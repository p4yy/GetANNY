"use strict";

const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

async function readRemoteTorrent(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept:
          "application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.1",
      },
    });
    if (!response.ok)
      throw new Error(
        `Torrent file request returned HTTP ${response.status}.`,
      );

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TORRENT_BYTES)
      throw new Error("The torrent file is larger than the 16 MB limit.");

    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_TORRENT_BYTES) {
        controller.abort();
        throw new Error("The torrent file is larger than the 16 MB limit.");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("The torrent file request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { MAX_TORRENT_BYTES, readRemoteTorrent };
