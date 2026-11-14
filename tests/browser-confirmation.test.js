const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { temporary, waitFor } = require("./helpers");

test("a browser confirmation pauses the task and a refreshed request reuses its ID", async (t) => {
  const folder = await temporary(t);
  const starts = [];
  const manager = new DownloadManager({
    settings: { defaultDownloadPath: folder },
    tempPath: folder,
    engineFactory(item, options) {
      return Object.assign(new EventEmitter(), {
        start() {
          starts.push(options);
          if (starts.length === 1)
            this.emit(
              "error",
              item.id,
              Object.assign(new Error("Site confirmation"), {
                code: "SOURCE_PAGE",
              }),
            );
          else
            this.emit("complete", item.id, { downloadedSize: 4, totalSize: 4 });
        },
      });
    },
  });
  const id = await manager.addDownload({
    url: "https://example.test/verify",
    filename: "example.zip",
    browserPage: "https://example.test/page",
    browserSource: "chrome",
    browserTransferId: "first",
  });
  await waitFor(
    () =>
      manager.requireItem(id).awaitingBrowserConfirmation &&
      !manager.running.has(id),
  );
  assert.equal(manager.requireItem(id).status, "paused");
  assert.equal(
    await manager.refreshBrowserDownload(id, {
      url: "https://example.test/actual.zip",
      headers: {
        Cookie: "confirmation=valid",
        Referer: "https://example.test/page",
      },
      transferId: "second",
      retainsBrowserCopy: true,
    }),
    id,
  );
  assert.equal(starts[1].headers.Cookie, "confirmation=valid");
  assert.equal(manager.requireItem(id).status, "completed");
  assert.equal(manager.requireItem(id).browserTransferId, "second");
  await manager.shutdown();
});
