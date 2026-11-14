const { isSensitiveHeader } = require("../utils/sensitive-headers");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { ChunkDownloader } = require("./ChunkDownloader");
const { FtpDownloader } = require("./FtpDownloader");
const { BrowserPayloadDownloader } = require("./BrowserPayloadDownloader");
const {
  MegaDownloader,
  isMegaShare,
  isMegaFolderShare,
  loadMegaShare,
  listMegaFiles,
  megaChildLink,
} = require("./MegaDownloader");
const {
  validateUrl,
  validateDownloadUrl,
  validateHeaders,
  sanitizeFilename,
  getFilenameFromURL,
  categoryFor,
} = require("./utils");

const ACTIVE = new Set(["connecting", "downloading", "processing"]);
// External posters are only visual hints; never pass cookies or privileged
// headers to renderer images. The completed file gets its own local preview.
function safePoster(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.hostname === "localhost" || url.hostname.endsWith(".local"))
      return undefined;
    return url.href;
  } catch { return undefined; }
}
// Daily local-time window. Equal endpoints mean the full day, avoiding a
// configuration that could silently prevent every transfer forever.
function isWithinSchedule(settings, date = new Date()) {
  if (!settings.scheduleEnabled) return true;
  const start = settings.scheduleStartMinute ?? 0;
  const end = settings.scheduleEndMinute ?? 360;
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
class DownloadManager extends EventEmitter {
  constructor({
    settings = {},
    downloadsRepo,
    tempPath = null,
    engineFactory,
    sessionVault = null,
    loadMega = loadMegaShare,
    onProgress = () => {},
    onStatusChange = () => {},
    onComplete = () => {},
    onError = () => {},
  } = {}) {
    super();
    Object.assign(this, {
      settings,
      repo: downloadsRepo,
      tempPath,
      engineFactory,
      sessionVault,
      loadMega,
      onProgress,
      onStatusChange,
      onComplete,
      onError,
    });
    this.globalSpeedLimit = settings.speedLimit || 0;
    this.items = new Map();
    this.rememberedSessions = new Set();
    this.running = new Map();
    this.pausedEngines = new Map();
    this.queue = [];
    this.retryTimers = new Map();
    this.pendingProgress = new Map();
    this.progressDirty = new Set();
    this.progressTimer = null;
    this.persistenceTimer = null;
    this.scheduleTimer = null;
    this.stopped = false;
    this.bulkPauseInProgress = false;
    this.reservationQueue = Promise.resolve();
  }
  snapshot() {
    this.emit("changed", this.getAll());
  }
  publicItem(item) {
    const { sessionHeaders, browserPayloadPath, ...safe } = item;
    safe.headers = persistentHeaders(safe.headers);
    return safe;
  }
  persist(item) {
    this.progressDirty.delete(item.id);
    if (this.repo && !item.privateSession)
      Object.assign(item, this.repo.save(item, item));
  }
  queueProgress(id, progress) {
    this.pendingProgress.set(id, progress);
    this.progressDirty.add(id);
    if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => this.flushProgress(), 150);
      this.progressTimer.unref?.();
    }
    if (!this.persistenceTimer) {
      this.persistenceTimer = setTimeout(() => this.flushPersistence(), 2000);
      this.persistenceTimer.unref?.();
    }
  }
  flushProgress() {
    clearTimeout(this.progressTimer);
    this.progressTimer = null;
    const pending = [...this.pendingProgress];
    this.pendingProgress.clear();
    for (const [id, progress] of pending) {
      if (!this.items.has(id)) continue;
      this.onProgress(id, progress);
      this.emit("progress", { id, ...progress });
    }
  }
  flushPersistence() {
    clearTimeout(this.persistenceTimer);
    this.persistenceTimer = null;
    for (const id of this.progressDirty) {
      const item = this.items.get(id);
      if (item) this.persist(item);
    }
    this.progressDirty.clear();
  }
  discardProgress(id) {
    this.pendingProgress.delete(id);
    this.progressDirty.delete(id);
  }
  async addDownload(input) {
    if (!input?.url) throw new Error("A download URL is required.");
    const url = validateDownloadUrl(input.url);
    if (!isMegaShare(url) || !isMegaFolderShare(url))
      return this.add({ ...input, url, kind: "file" });
    if (input.browserTransferId || input.privateSession)
      throw new Error("Open the MEGA folder in GetANNY to queue its files.");
    const timeout = (this.settings.requestTimeoutSeconds || 30) * 1000;
    const root = await this.loadMega(
      url,
      AbortSignal.timeout(timeout),
      timeout,
    );
    const files = listMegaFiles(root);
    if (!files.length)
      throw new Error("The MEGA folder contains no downloadable files.");
    const byUrl = new Map(
      [...this.items.values()]
        .filter((item) => !["failed", "cancelled"].includes(item.status))
        .map((item) => [item.url, item.id]),
    );
    let firstId;
    for (const { node, folders } of files) {
      const child = megaChildLink(url, node);
      const parent = path.join(
        input.savePath || this.settings.defaultDownloadPath,
        ...folders,
      );
      const id =
        byUrl.get(child) ||
        (await this.add({
          url: child,
          savePath: parent,
          filename: node.name,
          startImmediately: input.startImmediately,
          kind: "file",
        }));
      firstId ??= id;
    }
    return firstId;
  }
  async addMedia(input) {
    return this.add({ ...input, kind: "media" });
  }
  async addTorrent(input) {
    return this.add({ ...input, url: input.torrent, kind: "torrent" });
  }
  async add(input) {
    if (!input?.url) throw new Error("A download URL is required.");
    const url =
      input.kind === "torrent"
        ? String(input.url).trim()
        : input.kind === "file"
          ? validateDownloadUrl(input.url)
          : validateUrl(input.url);
    if (input.kind === "torrent" && !url.startsWith("magnet:?")) {
      const remoteTorrent =
        /^https?:\/\//i.test(url) && /\.torrent(?:$|[?#])/i.test(url);
      if (!remoteTorrent && !path.isAbsolute(url))
        throw new Error(
          "Choose a .torrent file, a .torrent link, or paste a magnet link.",
        );
      if (remoteTorrent) validateUrl(url);
    }
    const duplicate = [...this.items.values()].find(
      (other) =>
        !["cancelled", "failed"].includes(other.status) &&
        other.url === url &&
        Boolean(other.privateSession) === (input.privateSession === true) &&
        other.kind === (input.kind || "file") &&
        JSON.stringify(other.media || null) ===
          JSON.stringify(input.media || null),
    );
    if (duplicate && !input.allowDuplicate)
      throw new Error(
        "This download is already in your library. Open its details to resume or retry it.",
      );
    const destination = this.previewDestination(input);
    const savePath = destination.folder;
    if (!input.savePath && (destination.rule || this.settings.organizeByType))
      input.savePath = savePath;
    if (!savePath || !path.isAbsolute(savePath))
      throw new Error("Choose a valid absolute destination folder.");
    await fs.mkdir(savePath, { recursive: true });
    await fs.access(savePath, fs.constants.W_OK);
    if (
      input.kind === "media" &&
      this.settings.organizeByType &&
      !input.savePath
    ) {
      input.savePath = path.join(
        savePath,
        input.media.type === "subtitle"
          ? "Subtitles"
          : input.media.audioOnly
            ? "Audio"
            : "Video",
      );
      await fs.mkdir(input.savePath, { recursive: true });
    }
    const requestHeaders = validateHeaders(input.headers);
    const sessionHeaders = Object.fromEntries(
      Object.entries(requestHeaders).filter(([key]) => isSensitiveHeader(key)),
    );
    const safeHeaders = Object.fromEntries(
      Object.entries(requestHeaders).filter(([key]) => !isSensitiveHeader(key)),
    );
    const id = randomUUID();
    let browserPayloadPath;
    if (input.browserPayloadFile) {
      const dir = path.join(this.tempPath, id);
      await fs.mkdir(dir, { recursive: true });
      browserPayloadPath = path.join(dir, "browser-payload");
      await fs.rename(input.browserPayloadFile, browserPayloadPath);
    }
    let torrentMetadataPath;
    if (input.kind === "torrent" && input.torrentFileBase64) {
      if (
        typeof input.torrentFileBase64 !== "string" ||
        input.torrentFileBase64.length > 24 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          input.torrentFileBase64,
        )
      )
        throw new Error(
          "Torrent metadata is invalid or exceeds the 16 MB limit.",
        );
      const data = Buffer.from(input.torrentFileBase64, "base64");
      if (!data.length || data.length > 16 * 1024 * 1024)
        throw new Error(
          "Torrent metadata is invalid or exceeds the 16 MB limit.",
        );
      const parseTorrent = (await import("parse-torrent")).default;
      const parsed = await parseTorrent(data);
      if (
        input.infoHash &&
        parsed.infoHash?.toLowerCase() !== String(input.infoHash).toLowerCase()
      )
        throw new Error(
          "Torrent metadata does not match the selected torrent.",
        );
      const workPath = this.tempPath
        ? path.join(this.tempPath, id)
        : path.join(savePath, ".getanny-torrent", id);
      await fs.mkdir(workPath, { recursive: true });
      torrentMetadataPath = path.join(workPath, "source.torrent");
      await fs.writeFile(torrentMetadataPath, data, { flag: "wx" });
    }
    const item = {
      id,
      url,
      filename: input.filename
        ? sanitizeFilename(input.filename)
        : input.kind === "torrent"
          ? input.torrentName
            ? sanitizeFilename(input.torrentName)
            : "Waiting for torrent metadata"
          : getFilenameFromURL(url) || "download",
      filenameExplicit: !!input.filename,
      savePath: input.savePath || savePath,
      destinationExplicit: !!input.savePath,
      status:
        input.startImmediately === undefined
          ? this.settings.autoStartDownloads === false
            ? "paused"
            : "queued"
          : input.startImmediately
            ? "queued"
            : "paused",
      totalSize: 0,
      downloadedSize: 0,
      speed: 0,
      eta: null,
      priority: 0,
      queueOrder: Date.now(),
      downloadSpeedLimit: 0,
      attempt: 0,
      createdAt: new Date().toISOString(),
      kind: input.kind || "file",
      ...(input.kind === "torrent"
        ? {
            selectedFiles: Array.isArray(input.selectedFiles)
              ? input.selectedFiles.filter(
                  (index) => Number.isInteger(index) && index > 0,
                )
              : undefined,
            prioritizeFirstLast: input.prioritizeFirstLast === true,
            torrentOrder:
              input.torrentOrder === "sequential" ? "sequential" : "rarest",
            seedMinutes: [0, 5, 15, 60].includes(input.seedMinutes)
              ? input.seedMinutes
              : 0,
            torrentPriorities: Object.fromEntries(
              Object.entries(input.torrentPriorities || {})
                .filter(
                  ([index, priority]) =>
                    /^\d{1,6}$/.test(index) &&
                    Number(index) > 0 &&
                    [0, 1, 2].includes(priority),
                )
                .slice(0, 100000),
            ),
            torrentName: input.torrentName || undefined,
            infoHash: input.infoHash || undefined,
            torrentMetadataPath,
            torrentTrackers: Array.isArray(input.torrentTrackers)
              ? input.torrentTrackers.filter(
                  (tracker) =>
                    typeof tracker === "string" &&
                    /^(?:udp|https?|wss?):\/\//i.test(tracker),
                )
              : undefined,
          }
        : {}),
      headers: safeHeaders,
      ...(Object.keys(sessionHeaders).length
        ? { sessionHeaders, sessionRequired: true }
        : {}),
      privateSession: input.privateSession === true || undefined,
      browserTransferId: input.browserTransferId || undefined,
      browserSource: input.browserSource || undefined,
      browserPage: input.browserPage || undefined,
      // The originating webpage is distinct from a magnet link or CDN/file URL.
      // Keep it only for ordinary non-private downloads and validate it before persistence.
      sourcePage: !input.privateSession && input.sourcePage
        ? validateUrl(input.sourcePage)
        : undefined,
      posterUrl: input.privateSession ? undefined : safePoster(input.posterUrl),
      browserPayloadPath,
      retainsBrowserCopy: input.retainsBrowserCopy === true || undefined,
      ...(input.kind === "media"
        ? {
            media: input.media,
            filename: input.media.title,
            category:
              input.media.type === "subtitle"
                ? "Documents"
                : input.media.audioOnly
                  ? "Audio"
                  : "Video",
          }
        : {}),
    };
    if (
      item.browserSource &&
      item.sessionHeaders &&
      !item.privateSession &&
      this.sessionVault
    ) {
      const remembered = await this.sessionVault
        .store(item.id, item.url, item.sessionHeaders)
        .catch(() => false);
      if (remembered) this.rememberedSessions.add(item.id);
    }
    this.items.set(item.id, item);
    this.persist(item);
    this.emit("added", this.publicItem(item));
    this.snapshot();
    if (item.status === "queued") this.queue.push(item.id);
    this.pump();
    return item.id;
  }
  previewDestination(input = {}) {
    const category =
      input.kind === "torrent"
        ? "Torrents"
        : input.media
          ? input.media.audioOnly
            ? "Audio"
            : input.media.type === "subtitle"
              ? "Documents"
              : "Video"
          : categoryFor(
              input.filename ||
                getFilenameFromURL(input.url || "") ||
                "download",
            );
    const rule = !input.savePath && this.settings.destinationRules?.[category];
    const base = input.savePath || rule || this.settings.defaultDownloadPath;
    return {
      category,
      rule: !!rule,
      folder:
        !input.savePath && !rule && this.settings.organizeByType
          ? path.join(base, category)
          : base,
    };
  }
  async configure(id, changes = {}) {
    const item = this.requireItem(id);
    if (changes.priority !== undefined) {
      if (![-1, 0, 1].includes(changes.priority))
        throw new Error("Invalid priority.");
      item.priority = changes.priority;
    }
    if (changes.downloadSpeedLimit !== undefined) {
      if (
        !Number.isSafeInteger(changes.downloadSpeedLimit) ||
        changes.downloadSpeedLimit < 0 ||
        changes.downloadSpeedLimit > 1024 ** 4
      )
        throw new Error("Invalid speed limit.");
      // HTTP supports live changes. External media tools require a safe pause
      // and resume; the UI labels this explicitly rather than pretending live.
      if (ACTIVE.has(item.status) && item.kind !== "file")
        throw new Error("Pause this download before changing its speed limit.");
      item.downloadSpeedLimit = changes.downloadSpeedLimit;
      this.running.get(id)?.limiter?.setLimit(this.limitFor(item));
      const paused = this.pausedEngines.get(id);
      if (paused) {
        await paused.shutdown();
        this.pausedEngines.delete(id);
      }
    }
    this.persist(item);
    this.snapshot();
    this.pump();
    return this.publicItem(item);
  }
  reorder(ids) {
    if (
      !Array.isArray(ids) ||
      ids.length > this.items.size ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Invalid queue order.");
    const candidates = ids.map((id) => this.requireItem(id));
    if (candidates.some((item) => item.status !== "queued"))
      throw new Error("Only queued downloads can be reordered.");
    candidates.forEach((item, index) => {
      item.queueOrder = index;
      this.persist(item);
    });
    this.snapshot();
    this.pump();
    return true;
  }
  async refreshBrowserDownload(id, request) {
    const item = this.requireItem(id);
    if (!item.awaitingBrowserConfirmation || this.running.has(id))
      throw new Error(
        "The download is no longer waiting for browser confirmation.",
      );
    await this.recover(id, { url: request.url });
    const headers = validateHeaders(request.headers);
    this.forgetSession(item);
    item.headers = persistentHeaders(headers);
    item.sessionHeaders = Object.fromEntries(
      Object.entries(headers).filter(([key]) => isSensitiveHeader(key)),
    );
    item.sessionRequired = Object.keys(item.sessionHeaders).length > 0;
    if (!item.sessionRequired) delete item.sessionHeaders;
    else if (
      this.sessionVault &&
      !item.privateSession &&
      (await this.sessionVault
        .store(id, item.url, item.sessionHeaders)
        .catch(() => false))
    )
      this.rememberedSessions.add(id);
    item.awaitingBrowserConfirmation = false;
    item.browserTransferId = request.transferId || item.browserTransferId;
    item.retainsBrowserCopy = request.retainsBrowserCopy === true;
    item.pendingBrowserReconciliation = false;
    item.error = null;
    item.errorCode = null;
    this.persist(item);
    this.resume(id);
    return id;
  }

  async recover(id, { url, savePath } = {}) {
    const item = this.requireItem(id);
    if (
      !["paused", "failed", "cancelled"].includes(item.status) ||
      this.running.has(id)
    )
      throw new Error("Pause the download before repairing it.");
    if (this.pausedEngines.has(id))
      throw new Error(
        "Resume this torrent or add it again to change its source or destination.",
      );
    if (url !== undefined) {
      if (item.kind === "torrent")
        throw new Error("Torrent sources cannot be replaced.");
      const next =
        item.kind === "file" ? validateDownloadUrl(url) : validateUrl(url);
      if (next !== item.url) {
        // A new link may identify different bytes. Never splice old fragments
        // into a replacement source without a validated identity.
        const work = this.workPath(item);
        if (!work)
          throw new Error("Add the replacement source as a new download.");
        await fs.rm(work, { recursive: true, force: true });
        item.downloadedSize = 0;
        item.totalSize = 0;
        this.forgetSession(item);
        item.url = next;
        item.sessionRequired = false;
        item.headers = {};
      }
    }
    if (savePath !== undefined) {
      if (typeof savePath !== "string" || !path.isAbsolute(savePath))
        throw new Error("Choose a valid destination.");
      await fs.mkdir(savePath, { recursive: true });
      await fs.access(savePath, fs.constants.W_OK);
      if (!this.workPath(item))
        throw new Error(
          "Add this download again to choose another destination.",
        );
      item.savePath = savePath;
      item.destinationExplicit = true;
    }
    item.targetReserved = false;
    item.error = null;
    item.status = "paused";
    this.persist(item);
    this.snapshot();
    return this.publicItem(item);
  }
  reserve(item, info) {
    const next = this.reservationQueue.then(() =>
      this.reserveTarget(item, info),
    );
    this.reservationQueue = next.catch(() => {});
    return next;
  }
  async reserveTarget(item, info) {
    if (!item.targetReserved) {
      let filename = sanitizeFilename(info.filename);
      const category = categoryFor(filename);
      if (this.settings.organizeByType && !item.destinationExplicit)
        item.savePath = path.join(item.savePath, category);
      await fs.mkdir(item.savePath, { recursive: true });
      const extension = path.extname(filename);
      const basename = path.basename(filename, extension);
      let counter = 0;
      while (true) {
        const occupied = [...this.items.values()].some(
          (other) =>
            other.id !== item.id &&
            other.targetReserved &&
            other.savePath === item.savePath &&
            other.filename === filename,
        );
        const exists = await fs.access(path.join(item.savePath, filename)).then(
          () => true,
          () => false,
        );
        if (!occupied && !exists) break;
        filename = `${basename} (${++counter})${extension}`;
      }
      item.filename = filename;
      item.filenameExplicit = true;
      item.targetReserved = true;
      item.category = category;
      this.persist(item);
    }
    return { filename: item.filename, savePath: item.savePath };
  }
  workPath(item) {
    return this.tempPath ? path.join(this.tempPath, item.id) : null;
  }
  createEngine(item) {
    const options = {
      ...item,
      headers: { ...(item.headers || {}), ...(item.sessionHeaders || {}) },
      timeout: (this.settings.requestTimeoutSeconds || 30) * 1000,
      connections: this.settings.maxConnectionsPerDownload || 8,
      maxConcurrentDownloads: this.settings.maxConcurrentDownloads || 3,
      speedLimit: this.limitFor(item),
      tempPath: this.workPath(item),
      reserveTarget: (info) => this.reserve(item, info),
    };
    const engine =
      this.engineFactory?.(item, options) ||
      (item.browserPayloadPath
        ? new BrowserPayloadDownloader(options)
        : /^ftps?:/i.test(item.url)
          ? new FtpDownloader(options)
          : isMegaShare(item.url)
            ? new MegaDownloader(options)
            : new ChunkDownloader(options));
    engine.on("progress", (_id, progress) => {
      if (this.running.get(item.id) !== engine) return;
      Object.assign(item, progress);
      this.queueProgress(item.id, progress);
    });
    engine.on("status", (_id, status, data = {}) => {
      this.flushProgress();
      if (status === "cancelled") this.forgetSession(item);
      Object.assign(item, data, { status, speed: 0, eta: null });
      if (status !== "processing") {
        item.stage = null;
        item.stageProgress = null;
      }
      this.persist(item);
      this.onStatusChange(item.id, status, data);
      this.emit("status", { id: item.id, status, ...data });
      this.snapshot();
    });
    engine.on("complete", (_id, data) => {
      this.flushProgress();
      this.forgetSession(item);
      Object.assign(item, data, {
        status: "completed",
        completedAt: item.completedAt || new Date().toISOString(),
        speed: 0,
        eta: null,
        error: null,
      });
      this.persist(item);
      this.onComplete(item.id, data);
      this.emit("complete", { id: item.id, ...data });
      this.snapshot();
    });
    engine.on("error", (_id, error) => {
      engine.failure = error;
      this.failItem(item, error);
    });
    return engine;
  }
  failItem(item, error) {
    this.flushProgress();
    if (
      !this.rememberedSessions.has(item.id) ||
      ["AUTH_REQUIRED", "SITE_BLOCKED"].includes(error.code) ||
      [401, 403].includes(error.statusCode)
    )
      this.forgetSession(item);
    item.error = error.message;
    item.errorCode = error.code || null;
    item.speed = 0;
    item.eta = null;
    item.awaitingBrowserConfirmation = Boolean(
      item.browserPage &&
      ["AUTH_REQUIRED", "SOURCE_PAGE", "SITE_BLOCKED"].includes(error.code),
    );
    item.status = item.awaitingBrowserConfirmation ? "paused" : "failed";
    if (item.awaitingBrowserConfirmation)
      item.error =
        "Complete the site confirmation in your browser, then start the file download again.";
    this.persist(item);
    this.onError(item.id, error);
    this.emit("download-error", {
      id: item.id,
      error: item.error,
      ...(error.code ? { code: error.code } : {}),
    });
    this.snapshot();
  }
  pump() {
    // Do not replace a paused engine with a queued job mid-batch.
    if (this.stopped || this.bulkPauseInProgress) return;
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    if (this.queue.length && !isWithinSchedule(this.settings)) {
      // Recheck after clock changes or wake from sleep as well as at the next
      // minute. Running transfers are not interrupted by the window closing.
      this.scheduleTimer = setTimeout(() => this.pump(), 30000);
      this.scheduleTimer.unref?.();
      return;
    }
    this.queue.sort(
      (a, b) =>
        (this.items.get(b)?.priority || 0) -
          (this.items.get(a)?.priority || 0) ||
        (this.items.get(a)?.queueOrder || 0) -
          (this.items.get(b)?.queueOrder || 0),
    );
    const limit = Math.max(1, this.settings.maxConcurrentDownloads || 3);
    while (this.running.size < limit && this.queue.length) {
      const id = this.queue.shift();
      const item = this.items.get(id);
      if (!item || item.status !== "queued" || this.running.has(id)) continue;
      let engine, task;
      try {
        engine = this.pausedEngines.get(id) || this.createEngine(item);
        this.pausedEngines.delete(id);
        this.running.set(id, engine);
        if (engine.keepTorrentPaused) engine.resume();
        task = engine.start();
      } catch (error) {
        this.running.delete(id);
        this.pausedEngines.delete(id);
        this.failItem(item, error);
        continue;
      }
      Promise.resolve(task)
        .catch((error) => {
          if (engine.failure) return;
          engine.failure = error;
          this.failItem(item, error);
        })
        .finally(() => {
          if (this.running.get(id) !== engine) return;
          this.running.delete(id);
          if (
            !this.stopped &&
            item.status === "failed" &&
            (!item.sessionRequired || item.sessionHeaders) &&
            engine.failure?.retryable &&
            item.attempt < (this.settings.retryAttempts || 0)
          ) {
            item.attempt++;
            item.status = "retrying";
            item.retryAt =
              Date.now() +
              Math.max(
                Number(engine.failure?.retryAfterMs) || 0,
                Math.min(
                  120000,
                  (this.settings.retryDelaySeconds || 3) *
                    1000 *
                    2 ** (item.attempt - 1),
                ),
              );
            this.persist(item);
            const timer = setTimeout(() => {
              this.retryTimers.delete(id);
              if (item.status === "retrying") this.enqueue(item);
            }, item.retryAt - Date.now());
            this.retryTimers.set(id, timer);
            this.snapshot();
          }
          this.pump();
        });
    }
  }
  requireItem(id) {
    const item = this.items.get(id);
    if (!item) throw new Error("This download no longer exists.");
    return item;
  }
  clearRetry(id) {
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
  }
  enqueue(item, front = false) {
    this.clearRetry(item.id);
    item.status = "queued";
    item.error = null;
    item.retryAt = null;
    item.speed = 0;
    if (!this.queue.includes(item.id))
      front ? this.queue.unshift(item.id) : this.queue.push(item.id);
    this.persist(item);
    this.snapshot();
    this.pump();
    return true;
  }
  async pause(id) {
    const item = this.requireItem(id);
    if (ACTIVE.has(item.status)) {
      const engine = this.running.get(id);
      if (!engine) return false;
      await engine.pause();
      // The engine has stopped at this point. Remove its queue slot before
      // returning so an immediate Resume cannot race the start promise's
      // later finally callback and lose the newly queued job.
      if (this.running.get(id) === engine) {
        this.running.delete(id);
        if (engine.keepTorrentPaused) this.pausedEngines.set(id, engine);
        this.pump();
      }
    } else if (["queued", "retrying"].includes(item.status)) {
      this.clearRetry(id);
      this.queue = this.queue.filter((value) => value !== id);
      item.status = "paused";
      item.speed = 0;
      item.eta = null;
      this.persist(item);
      this.snapshot();
    } else return false;
    return true;
  }
  resume(id) {
    const item = this.requireItem(id);
    if (item.returnedToBrowser)
      throw new Error("This transfer was returned to your browser.");
    if (item.sessionRequired && !item.sessionHeaders)
      throw new Error(
        "Session expired. Refresh this download from your browser to resume it.",
      );
    if (
      !["paused", "failed", "cancelled"].includes(item.status) ||
      this.running.has(id)
    )
      return false;
    item.attempt = 0;
    item.pendingBrowserReconciliation = false;
    return this.enqueue(item, this.pausedEngines.has(id));
  }
  retry(id) {
    return this.resume(id);
  }
  async pauseAll({ ids, kind = "all" } = {}) {
    if (this.bulkPauseInProgress) throw new Error("Pause all is already running.");
    const selected = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const targets = [...this.items.values()].filter((item) =>
      (!selected || selected.has(item.id)) &&
      (kind !== "torrent" || item.kind === "torrent") &&
      (ACTIVE.has(item.status) || ["queued", "retrying"].includes(item.status)),
    );
    let count = 0, failed = 0;
    this.bulkPauseInProgress = true;
    try {
      // Disarm the queue and retry timers before awaiting active engines.
      // During the batch pump() cannot start an unintended replacement.
      const ordered = [
        ...targets.filter((item) => !ACTIVE.has(item.status)),
        ...targets.filter((item) => ACTIVE.has(item.status)),
      ];
      for (const item of ordered) {
        try {
          if (await this.pause(item.id)) count++;
          else failed++;
        } catch {
          failed++;
        }
      }
    } finally {
      this.bulkPauseInProgress = false;
      this.pump();
    }
    return { count, total: targets.length, failed };
  }
  resumeAll({ ids, kind = "all" } = {}) {
    if (this.bulkPauseInProgress) throw new Error("Cannot resume during Pause all.");
    const selected = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const targets = [...this.items.values()].filter((item) =>
      item.status === "paused" &&
      (!selected || selected.has(item.id)) &&
      (kind !== "torrent" || item.kind === "torrent"),
    );
    let count = 0, failed = 0;
    for (const item of targets) {
      try {
        if (this.resume(item.id)) count++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { count, total: targets.length, failed };
  }
  async cancel(id) {
    const item = this.requireItem(id);
    if (["completed", "cancelled"].includes(item.status)) return false;
    this.clearRetry(id);
    this.queue = this.queue.filter((value) => value !== id);
    const engine = this.running.get(id) || this.pausedEngines.get(id);
    if (engine) {
      await engine.cancel();
      this.pausedEngines.delete(id);
    } else {
      item.status = "cancelled";
      item.speed = 0;
      item.eta = null;
      this.forgetSession(item);
      await this.cleanup(item);
      this.persist(item);
      this.snapshot();
    }
    return true;
  }
  async cleanup(item) {
    // Work files live outside the destination now. The destination scan keeps
    // older interrupted transfers (from builds that used hidden in-place
    // partials) removable without exposing them to the user.
    const names = await fs.readdir(item.savePath).catch(() => []);
    const prefix = `.getanny-${item.id}`;
    await Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith(`${prefix}.`) ||
            name.startsWith(`.getanny-media-${item.id}`),
        )
        .map((name) => fs.rm(path.join(item.savePath, name), { force: true })),
    );
    if (this.tempPath)
      await fs
        .rm(path.join(this.tempPath, item.id), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
  }
  async clearHistory({ scope = "all", ids = [], stopUnfinished = false } = {}) {
    const selected = new Set(ids.map(String));
    const historical = (item) =>
      ["completed", "failed", "cancelled"].includes(item.status);
    const targets = [...this.items.values()].filter((item) => {
      if (scope === "selected")
        return selected.has(item.id) && (historical(item) || stopUnfinished);
      if (scope === "completed") return item.status === "completed";
      if (scope === "failed") return item.status === "failed";
      // "Clear all history" never cancels work that is still in progress or
      // paused; those entries remain until the user acts on them explicitly.
      return historical(item);
    });
    for (const item of targets) {
      if (["queued", "retrying"].includes(item.status)) {
        this.clearRetry(item.id);
        this.queue = this.queue.filter((value) => value !== item.id);
      }
      if (["completed", "cancelled", "failed"].includes(item.status))
        await this.cleanup(item);
      else await this.remove(item.id);
      this.forgetSession(item);
      this.discardProgress(item.id);
      this.items.delete(item.id);
      this.repo?.remove(item.id);
    }
    this.snapshot();
    return targets.length;
  }
  async remove(id, deleteFile = false) {
    const item = this.requireItem(id);
    if (item.status !== "completed") await this.cancel(id);
    await this.cleanup(item);
    this.forgetSession(item);
    if (deleteFile && item.filePath && item.kind !== "torrent")
      await fs.rm(item.filePath, { force: true });
    this.discardProgress(id);
    this.items.delete(id);
    this.repo?.remove(id);
    this.snapshot();
    return true;
  }
  async clearCompleted() {
    const ids = [...this.items.values()]
      .filter((item) => item.status === "completed")
      .map((item) => item.id);
    for (const id of ids) {
      this.discardProgress(id);
      this.items.delete(id);
      this.repo?.remove(id);
    }
    this.snapshot();
    return ids.length;
  }
  async restoreDownloads() {
    for (const saved of this.repo?.getAll() || []) {
      const hadPersistedSession = Object.keys(saved.headers || {}).some((key) =>
        isSensitiveHeader(key),
      );
      const item = {
        ...saved,
        headers: persistentHeaders(saved.headers),
        sessionRequired: !!saved.sessionRequired || hadPersistedSession,
        speed: 0,
        eta: null,
      };
      if (
        this.sessionVault &&
        item.browserSource &&
        item.sessionRequired &&
        !["completed", "cancelled"].includes(item.status)
      ) {
        const headers = await this.sessionVault
          .restore(item.id, item.url)
          .catch(() => null);
        if (headers && Object.keys(headers).length) {
          item.sessionHeaders = headers;
          this.rememberedSessions.add(item.id);
        }
      }
      const scheduledQueue =
        this.settings.scheduleEnabled && item.status === "queued";
      if (
        ACTIVE.has(item.status) ||
        (!scheduledQueue &&
          ["queued", "pending", "retrying"].includes(item.status))
      )
        item.status = "paused";
      if (
        item.sessionRequired &&
        !item.sessionHeaders &&
        !["completed", "failed", "cancelled"].includes(item.status)
      ) {
        item.status = "paused";
        item.error =
          "Session expired. Refresh this download from your browser to resume it.";
      }
      if (
        item.retainsBrowserCopy &&
        !["completed", "cancelled", "failed"].includes(item.status)
      ) {
        item.status = "paused";
        item.pendingBrowserReconciliation = true;
      }
      this.items.set(item.id, item);
      this.persist(item);
      if (
        !item.awaitingBrowserConfirmation &&
        !item.pendingBrowserReconciliation &&
        !item.returnedToBrowser &&
        (!item.sessionRequired || item.sessionHeaders) &&
        (scheduledQueue ||
          (this.settings.resumeOnStartup && item.status === "paused"))
      )
        this.queue.push(item.id);
    }
    if (this.settings.resumeOnStartup)
      for (const id of this.queue) this.items.get(id).status = "queued";
    this.pump();
  }
  limitFor(item) {
    const limit = Math.min(
      item.downloadSpeedLimit || Infinity,
      this.globalSpeedLimit || Infinity,
    );
    return Number.isFinite(limit) ? limit : 0;
  }
  setGlobalSpeedLimit(limit) {
    if (this.globalSpeedLimit === limit) return;
    this.globalSpeedLimit = limit;
    for (const [id, engine] of this.running) {
      const item = this.items.get(id);
      if (item) engine.limiter?.setLimit(this.limitFor(item));
    }
  }
  updateSettings(settings, { applySpeed = true } = {}) {
    this.settings = { ...settings };
    if (applySpeed) this.setGlobalSpeedLimit(settings.speedLimit || 0);
    this.pump();
  }
  async shutdown() {
    this.stopped = true;
    await Promise.all(
      [...this.items.values()]
        .filter((item) => item.privateSession)
        .map((item) => this.remove(item.id)),
    );
    this.flushProgress();
    this.flushPersistence();
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const engines = new Set([
      ...this.running.values(),
      ...this.pausedEngines.values(),
    ]);
    await Promise.all(
      [...engines].map((engine) =>
        typeof engine.shutdown === "function"
          ? engine.shutdown()
          : engine.pause(),
      ),
    );
    this.pausedEngines.clear();
    for (const item of this.items.values())
      if (["queued", "retrying"].includes(item.status)) {
        // Preserve scheduled queue entries across clean restarts. Retry timers
        // are not durable and remain paused rather than being silently reset.
        if (item.status === "queued" && this.settings.scheduleEnabled) {
          this.persist(item);
          continue;
        }
        item.status = "paused";
        item.speed = 0;
        this.persist(item);
      }
    for (const item of this.items.values()) this.burnSession(item);
    this.running.clear();
    await this.sessionVault?.flush();
  }
  getAll() {
    return [...this.items.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.publicItem(item));
  }
  forgetSession(item) {
    this.burnSession(item);
    if (this.rememberedSessions.delete(item.id))
      this.sessionVault.remove(item.id).catch(() => {});
  }
  burnSession(item) {
    if (!item?.sessionHeaders) return;
    for (const key of Object.keys(item.sessionHeaders))
      item.sessionHeaders[key] = "";
    delete item.sessionHeaders;
    item.sessionRequired = true;
    this.persist(item);
  }
}
function persistentHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => !isSensitiveHeader(key)),
  );
}
module.exports = { DownloadManager, ACTIVE, isWithinSchedule };
