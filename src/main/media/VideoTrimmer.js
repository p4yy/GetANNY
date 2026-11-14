const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

function run(executable, args, signal, onProgress) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      error = "",
      buffer = "";
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (data) => {
      if (!onProgress) {
        output = (output + data).slice(-2000000);
        return;
      }
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("out_time_us=")) {
          const seconds = Number(line.slice(12)) / 1000000;
          if (Number.isFinite(seconds)) onProgress(seconds);
        }
      }
    });
    child.stderr.on("data", (data) => {
      error = (error + data).slice(-12000);
    });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    child.once("error", (e) => {
      cleanup();
      reject(e);
    });
    child.once("close", (code) => {
      cleanup();
      if (signal?.aborted) reject(new Error("Media operation stopped."));
      else if (code !== 0)
        reject(new Error(`Video processing failed (${code}): ${error}`));
      else resolve(output);
    });
  });
}

function rational(value) {
  const [n, d = 1] = String(value).split("/").map(Number);
  return d && Number.isFinite(n / d) ? n / d : null;
}
function hdrParameters(video) {
  const params = [
    "pools=4",
    "frame-threads=2",
    ...(video.color_transfer === "smpte2084" ? ["hdr10=1"] : []),
    "repeat-headers=1",
  ];
  for (const data of video.side_data_list || []) {
    if (/Mastering display/i.test(data.side_data_type || "")) {
      const xy = (name) => Math.round(rational(data[name]) * 50000);
      const lum = (name) => Math.round(rational(data[name]) * 10000);
      if (
        [
          "red_x",
          "red_y",
          "green_x",
          "green_y",
          "blue_x",
          "blue_y",
          "white_point_x",
          "white_point_y",
          "max_luminance",
          "min_luminance",
        ].some((key) => rational(data[key]) === null)
      )
        throw new Error(
          "HDR mastering metadata is incomplete. Use Fast cut with MKV to preserve the source.",
        );
      params.push(
        `master-display=G(${xy("green_x")},${xy("green_y")})B(${xy("blue_x")},${xy("blue_y")})R(${xy("red_x")},${xy("red_y")})WP(${xy("white_point_x")},${xy("white_point_y")})L(${lum("max_luminance")},${lum("min_luminance")})`,
      );
    }
    if (/Content light/i.test(data.side_data_type || ""))
      params.push(
        `max-cll=${Number(data.max_content) || 0},${Number(data.max_average) || 0}`,
      );
  }
  return params.join(":");
}
async function trimVideo({
  source,
  segment,
  binPath,
  signal,
  onProgress,
  options = {},
  subtitleSource,
  subtitleStart = segment.start,
}) {
  const start = Number(segment.start),
    end = Number(segment.end),
    length = end - start;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    length < 0.001
  )
    throw new Error("Choose a valid video segment with a positive duration.");
  const mode = options.mode || "precise",
    container = options.container || "mkv";
  if (
    !["fast", "precise"].includes(mode) ||
    !["mkv", "mp4"].includes(container)
  )
    throw new Error("Unsupported export mode.");
  const binary = (name) =>
    path.join(binPath, name + (process.platform === "win32" ? ".exe" : ""));
  for (const name of ["ffmpeg", "ffprobe"]) await fs.access(binary(name));
  const probe = async (file) =>
    JSON.parse(
      await run(
        binary("ffprobe"),
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        signal,
      ),
    );
  const info = await probe(source);
  const video = info.streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (!video) throw new Error("The selected source contains no video stream.");
  if (Number(info.format?.duration) + 0.1 < end)
    throw new Error("The selected end exceeds the source duration.");
  const hdr = ["smpte2084", "arib-std-b67"].includes(video.color_transfer);
  if (
    mode === "precise" &&
    (video.codec_tag_string === "dvh1" ||
      (video.side_data_list || []).some((data) =>
        /DOVI|Dolby|HDR10\+/i.test(data.side_data_type || ""),
      ))
  )
    throw new Error(
      "Dynamic HDR cannot be preserved by the precise encoder. Choose Fast cut with MKV.",
    );
  if (
    mode === "fast" &&
    container === "mp4" &&
    !["h264", "hevc", "av1", "mpeg4"].includes(video.codec_name)
  )
    throw new Error(
      "This video codec cannot be copied to MP4. Choose MKV or Precise cut.",
    );
  const target = path.join(
    path.dirname(source),
    path.basename(source, path.extname(source)) + `.cut.${container}`,
  );
  const args = [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(start),
  ];
  if (mode === "precise") args.push("-accurate_seek");
  args.push("-i", source);
  if (subtitleSource)
    args.push("-ss", String(subtitleStart), "-i", subtitleSource);
  args.push("-t", String(length), "-map", `0:${video.index}`);
  if (options.audio !== "none") args.push("-map", "0:a?");
  const subtitles = info.streams.filter((s) => s.codec_type === "subtitle");
  if (options.subtitles && subtitles.length) {
    if (
      container === "mp4" &&
      subtitles.some(
        (s) =>
          !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
            s.codec_name,
          ),
      )
    )
      throw new Error("Image subtitles require MKV output.");
    args.push(
      "-map",
      "0:s?",
      "-c:s",
      container === "mp4" ? "mov_text" : "copy",
    );
  }
  if (subtitleSource)
    args.push(
      "-map",
      "1:s:0",
      "-c:s",
      container === "mp4" ? "mov_text" : "srt",
    );
  args.push("-map_metadata", "0", "-map_chapters", "-1");
  if (mode === "fast")
    args.push(
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
    );
  else {
    const crf = { high: 16, balanced: 19, small: 23 }[
      options.quality || "high"
    ];
    if (crf === undefined) throw new Error("Unsupported quality setting.");
    args.push(
      "-c:v",
      hdr ? "libx265" : "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(crf),
      "-threads",
      "4",
      "-fps_mode",
      "passthrough",
    );
    if (video.pix_fmt) args.push("-pix_fmt", video.pix_fmt);
    args.push("-c:a", container === "mkv" ? "flac" : "aac");
    if (container === "mp4") args.push("-b:a", "320k");
    if (hdr) args.push("-x265-params", hdrParameters(video));
    for (const [key, flag] of [
      ["color_range", "-color_range"],
      ["color_space", "-colorspace"],
      ["color_transfer", "-color_trc"],
      ["color_primaries", "-color_primaries"],
    ])
      if (video[key] && !["unknown", "unspecified"].includes(video[key]))
        args.push(flag, video[key]);
  }
  if (container === "mp4") args.push("-movflags", "+faststart");
  args.push(
    "-max_muxing_queue_size",
    "4096",
    "-progress",
    "pipe:1",
    "-nostats",
    target,
  );
  try {
    await run(binary("ffmpeg"), args, signal, onProgress);
    const result = await probe(target);
    const outputVideo = result.streams.find((s) => s.codec_type === "video");
    if (!outputVideo || !(await fs.stat(target)).size)
      throw new Error("The segment output is incomplete.");
    if (
      mode === "precise" &&
      video.pix_fmt &&
      outputVideo.pix_fmt !== video.pix_fmt
    )
      throw new Error(
        "The encoder could not preserve the source pixel format. Use Fast cut with MKV.",
      );
    const duration = Number(result.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Invalid exported duration.");
    const fps = rational(video.avg_frame_rate) || 0;
    const tolerance = Math.max(0.12, fps > 0 ? 2 / fps : 0.25);
    if (mode === "precise" && Math.abs(duration - length) > tolerance)
      throw new Error(
        "The exported duration does not match the selection. Output was not published.",
      );
    const expectedAudio =
      options.audio === "none"
        ? 0
        : info.streams.filter((s) => s.codec_type === "audio").length;
    if (
      result.streams.filter((s) => s.codec_type === "audio").length !==
      expectedAudio
    )
      throw new Error("The output audio tracks are incomplete.");
    return target;
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}
module.exports = { trimVideo };
