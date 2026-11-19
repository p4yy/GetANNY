import { choosePreferredAudioFormat } from "./choose-media-format.mjs";

export function choosePlaylistFormat(formats, mode, cap, audioPreferences) {
  const group = ["audio", "m4a", "opus"].includes(mode) ? "audio" : "video";
  const candidates = formats
    .filter(
      (format) =>
        format.group === group &&
        (mode === "audio" ||
          mode === "video" ||
          format.ext === mode ||
          (mode === "opus" && /^opus/i.test(format.acodec || ""))) &&
        (group === "audio" || !format.height || format.height <= cap),
    );
  if (group === "audio")
    return choosePreferredAudioFormat(candidates, audioPreferences) || undefined;
  return candidates.sort((a, b) =>
    (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0),
  )[0];
}
