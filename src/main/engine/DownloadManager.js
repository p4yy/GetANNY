const { isSensitiveHeader } = require("../utils/sensitive-headers");
const { ACTIVE, isWithinSchedule } = require("./DownloadManagerShared");
const persistenceMethods = require("./DownloadPersistence");
const sessionMethods = require("./DownloadSessions");
const queueMethods = require("./DownloadQueue");
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

const PRIORITIES = new Map([
  ["low", -1],
  ["normal", 0],
  ["high", 1],
]);
const MAX_TORRENT_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_TORRENT_BASE64_CHARS = Math.ceil(MAX_TORRENT_METADATA_BYTES / 3) * 4;

function mediaDuplicateKey(media) {
  if (!media) return null;
  const { requestedContainer, videoCodec, audioCodec, ...selection } = media;
  if (selection.type === "subtitle") delete selection.ext;
  for (const flag of [
    "mergeAudio",
    "live",
    "audioOnly",
    "audioUnknown",
    "seekableSection",
  ]) {
    if (selection[flag] === false) delete selection[flag];
  }
  return JSON.stringify(selection);
}
// External posters are only visual hints; never pass cookies or privileged
// headers to renderer images. The completed file gets its own local preview.
function safePoster(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local")
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
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
    this.queueSequence = 0;
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
    const priority =
      input.priority === undefined ? 0 : PRIORITIES.get(input.priority);
    if (priority === undefined) throw new Error("Invalid queue priority.");
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
    const mediaKey = mediaDuplicateKey(input.media);
    const duplicate = [...this.items.values()].find(
      (other) =>
        !["cancelled", "failed"].includes(other.status) &&
        other.url === url &&
        Boolean(other.privateSession) === (input.privateSession === true) &&
        other.kind === (input.kind || "file") &&
        mediaDuplicateKey(other.media) === mediaKey,
    );
    if (duplicate && !input.allowDuplicate)
      throw new Error(
        "This download is already in your library. Open its details to resume or retry it.",
      );
    const routeByFinalFilename =
      (input.kind === "file" || !input.kind) && !input.savePath;
    const destination = this.previewDestination(input);
    const savePath = destination.folder;
    if (
      !routeByFinalFilename &&
      !input.savePath &&
      (destination.rule || this.settings.organizeByType)
    )
      input.savePath = savePath;
    if (!savePath || !path.isAbsolute(savePath))
      throw new Error("Choose a valid absolute destination folder.");
    if (!routeByFinalFilename) {
      await fs.mkdir(savePath, { recursive: true });
      await fs.access(savePath, fs.constants.W_OK);
    }
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
        input.torrentFileBase64.length > MAX_TORRENT_BASE64_CHARS ||
        input.torrentFileBase64.length % 4 !== 0
      )
        throw new Error(
          "Torrent metadata is invalid or exceeds the 16 MB limit.",
        );
      const data = Buffer.from(input.torrentFileBase64, "base64");
      if (
        !data.length ||
        data.length > MAX_TORRENT_METADATA_BYTES ||
        data.toString("base64") !== input.torrentFileBase64
      )
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
      destinationPolicy: routeByFinalFilename
        ? {
            defaultDownloadPath: this.settings.defaultDownloadPath,
            organizeByType: this.settings.organizeByType,
            destinationRules: this.settings.destinationRules,
          }
        : undefined,
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
      priority,
      queueOrder: this.allocateQueueOrder(),
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
      sourcePage:
        !input.privateSession && input.sourcePage
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
  previewDestination(input = {}, settings = this.settings) {
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
    const rule = !input.savePath && settings.destinationRules?.[category];
    const base = input.savePath || rule || settings.defaultDownloadPath;
    return {
      category,
      rule: !!rule,
      folder:
        !input.savePath && !rule && settings.organizeByType
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
      if (status === "processing" && data.stage === "seeding") this.pump();
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
        errorCode: null,
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
    if (item.awaitingBrowserConfirmation) {
      item.error = {
        AUTH_REQUIRED: "This file requires a browser session. Open the original page and download it there.",
        SOURCE_PAGE: "This link opened a webpage. Use the page’s download button or choose its video in GetANNY.",
        SITE_BLOCKED: "The site refused the desktop download. Use the original browser to continue.",
      }[error.code];
    }
    this.persist(item);
    this.onError(item.id, error);
    this.emit("download-error", {
      id: item.id,
      error: item.error,
      ...(error.code ? { code: error.code } : {}),
    });
    this.snapshot();
  }
}
for (const methods of [persistenceMethods, sessionMethods, queueMethods]) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
    Object.defineProperty(DownloadManager.prototype, name, {
      ...descriptor,
      enumerable: false,
    });
  }
}
module.exports = { DownloadManager, ACTIVE, isWithinSchedule };
