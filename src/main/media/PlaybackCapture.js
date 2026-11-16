const { randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const { canonicalTikTokPost } = require("./TikTokPreview");

// A browser has already fetched this video. Reusing the captured media URL
// avoids re-parsing the watch page, but this is intentionally NOT a replacement
// for the full quality picker or a permanent download URL.
const CAPTURE_AGE_MS = 3 * 60 * 1000;
const MAX_POSTS = 40;
const MAX_VARIANTS = 4;

function safeStream(raw) {
  if (typeof raw !== "string" || raw.length > 8192) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isIP(host) ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.indexOf(".") === -1
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

class PlaybackCapture {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.posts = new Map();
  }
  sweep() {
    const cutoff = this.now() - CAPTURE_AGE_MS;
    for (const [post, variants] of this.posts) {
      const fresh = variants.filter((value) => value.time > cutoff);
      if (fresh.length) this.posts.set(post, fresh);
      else this.posts.delete(post);
    }
    while (this.posts.size > MAX_POSTS)
      this.posts.delete(this.posts.keys().next().value);
  }
  record({ url, pageUrl, mimeType, source, title, headers: rawHeaders } = {}) {
    const postUrl = canonicalTikTokPost(pageUrl);
    const streamUrl = safeStream(url);
    const type = String(mimeType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // Never pretend a DASH/HLS fragment or an unknown data response is an MP4.
    if (
      !postUrl ||
      !streamUrl ||
      !["video/mp4", "video/webm", "video/quicktime"].includes(type) ||
      typeof source !== "string" ||
      source.length > 32
    )
      return null;
    this.sweep();
    const variants = this.posts.get(postUrl) || [];
    const existing = variants.find((item) => item.url === streamUrl);
    const requestHeaders = {};
    for (const [rawName, rawValue] of Object.entries(rawHeaders || {})) {
      const name = rawName.toLowerCase();
      if (!["accept", "cookie", "referer", "user-agent"].includes(name))
        continue;
      if (
        typeof rawValue !== "string" ||
        rawValue.length > 16384 ||
        /[\r\n\0]/.test(rawValue)
      )
        continue;
      requestHeaders[
        {
          accept: "Accept",
          cookie: "Cookie",
          referer: "Referer",
          "user-agent": "User-Agent",
        }[name]
      ] = rawValue;
    }
    const entry = {
      id: existing?.id || randomUUID(),
      postUrl,
      url: streamUrl,
      type,
      source,
      headers: requestHeaders,
      title: String(title || "TikTok video").slice(0, 160),
      time: this.now(),
    };
    this.posts.delete(postUrl);
    this.posts.set(
      postUrl,
      [entry, ...variants.filter((item) => item.url !== streamUrl)].slice(
        0,
        MAX_VARIANTS,
      ),
    );
    this.sweep();
    return this.public(entry);
  }
  public(entry) {
    return {
      id: entry.id,
      postUrl: entry.postUrl,
      source: entry.source,
      type: entry.type,
      title: entry.title,
      observedAt: entry.time,
      label: "Current browser playback",
    };
  }
  find(pageUrl) {
    this.sweep();
    const postUrl = canonicalTikTokPost(pageUrl);
    if (!postUrl) return null;
    const entry = this.posts.get(postUrl)?.[0];
    return entry ? this.public(entry) : null;
  }
  resolve(pageUrl, id) {
    this.sweep();
    const postUrl = canonicalTikTokPost(pageUrl);
    const entry = this.posts.get(postUrl)?.find((item) => item.id === id);
    if (!entry)
      throw new Error(
        "The browser stream expired. Play the video again or use full analysis.",
      );
    const videoId = postUrl.match(/\/video\/(\d+)$/)?.[1];
    const ext =
      entry.type === "video/webm"
        ? "webm"
        : entry.type === "video/quicktime"
          ? "mov"
          : "mp4";
    return {
      url: entry.url,
      filename: `TikTok-${videoId}.${ext}`,
      // Headers are short-lived in-memory capture data. The extension only
      // supplies cookies when the user has enabled its local cookie toggle.
      headers: {
        Accept: "*/*",
        ...(entry.headers || {}),
        Referer: entry.headers?.Referer || "https://www.tiktok.com/",
      },
    };
  }
  close() {
    this.posts.clear();
  }
}
module.exports = { PlaybackCapture, safeStream, CAPTURE_AGE_MS };
