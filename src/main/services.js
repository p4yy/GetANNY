const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { Database } = require("./database/database");
const { DownloadsRepo } = require("./database/downloads-repo");
const { SettingsRepo } = require("./database/settings-repo");
const { SettingsService } = require("./settings/SettingsService");
const { DownloadManager } = require("./engine/DownloadManager");
const { reconcileTemporaryFiles } = require("./engine/transfer-cleanup");
const { TransferWorker } = require("./engine/transfer-worker");
const { TransferSpeedPolicy } = require("./engine/speed-policy");
const { TrackerListService } = require("./engine/TrackerListService");
const { MediaEngine } = require("./media/MediaEngine");
const { MediaDetector } = require("./media/MediaDetector");
const { PreviewService } = require("./previews/PreviewService");
const { WebSocketServer } = require("./browser-integration/WebSocketServer");
const { BrowserDetector } = require("./browser-integration/BrowserDetector");
const {
  ExtensionInstaller,
} = require("./browser-integration/ExtensionInstaller");
const {
  NativeMessagingHost,
} = require("./browser-integration/NativeMessagingHost");
const { getBridgeIdentity } = require("./browser-integration/BridgeIdentity");
const {
  BrowserSessionVault,
} = require("./browser-integration/BrowserSessionVault");
const { validateUrl } = require("./engine/utils");
const { BrowserPayloads } = require("./browser-integration/BrowserPayloads");
const themes = require("../shared/themes.json");
const { postLink, socialSite } = require("../extension/social-links");

// The browser extension mirrors the desktop palette, so the bridge sends the
// resolved tokens rather than a theme name the extension cannot resolve.
function themePayload(id) {
  const theme =
    themes.find((item) => item.id === id) ||
    themes.find((item) => item.id === "nord") ||
    themes[0];
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    colors: theme.colors,
  };
}

