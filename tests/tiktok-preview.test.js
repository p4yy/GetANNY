const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  canonicalTikTokPost,
  fetchTikTokPreview,
} = require("../src/main/media/TikTokPreview");
const { YtDlpWrapper } = require("../src/main/media/YtDlpWrapper");
const { TransferWorker } = require("../src/main/engine/transfer-worker");

const video = "https://www.tiktok.com/@example.user/video/7234567890123456789";

test("TikTok post canonicalization removes tracking while rejecting other hosts", () => {
  assert.equal(canonicalTikTokPost(video + "?is_from_webapp=1"), video);
  assert.equal(canonicalTikTokPost("https://tiktok.com.evil.example/" + video), null);
  assert.equal(canonicalTikTokPost("https://www.tiktok.com/explore"), null);
  assert.equal(canonicalTikTokPost("https://vm.tiktok.com/abc"), null);
  assert.equal(canonicalTikTokPost("https://www.youtube.com/watch?v=1"), null);
});

test("TikTok preview is bounded, public and does not block download metadata", async () => {
  let request;
  let options;
  const preview = await fetchTikTokPreview(video + "?utm_source=tracking", {
    fetchImpl: async (url, opts) => {
      request = url;
      options = opts;
      return {
        ok: true,
        headers: { get: () => null },
        body: null,
        text: async () =>
          JSON.stringify({
            provider_name: "TikTok",
            title: "Example video",
            author_name: "Creator",
            thumbnail_url: "https://example.com/thumb.jpg",
          }),
      };
    },
  });
  assert.equal(request, "https://www.tiktok.com/oembed?url=" + encodeURIComponent(video));
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.deepEqual(preview, {
    provider: "TikTok",
    url: video,
    title: "Example video",
    author: "Creator",
    thumbnail: "https://example.com/thumb.jpg",
  });
});

test("TikTok preview rejects oversized or insecure metadata and never fetches arbitrary URLs", async () => {
  let called = 0;
  const fetchImpl = async () => {
    called++;
    return {
      ok: true,
      headers: { get: () => "9999999" },
      body: null,
      text: async () => "{}",
    };
  };
  assert.equal(await fetchTikTokPreview("https://example.net/@foo/video/7234567890123456789", { fetchImpl }), null);
  assert.equal(called, 0);
  assert.equal(await fetchTikTokPreview(video, { fetchImpl }), null);
  assert.equal(called, 1);
  assert.equal(await fetchTikTokPreview(video, {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify({
        provider_name: "TikTok",
        thumbnail_url: "javascript:alert(1)",
      }),
    }),
  }), null);
});

test("TikTok metadata runs against canonical post URL with a referrer, not Explore", async () => {
  let args;
  const wrapper = new YtDlpWrapper({
    executable: "fake-ytdlp",
    spawnProcess: (_file, command) => {
      args = command;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from('{"title":"TikTok example","formats":[]}\n'));
        child.emit("close", 0);
      });
      return child;
    },
  });
  const result = await wrapper.getInfo(video + "?from=explore");
  assert.equal(result.title, "TikTok example");
  assert.equal(args.at(-1), video);
  assert.ok(args.includes("Referer: https://www.tiktok.com/"));
  assert.equal(args[args.indexOf("--socket-timeout") + 1], "15");
});

test("Idle HTTP worker is reaped promptly without changing torrent lifecycle", () => {
  const http = new TransferWorker("http");
  const torrent = new TransferWorker("torrent");
  assert.equal(http.idleTimeout, 15_000);
  assert.equal(torrent.idleTimeout, 5 * 60 * 1000);
  assert.equal(http.child, undefined);
  assert.equal(torrent.child, undefined);
});

test("TikTok preview fails closed after its deadline", async () => {
  const preview = await fetchTikTokPreview(video, {
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    }),
  });
  assert.equal(preview, null);
});

test("A public TikTok preview does not start the video extraction subprocess", async () => {
  let spawned = 0;
  const extractor = new YtDlpWrapper({
    executable: "fake-ytdlp",
    spawnProcess: () => { spawned++; throw new Error("No extraction requested"); },
  });
  assert.ok(extractor);
  const result = await fetchTikTokPreview(video, {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify({
        provider_name: "TikTok",
        thumbnail_url: "https://example.com/video-preview.jpg",
      }),
    }),
  });
  assert.equal(result.thumbnail, "https://example.com/video-preview.jpg");
  assert.equal(spawned, 0, "previewing must not retain or spawn yt-dlp");
});
