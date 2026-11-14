const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

// Hashes are streamed on demand. Closing the details panel cancels its read.
class LibraryTools {
  constructor(manager) {
    this.manager = manager;
    this.jobs = new Map();
  }
  async file(id) {
    const item = this.manager.requireItem(id);
    if (item.status !== "completed" || !item.filePath)
      throw new Error("Choose a completed file.");
    const stat = await fsp.stat(item.filePath);
    if (!stat.isFile()) throw new Error("This action requires a single file.");
    return { item, stat };
  }
  cancel(id) {
    this.jobs.get(id)?.destroy(new Error("Verification cancelled."));
  }
  async verify(id, expected) {
    if (
      typeof expected !== "string" ||
      !/^[a-f0-9]{64}$/i.test(expected.trim())
    )
      throw new Error("Enter the publisher’s 64-character SHA-256 checksum.");
    if (this.jobs.size >= 2 || this.jobs.has(id))
      throw new Error("Another verification is already running.");
    const { item, stat } = await this.file(id);
    // Reserve synchronously after awaiting stat, so simultaneous IPC requests
    // cannot create duplicate readers for the same download.
    if (this.jobs.size >= 2 || this.jobs.has(id))
      throw new Error("Another verification is already running.");
    const stream = fs.createReadStream(item.filePath, {
      highWaterMark: 256 * 1024,
    });
    this.jobs.set(id, stream);
    try {
      const hash = createHash("sha256");
      for await (const chunk of stream) hash.update(chunk);
      const after = await fsp.stat(item.filePath);
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ino !== stat.ino
      )
        throw new Error("The file changed during verification. Try again.");
      const actual = hash.digest("hex");
      return { actual, matches: actual === expected.trim().toLowerCase() };
    } finally {
      stream.destroy();
      this.jobs.delete(id);
    }
  }
  async preview(id) {
    const { item } = await this.file(id);
    const ext = path.extname(item.filePath).toLowerCase();
    const type = /^(\.png|\.jpg|\.jpeg|\.webp|\.gif|\.avif)$/.test(ext)
      ? "image"
      : /^(\.mp4|\.webm|\.m4v|\.mov)$/.test(ext)
        ? "video"
        : /^(\.mp3|\.m4a|\.ogg|\.wav|\.flac|\.aac)$/.test(ext)
          ? "audio"
          : null;
    return type ? { type, url: pathToFileURL(item.filePath).href } : null;
  }
}
module.exports = { LibraryTools };
