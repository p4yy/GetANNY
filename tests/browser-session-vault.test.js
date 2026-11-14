const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
const {
  BrowserSessionVault,
} = require("../src/main/browser-integration/BrowserSessionVault");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { Database } = require("../src/main/database/database");
const { DownloadsRepo } = require("../src/main/database/downloads-repo");
const { fixtureServer, temporary, waitFor } = require("./helpers");

function encryptionProvider() {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    async decryptStringAsync(sealed) {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        sealed.subarray(0, 12),
      );
      decipher.setAuthTag(sealed.subarray(12, 28));
      return {
        result: Buffer.concat([
          decipher.update(sealed.subarray(28)),
          decipher.final(),
        ]).toString(),
        shouldReEncrypt: false,
      };
    },
  };
}

test("an ordinary browser download resumes with an encrypted session after a database restart", async (t) => {
  let active;
  t.after(async () => {
    if (active) {
      await active.manager.shutdown();
      active.db.close();
    }
  });
  const folder = await temporary(t);
  const server = await fixtureServer(t, {
    size: 256 * 1024,
    extra(req, res) {
      if (req.headers.cookie === "private-cookie=fixture") return false;
      res.writeHead(401).end();
      return true;
    },
  });
  const safeStorage = encryptionProvider();
  const vault = new BrowserSessionVault({
    userDataPath: folder,
    safeStorage,
    platform: "win32",
  });
  const settings = {
    defaultDownloadPath: path.join(folder, "out"),
    autoStartDownloads: false,
    resumeOnStartup: true,
  };
  const create = async () => {
    const db = new Database(folder);
    await db.initialize();
    const repo = new DownloadsRepo(db);
    const manager = new DownloadManager({
      settings,
      downloadsRepo: repo,
      sessionVault: vault,
      tempPath: path.join(folder, "work"),
    });
    return { db, repo, manager };
  };

  const first = (active = await create());
  const id = await first.manager.addDownload({
    url: server.url + "/file.bin",
    headers: { Cookie: "private-cookie=fixture" },
    browserSource: "chrome",
  });
  assert.ok(
    !(await fs.readFile(vault.entry(id))).includes("private-cookie=fixture"),
  );
  assert.doesNotMatch(
    JSON.stringify(first.repo.get(id)),
    /private-cookie=fixture/,
  );
  assert.doesNotMatch(
    JSON.stringify(first.manager.getAll()),
    /private-cookie=fixture/,
  );
  await first.manager.shutdown();
  first.db.close();
  active = null;

  const reopened = (active = await create());
  await reopened.manager.restoreDownloads();
  await waitFor(() =>
    ["completed", "failed"].includes(reopened.manager.requireItem(id).status),
  );
  assert.equal(reopened.manager.requireItem(id).status, "completed");
  await vault.flush();
  await assert.rejects(fs.access(vault.entry(id)), { code: "ENOENT" });
  assert.ok(
    server.state.requests.some(
      (request) => request.cookie === "private-cookie=fixture",
    ),
  );
});

test("private handoffs never persist history or session material", async (t) => {
  let db;
  t.after(() => db?.close());
  const folder = await temporary(t);
  db = new Database(folder);
  await db.initialize();
  const repo = new DownloadsRepo(db);
  const vault = new BrowserSessionVault({
    userDataPath: folder,
    safeStorage: encryptionProvider(),
    platform: "win32",
  });
  const manager = new DownloadManager({
    settings: {
      defaultDownloadPath: path.join(folder, "out"),
      autoStartDownloads: false,
    },
    downloadsRepo: repo,
    sessionVault: vault,
    tempPath: path.join(folder, "work"),
  });
  const id = await manager.addDownload({
    url: "https://private.test/signed",
    headers: { Cookie: "private-cookie=fixture" },
    browserSource: "firefox",
    privateSession: true,
  });
  assert.equal(repo.get(id), null);
  await assert.rejects(fs.access(vault.entry(id)), { code: "ENOENT" });
  await manager.shutdown();
  assert.equal(manager.getAll().length, 0);
});

test("credential storage refuses Linux plaintext mode and expires sealed entries", async (t) => {
  const folder = await temporary(t);
  const safeStorage = encryptionProvider();
  safeStorage.getSelectedStorageBackend = () => "basic_text";
  const insecure = new BrowserSessionVault({
    userDataPath: folder,
    safeStorage,
    platform: "linux",
  });
  const id = "79d4b32f-b0e8-4b4d-a98c-a1eece6ca68a";
  const url = "https://example.test/file";
  assert.equal(await insecure.store(id, url, { Cookie: "fixture" }), false);
  await assert.rejects(fs.access(insecure.entry(id)), { code: "ENOENT" });
  let now = 100;
  const secure = new BrowserSessionVault({
    userDataPath: folder,
    safeStorage,
    platform: "win32",
    now: () => now,
  });
  assert.equal(await secure.store(id, url, { Cookie: "fixture" }, 150), true);
  assert.deepEqual(await secure.restore(id, url), { Cookie: "fixture" });
  now = 151;
  assert.equal(await secure.restore(id, url), null);
  await assert.rejects(fs.access(secure.entry(id)), { code: "ENOENT" });
});
