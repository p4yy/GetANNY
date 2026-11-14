const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { DownloadEngine } = require("../src/main/engine/DownloadEngine");
const { ChunkDownloader } = require("../src/main/engine/ChunkDownloader");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { fixtureServer, temporary, waitFor, checksum } = require("./helpers");

async function run(engine) {
  let failure;
  engine.on("error", (_id, error) => {
    failure = error;
  });
  await engine.start();
  return failure;
}

test("range-capable servers without a strong validator are read in one transfer", async (t) => {
  const server = await fixtureServer(t);
  const dir = await temporary(t);
  const engine = new ChunkDownloader({
    url: server.url + "/no-validators",
    savePath: dir,
    connections: 64,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.segmentCount, 1);
  assert.deepEqual(
    server.state.requests.map((request) => request.range),
    ["bytes=0-0", undefined],
  );
  assert.deepEqual(
    await fs.readFile(path.join(dir, engine.filename)),
    server.state.data,
  );
});

test("a different response ETag is rejected even when every range is the correct size", async (t) => {
  const server = await fixtureServer(t, {
    extra(req, _res, _url, state) {
      if (req.headers.range !== "bytes=0-0") state.etag = '"other-revision"';
      return false;
    },
  });
  const dir = await temporary(t);
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
  });
  assert.equal((await run(engine)).code, "SOURCE_CHANGED");
  assert.equal(engine.status, "failed");
  await assert.rejects(fs.access(path.join(dir, engine.filename)), {
    code: "ENOENT",
  });
});

test("a full HTTP checksum can authorize splitting and is checked before publishing", async (t) => {
  const server = await fixtureServer(t, {
    extra(req, res, url, state) {
      const sha = checksum(state.data);
      res.setHeader(
        "X-Checksum-Sha256",
        url.searchParams.has("bad") ? "0".repeat(64) : sha,
      );
      return false;
    },
  });
  const dir = await temporary(t);
  const good = new ChunkDownloader({
    url: server.url + "/no-validators",
    savePath: dir,
    filename: "good.bin",
  });
  assert.equal(await run(good), undefined);
  assert.equal(good.segmentCount, 2);
  const bad = new ChunkDownloader({
    url: server.url + "/no-validators?bad",
    savePath: dir,
    filename: "bad.bin",
  });
  assert.equal((await run(bad)).code, "CHECKSUM_MISMATCH");
  await assert.rejects(fs.access(path.join(dir, "bad.bin")), {
    code: "ENOENT",
  });
});

test("an authentication page returned after the audio probe cannot be published as MP3", async (t) => {
  const html = Buffer.from("<html><body>Sign in</body></html>");
  const server = await fixtureServer(t, {
    extra(req, res) {
      const probe = req.headers.range === "bytes=0-0";
      res.writeHead(200, {
        "Content-Type": probe ? "audio/mpeg" : "text/html",
        "Content-Length": html.length,
      });
      res.end(probe ? Buffer.alloc(html.length, 0x41) : html);
      return true;
    },
  });
  const dir = await temporary(t);
  const engine = new DownloadEngine({
    url: server.url + "/track.mp3",
    savePath: dir,
  });
  assert.equal((await run(engine)).code, "AUTH_REQUIRED");
  await assert.rejects(fs.access(path.join(dir, "track.mp3")), {
    code: "ENOENT",
  });
});

test("cross-volume publication refuses to overwrite a file created after reservation", async (t) => {
  const server = await fixtureServer(t, { size: 64 });
  const dir = await temporary(t);
  const realLink = fs.link;
  let links = 0;
  t.mock.method(fs, "link", async (from, to) => {
    if (++links === 1)
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    return realLink(from, to);
  });
  const target = path.join(dir, "server-file.bin");
  const engine = new DownloadEngine({
    url: server.url + "/file.bin",
    savePath: dir,
    reserveTarget: async ({ filename }) => {
      await fs.writeFile(target, "previous file");
      return { savePath: dir, filename };
    },
  });
  assert.equal((await run(engine)).code, "EEXIST");
  assert.equal(await fs.readFile(target, "utf8"), "previous file");
  assert.equal(links, 2);
  assert.equal(
    (await fs.readdir(dir)).some((name) => name.endsWith(".publishing")),
    false,
  );
});

