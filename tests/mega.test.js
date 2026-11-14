const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  MegaDownloader,
  isMegaShare,
  isMegaFolderShare,
} = require("../src/main/engine/MegaDownloader");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { temporary } = require("./helpers");

test("MEGA file and folder URLs are matched by exact HTTPS host", () => {
  assert.ok(isMegaShare("https://mega.nz/file/id#secret"));
  assert.ok(isMegaShare("https://mega.co.nz/#F!id!secret"));
  assert.ok(isMegaFolderShare("https://mega.nz/folder/id#secret"));
  assert.equal(
    isMegaFolderShare("https://mega.nz/folder/id#secret/file/item"),
    false,
  );
  assert.equal(
    isMegaShare("https://mega.nz.example.com/file/id#secret"),
    false,
  );
});

test("MEGA publishes plaintext only after the authenticated stream finishes", async (t) => {
  const folder = await temporary(t);
  const bytes = Buffer.from("fixture plaintext");
  for (const corrupt of [false, true]) {
    const name = corrupt ? "invalid.txt" : "example.txt";
    const engine = new MegaDownloader({
      url: "https://mega.nz/file/id#secret",
      savePath: folder,
      loadMegaShare: async () => ({
        name,
        size: bytes.length,
        download(options) {
          assert.equal(options.forceHttps, true);
          assert.equal(options.start, undefined);
          return Readable.from(
            (async function* () {
              yield bytes;
              if (corrupt) throw new Error("MAC verification failed");
            })(),
          );
        },
      }),
    });
    let failure;
    engine.on("error", (_id, error) => {
      failure = error;
    });
    await engine.start();
    if (corrupt) {
      assert.match(failure?.message, /MAC verification/);
      await assert.rejects(fs.access(path.join(folder, name)), {
        code: "ENOENT",
      });
    } else {
      assert.equal(failure, undefined);
      assert.deepEqual(await fs.readFile(path.join(folder, name)), bytes);
    }
  }
});

test("MEGA folder queues nested files with stable child links and safe paths", async (t) => {
  const folder = await temporary(t);
  const manager = new DownloadManager({
    settings: { defaultDownloadPath: folder, autoStartDownloads: false },
    loadMega: async () => ({
      name: "Shared files",
      directory: true,
      key: Buffer.alloc(16),
      children: [
        {
          name: "../escape",
          directory: true,
          key: Buffer.alloc(16),
          children: [
            { nodeId: "abc", name: "file.txt", size: 1, key: Buffer.alloc(32) },
          ],
        },
      ],
    }),
  });
  const url = "https://mega.nz/folder/id#secret";
  const id = await manager.addDownload({ url });
  assert.equal(await manager.addDownload({ url }), id);
  assert.equal(manager.getAll().length, 1);
  const item = manager.requireItem(id);
  assert.equal(item.url, url + "/file/abc");
  assert.equal(item.savePath, path.join(folder, "Shared files", "_escape"));
  assert.equal(item.filename, "file.txt");
  await manager.shutdown();
});
