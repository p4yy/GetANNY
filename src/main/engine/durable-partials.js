const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const fs = require("node:fs/promises");
const path = require("node:path");

const CHECKPOINT_BYTES = 4 * 1024 * 1024;
const CHECKPOINT_MS = 1000;
const STATE_VERSION = 2;

async function syncDirectory(directory) {
  // Node cannot open a directory for flushing on Windows. Windows filesystem
  // metadata recovery can still lose a recent name, in which case restore
  // treats the absent checkpoint as uncommitted and starts over.
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurable(file, content) {
  const temporary = `${file}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
  await syncDirectory(path.dirname(file));
}

function writeState(file, state) {
  return writeDurable(file, JSON.stringify(state));
}

class DurablePartials {
  static async read(file) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  constructor(file, identity, segments, saved) {
    this.file = file;
    this.state = {
      version: STATE_VERSION,
      ...identity,
      segments,
      offsets: Array.from({ length: segments }, (_, index) => {
        const offset = saved?.offsets?.[index];
        return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      }),
    };
    this.pending = Promise.resolve();
  }

  initialize() {
    return writeState(this.file, this.state);
  }

  checkpoint(part, offset) {
    const next = this.pending.then(async () => {
      this.state.offsets[part] = offset;
      await writeState(this.file, this.state);
    });
    this.pending = next.catch(() => {});
    return next;
  }

  async restore(file, part, length) {
    const stat = await fs.stat(file).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const durable = this.state.offsets[part];
    const usable = durable <= length ? Math.min(durable, stat?.size ?? 0) : 0;
    if (usable !== durable) await this.checkpoint(part, usable);
    if (stat && stat.size !== usable) await fs.truncate(file, usable);
    return usable;
  }

  async write(file, part, offset, signal, source, meter) {
    const handle = await fs.open(file, offset ? "a" : "w").catch((error) => {
      source.destroy();
      throw error;
    });
    let written = offset;
    let committed = offset;
    let lastSync = performance.now();
    let pendingWrite = Promise.resolve();
    const commit = async () => {
      await handle.sync();
      await this.checkpoint(part, written);
      committed = written;
      lastSync = performance.now();
    };
    const output = new Writable({
      write(chunk, _encoding, callback) {
        pendingWrite = (async () => {
          await handle.writeFile(chunk);
          written += chunk.length;
          if (
            written - committed >= CHECKPOINT_BYTES ||
            performance.now() - lastSync >= CHECKPOINT_MS
          )
            await commit();
        })();
        pendingWrite.then(() => callback(), callback);
      },
    });

    try {
      await pipeline(source, meter, output, { signal }).finally(async () => {
        // An abort can settle the pipeline before an outstanding filesystem
        // write. Persist only the bytes whose writes completed successfully.
        await pendingWrite;
        if (written !== committed || offset === 0) await commit();
      });
    } finally {
      await handle.close();
    }
  }
}

module.exports = {
  DurablePartials,
  STATE_VERSION,
  syncDirectory,
  writeDurable,
};
