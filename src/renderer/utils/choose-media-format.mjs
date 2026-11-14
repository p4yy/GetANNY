// Choose the best resolution actually exposed by the extractor, while
// avoiding silent video when a playable variant is available. Never infer
// unsupported quality, DRM bypasses, or formats the site did not publish.
export function choosePreferredMediaFormat(formats, preferences = {}, tools = {}) {
  const video = (formats || []).filter((format) => format.group === "video");
  const allowed = (format) =>
    (!preferences?.container ||
      preferences.container === "any" ||
      format.ext === preferences.container) &&
    (!preferences?.height ||
      !format.height ||
      format.height <= preferences.height);
  const usable = (format) =>
    format.hasAudio === true ||
    format.audioUnknown === true ||
    (format.mergeAudio === true && tools?.ffmpeg === true);
  const ranked = (list) => [...list].sort(
    (a, b) =>
      (b.height || 0) - (a.height || 0) ||
      (b.fps || 0) - (a.fps || 0) ||
      (b.bitrate || 0) - (a.bitrate || 0),
  );
  const compatible = ranked(video.filter(allowed));
  const anyVideo = ranked(video);
  return (
    compatible.find(usable) ||
    compatible[0] ||
    anyVideo.find(usable) ||
    anyVideo[0] ||
    (formats || []).find((format) => format.group === "audio") ||
    formats?.[0] ||
    null
  );
}
