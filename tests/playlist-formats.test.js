const test = require("node:test");
const assert = require("node:assert/strict");

test("playlist choices honor container and quality and support audio-only sources", async () => {
  const { choosePlaylistFormat } =
    await import("../src/renderer/utils/playlist-formats.mjs");
  const formats = [
    { group: "video", ext: "webm", height: 2160 },
    { group: "video", ext: "mkv", height: 1080 },
    { group: "video", ext: "mp4", height: 720 },
    { group: "audio", ext: "webm", acodec: "opus", bitrate: 150 },
    { group: "audio", ext: "m4a", acodec: "aac", bitrate: 120 },
  ];
  assert.equal(choosePlaylistFormat(formats, "video", 1080), formats[1]);
  assert.equal(choosePlaylistFormat(formats, "mp4", 1080), formats[2]);
  assert.equal(choosePlaylistFormat(formats, "video", Infinity), formats[0]);
  assert.equal(choosePlaylistFormat(formats, "opus", Infinity), formats[3]);
  assert.equal(choosePlaylistFormat(formats, "m4a", Infinity), formats[4]);
  assert.equal(choosePlaylistFormat(formats, "webm", 720), undefined);
});
