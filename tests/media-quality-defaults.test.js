const test = require("node:test");
const assert = require("node:assert/strict");
const { defaults, validateSetting } = require("../src/main/settings/schema");
const { normalizeFormats } = require("../src/main/media/formats");

test("fresh installs choose available best quality while preserving existing user preferences", () => {
  const prefs = defaults("/tmp/downloads").mediaPreferences;
  assert.equal(prefs.height, 0);
  assert.equal(prefs.container, "any");
  assert.deepEqual(validateSetting("mediaPreferences", prefs), prefs);
  const old = { ...prefs, height: 1080, container: "mp4" };
  assert.deepEqual(validateSetting("mediaPreferences", old), old);
});

test("media format normalization prefers higher frame rates at equal resolution and excludes DRM", () => {
  const formats = normalizeFormats({ formats: [
    { format_id: "sd", url: "https://cdn.example/sd.mp4", ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 360, fps: 30, tbr: 500 },
    { format_id: "4k30", url: "https://cdn.example/4k30.webm", ext: "webm", vcodec: "vp9", acodec: "none", height: 2160, fps: 30, tbr: 18000 },
    { format_id: "4k60", url: "https://cdn.example/4k60.webm", ext: "webm", vcodec: "vp9", acodec: "none", height: 2160, fps: 60, tbr: 14000 },
    { format_id: "audio", url: "https://cdn.example/audio.m4a", ext: "m4a", vcodec: "none", acodec: "mp4a", abr: 256 },
    { format_id: "drm", url: "https://cdn.example/drm.mp4", ext: "mp4", vcodec: "avc1", height: 4320, has_drm: true },
  ]});
  assert.equal(formats[0].formatId, "4k60");
  assert.equal(formats[0].mergeAudio, true);
  assert.equal(formats[1].formatId, "4k30");
  assert.ok(!formats.some(x => x.formatId === "drm"));
});
