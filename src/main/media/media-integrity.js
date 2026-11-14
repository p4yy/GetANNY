const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execute = promisify(execFile);

async function validateMediaOutput(
  file,
  { binPath, signal, audioOnly, mergeAudio },
) {
  const ffprobe = path.join(
    binPath,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
  let result;
  try {
    const { stdout } = await execute(
      ffprobe,
      [
        "-v",
        "error",
        "-read_intervals",
        "%+4",
        "-show_streams",
        "-show_format",
        "-show_frames",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name:stream_disposition=attached_pic:frame=media_type,stream_index",
        "-of",
        "json",
        file,
      ],
      { signal, timeout: 30000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    result = JSON.parse(stdout);
  } catch (cause) {
    signal?.throwIfAborted();
    throw new Error("FFprobe could not read the downloaded media.", { cause });
  }
  const duration = Number(result.format?.duration);
  if (!(Number.isFinite(duration) && duration > 0))
    throw new Error("The downloaded media has no playable duration.");

  const decoded = new Set(
    result.frames?.map((frame) => frame.stream_index) ?? [],
  );
  const playable = new Set(
    (result.streams || [])
      .filter(
        (stream) =>
          stream.codec_name &&
          !stream.disposition?.attached_pic &&
          decoded.has(stream.index),
      )
      .map((stream) => stream.codec_type),
  );
  if (audioOnly && !playable.has("audio"))
    throw new Error("The downloaded file has no decodable audio stream.");
  if (mergeAudio && (!playable.has("video") || !playable.has("audio")))
    throw new Error(
      "The merged file is missing a decodable video or audio stream.",
    );
  if (!playable.has("video") && !playable.has("audio"))
    throw new Error("The downloaded file has no decodable media streams.");
  return {
    duration,
    hasAudio: playable.has("audio"),
    hasVideo: playable.has("video"),
  };
}

module.exports = { validateMediaOutput };
