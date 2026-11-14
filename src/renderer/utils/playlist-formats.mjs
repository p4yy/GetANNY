export function choosePlaylistFormat(formats, mode, cap) {
  const group = ["audio", "m4a", "opus"].includes(mode) ? "audio" : "video";
  return formats
    .filter(
      (format) =>
        format.group === group &&
        (mode === "audio" ||
          mode === "video" ||
          format.ext === mode ||
          (mode === "opus" && /^opus/i.test(format.acodec || ""))) &&
        (group === "audio" || !format.height || format.height <= cap),
    )
    .sort((a, b) =>
      group === "audio"
        ? (b.bitrate || 0) - (a.bitrate || 0)
        : (b.height || 0) - (a.height || 0) ||
          (b.bitrate || 0) - (a.bitrate || 0),
    )[0];
}
