const test = require("node:test");
const assert = require("node:assert/strict");
const { PlaybackCapture, CAPTURE_AGE_MS, safeStream } =
  require("../src/main/media/PlaybackCapture");

const post = "https://www.tiktok.com/@creator/video/7234567890123456789";
const stream = "https://v16.tiktokcdn.com/clip.mp4?signature=temporary";

test("playback cache accepts only authenticated public TikTok video captures", () => {
  const cache = new PlaybackCapture();
  assert.equal(cache.record({
    url: stream, pageUrl: "https://example.net/watch",
    mimeType: "video/mp4", source: "chrome",
  }), null);
  assert.equal(cache.record({
    url: "http://127.0.0.1:8080/video.mp4",
    pageUrl: post, mimeType: "video/mp4", source: "chrome",
  }), null);
  assert.equal(cache.record({
    url: stream, pageUrl: post, mimeType: "application/dash+xml", source: "chrome",
  }), null);
  assert.equal(safeStream("https://localhost/private.mp4"), null);
  assert.equal(safeStream("https://user:pass@cdn.example.com/file.mp4"), null);
  assert.equal(cache.find(post), null);
  const found = cache.record({
    url: stream, pageUrl: post + "?utm_source=share",
    mimeType: "video/mp4", source: "chrome", title: "A public TikTok",
  });
  assert.ok(found.id);
  assert.equal(found.postUrl, post);
  assert.equal(found.label, "Current browser playback");
  assert.equal(Object.hasOwn(found, "url"), false,
    "Never expose the expiring signed media URL to the renderer");
  assert.equal(cache.find(post).id, found.id);
  const selection = cache.resolve(post, found.id);
  assert.equal(selection.url, stream);
  assert.equal(selection.filename, "TikTok-7234567890123456789.mp4");
  assert.deepEqual(selection.headers, {
    Accept: "*/*",
    Referer: "https://www.tiktok.com/",
  });
  cache.close();
  assert.equal(cache.find(post), null);
});

test("playback cache deduplicates variants, expires promptly and cannot cross posts", () => {
  let now = 1_000_000;
  const cache = new PlaybackCapture({ now: () => now });
  const result = cache.record({
    url: stream, pageUrl: post, mimeType: "video/mp4", source: "edge",
  });
  const again = cache.record({
    url: stream, pageUrl: post, mimeType: "video/mp4", source: "edge",
  });
  assert.equal(again.id, result.id);
  assert.throws(
    () => cache.resolve("https://www.tiktok.com/@creator/video/7234567890123456788", result.id),
    /expired/,
  );
  now += CAPTURE_AGE_MS + 1;
  assert.equal(cache.find(post), null);
  assert.throws(() => cache.resolve(post, result.id), /expired/);
});

test("playback cache stays bounded even on media-heavy feeds", () => {
  const cache = new PlaybackCapture();
  for (let i = 0; i < 100; i++) {
    const url = "https://www.tiktok.com/@creator/video/" + String(7234567890123456789n + BigInt(i));
    cache.record({
      url: "https://media.example.com/" + i + ".mp4",
      pageUrl: url, mimeType: "video/mp4", source: "chrome",
    });
  }
  assert.ok(cache.posts.size <= 40);
});
