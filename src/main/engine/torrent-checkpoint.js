const { createHash, randomInt } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { writeDurable, DurablePartials } = require("./durable-partials");

const STATE = ".getanny-torrent-state.json";
const METADATA = ".getanny-torrent-source.torrent";
const SAMPLE_SIZE = 8;

function filesForPiece(files, start, end) {
  let low = 0;
  let high = files.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (files[middle].offset + files[middle].length <= start) low = middle + 1;
    else high = middle;
  }
  const matches = [];
  while (low < files.length && files[low].offset < end) matches.push(low++);
  return matches;
}

function verified(bitmap, index) {
  return (bitmap[index >>> 3] & (128 >>> (index & 7))) !== 0;
}

function markVerified(bitmap, index) {
  bitmap[index >>> 3] |= 128 >>> (index & 7);
}

async function inside(root, relative) {
  const file = await fs.realpath(path.resolve(root, relative));
  const actual = path.relative(root, file);
  if (
    !actual ||
    actual === ".." ||
    actual.startsWith(".." + path.sep) ||
    path.isAbsolute(actual)
  )
    throw new Error("Torrent data is outside its work directory.");
  return file;
}

async function verifyPiece(root, parsed, piece) {
  const start = piece * parsed.pieceLength;
  const end = Math.min(start + parsed.pieceLength, parsed.length);
  const hash = createHash("sha1");
  let bytes = 0;
  for (const index of filesForPiece(parsed.files, start, end)) {
    const file = parsed.files[index];
    let position = Math.max(start, file.offset) - file.offset;
    let remaining =
      Math.min(end, file.offset + file.length) - file.offset - position;
    const handle = await fs.open(await inside(root, file.path), "r");
    try {
      const buffer = Buffer.allocUnsafe(Math.min(remaining, 64 * 1024));
      while (remaining) {
        const result = await handle.read(
          buffer,
          0,
          Math.min(remaining, buffer.length),
          position,
        );
        if (!result.bytesRead) return false;
        hash.update(buffer.subarray(0, result.bytesRead));
        position += result.bytesRead;
        remaining -= result.bytesRead;
        bytes += result.bytesRead;
      }
    } finally {
      await handle.close();
    }
  }
  return bytes === end - start && hash.digest("hex") === parsed.pieces[piece];
}

async function restoreTorrentCheckpoint(folder, input) {
  try {
    const state = await DurablePartials.read(path.join(folder, STATE));
    if (!state || state.version !== 1) return { input };
    const parse = (await import("parse-torrent")).default;
    const original =
      typeof input === "string" && path.isAbsolute(input)
        ? await fs.readFile(input)
        : input;
    if ((await parse(original)).infoHash !== state.infoHash) return { input };
    const metadata = await fs.readFile(path.join(folder, METADATA));
    const parsed = await parse(metadata);
    if (parsed.infoHash !== state.infoHash) return { input };
    const bitfield = Buffer.from(state.bitfield, "base64");
    if (bitfield.length !== Math.ceil(parsed.pieces.length / 8))
      return { input };

    const root = await fs.realpath(folder);
    const required = new Set();
    const candidates = [];
    for (let index = 0; index < parsed.pieces.length; index++) {
      if (!verified(bitfield, index)) continue;
      candidates.push(index);
      const start = index * parsed.pieceLength;
      for (const file of filesForPiece(
        parsed.files,
        start,
        Math.min(start + parsed.pieceLength, parsed.length),
      ))
        required.add(file);
    }
    if (!candidates.length) return { input };
    for (const index of required) {
      const signature = state.files[index];
      const stat = await fs.stat(await inside(root, parsed.files[index].path));
      if (
        !signature ||
        stat.size !== signature.size ||
        stat.mtimeMs !== signature.mtimeMs
      )
        return { input };
    }
    for (let i = 0; i < Math.min(SAMPLE_SIZE, candidates.length); i++) {
      const sample = randomInt(i, candidates.length);
      [candidates[i], candidates[sample]] = [candidates[sample], candidates[i]];
      if (!(await verifyPiece(root, parsed, candidates[i]))) return { input };
    }
    return { input: metadata, bitfield };
  } catch {
    // Incomplete, changed, or unreadable checkpoint data uses the normal scan.
    return { input };
  }
}

class TorrentCheckpoint {
  static async attach(torrent, folder) {
    if (!torrent.torrentFile || !torrent.bitfield) return null;
    const parse = (await import("parse-torrent")).default;
    const parsed = await parse(torrent.torrentFile);
    const root = await fs.realpath(folder);
    await writeDurable(path.join(root, METADATA), torrent.torrentFile);
    const checkpoint = new TorrentCheckpoint(torrent, root, parsed);
    for (let index = 0; index < parsed.pieces.length; index++)
      if (torrent.bitfield.get(index)) checkpoint.pieces.add(index);
    if (checkpoint.pieces.size) checkpoint.schedule();
    return checkpoint;
  }

  constructor(torrent, folder, parsed) {
    this.torrent = torrent;
    this.folder = folder;
    this.parsed = parsed;
    this.pieces = new Set();
    this.signatures = {};
    this.bitfield = Buffer.alloc(Math.ceil(parsed.pieces.length / 8));
    this.listener = (index) => {
      this.pieces.add(index);
      this.schedule();
    };
    torrent.on("verified", this.listener);
  }

  schedule() {
    if (this.writing) return;
    this.writing = this.flushPieces()
      .catch(() => {})
      .finally(() => {
        this.writing = null;
        if (this.pieces.size) this.schedule();
      });
  }

  async flushPieces() {
    const batch = [...this.pieces];
    this.pieces.clear();
    const { files, pieceLength, length, infoHash } = this.parsed;
    const touched = new Set();
    for (const index of batch) {
      const start = index * pieceLength;
      for (const file of filesForPiece(
        files,
        start,
        Math.min(start + pieceLength, length),
      ))
        touched.add(file);
    }
    for (const index of touched) {
      const handle = await fs.open(
        await inside(this.folder, files[index].path),
        "r+",
      );
      try {
        await handle.sync();
        const { size, mtimeMs } = await handle.stat();
        this.signatures[index] = { size, mtimeMs };
      } finally {
        await handle.close();
      }
    }
    for (const index of batch) markVerified(this.bitfield, index);
    await writeDurable(
      path.join(this.folder, STATE),
      JSON.stringify({
        version: 1,
        infoHash,
        files: this.signatures,
        bitfield: this.bitfield.toString("base64"),
      }),
    );
  }

  async flush() {
    while (this.writing) await this.writing;
  }

  async close() {
    this.torrent.off("verified", this.listener);
    await this.flush();
  }
}

module.exports = { TorrentCheckpoint, restoreTorrentCheckpoint };
