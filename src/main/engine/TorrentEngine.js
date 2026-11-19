"use strict";

const { EventEmitter } = require("node:events");
const {
  TorrentCheckpoint,
  restoreTorrentCheckpoint,
} = require("./torrent-checkpoint");
const path = require("node:path");
const fs = require("node:fs/promises");
const { sanitizeFilename } = require("./utils");
const {
  loadVerifiedTorrent,
  publishTorrentOutput,
  recordVerifiedTorrent,
} = require("./torrent-output");

const LEGACY_FOLDER =
  /^Torrent \[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;
const MAX_PEERS = 200;
const METADATA_TIMEOUT_MS = 180_000;
const NO_PROGRESS_TIMEOUT_MS = 30 * 60_000;

function connectionTarget(connections = 8, activeTransfers = 3) {
  const perDownload = Number.isFinite(connections) ? connections : 8;
  const concurrent = Number.isFinite(activeTransfers) ? activeTransfers : 3;
  return Math.max(
    40,
    Math.min(
      MAX_PEERS,
      Math.floor(600 / Math.max(1, concurrent)),
      perDownload * 20,
    ),
  );
}

function supplementalTrackers(url, trackers = []) {
  if (!/^magnet:/i.test(url)) return [];
  try {
    return new URL(url).searchParams.getAll("tr").length ? [] : trackers;
  } catch {
    return trackers;
  }
}

function trackerUrls(url, torrentTrackers = [], fallbackTrackers = []) {
  const explicit = [...new Set((torrentTrackers || []).filter(Boolean))];
  if (explicit.length) return explicit;
  return [
    ...new Set(supplementalTrackers(url, fallbackTrackers).filter(Boolean)),
  ];
}

function selectedTorrentFiles(torrent, selectedFiles, priorities = {}) {
  // Remove the default whole-torrent selection, including for resumed jobs.
  if (torrent.pieces.length) torrent.deselect(0, torrent.pieces.length - 1);
  const selected = Array.isArray(selectedFiles) ? new Set(selectedFiles) : null;
  return torrent.files.filter((file, index) => {
    if (selected) {
      const include = selected.has(index + 1);
      include ? file.select(priorities[index + 1] || 0) : file.deselect();
      return include;
    }
    file.select(priorities[index + 1] || 0);
    return true;
  });
}

class TorrentEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    Object.assign(this, options);
    this.status = "queued";
    this.stopping = false;
  }

  setStatus(status, data = {}) {
    this.status = status;
    this.emit("status", this.id, status, { speed: 0, ...data });
  }

  start() {
    if (!this.task) this.task = this.run();
    return this.task;
  }

  resolveSavePath() {
    this.savePath = this.savePath || this.basePath;
    if (LEGACY_FOLDER.test(path.basename(this.savePath)))
      this.savePath = path.dirname(this.savePath);
    return this.savePath;
  }

  destinationName() {
    return sanitizeFilename(
      this.torrent?.name || this.torrentName || "Torrent",
    );
  }

  async createTorrentInput() {
    if (this.torrentMetadataPath) {
      try {
        return await fs.readFile(this.torrentMetadataPath);
      } catch {}
    }
    if (/^https?:\/\//i.test(this.url)) {
      const { readRemoteTorrent } = require("./aria2");
      return readRemoteTorrent(this.url);
    }
    return this.url;
  }

  async saveVerified(ready, { sharing = false } = {}) {
    const totalSize = ready.files.reduce((sum, file) => sum + file.length, 0);
    this.setStatus("processing", {
      stage: "saving",
      stageProgress: null,
      totalSize,
      downloadedSize: totalSize,
      phase: "Saving verified torrent files",
    });
    const publication = (async () => {
      await fs.mkdir(this.savePath, { recursive: true });
      return publishTorrentOutput({
        workPath: this.workPath,
        savePath: this.savePath,
        id: this.id,
        ready,
        copy: sharing,
      });
    })();
    this.publication = publication;
    try {
      const target = await publication;
      this.published = {
        filename: path.basename(target),
        totalSize,
        downloadedSize: totalSize,
        filePath: target,
        savePath: this.savePath,
      };
    } catch (cause) {
      const error = new Error(
        "GetANNY could not save this torrent. Verified files are kept. Choose another folder or retry saving.",
        { cause },
      );
      error.code = "TORRENT_SAVE_FAILED";
      throw error;
    } finally {
      this.publication = null;
    }
  }

  async completeSavedFiles() {
    await this.destroyTorrent(false).catch(() => {});
    await fs
      .rm(this.workPath, { recursive: true, force: true })
      .catch(() => {});
    this.setStatus("completed", this.published);
    this.emit("complete", this.id, this.published);
  }

  async run() {
    let poller;
    try {
      this.resolveSavePath();
      this.workPath =
        this.tempPath ||
        path.join(this.savePath, ".getanny-torrent", String(this.id));
      await fs.mkdir(this.workPath, { recursive: true });
      const saved = await loadVerifiedTorrent(this.workPath);
      if (this.wantedState) return;
      if (saved) {
        await this.saveVerified(saved);
        await this.completeSavedFiles();
        return;
      }
      await fs.mkdir(this.savePath, { recursive: true });

      this.setStatus("connecting", {
        phase: "Connecting to torrent peers",
        savePath: this.savePath,
      });

      if (this.getSharedTorrentClient)
        this.sharedTorrentClient = await this.getSharedTorrentClient();
      if (this.wantedState) return;
      this.clientOwned = !this.sharedTorrentClient;
      if (this.clientOwned) {
        const { default: WebTorrent } = await import("webtorrent");
        this.client = new WebTorrent({
          maxConns: connectionTarget(
            this.connections,
            this.maxConcurrentDownloads,
          ),
          utp: true,
          downloadLimit: this.speedLimit || -1,
        });
      } else {
        this.client = this.sharedTorrentClient;
      }
      if (this.wantedState) return;

      const announce = trackerUrls(
        this.url,
        this.torrentTrackers,
        this.getTrackers?.() || [],
      );
      const source = await this.createTorrentInput();
      const checkpoint = await restoreTorrentCheckpoint(this.workPath, source);
      if (this.wantedState) return;
      const torrent = this.client.add(checkpoint.input, {
        ...(checkpoint.bitfield ? { bitfield: checkpoint.bitfield } : {}),
        path: this.workPath,
        announce,
        strategy: this.torrentOrder === "sequential" ? "sequential" : "rarest",
        deselect: true,
      });
      this.torrent = torrent;

      const startedAt = Date.now();
      await new Promise((resolve, reject) => {
        const metadataProgress = setInterval(
          () =>
            this.emit("progress", this.id, {
              peers: torrent.numPeers || 0,
              metadataElapsed: Math.floor((Date.now() - startedAt) / 1000),
            }),
          1000,
        );
        metadataProgress.unref?.();
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(metadataTimer);
          clearInterval(metadataProgress);
          error ? reject(error) : resolve();
        };
        const metadataTimer = setTimeout(
          () =>
            finish(
              new Error(
                "Torrent metadata was not available within three minutes. Check the magnet link and peer access.",
              ),
            ),
          METADATA_TIMEOUT_MS,
        );
        metadataTimer.unref?.();
        this.finish = () => finish();
        torrent.once("error", finish);
        torrent.once("ready", () => finish());
      });
      if (this.wantedState) return;
      this.checkpoint = await TorrentCheckpoint.attach(
        torrent,
        this.workPath,
      ).catch(() => null);
      if (this.wantedState) return;

      const files = selectedTorrentFiles(
        torrent,
        this.selectedFiles,
        this.torrentPriorities,
      );
      if (!files.length)
        throw new Error("Select at least one file to download.");
      const totalSize = files.reduce((sum, file) => sum + file.length, 0);
      if (this.prioritizeFirstLast) {
        for (const file of files) {
          if (!file.length) continue;
          const first = Math.floor(file.offset / torrent.pieceLength);
          const last = Math.floor(
            (file.offset + file.length - 1) / torrent.pieceLength,
          );
          torrent.critical(first, first);
          torrent.critical(last, last);
        }
      }
      const selectedDownloaded = () =>
        files.reduce((sum, file) => sum + file.downloaded, 0);
      const selectedDone = () => files.every((file) => file.done);
      const connectedTrackers = new Set();
      let trackerReportedPeers = 0;
      const tracker = torrent.discovery?.tracker;
      tracker?.on("update", (data = {}) => {
        const announceUrl = data.announce || data.announceUrl;
        if (announceUrl) connectedTrackers.add(announceUrl);
        trackerReportedPeers = Math.max(
          trackerReportedPeers,
          Number(data.complete || 0) + Number(data.incomplete || 0),
        );
      });
      this.setStatus("downloading", {
        filename: torrent.name,
        totalSize,
        infoHash: torrent.infoHash,
        phase: "Downloading and verifying pieces",
      });

      const verified = () => {
        this.lastVerifiedAt = Date.now();
      };
      verified();
      torrent.on("verified", verified);
      await new Promise((resolve, reject) => {
        this.transferActive = true;
        this.finish = resolve;
        this.clientError = reject;
        poller = setInterval(() => {
          if (this.wantedState === "paused") return;
          if (this.wantedState) return resolve();
          const peers = torrent.numPeers || 0;
          if (selectedDone()) return resolve();
          const seeds = (torrent.wires || []).filter(
            (wire) => wire.isSeeder,
          ).length;
          const stalledFor = Date.now() - this.lastVerifiedAt;
          if (stalledFor > NO_PROGRESS_TIMEOUT_MS)
            return reject(
              new Error(
                "No new torrent pieces were verified for 30 minutes. Verified pieces are kept. Resume when more pieces are available.",
              ),
            );
          const downloadedSize = selectedDownloaded();
          this.emit("progress", this.id, {
            downloadedSize,
            totalSize,
            phase:
              stalledFor < 30_000
                ? "Downloading and verifying pieces"
                : peers
                  ? "Waiting for peers with missing pieces"
                  : "Waiting for peers to continue downloading",
            speed: torrent.downloadSpeed || 0,
            uploadSpeed: torrent.uploadSpeed || 0,
            eta:
              torrent.downloadSpeed > 0
                ? Math.max(0, totalSize - downloadedSize) /
                  torrent.downloadSpeed
                : null,
            peers,
            seeds,
            trackerCount:
              torrent.discovery?._announce?.length || announce.length,
            connectedTrackers: connectedTrackers.size,
            trackerReportedPeers,
            peerConnectionWarning:
              trackerReportedPeers > 0 &&
              peers === 0 &&
              Date.now() - startedAt > 60_000,
            trackerWarning:
              announce.length > 0 &&
              Date.now() - startedAt > 60_000 &&
              connectedTrackers.size === 0,
            trackerEmptyWarning: false,
            emptyPeerSources: [],
            torrentTransport: this.client.utp ? "TCP + uTP" : "TCP",
          });
        }, 500);
        poller.unref?.();
        if (selectedDone()) resolve();
        else torrent.once("done", resolve);
        torrent.once("error", reject);
      }).finally(() => torrent.off("verified", verified));

      if (this.wantedState) return;
      if (!selectedDone())
        throw new Error(
          "The torrent stopped before all selected pieces were verified.",
        );
      // The transfer wait has ended. Pause during optional sharing must stop
      // this task cleanly, rather than retain an already-resolved transfer task.
      clearInterval(poller);
      this.transferActive = false;
      await this.checkpoint?.close();
      this.checkpoint = null;
      if (this.wantedState) return;
      const ready = await recordVerifiedTorrent(
        this.workPath,
        files,
        this.destinationName(),
      );
      if (this.wantedState) return;
      const sharing = this.seedMinutes > 0 && !torrent.destroyed;
      if (!sharing) await this.destroyTorrent(false);
      if (this.wantedState) return;
      await this.saveVerified(ready, { sharing });
      if (sharing && !torrent.destroyed) {
        const end = Date.now() + this.seedMinutes * 60000;
        this.setStatus("processing", {
          stage: "seeding",
          stageProgress: null,
          phase: "Sharing verified torrent pieces",
          seedRemaining: this.seedMinutes * 60,
          ...this.published,
        });
        await new Promise((resolve) => {
          let deadline, progress;
          const finish = () => {
            clearTimeout(deadline);
            clearInterval(progress);
            torrent.removeListener("error", finish);
            this.finishSeeding = null;
            resolve();
          };
          this.finishSeeding = finish;
          this.finish = this.finishSeeding;
          torrent.once("error", finish);
          progress = setInterval(
            () =>
              this.emit("progress", this.id, {
                stage: "seeding",
                stageProgress: Math.min(
                  100,
                  100 * (1 - (end - Date.now()) / (this.seedMinutes * 60000)),
                ),
                uploadSpeed: torrent.uploadSpeed || 0,
                peers: torrent.numPeers || 0,
                seedRemaining: Math.max(
                  0,
                  Math.ceil((end - Date.now()) / 1000),
                ),
              }),
            1000,
          );
          deadline = setTimeout(() => finish(), this.seedMinutes * 60000);
          deadline.unref?.();
          progress.unref?.();
        });
      }
      await this.completeSavedFiles();
    } catch (error) {
      if (this.wantedState) this.setStatus(this.wantedState);
      else {
        this.setStatus("failed", { error: error.message });
        this.emit("error", this.id, error);
      }
    } finally {
      clearInterval(poller);
      this.transferActive = false;
      if (!(this.keepTorrentPaused && this.wantedState === "paused"))
        await this.destroyTorrent(this.wantedState === "cancelled");
      if (this.clientOwned && this.client && !this.client.destroyed)
        await new Promise((resolve) => this.client.destroy(resolve));
      if (this.wantedState && this.status !== this.wantedState)
        this.setStatus(this.wantedState);
    }
  }

  async destroyTorrent(destroyStore = false) {
    if (this.destroyingTorrent) return this.destroyingTorrent;
    const torrent = this.torrent;
    const checkpoint = this.checkpoint;
    this.torrent = null;
    this.checkpoint = null;
    this.destroyingTorrent = (async () => {
      await checkpoint?.close();
      if (torrent && !torrent.destroyed)
        await new Promise((resolve) =>
          torrent.destroy({ destroyStore }, () => resolve()),
        );
    })();
    try {
      await this.destroyingTorrent;
    } finally {
      this.destroyingTorrent = null;
    }
  }

  async stop(status) {
    if (["completed", "failed", "cancelled"].includes(this.status))
      return false;
    if (this.publication) return false;
    if (this.published) {
      this.finishSeeding?.();
      await this.task;
      return true;
    }
    this.wantedState = status;
    if (
      status === "paused" &&
      this.torrent?.ready &&
      this.transferActive &&
      this.client &&
      !this.clientOwned
    ) {
      this.keepTorrentPaused = true;
      this.torrent.pause();
      await this.checkpoint?.flush();
      this.setStatus("paused");
      return true;
    }
    this.finish?.();
    await this.destroyTorrent(status === "cancelled");
    await this.task;
    this.keepTorrentPaused = false;
    if (status === "cancelled" && this.workPath)
      await fs
        .rm(this.workPath, { recursive: true, force: true })
        .catch(() => {});
    this.setStatus(status);
    return true;
  }

  pause() {
    return this.stop("paused");
  }

  resume() {
    if (!this.keepTorrentPaused || !this.torrent || this.torrent.destroyed)
      return false;
    this.wantedState = null;
    this.keepTorrentPaused = false;
    this.lastVerifiedAt = Date.now();
    this.torrent.resume();
    this.setStatus("downloading", {
      phase: "Resumed from verified local pieces",
    });
    return true;
  }

  cancel() {
    return this.stop("cancelled");
  }

  async shutdown() {
    if (["completed", "failed", "cancelled"].includes(this.status)) return;
    if (this.publication || this.published) {
      await this.publication?.catch(() => {});
      this.finishSeeding?.();
      await this.task;
      return;
    }
    this.wantedState = "paused";
    this.keepTorrentPaused = false;
    this.finish?.();
    await this.destroyTorrent(false);
    await this.task;
    this.setStatus("paused");
  }
}

module.exports = {
  TorrentEngine,
  LEGACY_FOLDER,
  connectionTarget,
  supplementalTrackers,
  trackerUrls,
  selectedTorrentFiles,
};
