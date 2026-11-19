const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { syncDirectory } = require("./durable-partials");

const MAX_FILE_CONNECTIONS = 64;
const MAX_CONCURRENT_DOWNLOADS = 12;

function strongETag(value) {
  return typeof value === "string" && /^"[^"\x00-\x20\x7f]*"$/.test(value)
    ? value
    : null;
}

function representationChecksum(headers, status) {
  const custom = headers["x-checksum-sha256"];
  if (typeof custom === "string" && /^[a-f0-9]{64}$/i.test(custom.trim()))
    return custom.trim().toLowerCase();
  // Content-Digest on a 206 covers the response content, not the whole file.
  const encoded = /(?:^|,)\s*sha-256=:([a-z0-9+/]{43}=):\s*(?=,|$)/i.exec(
    headers["repr-digest"] ||
      (status === 200 ? headers["content-digest"] : "") ||
      "",
  )?.[1];
  return encoded ? Buffer.from(encoded, "base64").toString("hex") : null;
}

function validateRepresentation(response, { etag, sha256 }) {
  const returnedETag = strongETag(response.headers.etag);
  const returnedChecksum = representationChecksum(
    response.headers,
    response.statusCode,
  );
  if (
    (etag && returnedETag && etag !== returnedETag) ||
    (sha256 && returnedChecksum && sha256 !== returnedChecksum) ||
    (etag && !returnedETag && !sha256)
  ) {
    response.destroy();
    const error = new Error(
      "The server changed the file or did not confirm its identity. The transfer must be checked again.",
    );
    error.code = "SOURCE_CHANGED";
    error.retryable = true;
    throw error;
  }
}

async function verifyChecksum(file, expected, signal) {
  if (!expected) return;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal }))
    hash.update(chunk);
  if (hash.digest("hex") !== expected) {
    const error = new Error(
      "The downloaded file does not match the server's SHA-256 checksum.",
    );
    error.code = "CHECKSUM_MISMATCH";
    throw error;
  }
}

async function publishFile(source, target, jobId, { copy = false } = {}) {
  let linked = false;
  if (!copy) {
    try {
      await fs.link(source, target);
      linked = true;
    } catch (error) {
      if (!["EXDEV", "EPERM", "ENOTSUP", "EACCES"].includes(error.code))
        throw error;
    }
  }
  const destination = path.dirname(target);
  if (linked) {
    await syncDirectory(destination);
    return;
  }

  // A staged copy is linked in the destination volume. Unlike rename, link
  // refuses to replace an existing target even if it appeared after reservation.
  const staged = path.join(
    destination,
    `.getanny-${jobId}.${process.pid}.${randomUUID()}.publishing`,
  );
  await fs
    .copyFile(source, staged, constants.COPYFILE_EXCL)
    .catch(async (error) => {
      if (error.code !== "EEXIST")
        await fs.rm(staged, { force: true }).catch(() => {});
      throw error;
    });
  try {
    const handle = await fs.open(staged, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.link(staged, target);
    await syncDirectory(destination);
  } finally {
    await fs.rm(staged, { force: true }).catch(() => {});
  }
}

module.exports = {
  MAX_FILE_CONNECTIONS,
  MAX_CONCURRENT_DOWNLOADS,
  strongETag,
  representationChecksum,
  validateRepresentation,
  verifyChecksum,
  publishFile,
};
