const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK = 48 * 1024;

class BrowserPayloads {
  constructor(root, manager) {
    this.root = root;
    this.manager = manager;
    this.uploads = new Map();
  }

  async receive(message, sessionId) {
    if (message.action === "begin") {
      const length = message.length;
      const url = new URL(message.page);
      if (
        !/^https?:$/.test(url.protocol) ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_BYTES ||
        typeof message.filename !== "string" ||
        !message.filename.length ||
        message.filename.length > 220
      )
        throw new Error("Invalid browser payload metadata.");
      if (this.uploads.size >= 4)
        throw new Error("Too many browser uploads. Try again shortly.");
      const id = randomUUID();
      const file = path.join(this.root, ".browser-upload-" + id);
      const upload = {
        id,
        file,
        sessionId,
        url: url.href,
        length,
        filename: message.filename,
        offset: 0,
        busy: true,
      };
      this.uploads.set(id, upload);
      try {
        await fs.mkdir(this.root, { recursive: true });
        upload.handle = await fs.open(file, "wx", 0o600);
        upload.busy = false;
        this.extend(upload);
        return { uploadId: id };
      } catch (error) {
        await this.remove(upload);
        throw error;
      }
    }

    const upload = this.uploads.get(message.uploadId);
    if (!upload || upload.sessionId !== sessionId || upload.busy)
      throw new Error("This browser upload is unavailable.");
    upload.busy = true;
    clearTimeout(upload.timer);
    try {
      if (message.action === "abort") {
        await this.remove(upload);
        return {};
      }
      if (message.action === "chunk") {
        if (
          typeof message.data !== "string" ||
          message.data.length > (MAX_CHUNK * 4) / 3 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data) ||
          message.offset !== upload.offset
        )
          throw new Error("Invalid browser upload chunk.");
        const bytes = Buffer.from(message.data, "base64");
        if (
          !bytes.length ||
          upload.offset + bytes.length > upload.length ||
          bytes.toString("base64") !== message.data
        )
          throw new Error("Invalid browser upload size.");
        const result = await upload.handle.write(
          bytes,
          0,
          bytes.length,
          upload.offset,
        );
        if (result.bytesWritten !== bytes.length)
          throw new Error("The browser upload write was incomplete.");
        upload.offset += bytes.length;
        this.extend(upload);
        return { offset: upload.offset };
      }
      if (message.action !== "finish" || upload.offset !== upload.length)
        throw new Error("The browser upload is incomplete.");
      await upload.handle.sync();
      await upload.handle.close();
      upload.handle = null;
      const url = new URL(upload.url);
      url.hash = "getanny-browser-file-" + upload.id;
      const id = await this.manager.addDownload({
        url: url.href,
        filename: upload.filename,
        browserPayloadFile: upload.file,
      });
      await this.remove(upload);
      return { action: "queued", id };
    } catch (error) {
      await this.remove(upload);
      throw error;
    } finally {
      upload.busy = false;
    }
  }

  extend(upload) {
    upload.timer = setTimeout(() => this.remove(upload).catch(() => {}), 60000);
    upload.timer.unref();
  }

  async remove(upload) {
    clearTimeout(upload.timer);
    this.uploads.delete(upload.id);
    await upload.handle?.close().catch(() => {});
    await fs.rm(upload.file, { force: true }).catch(() => {});
  }

  async close() {
    await Promise.all(
      [...this.uploads.values()].map((upload) => this.remove(upload)),
    );
  }
}

module.exports = { BrowserPayloads, MAX_BYTES, MAX_CHUNK };
