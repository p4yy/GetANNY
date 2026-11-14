const { validateUrl } = require("../engine/utils");

const MAX_JSON_BYTES = 96 * 1024;
const DEFAULT_TIMEOUT_MS = 4500;

// Only a public post URL may be sent to TikTok's documented oEmbed service.
// No user cookies, signed URLs, or other credentials are forwarded.
function canonicalTikTokPost(rawUrl) {
  let parsed;
  try {
    parsed = new URL(validateUrl(rawUrl));
  } catch {
    return null;
  }
  if (!["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(parsed.hostname.toLowerCase()))
    return null;
  if (!/^\/@[a-zA-Z0-9_.]+\/video\/[0-9]{12,25}\/?$/.test(parsed.pathname))
    return null;
  return `https://www.tiktok.com${parsed.pathname.replace(/\/$/, "")}`;
}

function safeThumbnail(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function limitedJson(response) {
  if (!response?.ok) return null;
  const length = response.headers?.get?.("content-length");
  if (length !== null && Number(length) > MAX_JSON_BYTES) return null;
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) return null;
    return JSON.parse(raw);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchTikTokPreview(
  rawUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {},
) {
  const postUrl = canonicalTikTokPost(rawUrl);
  if (!postUrl || typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  // Keep this deadline referenced: a stalled fetch must settle even when
  // no other work is running. Unref'ing it leaves pending preview promises
  // unresolved and causes Node's test runner to cancel the request.
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      },
    );
    const result = await limitedJson(response);
    if (!result || result.provider_name !== "TikTok") return null;
    const thumbnail = safeThumbnail(result.thumbnail_url);
    if (!thumbnail) return null;
    return {
      provider: "TikTok",
      url: postUrl,
      title: typeof result.title === "string" ? result.title.slice(0, 240) : "",
      author: typeof result.author_name === "string" ? result.author_name.slice(0, 100) : "",
      thumbnail,
    };
  } catch {
    // oEmbed is intentionally best-effort; yt-dlp remains authoritative.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

module.exports = { canonicalTikTokPost, fetchTikTokPreview };
