const test = require("node:test");
const assert = require("node:assert/strict");
const { contextPost, postForCard, dribbbleAsset } = require("../src/extension/social-links");
const { prefersBrowser } = require("../src/extension/site-downloads");

test("home and search card links resolve to the selected post", () => {
  assert.equal(contextPost("https://www.youtube.com/shorts/AbCdEf12345?feature=share", "https://www.youtube.com/"), "https://www.youtube.com/watch?v=AbCdEf12345");
  assert.equal(contextPost("https://dribbble.com/shots/12345-Project?utm_source=feed", "https://dribbble.com/shots/popular"), "https://dribbble.com/shots/12345-Project");
  assert.equal(contextPost(null, "https://www.tiktok.com/foryou"), null);
  assert.equal(contextPost("https://example.org", "https://www.tiktok.com/@user/video/123456"), null);
});

test("TikTok card lookup uses a unique adjacent post and rejects ambiguous ancestors", () => {
  const urls = ["/@artist/video/123", "/@artist/video/456"];
  const nodes = urls.map((href) => ({ getAttribute: () => href }));
  const root = (anchors) => ({ querySelectorAll: (selector) => selector === "a[href]" ? anchors : [] });
  assert.equal(postForCard({ parentElement: root(nodes.slice(0, 1)) }, "https://www.tiktok.com/foryou"), "https://www.tiktok.com/@artist/video/123");
  assert.equal(postForCard({ parentElement: root(nodes) }, "https://www.tiktok.com/foryou"), null);
});

test("Dribbble sources are restricted to HTTPS video files on verified hosts", () => {
  const page = "https://dribbble.com/shots/12345-Project";
  assert.equal(dribbbleAsset("https://cdn.dribbble.com/userupload/123/preview.mp4?token=yes", page), "https://cdn.dribbble.com/userupload/123/preview.mp4?token=yes");
  assert.equal(dribbbleAsset("https://cdn.dribbble.com.example.org/wrong.mp4", page), null);
  assert.equal(dribbbleAsset("https://cdn.dribbble.com/poster.png", page), null);
});

test("protected ChatGPT and Claude transfers stay in the original session without cookie consent", () => {
  assert.equal(prefersBrowser("https://chatgpt.com/c/example", "https://files.oaiusercontent.com/example", false), true);
  assert.equal(prefersBrowser("", "https://claude.ai/download/example", false), true);
  assert.equal(prefersBrowser("https://claude.ai/chat/example", "https://example.org/example", true), false);
  assert.equal(prefersBrowser("https://example.org/", "https://example.org/example", false), false);
});
