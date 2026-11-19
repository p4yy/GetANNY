const http = require("node:http");
const https = require("node:https");

const MAX_CAPTION_BYTES = 8 * 1024 * 1024;
const DEFAULT_RETRY_MS = 60 * 1000;
const rateLimits = new Map();

function captionRateLimit(retryAfter, now = Date.now()) {
  const header = String(retryAfter ?? "").trim();
  const retryAt = /^\d+$/.test(header)
    ? now + Number(header) * 1000
    : Date.parse(header);
  return new CaptionRateLimitError(
    Number.isFinite(retryAt) && retryAt > now && retryAt <= 8.64e15
      ? retryAt
      : now + DEFAULT_RETRY_MS,
  );
}

class CaptionRateLimitError extends Error {
  constructor(retryAt) {
    super("The site rate-limited subtitles (HTTP 429). Retry this download after " +
      new Date(retryAt).toISOString() + ".");
    this.code = "CAPTION_RATE_LIMIT";
    this.statusCode = 429;
    this.retryAt = retryAt;
  }
}

function captionOrigins(urls) {
  return urls.filter(Boolean).map((url) => new URL(url).origin);
}

function checkCaptionCooldown(urls, retryAt = 0, now = Date.now()) {
  for (const [origin, until] of rateLimits) {
    if (until <= now) rateLimits.delete(origin);
  }
  const blockedUntil = Math.max(retryAt || 0, 0, ...captionOrigins(urls)
    .map((origin) => rateLimits.get(origin) || 0));
  if (blockedUntil > now) throw new CaptionRateLimitError(blockedUntil);
}

function recordCaptionCooldown(urls, error) {
  if (error.code !== "CAPTION_RATE_LIMIT") return;
  for (const origin of captionOrigins(urls))
    rateLimits.set(origin, Math.max(rateLimits.get(origin) || 0, error.retryAt));
}

function toSrtTime(raw) {
  let value = String(raw || "").trim();
  if (!/^\d+:\d{2}:\d{2}/.test(value)) value = `00:${value}`;
  return value.replace(".", ",");
}

function stripMarkup(text) {
  return String(text)
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&lrm;|&rlm;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/**
 * Converts a WEBVTT document to SubRip. Cue identifiers, settings and markup
 * are dropped so the result opens cleanly in players that only read SRT.
 */
function vttToSrt(input) {
  const blocks = String(input)
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) continue;
    if (
      /^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0]) ||
      lines[0].startsWith("X-TIMESTAMP-MAP")
    )
      continue;
    const offset = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const timing = lines[offset];
    if (!timing || !timing.includes("-->")) continue;
    const [start, end] = timing.split("-->");
    if (!start || !end) continue;
    const text = stripMarkup(lines.slice(offset + 1).join("\n")).trim();
    if (!text) continue;
    cues.push({
      start: toSrtTime(start.trim().split(/\s+/)[0]),
      end: toSrtTime(end.trim().split(/\s+/)[0]),
      text,
    });
  }
  return cues
    .map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`)
    .join("\n\n")
    .concat(cues.length ? "\n" : "");
}

/** Converts SubRip to WEBVTT without losing cue timing or text. */
function srtToVtt(input) {
  const blocks = String(input)
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) continue;
    const offset = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const timing = lines[offset];
    if (!timing || !timing.includes("-->")) continue;
    const [start, end] = timing.split("-->");
    if (!start || !end) continue;
    cues.push({
      start: start.trim().split(/\s+/)[0].replace(",", "."),
      end: end.trim().split(/\s+/)[0].replace(",", "."),
      text: stripMarkup(lines.slice(offset + 1).join("\n")).trim(),
    });
  }
  if (!cues.length) return "WEBVTT\n";
  return `WEBVTT\n\n${cues
    .map((cue) => `${cue.start} --> ${cue.end}\n${cue.text}`)
    .join("\n\n")}\n`;
}

function looksLikeCaptions(text) {
  return typeof text === "string" && text.includes("-->");
}

function convertCaptions(text, from, to) {
  if (from === to) return text;
  if (from === "vtt" && to === "srt") return vttToSrt(text);
  if (from === "srt" && to === "vtt") return srtToVtt(text);
  return null;
}

/** Streams a caption track, following redirects and enforcing a size cap. */
function fetchCaption(
  url,
  { headers = {}, signal, timeout = 30000, redirects = 5 } = {},
) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error("The caption URL is not valid."));
      return;
    }
    if (!/^https?:$/.test(target.protocol)) {
      reject(new Error("The caption URL is not supported."));
      return;
    }
    if (signal?.aborted) {
      reject(new Error("Subtitle download cancelled."));
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const request = client.get(
      target,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GetANNY Subtitle Fetcher",
          accept: "*/*",
          ...headers,
        },
        timeout,
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          const location = response.headers.location;
          if (!location || redirects <= 0) {
            reject(new Error("The caption request could not follow its redirect."));
            return;
          }
          let next;
          try {
            next = new URL(location, target).toString();
          } catch {
            reject(new Error("The caption request redirected to an invalid URL."));
            return;
          }
          fetchCaption(next, {
            headers,
            signal,
            timeout,
            redirects: redirects - 1,
          }).then(resolve, reject);
          return;
        }
        if (response.statusCode === 429) {
          response.resume();
          reject(captionRateLimit(response.headers["retry-after"]));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(`The caption server replied with HTTP ${response.statusCode}.`),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_CAPTION_BYTES) {
            request.destroy();
            reject(new Error("The caption file is unexpectedly large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!looksLikeCaptions(text)) {
            reject(new Error("The caption track did not contain any cues."));
            return;
          }
          resolve(text);
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Caption request timed out.")));
    request.on("error", reject);
    if (signal) {
      const abort = () =>
        request.destroy(new Error("Subtitle download cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      request.on("close", () => signal.removeEventListener("abort", abort));
    }
  });
}

module.exports = {
  captionRateLimit,
  checkCaptionCooldown,
  convertCaptions,
  fetchCaption,
  looksLikeCaptions,
  recordCaptionCooldown,
  srtToVtt,
  vttToSrt,
};
