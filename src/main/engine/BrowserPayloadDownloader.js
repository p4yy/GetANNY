const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { Transform } = require("node:stream");
const { DownloadEngine } = require("./DownloadEngine");
const { sanitizeFilename } = require("./utils");

class BrowserPayloadDownloader extends DownloadEngine {
  constructor(options) {
    super(options);
    this.sourceFile = options.browserPayloadPath;
  }

  async probe() {
    const stat = await fsp.stat(this.sourceFile);
    if (!stat.isFile()) throw new Error("The browser payload is unavailable.");
    const info = {
      url: this.url,
      filename: sanitizeFilename(this.filename),
      totalSize: stat.size,
      resumable: false,
      etag: null,
      sha256: null,
      lastModified: null,
    };
    Object.assign(this, info);
    return info;
  }

  async transfer() {
    const signal = this.controller.signal;
    const meter = new Transform({
      transform: (chunk, _encoding, callback) => {
        this.limiter.consume(chunk.length, signal).then(() => {
          this.downloadedSize += chunk.length;
          this.tickBytes += chunk.length;
          callback(null, chunk);
        }, callback);
      },
    });
    await this.partials.write(
      this.partialPath,
      0,
      0,
      signal,
      fs.createReadStream(this.sourceFile),
      meter,
    );
  }

  async cleanupPartials(options) {
    if (options?.removeWorkDir && this.sourceFile)
      await fsp.rm(this.sourceFile, { force: true });
    await super.cleanupPartials(options);
  }
}

module.exports = { BrowserPayloadDownloader };
