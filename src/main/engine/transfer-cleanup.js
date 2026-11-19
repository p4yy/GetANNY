const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const JOB_ID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const JOB_DIRECTORY = new RegExp(`^${JOB_ID}$`, "i");
const STAGING_FILE = new RegExp(
  `^\\.getanny-(${JOB_ID})(?:\\.(?:(\\d+)\\.)?${JOB_ID})?\\.publishing$`,
  "i",
);
const METADATA_DIRECTORY = /^getanny-metadata-[a-z0-9]+$/i;
const LEGACY_STALE_MS = 24 * 60 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function directoryEntries(folder) {
  try {
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    return await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function removeOwnedDirectory(parent, child) {
  const [root, resolved] = await Promise.all([
    fs.realpath(parent),
    fs.realpath(path.join(parent, child)),
  ]);
  if (path.dirname(resolved) !== root || path.basename(resolved) !== child)
    throw new Error("The temporary path is outside its expected parent.");
  await fs.rm(resolved, { recursive: true, force: true });
}

function resumable(item) {
  if (!["completed", "failed", "cancelled"].includes(item.status)) return true;
  return (
    item.status === "failed" &&
    (item.kind === "media" ||
      item.kind === "torrent" ||
      item.resumable === true) &&
    item.errorCode !== "CHECKSUM_MISMATCH"
  );
}

async function reconcileTemporaryFiles({
  workRoot,
  items,
  defaultDestination,
  activeIds = new Set(),
  startup = false,
  systemTemp = os.tmpdir(),
  now = Date.now(),
  logger,
}) {
  const known = new Map(items.map((item) => [item.id, item]));
  const counts = { workFolders: 0, publishingFiles: 0, metadataFolders: 0 };
  const record = async (kind, identifier, operation) => {
    try {
      await operation();
      counts[kind]++;
      logger?.info("Removed temporary download data", { kind, identifier });
    } catch {
      logger?.warn("Could not remove temporary download data", {
        kind,
        identifier,
      });
    }
  };

  if (workRoot) {
    for (const entry of await directoryEntries(workRoot)) {
      if (
        startup &&
        entry.isFile() &&
        /^\.browser-upload-[a-f0-9-]{36}$/i.test(entry.name)
      ) {
        await record("workFolders", entry.name, () =>
          fs.rm(path.join(workRoot, entry.name), { force: true }),
        );
        continue;
      }
      if (
        !entry.isDirectory() ||
        !JOB_DIRECTORY.test(entry.name) ||
        activeIds.has(entry.name)
      )
        continue;
      const item = known.get(entry.name);
      if (item && (!startup || resumable(item))) continue;
      await record("workFolders", entry.name, () =>
        removeOwnedDirectory(workRoot, entry.name),
      );
    }
  }

  const destinations = new Set([
    defaultDestination,
    ...items.map((item) => item.savePath),
  ]);
  for (const folder of destinations) {
    if (!folder || !path.isAbsolute(folder)) continue;
    for (const entry of await directoryEntries(folder)) {
      const match = STAGING_FILE.exec(entry.name);
      if (!match || activeIds.has(match[1])) continue;
      const [name, id, pid] = match;
      const fullPath = path.join(folder, name);
      const stat = await fs.lstat(fullPath).catch(() => null);
      if (!stat?.isFile() && !stat?.isDirectory()) continue;
      if (stat.isDirectory() && !pid) continue;
      if (
        pid
          ? processIsAlive(Number(pid))
          : !known.has(id) && now - stat.mtimeMs < LEGACY_STALE_MS
      )
        continue;
      await record("publishingFiles", id, () =>
        stat.isDirectory()
          ? removeOwnedDirectory(folder, name)
          : fs.rm(fullPath, { force: true }),
      );
    }
  }

  for (const entry of await directoryEntries(systemTemp)) {
    if (!entry.isDirectory() || !METADATA_DIRECTORY.test(entry.name)) continue;
    const fullPath = path.join(systemTemp, entry.name);
    const owner = await fs
      .readFile(path.join(fullPath, ".getanny-owner"), "utf8")
      .catch(() => "");
    if (owner) {
      if (processIsAlive(Number(owner))) continue;
    } else {
      const stat = await fs.lstat(fullPath).catch(() => null);
      if (!stat?.isDirectory() || now - stat.mtimeMs < LEGACY_STALE_MS)
        continue;
    }
    await record("metadataFolders", entry.name, () =>
      removeOwnedDirectory(systemTemp, entry.name),
    );
  }
  return counts;
}

module.exports = { reconcileTemporaryFiles };
