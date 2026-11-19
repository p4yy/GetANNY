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

test("audio and subtitles prefer the requested or original language", async () => {
  const {
    choosePreferredAudioFormat,
    choosePreferredSubtitle,
    mediaLanguageName,
  } = await import("../src/renderer/utils/choose-media-format.mjs");
  const audio = [
    { group: "audio", language: "id", bitrate: 152 },
    { group: "audio", language: "en-US", bitrate: 107, originalAudio: true },
    { group: "audio", language: "fr-FR", bitrate: 100 },
  ];
  assert.equal(choosePreferredAudioFormat(audio).language, "en-US");
  assert.equal(choosePreferredAudioFormat(audio, { language: "FR_fr" }).language, "fr-FR");
  assert.equal(choosePreferredAudioFormat(audio, { language: "id-ID" }).language, "id");
  assert.equal(mediaLanguageName("id", "en"), "Indonesian");
  const subtitles = [
    { id: "automatic:ab", language: "ab", automatic: true },
    { id: "automatic:en-US", language: "en-US", automatic: true },
    { id: "manual:en-US", language: "en-US", automatic: false },
  ];
  assert.equal(choosePreferredSubtitle(subtitles, "EN_us").id, "manual:en-US");
  assert.equal(choosePreferredSubtitle(subtitles, "automatic:en-US").id, "automatic:en-US");
  assert.equal(choosePreferredSubtitle(subtitles, "", "en").id, "manual:en-US");
  assert.equal(choosePreferredSubtitle(subtitles, "de"), null);
});

test("media presets use only available codecs and choose a matching AAC track", async () => {
  const { chooseMediaPreset } = await import("../src/renderer/utils/choose-media-format.mjs");
  const formats = [
    { formatId: "vp9", group: "video", hasAudio: true, ext: "mp4", vcodec: "vp9", height: 2160 },
    { formatId: "avc", group: "video", mergeAudio: true, ext: "mp4", vcodec: "avc1.4d401e", height: 1080 },
    { formatId: "sd-big", group: "video", hasAudio: true, ext: "webm", height: 720, filesize: 200 },
    { formatId: "sd-small", group: "video", hasAudio: true, ext: "webm", height: 720, filesize: 100 },
    { formatId: "opus", group: "audio", ext: "webm", acodec: "opus", bitrate: 152, originalAudio: true },
    { formatId: "aac", group: "audio", ext: "m4a", acodec: "mp4a.40.2", bitrate: 120 },
  ];
  assert.equal(chooseMediaPreset(formats, "best", { ffmpeg: true }).format.formatId, "vp9");
  assert.equal(chooseMediaPreset(formats, "small", { ffmpeg: true }).format.formatId, "sd-small");
  const compatible = chooseMediaPreset(formats, "compatible", { ffmpeg: true });
  assert.equal(compatible.format.formatId, "avc");
  assert.equal(compatible.audio.formatId, "aac");
  assert.equal(chooseMediaPreset(formats, "compatible", { ffmpeg: false }), null);
});