async function createServices({
  userDataPath,
  downloadPath,
  binPath,
  extensionPath,
  appPath = process.execPath,
  isPackaged = false,
  isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  nativeImage = null,
  safeStorage = null,
  getSystemIdleTime = null,
  logger = null,
  getFileIcon = null,
  port = 29615,
  onSettingChange = async () => {},
  onBrowserRequest = () => {},
  startTransfers = true,
}) {
  const events = new EventEmitter();
  const db = new Database(userDataPath);
  await db.initialize();
  const downloadsRepo = new DownloadsRepo(db);
  const settingsRepo = new SettingsRepo(db);
  let manager, wsServer, speedPolicy;
  const httpWorker = new TransferWorker("http");
  const torrentWorker = new TransferWorker("torrent");
  const settings = new SettingsService({
    repo: settingsRepo,
    downloadPath,
    onChange: async (key, value) => {
      await onSettingChange(key, value);
      if (key === "browserIntegrationEnabled") wsServer?.setEnabled(value);
      if (key === "theme") wsServer?.setTheme(themePayload(value));
      const updated = { ...settings.getAll(), [key]: value };
      speedPolicy?.configure(updated);
      manager?.updateSettings(updated, { applySpeed: false });
      events.emit("event", "settings:changed", {
        ...settings.getAll(),
        [key]: value,
      });
    },
  });
  const mediaDetector = new MediaDetector({ binPath });
  const trackerList = new TrackerListService({
    cachePath: path.join(userDataPath, "tracker-list.json"),
  });
  await trackerList.loadCache();
  if (startTransfers) trackerList.start();
  const previews = new PreviewService({
    userDataPath,
    binPath,
    nativeImage,
    getFileIcon,
  });
  const workRoot = path.join(userDataPath, "transfer-temp");
  let tempSweep;
  const clearTemporaryFiles = (startup = false) => {
    if (!tempSweep) {
      tempSweep = reconcileTemporaryFiles({
        workRoot,
        items: startup ? downloadsRepo.getAll() : manager.getAll(),
        defaultDestination: settings.get("defaultDownloadPath"),
        activeIds: new Set(manager.running.keys()),
        startup,
        logger,
      }).finally(() => {
        tempSweep = null;
      });
    }
    return tempSweep;
  };
  manager = new DownloadManager({
    settings: settings.getAll(),
    downloadsRepo,
    sessionVault: safeStorage
      ? new BrowserSessionVault({ userDataPath, safeStorage })
      : null,
    tempPath: workRoot,
    engineFactory: (item, options) => {
      speedPolicy.setTransferring(true);
      options.speedLimit = manager.limitFor(item);
      if (item.kind === "media")
        return new MediaEngine(options, mediaDetector.ytdlp);
      if (item.kind === "torrent")
        return torrentWorker.createTransfer(options, {
          shared: !item.downloadSpeedLimit,
          trackers: trackerList.getTrackers(),
          globalSpeedLimit: manager.globalSpeedLimit,
        });
      return httpWorker.createTransfer({ ...options, binPath });
    },
  });
  speedPolicy = new TransferSpeedPolicy({
    getSystemIdleTime,
    hasTransfers: false,
    onChange(limit) {
      manager.setGlobalSpeedLimit(limit);
      torrentWorker.throttle(limit);
    },
  });
  speedPolicy.configure(settings.getAll());
  const updateTransferActivity = (downloads) => {
    speedPolicy.setTransferring(downloads.some(({ status }) =>
      ["connecting", "downloading", "processing", "seeding"].includes(status),
    ));
  };
  manager.on("changed", updateTransferActivity);
  for (const [event, channel] of [
    ["changed", "downloads:changed"],
    ["added", "download:added"],
    ["progress", "download:progress"],
    ["status", "download:status"],
    ["complete", "download:complete"],
    ["download-error", "download:error"],
  ])
    manager.on(event, (data) => events.emit("event", channel, data));
  const identity = await getBridgeIdentity(userDataPath);
  const browserDetector = new BrowserDetector({ userDataPath });
  const extensionInstaller = new ExtensionInstaller({
    userDataPath,
    extensionPath,
    clientTokens: identity.clientTokens,
    port,
  });
  const pendingBrowserRequests = [];
  const recentBrowserRequests = new Map();
  const ownerSessions = new Map();
  function ownership(item, sessionId) {
    if (item.status === "completed" || item.status === "cancelled")
      return { action: "completed", id: item.id };
    if (item.returnedToBrowser || item.pendingBrowserReconciliation) {
      item.returnedToBrowser = true;
      item.pendingBrowserReconciliation = false;
      manager.persist(item);
      return { action: "browser", id: item.id };
    }
    if (item.retainsBrowserCopy) ownerSessions.set(item.id, sessionId);
    return {
      action: "queued",
      id: item.id,
      retainBrowserCopy: item.retainsBrowserCopy === true,
    };
  }
  async function processBrowserRequest(request, { sessionId }) {
    request.url = validateUrl(request.url);
    if (request.page) request.page = validateUrl(request.page);
    if (request.intercepted && request.page && !request.privateSession) {
      const waiting = [...manager.items.values()].filter(
        (item) =>
          item.awaitingBrowserConfirmation &&
          !item.returnedToBrowser &&
          item.browserSource === request.source &&
          item.browserPage === request.page &&
          item.filename === request.filename &&
          item.browserTransferId !== request.transferId,
      );
      if (waiting.length === 1) {
        const item = waiting[0];
        const prior = item.browserTransferId;
        const priorSession = ownerSessions.get(item.id);
        await manager.refreshBrowserDownload(item.id, request);
        if (prior && priorSession)
          wsServer
            .downloadCommand(priorSession, "cancel", prior)
            .catch(() => {});
        return ownership(item, sessionId);
      }
    }
    if (request.privateSession && request.kind === "media")
      throw new Error(
        "Private media pages stay in the browser. Start a file download there to hand it off.",
      );
    if (request.kind === "media" && !settings.get("mediaIntegration"))
      throw new Error(
        "Media-page integration is disabled in GetANNY settings.",
      );
    const dedupeKey = request.transferId
      ? `${request.source}:${request.transferId}`
      : null;
    if (dedupeKey) {
      const existing = manager
        .getAll()
        .find(
          (item) =>
            item.browserSource === request.source &&
            item.browserTransferId === request.transferId,
        );
      if (existing) return ownership(existing, sessionId);
    }
    if (dedupeKey && recentBrowserRequests.has(dedupeKey))
      return recentBrowserRequests.get(dedupeKey);
    const operation = (async () => {
      // Media pages need a format choice, so they open in Media studio. File
      // handoffs are always taken over and started automatically: making the
      // user revisit GetANNY to press Start leaves the browser in charge and
      // defeats the point of the integration.
      if (request.kind === "media") {
        const existing = request.transferId
          ? pendingBrowserRequests.find(
              (item) =>
                item.source === request.source &&
                item.transferId === request.transferId,
            )
          : null;
        if (existing) {
          existing.sessionId = sessionId;
          return { action: "review", pendingId: existing.id };
        }
        if (pendingBrowserRequests.length >= 20)
          throw new Error(
            "Too many unreviewed browser requests. Review the pending requests in GetANNY first.",
          );
        const review = {
          ...request,
          sessionId,
          id: randomUUID(),
          createdAt: Date.now(),
        };
        pendingBrowserRequests.push(review);
        // A UI delivery/focus failure must not turn an already-recorded
        // review into a rejection that resumes the browser copy.
        try {
          events.emit("event", "browser:request", review);
        } catch {
          // The pending request remains available through bootstrap.
        }
        try {
          onBrowserRequest(review);
        } catch {
          // Window focus is best effort, not an ownership decision.
        }
        return { action: "analyze", pendingId: review.id };
      }
      const id = await manager.addDownload({
        url: request.url,
        filename: request.filename,
        headers: request.headers,
        privateSession: request.privateSession,
        browserTransferId: request.transferId || undefined,
        retainsBrowserCopy:
          request.intercepted &&
          request.retainsBrowserCopy &&
          !request.privateSession,
        browserSource: request.source,
        browserPage: !request.privateSession ? request.page : undefined,
      });
      // Accepted automatic handoffs should be visible just like reviews.
      // The transfer has already been persisted, so a UI notification error
      // must not turn acceptance into a browser-side resume/duplicate.
      try {
        onBrowserRequest({ ...request, downloadId: id });
      } catch {
        // Window focus is best effort; it does not affect transfer ownership.
      }
      return ownership(manager.requireItem(id), sessionId);
    })();
    if (dedupeKey) {
      recentBrowserRequests.set(dedupeKey, operation);
      if (recentBrowserRequests.size > 100)
        recentBrowserRequests.delete(recentBrowserRequests.keys().next().value);
      operation.catch(() => recentBrowserRequests.delete(dedupeKey));
    }
    return operation;
  }
  const payloads = new BrowserPayloads(workRoot, manager);
  let socialBatch;
  let batchController;
  function startSocialBatch(page, urls) {
    if (!settings.get("mediaIntegration"))
      throw new Error(
        "Media-page integration is disabled in GetANNY settings.",
      );
    if (!socialSite(page))
      throw new Error("Open a supported social media page.");
    if (socialBatch) throw new Error("GetANNY is already processing a batch.");
    const posts = [
      ...new Set(urls.map((url) => postLink(url, page)).filter(Boolean)),
    ];
    if (!posts.length) throw new Error("The page has no supported posts.");
    batchController = new AbortController();
    const { signal } = batchController;
    socialBatch = (async () => {
      let queued = 0,
        skipped = 0;
      for (const url of posts) {
        if (signal.aborted) break;
        try {
          const info = await mediaDetector.getFormats(url, { signal });
          signal.throwIfAborted();
          const videos = info.formats.filter(
            (format) => format.group === "video",
          );
          const format =
            videos.find((item) => item.ext === "mp4" && item.height <= 1080) ||
            videos.find((item) => item.height <= 1080) ||
            videos.at(-1);
          if (!format || info.live)
            throw new Error("Post has no downloadable video.");
          await manager.addMedia(
            mediaDetector.selection({
              analysisId: info.analysisId,
              formatId: format.formatId,
            }),
          );
          queued++;
        } catch (error) {
          skipped++;
          if (!signal.aborted)
            logger?.warn("Social batch post:", error.message);
        }
        events.emit("event", "media:social-batch-progress", {
          total: posts.length,
          queued,
          skipped,
        });
      }
    })().finally(() => {
      socialBatch = undefined;
      batchController = undefined;
    });
    socialBatch.catch((error) => logger?.warn("Social batch:", error.message));
    return { accepted: posts.length };
  }

  wsServer = new WebSocketServer({
    port,
    nativeToken: identity.nativeToken,
    recoveryToken: identity.recoveryToken,
    clientTokens: identity.clientTokens,
    enabled: settings.get("browserIntegrationEnabled"),
    theme: themePayload(settings.get("theme")),
    onDownloadRequest: processBrowserRequest,
    onMediaDetected: (data) => {
      if (!settings.get("mediaIntegration")) return;
      const captured = mediaDetector.capture(data);
      if (captured) events.emit("event", "media:captured", captured);
    },
    onSocialBatch: startSocialBatch,
    onBrowserPayload: (message, sessionId) =>
      payloads.receive(message, sessionId),
    onDownloadStatus: async ({ transferId, source }, { sessionId }) => {
      const review = pendingBrowserRequests.find(
        (item) => item.source === source && item.transferId === transferId,
      );
      if (review) {
        review.sessionId = sessionId;
        return { action: "review", pendingId: review.id };
      }
      const item = manager
        .getAll()
        .find(
          (item) =>
            item.browserSource === source &&
            item.browserTransferId === transferId,
        );
      return item ? ownership(item, sessionId) : { action: "missing" };
    },
    onHello: (session) => {
      const evidence = settingsRepo.get("integrationEvidence") || {};
      evidence[session.browserId] = {
        lastSeen: Date.now(),
        version: session.version,
        transport: session.transport,
      };
      settingsRepo.set("integrationEvidence", evidence);
      // A verified handshake is the completion signal for first-time setup, so
      // later launches open the library instead of the welcome screen.
      if (!settings.get("firstRunCompleted"))
        settings.set("firstRunCompleted", true).catch(() => {});
      events.emit("event", "browser:changed", wsServer.status());
    },
    onConnectionChange: (status) =>
      events.emit("event", "browser:changed", status),
  });
  function discardBrowserCopy(id) {
    const session = ownerSessions.get(id);
    if (!session) return;
    const transferId = manager.requireItem(id).browserTransferId;
    if (!transferId) return;
    // Completion of the desktop transfer precedes browser cleanup by design.
    // Keep the ownership record until the browser confirms cancel+erase.
    // A dropped result or transient bridge error must not silently erase the
    // only information needed for a safe retry.
    const cleanup = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (ownerSessions.get(id) !== session) return;
        try {
          const result = await wsServer.downloadCommand(
            session,
            "cancel",
            transferId,
          );
          if (result.success === true) {
            ownerSessions.delete(id);
            return;
          }
          if (attempt === 2)
            logger?.warn(
              "Browser cleanup still unacknowledged:",
              result.error || "Browser connection unavailable",
            );
        } catch (error) {
          if (attempt === 2)
            logger?.warn("Browser cleanup still unacknowledged:", error.message);
        }
        if (attempt < 2)
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
      // The browser's own reconnect reconciliation checks the desktop's
      // completed status and retries the native erase. Never resume an accepted
      // browser download or delete an unrelated filesystem path.
    };
    cleanup().catch((error) =>
      logger?.warn("Browser cleanup retry:", error.message),
    );
  }
  manager.on("complete", ({ id }) => discardBrowserCopy(id));
  manager.on("status", ({ id, status }) => {
    if (status === "cancelled") discardBrowserCopy(id);
  });
  await new Promise((resolve) => {
    if (wsServer.server.address() || wsServer.error) resolve();
    else {
      wsServer.server.once("listening", resolve);
      wsServer.server.once("error", resolve);
    }
  });
  const nativeMessagingHost = new NativeMessagingHost({
    userDataPath,
    appPath,
    isPackaged,
    binPath,
    token: identity.nativeToken,
    port: wsServer.status().port,
  });
  if (!startTransfers) manager.stopped = true;
  else {
    await clearTemporaryFiles(true);
    await manager.restoreDownloads();
  }
  function takeBrowserRequest(id) {
    const index = pendingBrowserRequests.findIndex(
      (request) => request.id === id,
    );
    if (index < 0) return null;
    return pendingBrowserRequests.splice(index, 1)[0];
  }
  async function ackBrowserRequest(id) {
    const request = takeBrowserRequest(id);
    if (!request) return { found: false };
    if (request.intercepted && request.transferId) {
      const result = await wsServer.downloadCommand(
        request.sessionId,
        "resume",
        request.transferId,
      );
      return { found: true, resumed: result.success === true };
    }
    return { found: true };
  }
  async function commitBrowserRequest(id, downloadId) {
    const request = pendingBrowserRequests.find((request) => request.id === id);
    if (!request) return { found: false };
    if (request.intercepted && request.transferId) {
      if (!downloadId)
        throw new Error(
          "A matching desktop download is required before browser handoff.",
        );
      const item = manager.requireItem(downloadId);
      if (
        item.kind !== "file" ||
        item.browserTransferId !== request.transferId ||
        item.browserSource !== request.source ||
        item.url !== request.url
      )
        throw new Error(
          "The desktop download does not match this browser request.",
        );
    } else if (downloadId) manager.requireItem(downloadId);
    takeBrowserRequest(id);
    if (request.intercepted && request.transferId) {
      const result = await wsServer.downloadCommand(
        request.sessionId,
        "cancel",
        request.transferId,
      );
      return { found: true, cancelled: result.success === true };
    }
    return { found: true, cancelled: true };
  }
  async function browserStatus() {
    const websocket = wsServer.status();
    const evidence = settingsRepo.get("integrationEvidence") || {};
    const detected = await browserDetector.detect();
    const browsers = await Promise.all(
      detected.map(async (browser) => {
        const [prepared, host] = await Promise.all([
          extensionInstaller.check(browser.id),
          nativeMessagingHost.check(browser.id),
        ]);
        const session = websocket.sessions.find(
          (value) => value.browserId === browser.id,
        );
        return {
          ...browser,
          prepared: prepared.prepared,
          directProvisioned: prepared.directProvisioned,
          packagePath: prepared.path,
          registered: host.registered,
          nativeManifestPath: host.path,
          connected: !!session,
          extensionInstalled: session ? true : null,
          extensionEnabled: session ? true : null,
          transport: session?.transport || null,
          lastSeen: session?.lastSeen || evidence[browser.id]?.lastSeen || null,
        };
      }),
    );
    return { websocket, browsers };
  }
  async function prepareBrowser(id, onProgress = async () => {}) {
    if (isPortable)
      throw new Error(
        "The portable launcher uses temporary files and cannot keep a stable provisioned extension credential. Use the installed app, or load a release extension and enter its recovery key while GetANNY is running.",
      );
    await onProgress("extension-prepare", { browserId: id });
    const extension = await extensionInstaller.install(id);
    await onProgress("native-register", { browserId: id });
    try {
      const host = await nativeMessagingHost.register(id);
      return {
        ...extension,
        registered: host.registered,
        nativeManifestPath: host.path,
        hostPath: host.hostPath,
        instructions: extension.instructions,
      };
    } catch (error) {
      // The provisioned WebSocket is the primary transport. Native messaging
      // remains a cold-start/bootstrap adapter, so its failure must be visible
      // without invalidating a working direct package.
      await onProgress("native-warning", {
        browserId: id,
        error: error.message,
      });
      return {
        ...extension,
        registered: false,
        nativeError: error.message,
        instructions: extension.instructions,
      };
    }
  }
  async function setupInstalledBrowsers(onProgress = async () => {}) {
    const result = [];
    await onProgress("browser-detect");
    const detected = await browserDetector.detect();
    await onProgress("browser-detected", {
      installed: detected
        .filter((browser) => browser.installed)
        .map((browser) => browser.id),
    });
    // Registration used to be gated on executable detection. A missed custom
    // path therefore made both installers report success while writing no host
    // or usable fallback for that browser. Preparing all supported adapters is
    // deterministic, harmless for absent browsers and also covers browsers
    // installed after GetANNY.
    for (const browser of detected) {
      try {
        result.push({
          browserId: browser.id,
          browserDetected: browser.installed,
          ...(await prepareBrowser(browser.id, onProgress)),
        });
        await onProgress("browser-prepared", { browserId: browser.id });
      } catch (error) {
        result.push({
          browserId: browser.id,
          browserDetected: browser.installed,
          error: error.message,
        });
        await onProgress("browser-error", {
          browserId: browser.id,
          error: error.message,
        });
      }
    }
    await onProgress("write-setup-report");
    await fs.writeFile(
      path.join(userDataPath, "browser-setup-report.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  }
  return {
    events,
    db,
    manager,
    downloadsRepo,
    settings,
    settingsRepo,
    trackerList,
    mediaDetector,
    previews,
    wsServer,
    browserDetector,
    extensionInstaller,
    nativeMessagingHost,
    identity,
    pendingBrowserRequests,
    browserStatus,
    ackBrowserRequest,
    commitBrowserRequest,
    prepareBrowser,
    setupInstalledBrowsers,
    clearTemporaryFiles,
    async close() {
      batchController?.abort();
      await socialBatch?.catch(() => {});
      manager.off("changed", updateTransferActivity);
      await previews.close();
      mediaDetector.captures.close();
      // A reviewed native transfer is still paused in the browser. On clean
      // shutdown, explicitly return those reviews instead of stranding them.
      await Promise.all(
        pendingBrowserRequests
          .filter((request) => request.intercepted && request.transferId)
          .map((request) =>
            wsServer.downloadCommand(
              request.sessionId,
              "resume",
              request.transferId,
            ),
          ),
      );
      try {
        await manager.shutdown();
        await Promise.all(
          manager
            .getAll()
            .filter(
              (item) =>
                item.retainsBrowserCopy &&
                !item.returnedToBrowser &&
                !["completed", "cancelled"].includes(item.status) &&
                ownerSessions.has(item.id),
            )
            .map(async (record) => {
              const item = manager.requireItem(record.id);
              // Persist ownership before sending the command, so a lost
              // acknowledgement cannot cause a duplicate on desktop restart.
              item.returnedToBrowser = true;
              manager.persist(item);
              await wsServer.downloadCommand(
                ownerSessions.get(item.id),
                "resume",
                item.browserTransferId,
              );
            }),
        );
      } finally {
        speedPolicy.close();
        await wsServer.close();
        await payloads.close();
        await Promise.all([httpWorker.close(), torrentWorker.close()]);
        await trackerList.close();
        db.close();
      }
    },
  };
}
module.exports = { createServices };