test(
  "64 active ranges can pause, survive a server rate limit, and resume by saved offsets",
  { timeout: 45000 },
  async (t) => {
    const size = 256 * 1024 * 1024;
    let rateLimit = false;
    const server = await fixtureServer(t, {
      size,
      delay: 1,
      extra(req, res) {
        if (!rateLimit || !req.headers["if-range"]) return false;
        rateLimit = false;
        res.writeHead(429, { "Retry-After": "1" }).end();
        return true;
      },
    });
    const dir = await temporary(t);
    const options = {
      id: "wide-resume",
      url: server.url + "/file.bin",
      savePath: dir,
      connections: 64,
    };
    const first = new ChunkDownloader({
      ...options,
      speedLimit: 32 * 1024 * 1024,
    });
    const initial = run(first);
    await waitFor(
      async () =>
        server.state.maxActive >= 64 && (await first.partialBytes()) > 0,
    );
    await first.pause();
    assert.equal(await initial, undefined);
    assert.equal(first.status, "paused");
    assert.equal(first.segmentCount, 64);
    assert.ok(first.downloadedSize > 0 && first.downloadedSize < size);

    rateLimit = true;
    const rejected = await run(new ChunkDownloader(options));
    assert.equal(rejected.statusCode, 429);
    assert.equal(rejected.retryAfterMs, 1000);
    const resumed = new ChunkDownloader(options);
    assert.equal(await run(resumed), undefined);
    assert.equal(resumed.segmentCount, 64);
    const resumedRanges = server.state.requests.filter(
      ({ ifRange, range }) =>
        ifRange && Number(/^bytes=(\d+)/.exec(range)?.[1]) % (size / 64) !== 0,
    );
    assert.ok(resumedRanges.length > 0);
    assert.deepEqual(
      await fs.readFile(path.join(dir, resumed.filename)),
      server.state.data,
    );
  },
);

test("a synchronous job setup failure releases its slot for the next download", async (t) => {
  const dir = await temporary(t);
  const manager = new DownloadManager({
    settings: {
      defaultDownloadPath: dir,
      maxConcurrentDownloads: 1,
      autoStartDownloads: false,
    },
    engineFactory(item) {
      if (item.url.endsWith("/fail"))
        throw new Error("fixture startup failure");
      return Object.assign(new EventEmitter(), {
        start() {
          this.emit("complete", item.id, { downloadedSize: 0, totalSize: 0 });
          return Promise.resolve();
        },
      });
    },
  });
  t.after(() => manager.shutdown());
  const failed = await manager.addDownload({
    url: "https://example.test/fail",
  });
  const next = await manager.addDownload({ url: "https://example.test/next" });
  manager.resume(failed);
  manager.resume(next);
  await waitFor(() => manager.running.size === 0);
  assert.equal(manager.requireItem(failed).status, "failed");
  assert.equal(manager.requireItem(next).status, "completed");
});

test("restart ignores bytes beyond the last durable checkpoint", async (t) => {
  const server = await fixtureServer(t, { size: 1024 * 1024, delay: 10 });
  const dir = await temporary(t);
  const options = {
    id: "checkpoint",
    url: server.url + "/file.bin",
    savePath: dir,
  };
  const first = new DownloadEngine(options);
  const task = run(first);
  t.after(() => first.pause());
  await waitFor(async () => (await first.partialBytes()) > 0);
  await first.pause();
  assert.equal(await task, undefined);
  const saved = JSON.parse(await fs.readFile(first.stateFile, "utf8"));
  const offset = saved.offsets[0];
  assert.equal(saved.version, 2);
  assert.ok(offset > 0 && offset < server.state.data.length);
  assert.equal(offset, (await fs.stat(first.partialPath)).size);
  // Simulate a later write reaching the filesystem while the prior state
  // checkpoint remains the last committed one.
  await fs.appendFile(first.partialPath, Buffer.alloc(1024, 0xff));

  const restored = new DownloadEngine(options);
  assert.equal(await run(restored), undefined);
  assert.ok(
    server.state.requests.some(
      ({ range, ifRange }) =>
        range === `bytes=${offset}-` && ifRange === server.state.etag,
    ),
  );
  assert.deepEqual(
    await fs.readFile(path.join(dir, restored.filename)),
    server.state.data,
  );
});

test("HTTP verifies a matching SHA-256 sidecar before publication", async (t) => {
  let requested = false;
  const server = await fixtureServer(t, {
    extra(req, res, url) {
      if (url.pathname !== "/file.bin.sha256") return false;
      requested = true;
      res
        .writeHead(200, { "Content-Type": "text/plain" })
        .end(`${"0".repeat(64)} *file.bin\n`);
      return true;
    },
  });
  const dir = await temporary(t);
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
  });
  assert.equal((await run(engine)).code, "CHECKSUM_MISMATCH");
  assert.equal(requested, true);
  await assert.rejects(fs.access(path.join(dir, engine.filename)), {
    code: "ENOENT",
  });
});

test("sidecars with ambiguous hashes or filenames cannot authorize a download", () => {
  const { parseSidecar } = require("../src/main/engine/checksum-sidecar");
  const digest = "a".repeat(64);
  const names = new Set(["file.bin"]);
  assert.equal(parseSidecar(`${digest} *file.bin\n`, names), digest);
  assert.equal(parseSidecar(`SHA256 (file.bin) = ${digest}`, names), digest);
  assert.equal(parseSidecar(`${digest} *other.bin`, names), null);
  assert.equal(
    parseSidecar(`${digest} *file.bin\n${"b".repeat(64)} *file.bin`, names),
    null,
  );
});
