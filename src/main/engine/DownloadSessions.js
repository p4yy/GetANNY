"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { isSensitiveHeader } = require("../utils/sensitive-headers");
const { persistentHeaders } = require("./DownloadManagerShared");
const { validateUrl, validateDownloadUrl, validateHeaders } = require("./utils");

const methods = {
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
};

module.exports = methods;
