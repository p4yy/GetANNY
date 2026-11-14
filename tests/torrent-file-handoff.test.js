const test = require("node:test");
const assert = require("node:assert/strict");

test("only completed locally saved .torrent downloads can be imported", async () => {
  const { isCompletedTorrentFile, openCompletedTorrent } =
    await import("../src/renderer/utils/torrent-file-action.mjs");
  const file = { id: "source-download-id", status: "completed", kind: "file", filename: "Movie.TORRENT", filePath: "C:\\Users\\AV\\Downloads\\Movie.TORRENT", browserPage: "https://example.com/torrents/movie" };
  assert.equal(isCompletedTorrentFile(file), true);
  const calls = [];
  assert.equal(openCompletedTorrent(file, {
    setActiveTab: (tab) => calls.push(["tab", tab]),
    setAddModal: (input) => calls.push(["modal", input]),
  }), true);
  assert.deepEqual(calls, [
    ["tab", "torrent"],
    ["modal", { torrent: true, torrentUrl: file.filePath, autoInspectTorrent: true, sourceTorrentDownloadId: file.id, sourcePage: file.browserPage }],
  ]);
  for (const change of [
    { status: "downloading" },
    { kind: "torrent" },
    { filename: "video.mp4" },
    { filePath: "/tmp/video.mp4" },
    { filePath: "relative.torrent" },
    { filePath: "" },
  ]) assert.equal(isCompletedTorrentFile({ ...file, ...change }), false);
});

test("torrent row offers explicit import and local picker inspects without starting", async () => {
  const fs = require("node:fs/promises");
  const row = await fs.readFile("src/renderer/pages/DownloadsPage.jsx", "utf8");
  const modal = await fs.readFile("src/renderer/components/AddDownloadDialog.jsx", "utf8");
  assert.match(row, /torrentFileReady && \(/);
  assert.match(row, /downloads\.action\.sendToTorrents/);
  assert.match(modal, /if \(!initial\.autoInspectTorrent/);
  assert.match(modal, /torrent:inspect/);
  assert.match(modal, /setSelectedFiles\(new Set/);
  assert.doesNotMatch(modal.split("  // The Downloads list can hand over")[1].split("  const clearLink")[0], /download:add-torrent/);
});

test("torrent handoff removes only its source history after the torrent was queued", async () => {
  const fs = require("node:fs/promises");
  const code = await fs.readFile("src/renderer/components/AddDownloadDialog.jsx", "utf8");
  const queued = code.indexOf("const downloadId = await api.invoke(");
  const cleanup = code.indexOf('if (kind === "torrent" && initial.sourceTorrentDownloadId)');
  assert.ok(queued >= 0 && cleanup > queued,
    "source row must remain when the user cancels inspection or torrent creation fails");
  assert.match(code.slice(cleanup, cleanup + 450), /deleteFile: false/);
  assert.match(code, /sourcePage: initial.sourcePage/);
});
