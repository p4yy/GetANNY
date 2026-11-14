const { Client } = require("basic-ftp");
const { PassThrough, Writable, Transform } = require("node:stream");
const { ChunkDownloader } = require("./ChunkDownloader");
const { validateUrl, getFilenameFromURL } = require("./utils");

class FtpDownloader extends ChunkDownloader {
  constructor(options) {
    super(options);
    const source = new URL(this.url);
    this.remote = decodeURIComponent(source.pathname);
    if (
      !source.hostname ||
      this.remote.endsWith("/") ||
      /[\x00-\x1f\x7f]/.test(this.remote)
    )
      throw new Error("Enter an FTP link to an individual file.");
    this.server = {
      host: source.hostname.replace(/^\[|\]$/g, ""),
      port: Number(source.port) || 21,
      secure: source.protocol === "ftps:",
    };
    this.openClient = options.openFtpClient || (() => new Client(this.timeout));
    this.clients = new Set();
  }

  validateSourceUrl(url) {
    return validateUrl(url, ["ftp:", "ftps:"]);
  }

  async withClient(callback) {
    const client = this.openClient();
    const signal = this.controller.signal;
    const close = () => client.close();
    this.clients.add(client);
    signal.addEventListener("abort", close, { once: true });
    try {
      signal.throwIfAborted();
      await client.access(this.server);
      return await callback(client);
    } finally {
      signal.removeEventListener("abort", close);
      this.clients.delete(client);
      close();
    }
  }

  async inspect(client) {
    const size = await client.size(this.remote);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error("FTP returned an invalid file size.");
    const date = await client.lastMod(this.remote).catch(() => null);
    const modified =
      date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    return { size, modified };
  }

  async probe() {
    const info = await this.withClient(async (client) => {
      const { size, modified } = await this.inspect(client);
      const restart =
        size > 0 &&
        modified &&
        (await client.send("REST 0").catch(() => null))?.code === 350;
      return {
        url: this.url,
        filename: this.filenameExplicit
          ? this.filename
          : getFilenameFromURL(this.url),
        totalSize: size,
        acceptRanges: !!restart,
        resumable: !!restart,
        dynamicArchive: false,
        lastModified: modified,
        etag: restart ? JSON.stringify(size + ":" + modified) : null,
        sha256: null,
      };
    });
    Object.assign(this, info);
    return info;
  }

  async checkSource(client) {
    const { size, modified } = await this.inspect(client);
    if (size !== this.totalSize || modified !== this.lastModified) {
      throw Object.assign(
        new Error("The FTP file changed during the download."),
        {
          code: "FTP_SOURCE_CHANGED",
        },
      );
    }
  }

  async transfer() {
    try {
      await super.transfer();
      await this.withClient((client) => this.checkSource(client));
    } catch (error) {
      for (const client of this.clients) client.close();
      throw error;
    }
  }

  async transferSingle() {
    const existing = await this.partials.restore(
      this.partialPath,
      0,
      this.totalSize,
    );
    this.downloadedSize = existing;
    if (existing && existing === this.totalSize) return;
    await this.runSegment({
      file: this.partialPath,
      index: 0,
      start: 0,
      end: this.totalSize - 1,
      existing,
    });
  }

  async runSegment(part) {
    const signal = this.controller.signal;
    const offset = part.start + part.existing;
    const length = part.end - offset + 1;
    await this.withClient(async (client) => {
      await this.checkSource(client);
      let received = 0;
      const fileEnd = this.totalSize - 1;
      const source = new PassThrough();
      let closedAfterRange = false;
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          const remaining = length - received;
          if (part.end === fileEnd && chunk.length > remaining)
            return callback(
              new Error("FTP returned more bytes than the declared file size."),
            );
          const bytes = chunk.subarray(0, remaining);
          received += bytes.length;
          source.write(bytes, (error) => {
            callback(error);
            if (!error && received === length && part.end < fileEnd) {
              // REST sets the starting offset. Close the dedicated connection
              // after its portion reaches the downstream buffer.
              closedAfterRange = true;
              source.end();
              client.close();
            }
          });
        },
        final(callback) {
          // A bounded REST segment can end its PassThrough before basic-ftp
          // finishes the sink. Pause/abort can destroy it meanwhile. Ending
          // an already closed stream raises ERR_STREAM_DESTROYED on Windows.
          if (source.destroyed || source.writableEnded) return callback();
          source.end(callback);
        },
      });
      const meter = new Transform({
        transform: (chunk, _encoding, callback) => {
          this.limiter.consume(chunk.length, signal).then(() => {
            this.downloadedSize += chunk.length;
            this.tickBytes += chunk.length;
            callback(null, chunk);
          }, callback);
        },
      });
      source.on("error", () => {});
      const writing = this.partials
        .write(part.file, part.index, part.existing, signal, source, meter)
        .catch((error) => {
          client.close();
          throw error;
        });
      const downloading = client
        .downloadTo(sink, this.remote, offset)
        .catch((error) => {
          if (closedAfterRange) return;
          source.destroy(error);
          throw error;
        });
      const results = await Promise.allSettled([writing, downloading]);
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
      if (received !== length)
        throw new Error("The FTP server returned an incomplete segment.");
    }).catch((error) => {
      for (const client of this.clients) client.close();
      throw error;
    });
  }
}

module.exports = { FtpDownloader };
