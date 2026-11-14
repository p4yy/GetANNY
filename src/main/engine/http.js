const { isSensitiveHeader } = require("../utils/sensitive-headers");
const http = require("node:http");
const https = require("node:https");
const { validateUrl } = require("./utils");
const {
  MAX_FILE_CONNECTIONS,
  MAX_CONCURRENT_DOWNLOADS,
} = require("./transfer-integrity");
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// Bounded keep-alive agents reuse probe/transfer and sequential-download
// connections without retaining an unbounded pool per history item.
const AGENTS = {
  "http:": new http.Agent({
    keepAlive: true,
    maxSockets: MAX_FILE_CONNECTIONS * MAX_CONCURRENT_DOWNLOADS,
    maxFreeSockets: 4,
    scheduling: "lifo",
  }),
  "https:": new https.Agent({
    keepAlive: true,
    maxSockets: MAX_FILE_CONNECTIONS * MAX_CONCURRENT_DOWNLOADS,
    maxFreeSockets: 4,
    scheduling: "lifo",
  }),
};

function httpError(status, detail = "", retryAfterMs = 0) {
  const error = new Error(`HTTP ${status}${detail ? `: ${detail}` : ""}`);
  error.statusCode = status;
  error.retryable = status === 408 || status === 429 || status >= 500;
  error.retryAfterMs = retryAfterMs;
  return error;
}
async function request(
  url,
  {
    method = "GET",
    headers = {},
    timeout = 30000,
    signal,
    requestOptions = {},
    sameOriginOnly = false,
  } = {},
) {
  let current = validateUrl(url);
  let forwarded = { ...headers };
  for (let redirects = 0; redirects <= 10; redirects++) {
    signal?.throwIfAborted();
    const parsed = new URL(current);
    const response = await new Promise((resolve, reject) => {
      const transport = parsed.protocol === "https:" ? https : http;
      const req = transport.request(
        parsed,
        {
          agent:
            requestOptions.ca || requestOptions.cert || requestOptions.key
              ? undefined
              : AGENTS[parsed.protocol],
          ...requestOptions,
          method,
          signal,
          headers: {
            "User-Agent": "GetANNY/2.0",
            "Accept-Encoding": "identity",
            ...forwarded,
          },
        },
        (incoming) => {
          // A consumer can be checking the response or opening a checkpoint
          // before it attaches a pipeline. The stream retains errors for the
          // pipeline, and this listener covers that short interval.
          incoming.on("error", () => {});
          resolve(incoming);
        },
      );
      // Socket inactivity alone does not bound DNS lookup or TLS setup.
      const deadline = setTimeout(() => {
        const error = new Error(
          "Connection setup timed out. Check your connection or retry.",
        );
        error.retryable = true;
        req.destroy(error);
      }, timeout);
      deadline.unref?.();
      req.once("response", () => clearTimeout(deadline));
      req.once("error", () => clearTimeout(deadline));
      req.once("close", () => clearTimeout(deadline));
      req.setTimeout(timeout, () => {
        const error = new Error(
          `The server did not respond for ${Math.round(timeout / 1000)} seconds.`,
        );
        error.retryable = true;
        req.destroy(error);
      });
      req.once("error", (error) => {
        if (
          ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(
            error.code,
          )
        )
          error.retryable = true;
        reject(error);
      });
      req.end();
    });
    if (REDIRECTS.has(response.statusCode) && response.headers.location) {
      const next = validateUrl(
        new URL(response.headers.location, current).href,
      );
      response.destroy();
      if (new URL(next).origin !== parsed.origin) {
        if (sameOriginOnly)
          throw new Error(
            "The server redirected the checksum to a different origin.",
          );
        forwarded = Object.fromEntries(
          Object.entries(forwarded).filter(([key]) => !isSensitiveHeader(key)),
        );
      }
      current = next;
      continue;
    }
    const retryAfter = response.headers["retry-after"];
    if (retryAfter) {
      const seconds = /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : (Date.parse(retryAfter) - Date.now()) / 1000;
      if (Number.isFinite(seconds))
        response.retryAfterMs = Math.max(0, Math.min(3600000, seconds * 1000));
    }
    return { response, url: current, headers: forwarded };
  }
  throw new Error("The server redirected this download too many times.");
}
function parseRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || "");
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  if (
    ![start, end, total].every(Number.isSafeInteger) ||
    start > end ||
    end >= total
  )
    return null;
  return { start, end, total };
}
function validateRange(response, start, end, total) {
  const range = parseRange(response.headers["content-range"]);
  if (
    response.statusCode !== 206 ||
    !range ||
    range.start !== start ||
    range.end !== end ||
    range.total !== total
  ) {
    response.destroy();
    throw new Error(
      "The server returned an incorrect byte range. The partial file was not marked complete.",
    );
  }
  const length = response.headers["content-length"];
  if (length !== undefined && Number(length) !== end - start + 1) {
    response.destroy();
    throw new Error(
      "The range response length does not match the requested bytes.",
    );
  }
}
module.exports = { request, httpError, parseRange, validateRange };
