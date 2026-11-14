const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { MediaDetector } = require("./MediaDetector");
const { YtDlpWrapper } = require("./YtDlpWrapper");
const { MediaEngine, segmentStamp } = require("./MediaEngine");
const { temporary } = require("../../../tests/helpers");

test("segment validation accepts bounded video ranges and rejects unsafe ranges", async () => {
  const detector = new MediaDetector({
    wrapper: {
      getFormats: async () => ({
        title: "Clip",
        duration: 600,
        live: false,
        formats: [
          { formatId: "137", group: "video", ext: "mp4", mergeAudio: false },
          { formatId: "140", group: "audio", ext: "m4a" },
        ],
        thumbnails: [],
        subtitles: [],
      }),
      availability: async () => ({ ytdlp: true, ffmpeg: true }),
    },
  });
  const result = await detector.getFormats("https://example.test/video");
  assert.deepEqual(
    detector.selection({
      analysisId: result.analysisId,
      formatId: "137",
      segment: { start: 135, end: 340 },
    }).media.segment,
    { start: 135, end: 340 },
  );
  assert.equal(
    detector.selection({
      analysisId: result.analysisId,
      formatId: "137",
      segment: { start: 0, end: 600 },
    }).media.segment,
    null,
  );
  for (const segment of [
    { start: -1, end: 2 },
    { start: 12, end: 11 },
    { start: 10, end: 10.0005 },
    { start: 599, end: 601 },
  ])
    assert.throws(
      () =>
        detector.selection({
          analysisId: result.analysisId,
          formatId: "137",
          segment,
        }),
      /segment/i,
    );
  assert.throws(
    () =>
      detector.selection({
        analysisId: result.analysisId,
        formatId: "140",
        segment: { start: 1, end: 3 },
      }),
    /video formats/i,
  );
});

test("live streams and unknown durations cannot produce a segment selection", async () => {
  const detector = new MediaDetector({
    wrapper: {
      getFormats: async () => ({
        title: "Live",
        duration: null,
        live: true,
        formats: [{ formatId: "18", group: "video", ext: "mp4" }],
        thumbnails: [],
        subtitles: [],
      }),
      availability: async () => ({ ytdlp: true, ffmpeg: true }),
    },
  });
  const result = await detector.getFormats("https://example.test/live");
  assert.equal(result.live, true);
  assert.throws(
    () =>
      detector.selection({
        analysisId: result.analysisId,
        formatId: "18",
        segment: { start: 1, end: 5 },
      }),
    /reliable duration/i,
  );
});

test("completed live recordings with a known duration remain eligible for segments", async () => {
  const wrapper = new YtDlpWrapper({});
  wrapper.getInfo = async () => ({
    title: "Recorded stream",
    duration: 60,
    live_status: "was_live",
    formats: [],
  });
  const result = await wrapper.getFormats("https://example.test/recording");
  assert.equal(result.duration, 60);
  assert.equal(result.live, false);
});

test("the source download delegates precise trimming and requires every VOD fragment", async (t) => {
  const directory = await temporary(t);
  const wrapper = new YtDlpWrapper({ binPath: directory });
  wrapper.availability = async () => ({ ytdlp: true, ffmpeg: true });
  let args;
  wrapper.run = async (value) => {
    args = value;
    return "";
  };
  await wrapper.download({
    url: "https://example.test/video",
    formatId: "137",
    mergeAudio: false,
    outputTemplate: path.join(directory, "clip.%(ext)s"),
    speedLimit: 0,
    segment: { start: 135, end: 340 },
  });
  assert.ok(!args.includes("--download-sections"));
  assert.ok(args.includes("--abort-on-unavailable-fragments"));
});

test("partial media output names contain the chosen range and full video keeps its old name", async (t) => {
  const directory = await temporary(t);
  assert.equal(segmentStamp(135), "02m15s");
  assert.equal(segmentStamp(3723), "01h02m03s");
  const run = async (segment, id) => {
    const wrapper = {
      async download({ outputTemplate, onFile }) {
        const file = outputTemplate.replace("%(ext)s", "mp4");
        await fs.writeFile(file, Buffer.from("fixture"));
        onFile(file);
      },
    };
    const engine = new MediaEngine(
      {
        id,
        url: "https://example.test/video",
        savePath: directory,
        media: { title: "Video title", formatId: "137", segment },
        timeout: 30000,
      },
      wrapper,
      {
        validateOutput: async () => {},
        trimOutput: async ({ source }) => source,
      },
    );
    let completed;
    engine.on("complete", (_id, result) => {
      completed = result;
    });
    engine.on("error", () => {});
    await engine.start();
    assert.equal(engine.status, "completed");
    return completed.filename;
  };
  assert.match(
    await run({ start: 135, end: 340 }, "partial"),
    /Video title_02m15s-05m40s\.mp4$/,
  );
  assert.match(await run(null, "whole"), /Video title\.mp4$/);
});

test("seekable media uses only the selected interval and keeps captions aligned", async (t) => {
  for (const expectedFallback of [false, true]) {
    const dir = await temporary(t);
    const attempts = [];
    const wrapper = {
      async download({ section, outputTemplate, onFile }) {
        attempts.push(section);
        const file = outputTemplate.replace("%(ext)s", "mp4");
        await fs.writeFile(file, "fixture");
        onFile(file);
      },
    };
    const engine = new MediaEngine(
      {
        id: "fixture",
        url: "https://example.test/video",
        savePath: dir,
        media: {
          title: "Selected interval",
          formatId: "18",
          seekableSection: true,
          segment: { start: 10, end: 12 },
        },
        timeout: 30000,
      },
      wrapper,
      {
        validateOutput: async () => ({
          hasVideo: true,
          duration: expectedFallback ? 30 : 2,
        }),
        trimOutput: async ({ source, segment, subtitleStart }) => {
          assert.equal(subtitleStart, 10);
          assert.deepEqual(
            segment,
            expectedFallback ? { start: 10, end: 12 } : { start: 0, end: 2 },
          );
          return source;
        },
      },
    );
    engine.on("error", (_id, error) => assert.fail(error));
    await engine.start();
    assert.equal(engine.status, "completed");
    assert.deepEqual(
      attempts,
      expectedFallback
        ? [{ start: 10, end: 12 }, undefined]
        : [{ start: 10, end: 12 }],
    );
    assert.equal(engine.filename, "Selected interval_00m10s-00m12s.mp4");
  }
});
