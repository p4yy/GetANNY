const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fixtureServer, temporary } = require("./helpers");
const { DownloadEngine } = require("../src/main/engine/DownloadEngine");
const { MediaEngine } = require("../src/main/media/MediaEngine");
const { YtDlpWrapper } = require("../src/main/media/YtDlpWrapper");

const binPath = path.resolve("bin");
const binary = (name) =>
  path.join(binPath, process.platform === "win32" ? `${name}.exe` : name);

async function run(engine) {
  let error;
  engine.on("error", (_id, failure) => {
    error = failure;
  });
  await engine.start();
  return error;
}

test("media publication rejects a nonempty file with no decodable streams", async (t) => {
  if (
    !(await fs.access(binary("ffprobe")).then(
      () => true,
      () => false,
    ))
  )
    return t.skip("Pinned FFprobe is unavailable");
  const folder = await temporary(t);
  const engine = new MediaEngine(
    {
      id: "invalid-media",
      url: "https://example.test/watch",
      savePath: folder,
      tempPath: path.join(folder, "work"),
      timeout: 30000,
      media: { title: "Invalid media", formatId: "demo", audioOnly: true },
    },
    {
      binPath,
      async download({ outputTemplate, onFile }) {
        const file = outputTemplate.replace("%(ext)s", "mp3");
        await fs.writeFile(file, "<html>Authentication required</html>");
        onFile(file);
      },
    },
  );
  assert.match(
    (await run(engine)).message,
    /could not read the downloaded media/i,
  );
  assert.equal(engine.status, "failed");
  await assert.rejects(fs.access(path.join(folder, "Invalid media.mp3")), {
    code: "ENOENT",
  });
});

test("direct HTTP audio is published only when FFprobe decodes it", async (t) => {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (
      !(await fs.access(binary(tool)).then(
        () => true,
        () => false,
      ))
    )
      return t.skip("Pinned media tools are unavailable");
  }
  const folder = await temporary(t);
  const valid = execFileSync(binary("ffmpeg"), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-t",
    "1",
    "-f",
    "mp3",
    "pipe:1",
  ]);
  const server = await fixtureServer(t, {
    extra(req, res, url) {
      if (url.pathname.endsWith(".sha256")) {
        res.writeHead(404).end();
        return true;
      }
      const audio =
        url.pathname === "/valid.mp3"
          ? valid
          : Buffer.from("broken audio data");
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length,
      });
      res.end(audio);
      return true;
    },
  });
  const download = (filename) =>
    new DownloadEngine({
      url: server.url + "/" + filename,
      filename,
      savePath: folder,
      tempPath: path.join(folder, filename + ".work"),
      binPath,
    });
  assert.equal(await run(download("valid.mp3")), undefined);
  assert.deepEqual(await fs.readFile(path.join(folder, "valid.mp3")), valid);
  assert.equal((await run(download("invalid.mp3"))).code, "INVALID_MEDIA");
  await assert.rejects(fs.access(path.join(folder, "invalid.mp3")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.access(path.join(folder, "invalid.mp3.work")), {
    code: "ENOENT",
  });
});

test(
  "VOD HLS requires every TS fragment before marking the output complete",
  { timeout: 45000 },
  async (t) => {
    const wrapper = new YtDlpWrapper({ binPath });
    const tools = await wrapper.availability();
    if (!tools.ytdlp || !tools.ffmpeg)
      return t.skip("Pinned media tools are unavailable");
    const folder = await temporary(t);
    execFileSync(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100",
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-g",
        "10",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-hls_time",
        "1",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        path.join(folder, "seg%d.ts"),
        path.join(folder, "clip.m3u8"),
      ],
      { windowsHide: true, timeout: 15000 },
    );
    const files = new Map();
    for (const name of await fs.readdir(folder)) {
      const body = await fs.readFile(path.join(folder, name));
      const type = name.endsWith(".ts")
        ? "video/mp2t"
        : "application/vnd.apple.mpegurl";
      files.set("/" + name, { body, type });
      if (name === "clip.m3u8")
        files.set("/broken.m3u8", {
          body: Buffer.from(body.toString().replace("seg1.ts", "missing.ts")),
          type,
        });
    }
    const server = await fixtureServer(t, {
      extra(_req, res, url) {
        const entry = files.get(url.pathname);
        if (!entry) res.writeHead(404).end();
        else {
          res.writeHead(200, {
            "Content-Type": entry.type,
            "Content-Length": entry.body.length,
          });
          res.end(entry.body);
        }
        return true;
      },
    });
    for (const [filename, shouldComplete] of [
      ["clip.m3u8", true],
      ["broken.m3u8", false],
    ]) {
      const url = server.url + "/" + filename;
      const info = await wrapper.getFormats(url);
      const format = info.formats.find((value) => value.group === "video");
      assert.equal(format.protocol, "m3u8_native");
      const savePath = path.join(folder, "outputs");
      const engine = new MediaEngine(
        {
          id: filename,
          url,
          savePath,
          tempPath: path.join(folder, filename + "-work"),
          timeout: 30000,
          media: {
            title: filename,
            formatId: format.formatId,
            mergeAudio: format.mergeAudio,
          },
        },
        wrapper,
      );
      const error = await run(engine);
      if (shouldComplete) {
        assert.equal(error, undefined);
        assert.equal(engine.status, "completed");
      } else {
        assert.equal(engine.status, "failed");
        assert.match(error.message, /404|fragment/i);
        assert.equal(
          (await fs.readdir(savePath)).some((name) =>
            name.startsWith(filename),
          ),
          false,
        );
        assert.ok(
          server.state.requests.some(
            (request) => request.url === "/missing.ts",
          ),
        );
      }
    }
  },
);
