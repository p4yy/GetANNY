const path = require("node:path");
const { request } = require("./http");

const MAX_BYTES = 8192;

function parseSidecar(text, names) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 1 && /^[a-f0-9]{64}$/i.test(lines[0]))
    return lines[0].toLowerCase();
  const hashes = new Set();
  for (const line of lines) {
    const sum = /^([a-f0-9]{64})\s+[ *]?(.+)$/i.exec(line);
    const bsd = /^SHA256\s+\((.+)\)\s*=\s*([a-f0-9]{64})$/i.exec(line);
    const name = sum?.[2] || bsd?.[1];
    if (name && names.has(name.replace(/^\.\//, "")))
      hashes.add((sum?.[1] || bsd[2]).toLowerCase());
  }
  return hashes.size === 1 ? hashes.values().next().value : null;
}

async function discoverSidecar(
  address,
  link,
  { filename, signal, timeout, requestOptions },
) {
  const source = new URL(address);
  const segment = source.pathname.split("/").at(-1);
  if (!segment || /\.sha256$/i.test(segment)) return null;
  const advertised =
    /<([^>]+)>\s*;\s*rel\s*=\s*(?:"(?:checksum|digest)"|(?:checksum|digest)(?=[\s;,]|$))/i.exec(
      link || "",
    )?.[1];
  if (!advertised && !path.posix.extname(segment)) return null;
  let target;
  try {
    target = new URL(advertised || source.pathname + ".sha256", source);
  } catch {
    return null;
  }
  if (
    target.origin !== source.origin ||
    target.username ||
    target.password ||
    target.href === source.href
  )
    return null;
  let response;
  try {
    const result = await request(target.href, {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.min(timeout, 2500)),
      ]),
      timeout: Math.min(timeout, 2500),
      requestOptions,
      sameOriginOnly: true,
    });
    response = result.response;
    if (
      new URL(result.url).origin !== source.origin ||
      response.statusCode !== 200 ||
      Number(response.headers["content-length"]) > MAX_BYTES ||
      /^(?:text\/html|application\/xhtml\+xml)/i.test(
        response.headers["content-type"] || "",
      )
    )
      return null;
    const chunks = [];
    let length = 0;
    for await (const chunk of response) {
      length += chunk.length;
      if (length > MAX_BYTES) return null;
      chunks.push(chunk);
    }
    return parseSidecar(
      Buffer.concat(chunks).toString("utf8"),
      new Set([decodeURIComponent(segment), filename]),
    );
  } catch {
    signal.throwIfAborted();
    return null;
  } finally {
    response?.destroy();
  }
}

module.exports = { discoverSidecar, parseSidecar };
