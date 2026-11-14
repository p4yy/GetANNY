const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { validateHeaders } = require("../engine/utils");
const { syncDirectory } = require("../engine/durable-partials");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

class BrowserSessionVault {
  constructor({
    userDataPath,
    safeStorage,
    platform = process.platform,
    now = Date.now,
  }) {
    this.folder = path.join(userDataPath, "browser-session-vault");
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.now = now;
    this.removals = new Set();
  }

  entry(id) {
    if (!UUID.test(id)) throw new Error("Invalid browser session job ID.");
    return path.join(this.folder, `${id}.sealed`);
  }

  async available() {
    if (!(await this.safeStorage?.isAsyncEncryptionAvailable?.())) return false;
    if (this.platform !== "linux") return true;
    return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
      this.safeStorage.getSelectedStorageBackend?.(),
    );
  }

  async store(id, url, headers, expires = this.now() + SESSION_TTL_MS) {
    if (!(await this.available())) return false;
    const target = this.entry(id);
    const sealed = await this.safeStorage.encryptStringAsync(
      JSON.stringify({
        id,
        origin: new URL(url).origin,
        expires,
        headers,
      }),
    );
    await fs.mkdir(this.folder, { recursive: true, mode: 0o700 });
    const stage = path.join(this.folder, `${id}.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(stage, "wx", 0o600);
      try {
        await handle.writeFile(sealed);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(stage, target);
      await syncDirectory(this.folder);
    } finally {
      await fs.rm(stage, { force: true }).catch(() => {});
    }
    return true;
  }

  async restore(id, url) {
    if (!(await this.available())) return null;
    const file = this.entry(id);
    const sealed = await fs.readFile(file).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!sealed) return null;
    let data;
    let reEncrypt;
    try {
      const { result, shouldReEncrypt } =
        await this.safeStorage.decryptStringAsync(sealed);
      data = JSON.parse(result);
      reEncrypt = shouldReEncrypt;
    } catch {
      // Leave a credential that could not be unsealed untouched. The OS key
      // store can be temporarily unavailable, such as during a login session.
      return null;
    }
    if (
      data?.id !== id ||
      data.origin !== new URL(url).origin ||
      !Number.isFinite(data.expires) ||
      data.expires <= this.now()
    ) {
      await this.remove(id);
      return null;
    }
    const headers = validateHeaders(data.headers);
    if (reEncrypt) await this.store(id, url, headers, data.expires);
    return headers;
  }

  remove(id) {
    const operation = fs.rm(this.entry(id), { force: true });
    this.removals.add(operation);
    operation.then(
      () => this.removals.delete(operation),
      () => this.removals.delete(operation),
    );
    return operation;
  }

  async flush() {
    await Promise.allSettled(this.removals);
  }
}

module.exports = { BrowserSessionVault };
