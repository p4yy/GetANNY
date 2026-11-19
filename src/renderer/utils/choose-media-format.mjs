function languageCode(value) {
  if (typeof value !== "string") return "";
  return value.trim().replaceAll("_", "-").toLowerCase();
}

function languageMatch(value, requested) {
  const code = languageCode(value);
  const wanted = languageCode(requested);
  if (!code || !wanted) return 0;
  if (code === wanted) return 2;
  return code.split("-")[0] === wanted.split("-")[0] ? 1 : 0;
}

export function mediaLanguageName(code, locale) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale], { type: "language", fallback: "none" })
      .of(code.replaceAll("_", "-")) || code;
  } catch {
    return code;
  }
}

export function mediaAudioTrackLabel(format, locale, originalLabel) {
  return [
    mediaLanguageName(format.language, locale),
    format.originalAudio && originalLabel,
    format.bitrate > 0 && `${Math.round(format.bitrate)} kbps`,
    format.audioChannels && `${format.audioChannels} ch`,
    format.ext?.toUpperCase(),
  ].filter(Boolean).join(" · ");
}

const isH264 = (codec) => /^(avc[13]|h264)(?:\.|$)/i.test(codec || "");
const isAac = (codec) => /^(mp4a|aac)(?:\.|$)/i.test(codec || "");
const usable = (format, tools) =>
  format.hasAudio === true ||
  format.audioUnknown === true ||
  (format.mergeAudio === true && tools?.ffmpeg === true);
const qualityOrder = (a, b) =>
  (b.height || 0) - (a.height || 0) ||
  (b.fps || 0) - (a.fps || 0) ||
  (b.bitrate || 0) - (a.bitrate || 0);
const preferredAudioOrder = (a, b, preferences) =>
  languageMatch(b.language, preferences.language) -
    languageMatch(a.language, preferences.language) ||
  Number(!!b.originalAudio) - Number(!!a.originalAudio) ||
  languageMatch(b.language, preferences.interfaceLanguage) -
    languageMatch(a.language, preferences.interfaceLanguage);

export function choosePreferredAudioFormat(formats, preferences = {}) {
  return (formats || [])
    .filter((format) => format.group === "audio" &&
      (!preferences.compatible || (format.ext === "m4a" && isAac(format.acodec))))
    .sort((a, b) =>
      preferredAudioOrder(a, b, preferences) ||
      qualityOrder(a, b),
    )[0] || null;
}

export function choosePreferredSubtitle(tracks, preferred, source, interfaceLanguage) {
  const ranked = (tracks || []).filter((track) =>
    track.id === preferred ||
    languageMatch(track.language, preferred) ||
    languageMatch(track.language, source) ||
    languageMatch(track.language, interfaceLanguage),
  );
  return ranked.sort((a, b) =>
    Number(b.id === preferred) - Number(a.id === preferred) ||
    languageMatch(b.language, preferred) - languageMatch(a.language, preferred) ||
    languageMatch(b.language, source) - languageMatch(a.language, source) ||
    languageMatch(b.language, interfaceLanguage) - languageMatch(a.language, interfaceLanguage) ||
    Number(!!a.automatic) - Number(!!b.automatic),
  )[0] || null;
}

export function choosePreferredMediaFormat(formats, preferences = {}, tools = {}) {
  const video = (formats || []).filter((format) => format.group === "video");
  const audioPreferences = {
    language: preferences.audioLanguage,
    interfaceLanguage: preferences.interfaceLanguage,
  };
  const audio = choosePreferredAudioFormat(formats, audioPreferences);
  const allowed = (format) =>
    (!preferences?.container ||
      preferences.container === "any" ||
      format.ext === preferences.container) &&
    (!preferences?.height ||
      !format.height ||
      format.height <= preferences.height);
  const ranked = (list) => [...list].sort((a, b) =>
    (b.height || 0) - (a.height || 0) ||
    (b.fps || 0) - (a.fps || 0) ||
    preferredAudioOrder(
      (a.mergeAudio && audio) || a,
      (b.mergeAudio && audio) || b,
      audioPreferences,
    ) ||
    (b.bitrate || 0) - (a.bitrate || 0),
  );
  const compatible = ranked(video.filter(
    (format) => allowed(format) && (!format.mergeAudio || tools?.ffmpeg),
  ));
  const anyVideo = ranked(video.filter((format) => !format.mergeAudio || tools?.ffmpeg));
  return (
    compatible.find((format) => usable(format, tools)) ||
    compatible[0] ||
    anyVideo.find((format) => usable(format, tools)) ||
    anyVideo[0] ||
    audio ||
    formats?.[0] ||
    null
  );
}

export function chooseMediaPreset(formats, preset, tools, audioPreferences) {
  const selectableVideo = formats.filter(
    (format) => format.group === "video" && usable(format, tools),
  );
  const audio = choosePreferredAudioFormat(formats, {
    ...audioPreferences,
    compatible: preset === "compatible",
  });
  let format;
  if (preset === "compatible") {
    format = selectableVideo
      .filter((item) => item.ext === "mp4" && isH264(item.vcodec) &&
        (item.mergeAudio ? audio : isAac(item.acodec)))
      .sort(qualityOrder)[0];
  } else if (preset === "small") {
    format = selectableVideo
      .filter((item) => item.height > 0 && item.height <= 720)
      .sort((a, b) =>
        b.height - a.height ||
        (a.filesize || Infinity) - (b.filesize || Infinity) ||
        (a.bitrate || Infinity) - (b.bitrate || Infinity) ||
        qualityOrder(a, b),
      )[0];
  } else if (preset === "best") {
    format = selectableVideo.sort(qualityOrder)[0];
  }
  return format ? { format, audio: format.mergeAudio ? audio : null } : null;
}
