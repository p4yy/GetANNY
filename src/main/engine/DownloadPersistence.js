"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { isSensitiveHeader } = require("../utils/sensitive-headers");
const { ACTIVE, persistentHeaders } = require("./DownloadManagerShared");
const { sanitizeFilename, categoryFor } = require("./utils");

const methods = {
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
      if (item.destinationPolicy && !item.destinationExplicit) {
        item.savePath = this.previewDestination(
          { filename, kind: "file" },
          item.destinationPolicy,
        ).folder;
      } else if (
        item.kind !== "file" &&
        this.settings.organizeByType &&
        !item.destinationExplicit
      ) {
        item.savePath = path.join(item.savePath, category);
      }
      await fs.mkdir(item.savePath, { recursive: true });
      await fs.access(item.savePath, fs.constants.W_OK);
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
      item.destinationPolicy = undefined;
      item.category = category;
      this.persist(item);
    }
    return { filename: item.filename, savePath: item.savePath };
  }

  workPath(item) {
    return this.tempPath ? path.join(this.tempPath, item.id) : null;
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
    if (!["completed", "cancelled"].includes(item.status)) {
      const stopped = await this.cancel(id);
      if (!stopped && !["completed", "cancelled"].includes(item.status))
        throw new Error(
          "Wait for the transfer to finish saving before removing it.",
        );
    }
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
        item.kind === "torrent" &&
        item.stage === "seeding" &&
        item.filePath
      ) {
        const output = await fs.lstat(item.filePath).catch(() => null);
        if (output?.isFile() || output?.isDirectory()) {
          item.status = "completed";
          item.completedAt ||= new Date().toISOString();
        } else {
          item.filePath = null;
        }
        item.stage = null;
        item.stageProgress = null;
        item.seedRemaining = null;
        item.uploadSpeed = 0;
      }
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
    if (this.settings.resumeOnStartup) {
      for (const id of this.queue) {
        const item = this.items.get(id);
        if (!item) continue;
        item.status = "queued";
        this.persist(item);
      }
    }
    this.pump();
  }

  getAll() {
    return [...this.items.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.publicItem(item));
  }
};

module.exports = methods;
