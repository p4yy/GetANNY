const test = require("node:test");
const assert = require("node:assert/strict");
const {
  siteKey,
  offset,
  position,
} = require("../src/extension/overlay-preferences");
const {
  classifyMediaResponse,
  addDetection,
} = require("../src/extension/stream-detection");
const { getBrowser } = require("../src/main/browser-integration/catalog");

test("overlay preferences are scoped to the hostname and clamp saved positions to the viewport", () => {
  assert.equal(
    siteKey("https://video.example/watch?a=1"),
    "getanny-overlay:video.example",
  );
  assert.equal(
    siteKey("https://video.example/another"),
    "getanny-overlay:video.example",
  );
  assert.equal(siteKey("chrome://extensions"), null);
  const saved = position(
    { x: 400, y: -2 },
    { width: 900, height: 700 },
    { width: 100, height: 50 },
  );
  assert.deepEqual(saved, { x: 0.5, y: 0 });
  assert.deepEqual(
    offset(saved, { width: 700, height: 500 }, { width: 100, height: 50 }),
    { x: 300, y: 0 },
  );
});

test("HLS detection promotes manifests and groups matching fragment observations by frame and origin", () => {
  const manifest = "https://cdn.example/watch/master.m3u8?token=fixture";
  const first = "https://cdn.example/watch/0001.ts";
  const second = "https://cdn.example/watch/0002.ts";
  const unrelated = "https://cdn.example/watch/other.ts";
  assert.equal(
    classifyMediaResponse("https://cdn.example/code.ts", "text/typescript"),
    null,
  );
  assert.deepEqual(
    classifyMediaResponse(manifest, "application/octet-stream"),
    { kind: "media", stream: "hls" },
  );
  const fragment = (url, frameId) => ({
    url,
    frameId,
    ...classifyMediaResponse(url, "video/mp2t"),
  });
  let detections = addDetection([], fragment(first, 1), 10);
  detections = addDetection(detections, fragment(unrelated, 2), 10);
  detections = addDetection(
    detections,
    { url: manifest, frameId: 1, kind: "file" },
    10,
  );
  detections = addDetection(
    detections,
    { url: manifest, frameId: 1, ...classifyMediaResponse(manifest, "") },
    10,
  );
  detections = addDetection(detections, fragment(second, 1), 10);
  assert.equal(detections[0].kind, "media");
  assert.equal(detections[0].fragmentCount, 2);
  assert.deepEqual(
    detections.map((item) => item.url),
    [manifest, unrelated],
  );
});

test("Comet has a distinct Chromium package and can be provisioned through its own catalog entry", () => {
  const browser = getBrowser("comet");
  assert.equal(browser.family, "chromium");
  assert.equal(browser.page, "chrome://extensions");
  assert.ok(browser.win.some((file) => file.endsWith("/comet.exe")));
});

test("HLS retries are deduplicated and variant playlists take precedence over root playlists", () => {
  const root = {
    url: "https://cdn.example/master.m3u8",
    frameId: 0,
    stream: "hls",
  };
  const variant = {
    url: "https://cdn.example/720p/index.m3u8",
    frameId: 0,
    stream: "hls",
  };
  const fragment = {
    url: "https://cdn.example/720p/0001.ts",
    frameId: 0,
    stream: "hls-fragment",
  };
  const inOtherFrame = { ...fragment, frameId: 2 };
  let list = addDetection([], root, 10);
  list = addDetection(list, fragment, 10);
  assert.equal(list[0].fragmentCount, 1);
  list = addDetection(list, variant, 10);
  const original = list;
  list = addDetection(list, fragment, 10);
  assert.equal(list, original);
  list = addDetection(list, inOtherFrame, 10);
  assert.equal(
    list.find((entry) => entry.url === variant.url).fragmentCount,
    1,
  );
  assert.equal(list.find((entry) => entry.url === root.url).fragmentCount, 0);
  assert.equal(list.find((entry) => entry.url === fragment.url).frameId, 2);
});

test("content script recovers dropped initial HTML5 media reports without duplicate events", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync("src/extension/content.js", "utf8");
  const background = fs.readFileSync("src/extension/background.js", "utf8");
  const listeners = [];
  const events = [];
  class MediaNode {
    constructor(url) { this.src = url; this.currentSrc = url; }
    matches(selector) { return selector === "video,audio"; }
    querySelectorAll() { return []; }
  }
  const video = new MediaNode("https://media.example/video.mp4");
  const document = {
    title: "GetANNY fixture",
    documentElement: {},
    addEventListener() {},
    querySelectorAll() { return [video]; },
  };
  const api = {
    runtime: {
      id: "getanny@test",
      sendMessage(message) { events.push(message); return Promise.resolve({success:true}); },
      onMessage: { addListener(fn) { listeners.push(fn); } },
    },
  };
  const window = {};
  window.top = window;
  vm.runInNewContext(source, {
    globalThis: {
      browser: api,
      GetANNYSiteDownloads: {providerFor() {return false;}},
      GetANNYSocialLinks: {socialSite() {return false;}},
    },
    window,
    document,
    location: {href:"https://media.example/watch.html"},
    Element: MediaNode,
    MutationObserver: class {observe() {}},
    Node: {ELEMENT_NODE:1},
    URL,
    setTimeout,
    clearTimeout,
  });
  assert.equal(events.filter(e => e.type === "media-detected").length,1);
  let response;
  for (const listener of listeners)
    listener({type:"getanny:scan-media"}, {id:api.runtime.id}, result => response=result);
  assert.equal(response.items.length,1);
  assert.equal(response.items[0].url, "https://media.example/video.mp4");
  assert.equal(response.items[0].title, "GetANNY fixture");
  assert.equal(events.length,1, "Recovery must not send a duplicate event");
  assert.match(background, /api\.tabs\.sendMessage\(tabId/);
  assert.match(background, /getanny:scan-media/);
});

// A media blob does not identify a TikTok post: the feed's generic /en/
// URL must never be queued as though it were an individual video.
test("TikTok content, overlay and popup never submit a generic feed URL", async () => {
  const fs = require("node:fs/promises");
  const content = await fs.readFile("src/extension/content.js", "utf8");
  const overlay = await fs.readFile("src/extension/injector.js", "utf8");
  const popup = await fs.readFile("src/extension/popup.js", "utf8");
  const html = await fs.readFile("src/extension/popup.html", "utf8");
  assert.match(content, /postForMediaElement\(\s*main\.video,\s*location\.href/);
  assert.match(content, /getanny:active-post/);
  assert.match(overlay, /if \(isTikTok && !post\)/);
  assert.match(overlay, /url: post \|\|/);
  assert.match(popup, /getanny:active-post/);
  assert.match(html, /<script src="social-links\.js"><\/script>/);
});

test("TikTok source elements do not replace a canonical post with a transient rendition URL", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("src/extension/content.js", "utf8");
  assert.match(source, /if \(isTikTok && root\.parentElement\.matches\("video"\)\) return/);
  assert.match(source, /send\(\{ url: post, kind: "media" \}\)/);
});
