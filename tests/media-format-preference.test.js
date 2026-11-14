const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("preferred media quality selects the highest available usable variant", async () => {
  const { choosePreferredMediaFormat } = await import(
    pathToFileURL(path.resolve("src/renderer/utils/choose-media-format.mjs")).href
  );
  const formats = [
    { formatId: "720", group: "video", ext: "mp4", height: 720, fps: 30, bitrate: 1500, hasAudio: true },
    { formatId: "4k30", group: "video", ext: "webm", height: 2160, fps: 30, bitrate: 12000, hasAudio: false, mergeAudio: true },
    { formatId: "4k60", group: "video", ext: "webm", height: 2160, fps: 60, bitrate: 10000, hasAudio: false, mergeAudio: true },
  ];
  assert.equal(choosePreferredMediaFormat(formats, { height: 0, container: "any" }, { ffmpeg: true }).formatId, "4k60");
  assert.equal(choosePreferredMediaFormat(formats, { height: 1080, container: "mp4" }, { ffmpeg: true }).formatId, "720");
  assert.equal(choosePreferredMediaFormat(formats, { height: 0, container: "any" }, { ffmpeg: false }).formatId, "720");
  assert.equal(choosePreferredMediaFormat(formats, { height: 0, container: "any" }, { ffmpeg: true }).mergeAudio, true);
});

test("unsupported preferences fall back without pretending a site has more quality", async () => {
  const { choosePreferredMediaFormat } = await import(
    pathToFileURL(path.resolve("src/renderer/utils/choose-media-format.mjs")).href
  );
  assert.equal(choosePreferredMediaFormat([], {}, {}), null);
  const only = { formatId: "source-480", ext: "webm", group: "video", height: 480, hasAudio: true };
  assert.equal(choosePreferredMediaFormat([only], { height: 4320, container: "any" }, {}).formatId, only.formatId);
});
