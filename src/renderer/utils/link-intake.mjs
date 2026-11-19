const mediaHost =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|soundcloud\.com|dailymotion\.com|tiktok\.com|instagram\.com|facebook\.com|twitter\.com|x\.com|bilibili\.com|reddit\.com|kick\.com)\.?$/i;
const directMedia =
  /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|ogg|flac|wav|aac|opus)$/i;
export const BATCH_LIMIT = 50;

export function classifyLink(value) {
  const input = String(value || "").trim();
  if (!input || input.length > 8192 || /[\r\n]/.test(input)) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol === "magnet:") {
    const hash = url.searchParams
      .getAll("xt")
      .find((value) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(value));
    return hash
      ? {
          url: input,
          kind: "torrent",
          key: hash.toLowerCase(),
          kinds: ["torrent"],
        }
      : null;
  }
  if (
    !["http:", "https:", "ftp:", "ftps:"].includes(url.protocol) ||
    !url.hostname
  )
    return null;
  const web = url.protocol === "http:" || url.protocol === "https:";
  if (web && /\.torrent$/i.test(url.pathname)) {
    return {
      url: url.href,
      kind: "torrent",
      key: url.href,
      kinds: ["torrent", "file"],
    };
  }
  const kind =
    web && mediaHost.test(url.hostname) && !directMedia.test(url.pathname)
      ? "media"
      : "file";
  return {
    url: url.href,
    kind,
    key: url.href,
    kinds: web ? ["file", "media", "torrent"] : ["file"],
  };
}

export function intakeLines(value) {
  return String(value || "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function openLinkIntake(value, ui, { allowFile = true } = {}) {
  const lines = intakeLines(value);
  if (lines.length > 1) {
    if (!lines.slice(0, BATCH_LIMIT).some(classifyLink)) return false;
    ui.setDetails(null);
    ui.setAddModal({
      batch: true,
      text: lines.slice(0, BATCH_LIMIT + 1).join("\n"),
    });
    return true;
  }
  const link = classifyLink(lines[0]);
  if (!link || (!allowFile && link.kind === "file")) return false;
  ui.setDetails(null);
  if (link.kind === "media") {
    ui.setAddModal(null);
    ui.openMedia(link.url);
  } else if (link.kind === "torrent") {
    ui.setActiveTab("torrent");
    ui.setAddModal({ torrent: true, torrentUrl: link.url });
  } else {
    ui.setAddModal({ url: link.url });
  }
  return true;
}
