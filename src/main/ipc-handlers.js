const fs = require("node:fs/promises");
const path = require("node:path");
const { validateUrl } = require("./engine/utils");
const { inspectTorrent } = require("./engine/TorrentMetadata");

function createHandlers({ services: s, desktop }) {
  const { manager, settings, mediaDetector } = s;
  const { LibraryTools } = require("./utils/library-tools");
  const library = new LibraryTools(manager);
  const { QueueAction } = require("./utils/queue-action");
  const queueAction = new QueueAction(manager, desktop);
  desktop?.app.once("before-quit", () => {
    queueAction.cancel();
    for (const id of library.jobs.keys()) library.cancel(id);
  });
  const desktopOnly = () => {
    if (!desktop)
      throw new Error(
        "This action needs the installed GetANNY desktop application.",
      );
    return desktop;
  };
  const openKnown = async (id, folder) => {
    const item = manager.requireItem(id);
    if (folder) {
      if (item.filePath && item.status === "completed") {
        await fs.access(item.filePath);
        desktopOnly().shell.showItemInFolder(item.filePath);
      } else {
        const error = await desktopOnly().shell.openPath(item.savePath);
        if (error) throw new Error(error);
      }
    } else {
      if (item.status !== "completed" || !item.filePath)
        throw new Error("Only completed downloads can be opened.");
      await fs.access(item.filePath).catch(() => {
        throw new Error("This file was moved or deleted outside GetANNY.");
      });
      if (/\.(exe|msi|bat|cmd|ps1|com|scr|js|vbs)$/i.test(item.filePath)) {
        const answer = await desktopOnly().dialog.showMessageBox(
          desktop.mainWindow(),
          {
            type: "warning",
            title: "Open downloaded program?",
            message: "Only run downloaded programs you trust.",
            detail: item.filePath,
            buttons: ["Cancel", "Open program"],
            defaultId: 0,
            cancelId: 0,
          },
        );
        if (answer.response !== 1) return { opened: false };
      }
      const error = await desktopOnly().shell.openPath(item.filePath);
      if (error) throw new Error(error);
    }
    return { opened: true };
  };
  return {
    "app:bootstrap": async () => ({
      version: require("../../package.json").version,
      platform: process.platform,
      desktop: !!desktop,
      settings: settings.getAll(),
      downloads: manager.getAll(),
      bridge: s.wsServer.status(),
      pendingRequests: [...s.pendingBrowserRequests],
      tools: await mediaDetector.ytdlp.availability(),
      capabilities: {
        login: !!desktop && ["win32", "darwin"].includes(process.platform),
        scheduledWake: desktop?.scheduledWake === true,
        dialogs: !!desktop,
        updates: !!desktop?.updater,
      },
      update: desktop?.updater?.getState() || { status: "unavailable" },
    }),
    "download:add": (options) => manager.addDownload(options),
    "download:add-torrent": (options) => manager.addTorrent(options),
    "torrent:inspect": ({ torrent }) =>
      inspectTorrent(torrent, {
        trackers: s.trackerList?.getTrackers() || [],
      }),
    "torrent:finish-seeding": async (id) => {
      const item = manager.requireItem(id);
      const engine = manager.running.get(id);
      if (
        item.kind !== "torrent" ||
        item.stage !== "seeding" ||
        !engine?.finishSeeding
      )
        throw new Error(
          "This torrent is not currently sharing completed pieces.",
        );
      return (await engine.finishSeeding()) !== false;
    },
    "storage:clear-temp": () => {
      desktopOnly();
      return s.clearTemporaryFiles();
    },
    "storage:free-space": async (folder) => {
      if (!desktop) return null;
      if (typeof folder !== "string" || !path.isAbsolute(folder))
        throw new Error("Choose a valid destination folder.");
      const stats = await fs.statfs(folder);
      return Number(stats.bavail) * Number(stats.bsize);
    },
    "download:configure": ({ id, changes }) => manager.configure(id, changes),
    "download:reorder": (ids) => manager.reorder(ids),
    "download:recover": ({ id, ...changes }) => manager.recover(id, changes),
    "download:destination": (options) => manager.previewDestination(options),
    "download:browser-fallback": async (id) => {
      const item = manager.requireItem(id);
      if (item.kind !== "file" || !["failed", "paused"].includes(item.status))
        throw new Error("Pause the file before using browser recovery.");
      const url = validateUrl(item.url);
      const browserId = item.browserSource || settings.get("preferredBrowser");
      const result = await s.wsServer.browserDownload(browserId, { url });
      if (!result.success || result.browserManaged !== true)
        throw new Error(
          "Connect the original browser with the updated GetANNY extension, then try again.",
        );
      return result;
    },
    "settings:export": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showSaveDialog(d.mainWindow(), {
        defaultPath: "GetANNY-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      // Portable preferences exclude local filesystem locations and OS startup
      // choices. No history, browser keys or credentials are exported.
      const values = Object.fromEntries(
        Object.entries(settings.getAll()).filter(
          ([key]) =>
            ![
              "defaultDownloadPath",
              "destinationRules",
              "firstRunCompleted",
              "launchAtLogin",
            ].includes(key),
        ),
      );
      await fs.writeFile(
        result.filePath,
        JSON.stringify({ schemaVersion: 1, preferences: values }, null, 2),
        { mode: 0o600 },
      );
      return true;
    },
    "settings:import": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = result.filePaths[0];
      if ((await fs.stat(file)).size > 65536)
        throw new Error("Settings file is too large.");
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        data.schemaVersion !== 1 ||
        !data.preferences ||
        typeof data.preferences !== "object" ||
        Array.isArray(data.preferences)
      )
        throw new Error("Unsupported settings file.");
      const { validateSetting } = require("./settings/schema");
      const entries = Object.entries(data.preferences);
      for (const [key, value] of entries) {
        if (
          [
            "defaultDownloadPath",
            "destinationRules",
            "firstRunCompleted",
            "launchAtLogin",
          ].includes(key)
        )
          throw new Error("Settings file contains a nonportable preference.");
        validateSetting(key, value);
      }
      const before = settings.getAll();
      try {
        for (const [key, value] of entries) await settings.set(key, value);
      } catch (error) {
        for (const [key] of entries)
          await settings.set(key, before[key]).catch(() => {});
        throw error;
      }
      return settings.getAll();
    },
    "app:diagnostics": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showSaveDialog(d.mainWindow(), {
        defaultPath: "GetANNY-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      const { diagnostics } = require("./utils/diagnostics");
      const data = diagnostics({
        manager,
        tools: await mediaDetector.ytdlp.availability(),
        version: require("../../package.json").version,
      });
      await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), {
        mode: 0o600,
      });
      return true;
    },
    "download:pause": (id) => manager.pause(id),
    "download:resume": (id) => manager.resume(id),
    "download:pause-all": (options) => manager.pauseAll(options),
    "download:resume-all": (options) => manager.resumeAll(options),
    "download:cancel": (id) => manager.cancel(id),
    "download:retry": (id) => manager.retry(id),
    "download:remove": (options) =>
      manager.remove(options.id, options.deleteFile === true),
    "download:clear-completed": () => manager.clearCompleted(),
    "download:clear-history": (options) => manager.clearHistory(options),
    "download:get-all": () => manager.getAll(),
    "download:preview": (id) => s.previews.get(manager.requireItem(id)),
    "download:local-preview": (id) => library.preview(id),
    "download:verify": ({ id, expected }) => library.verify(id, expected),
    "download:verify-cancel": (id) => library.cancel(id),
    "queue:action": (action) =>
      action === undefined ? queueAction.state : queueAction.arm(action),
    "download:open-file": (id) => openKnown(id, false),
    "download:open-folder": (id) => openKnown(id, true),
    "download:open-working-folder": async (id) => {
      const item = manager.requireItem(id);
      if (item.kind !== "torrent" || item.status === "completed")
        throw new Error(
          "The torrent work folder is only available during an active transfer.",
        );
      const location =
        manager.workPath(item) ||
        path.join(item.savePath, ".getanny-torrent", String(item.id));
      const stat = await fs.stat(location).catch(() => null);
      if (!stat?.isDirectory())
        throw new Error("No torrent working files were found yet.");
      const err = await desktopOnly().shell.openPath(location);
      if (err) throw new Error(err);
      return true;
    },
    "download:open-origin": async (id) => {
      const item = manager.requireItem(id);
      const raw =
        item.sourcePage ||
        item.browserPage ||
        (item.kind === "media" ? item.url : undefined);
      if (item.privateSession || !raw || !/^https?:\/\//i.test(raw))
        throw new Error(
          "No originating webpage was recorded for this download.",
        );
      await desktopOnly().shell.openExternal(validateUrl(raw));
      return true;
    },
    "media:preview": (url) => mediaDetector.preview(url),
    "media:captured": (url) => mediaDetector.captured(url),
    "media:download-captured": async ({
      pageUrl,
      captureId,
      savePath,
      posterUrl,
    }) => {
      if (!settings.get("mediaIntegration"))
        throw new Error("Media integration is disabled.");
      return manager.addDownload({
        ...mediaDetector.capturedSelection(pageUrl, captureId),
        sourcePage: pageUrl,
        posterUrl,
        ...(savePath ? { savePath } : {}),
      });
    },
    "media:get-formats": (url, requestId) =>
      mediaDetector.getFormats(url, { requestId }),
    "media:cancel-analysis": (requestId) =>
      mediaDetector.cancelAnalysis(requestId),
    "media:get-playlist": (url, requestId) =>
      mediaDetector.getPlaylist(url, {
        onEntry(count) {
          if (
            typeof requestId === "string" &&
            requestId.length <= 64 &&
            (count === 1 || count % 20 === 0)
          )
            s.events.emit("event", "media:playlist-progress", {
              requestId,
              count,
            });
        },
      }),
    "media:download": async (options) => {
      const selection = mediaDetector.selection(options);
      const subtitle = options.subtitle
        ? mediaDetector.subtitleSelection({
            analysisId: options.analysisId,
            languageId: options.subtitle.languageId,
            format: options.subtitle.format,
          })
        : null;
      if (subtitle && selection.media.segment)
        selection.media.segmentSubtitle = subtitle.media.subtitle;
      const id = await manager.addMedia({
        ...selection,
        savePath: options.savePath,
      });
      if (subtitle && !selection.media.segment)
        await manager.addMedia({ ...subtitle, savePath: options.savePath });
      return id;
    },
    "media:download-subtitle": (options) =>
      manager.addMedia({
        ...mediaDetector.subtitleSelection(options),
        savePath: options.savePath,
      }),
    "media:download-thumbnail": (options) =>
      manager.addDownload({
        ...mediaDetector.thumbnailSelection(options),
        savePath: options.savePath,
      }),
    "settings:get-all": () => settings.getAll(),
    "settings:set": async ({ key, value }) => {
      await settings.set(key, value);
      return settings.getAll();
    },
    "settings:reset": () => settings.reset(),
    "browser:status": () => s.browserStatus(),
    "browser:bridge-status": () => s.wsServer.status(),
    "browser:detect": () => s.browserDetector.detect(),
    "browser:prepare": (id) => {
      desktopOnly();
      return s.prepareBrowser(id);
    },
    "browser:open-extensions": (id) => {
      desktopOnly();
      return s.browserDetector.openExtensions(id);
    },
    "browser:open-package": async (id) => {
      const result = await s.extensionInstaller.check(id);
      if (!result.prepared) throw new Error("Prepare this extension first.");
      const manifest = path.join(result.path, "manifest.json");
      await fs.access(manifest);
      desktopOnly().shell.showItemInFolder(manifest);
      return true;
    },
    "browser:locate": async (id) => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        title: "Locate browser executable",
        properties: ["openFile"],
        ...(process.platform === "win32"
          ? { filters: [{ name: "Browser executable", extensions: ["exe"] }] }
          : {}),
      });
      if (!result.canceled)
        return s.browserDetector.locate(id, result.filePaths[0]);
      return null;
    },
    "browser:pairing-key": (browserId) => {
      const token = s.identity.clientTokens[browserId];
      if (!token) throw new Error("Choose a supported browser first.");
      return token;
    },
    "browser:ack-request": (id) => s.ackBrowserRequest(id),
    "browser:commit-request": ({ id, downloadId }) =>
      s.commitBrowserRequest(id, downloadId),
    "dialog:select-folder": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        defaultPath: settings.get("defaultDownloadPath"),
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    "dialog:select-torrent": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        properties: ["openFile"],
        filters: [{ name: "BitTorrent files", extensions: ["torrent"] }],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    "app:open-external": async (url) => {
      const d = desktopOnly();
      await d.shell.openExternal(validateUrl(url));
      return true;
    },
    "app:open-data-folder": async () => {
      const error = await desktopOnly().shell.openPath(path.dirname(s.db.file));
      if (error) throw new Error(error);
      return true;
    },
    "app:window-state": () => ({
      maximized: desktop?.mainWindow()?.isMaximized() || false,
    }),
    "clipboard:read-text": () => desktopOnly().clipboard.readText(),
    "app:quit": () => {
      desktopOnly().app.quit();
      return true;
    },
    "updates:get-state": () =>
      desktopOnly().updater?.getState() || { status: "unavailable" },
    "updates:check": () => desktopOnly().updater?.check(),
    "updates:download": () => desktopOnly().updater?.download(),
    "updates:install": () => desktopOnly().updater?.install(),
  };
}
function setupIpcHandlers({ ipcMain, services, desktop }) {
  const handlers = createHandlers({ services, desktop });
  const validateSender = (event) => {
    const win = desktop.mainWindow();
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender.");
  };
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, (event, ...args) => {
      validateSender(event);
      return handler(...args);
    });
  for (const action of ["minimize", "maximize", "close"])
    ipcMain.on(`window:${action}`, (event) => {
      validateSender(event);
      const win = desktop.mainWindow();
      if (action === "minimize") win.minimize();
      else if (action === "maximize")
        win.isMaximized() ? win.unmaximize() : win.maximize();
      else win.close();
    });
}
module.exports = { createHandlers, setupIpcHandlers };
