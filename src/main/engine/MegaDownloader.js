const { API, File } = require("megajs");
const { Readable, Transform } = require("node:stream");
const { DownloadEngine } = require("./DownloadEngine");
const { sanitizeFilename } = require("./utils");

function isMegaShare(url) {
  let source;
  try {
    source = new URL(url);
  } catch {
    return false;
  }
  return (
    source.protocol === "https:" &&
    ["mega.nz", "mega.co.nz"].includes(source.hostname) &&
    (/^\/(?:file|folder)\//.test(source.pathname) ||
      /^#(?:F)?!/.test(source.hash))
  );
}

function requireHttps(input) {
  const address = new URL(input);
  if (address.protocol !== "https:")
    throw new Error("MEGA returned an insecure transfer URL.");
  return address;
}

async function loadMegaShare(url, signal, timeout = 30000) {
  const api = new API(false, {
    fetch: (input, options) =>
      fetch(requireHttps(input), {
        ...options,
        redirect: "error",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(timeout),
          ...(options?.signal ? [options.signal] : []),
        ]),
      }),
  });
  try {
    const file = File.fromURL(url, { api });
    if (!file.key) throw new Error("Missing decryption key.");
    return await file.loadAttributes();
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error(
      "MEGA could not open the share. Check that the link is available and includes its decryption key.",
      { cause },
    );
  }
}

function isMegaFolderShare(url) {
  const source = new URL(url);
  const hash = source.hash;
  return (
    (source.pathname.startsWith("/folder/") && !hash.includes("/file/")) ||
    (hash.startsWith("#F!") && hash.split("!").length === 3)
  );
}

function megaChildLink(url, node) {
  const child = new URL(url);
  if (!/^[A-Za-z0-9_-]+$/.test(node.nodeId || ""))
    throw new Error("MEGA returned an invalid child file ID.");
  if (child.pathname.startsWith("/folder/"))
    child.hash += "/file/" + node.nodeId;
  else child.hash += "!" + node.nodeId;
  return child.href;
}

function listMegaFiles(root) {
  const files = [];
  const seen = new Set();
  const stack = [{ node: root, folders: [] }];
  while (stack.length) {
    const { node, folders } = stack.pop();
    if (seen.has(node))
      throw new Error("The MEGA folder contains a cyclic entry.");
    seen.add(node);
    if (!node.name || !node.key)
      throw new Error(
        "The MEGA share contains an entry that could not be decrypted.",
      );
    if (node.directory) {
      const next = [...folders, sanitizeFilename(node.name).slice(0, 120)];
      for (const child of [...(node.children || [])].reverse())
        stack.push({ node: child, folders: next });
    } else {
      if (!Number.isSafeInteger(node.size) || node.size < 0)
        throw new Error("The MEGA file has an invalid size.");
      files.push({ node, folders });
    }
  }
  return files;
}

class MegaDownloader extends DownloadEngine {
  constructor(options) {
    super(options);
    this.loadShare = options.loadMegaShare || loadMegaShare;
  }

  async probe() {
    this.file = await this.loadShare(
      this.url,
      this.controller.signal,
      this.timeout,
    );
    if (this.file.directory)
      throw new Error(
        "Open this MEGA folder as a batch to download the files it contains.",
      );
    if (
      !Number.isSafeInteger(this.file.size) ||
      this.file.size < 0 ||
      !this.file.name
    )
      throw new Error("MEGA could not read the file metadata.");
    const info = {
      url: this.url,
      filename: this.filenameExplicit
        ? this.filename
        : sanitizeFilename(this.file.name),
      totalSize: this.file.size,
      acceptRanges: false,
      resumable: false,
      lastModified: null,
      etag: null,
      sha256: null,
    };
    Object.assign(this, info);
    return info;
  }

  async transfer() {
    const signal = this.controller.signal;
    const source =
      this.totalSize === 0
        ? Readable.from([])
        : this.file.download({
            forceHttps: true,
            maxConnections: Math.max(1, Math.min(8, this.connections)),
            handleRetries: (count, error, complete) =>
              complete(count >= 3 || signal.aborted ? error : null),
          });
    // MEGA authenticates the decrypted stream when it is read from byte zero.
    // Partial plaintext is never used to skip the stream's integrity check.
    const meter = new Transform({
      transform: (chunk, _encoding, callback) => {
        this.limiter.consume(chunk.length, signal).then(() => {
          this.downloadedSize += chunk.length;
          this.tickBytes += chunk.length;
          if (this.downloadedSize > this.totalSize)
            return callback(
              new Error("MEGA sent more bytes than the declared file size."),
            );
          callback(null, chunk);
        }, callback);
      },
    });
    // The client may still report an asynchronous network error after abort.
    source.on("error", () => {});
    await this.partials.write(this.partialPath, 0, 0, signal, source, meter);
  }
}

module.exports = {
  MegaDownloader,
  isMegaShare,
  isMegaFolderShare,
  megaChildLink,
  loadMegaShare,
  listMegaFiles,
};
