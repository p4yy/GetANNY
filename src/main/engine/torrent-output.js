const { randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DurablePartials, writeDurable } = require("./durable-partials");
const { publishFile } = require("./transfer-integrity");
const { sanitizeFilename } = require("./utils");

const READY = ".getanny-torrent-ready.json";

function relativeInside(root, file) {
  const relative = path.relative(root, file);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Torrent metadata contains an unsafe file path.");
  return relative;
}

async function verifiedFiles(workPath, files, createEmpty = false) {
  const root = await fs.realpath(workPath);
  const result = [];
  for (const file of files) {
    const source = path.resolve(root, file.path);
    const relative = relativeInside(root, source);
    if (createEmpty && file.length === 0) {
      try {
        await fs.lstat(source);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const folder = path.dirname(source);
        await fs.mkdir(folder, { recursive: true });
        relativeInside(
          root,
          path.join(await fs.realpath(folder), path.basename(source)),
        );
        await fs.writeFile(source, "", { flag: "wx" });
      }
    }
    relativeInside(root, await fs.realpath(source));
    const stat = await fs.lstat(source);
    if (
      !stat.isFile() ||
      stat.size !== file.length ||
      (file.mtimeMs !== undefined && file.mtimeMs !== stat.mtimeMs)
    )
      throw new Error(
        "A selected torrent file is missing or has changed since verification.",
      );
    result.push({ path: relative, length: stat.size, mtimeMs: stat.mtimeMs });
  }
  if (!result.length)
    throw new Error("No selected torrent files were available to save.");
  return result;
}

async function recordVerifiedTorrent(workPath, files, name) {
  const ready = {
    version: 1,
    name,
    files: await verifiedFiles(workPath, files, true),
  };
  await writeDurable(path.join(workPath, READY), JSON.stringify(ready));
  return ready;
}

async function loadVerifiedTorrent(workPath) {
  try {
    const ready = await DurablePartials.read(path.join(workPath, READY));
    if (
      ready?.version !== 1 ||
      typeof ready.name !== "string" ||
      !Array.isArray(ready.files)
    )
      return null;
    return { ...ready, files: await verifiedFiles(workPath, ready.files) };
  } catch {
    return null;
  }
}

async function claimUniqueTarget(folder, name, isFile, claim) {
  const ext = isFile ? path.extname(name) : "";
  const stem = path.basename(name, ext);
  for (let counter = 0; ; counter++) {
    const target = path.join(
      folder,
      counter ? `${stem} (${counter})${ext}` : name,
    );
    try {
      await claim(target);
      return target;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

async function commitDirectory(staging, target, files) {
  const directories = new Set([target]);
  const linked = [];
  const makeDirectory = async (folder) => {
    if (directories.has(folder)) return;
    await makeDirectory(path.dirname(folder));
    try {
      await fs.mkdir(folder);
      directories.add(folder);
    } catch (error) {
      if (error.code !== "EEXIST" || !(await fs.lstat(folder)).isDirectory())
        throw error;
    }
  };
  try {
    for (const file of files) {
      const source = path.join(staging, file.path);
      const destination = path.join(target, file.path);
      await makeDirectory(path.dirname(destination));
      await fs.link(source, destination);
      linked.push({ source, destination });
    }
  } catch (error) {
    for (const { source, destination } of linked) {
      await Promise.all([fs.stat(source), fs.lstat(destination)])
        .then(([before, current]) => {
          if (before.dev === current.dev && before.ino === current.ino)
            return fs.unlink(destination);
        })
        .catch(() => {});
    }
    for (const folder of [...directories].reverse())
      await fs.rmdir(folder).catch(() => {});
    throw error;
  }
}

async function publishTorrentFile(source, target, id, copy) {
  try {
    await publishFile(source, target, id, { copy });
  } catch (error) {
    if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "EINVAL"].includes(error.code))
      throw error;
    // A FAT/exFAT destination cannot hard-link. An exclusive copy still
    // preserves an existing file and leaves the verified source available.
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  }
}

async function renameWindowsDirectory(staging, target) {
  try {
    // On Windows a directory rename fails if the target names an existing
    // entry, including an empty directory. POSIX requires an explicit claim.
    await fs.rename(staging, target);
  } catch (error) {
    if (
      ["EPERM", "EACCES", "ENOTEMPTY"].includes(error.code) &&
      (await fs.lstat(target).catch(() => null))
    ) {
      error.code = "EEXIST";
    }
    throw error;
  }
}

async function publishTorrentOutput({ workPath, savePath, id, ready, copy }) {
  if (ready.files.length === 1) {
    const { path: relative } = ready.files[0];
    const name = sanitizeFilename(path.basename(relative));
    return claimUniqueTarget(savePath, name, true, (target) =>
      publishTorrentFile(path.join(workPath, relative), target, id, copy),
    );
  }
  const staging = path.join(
    savePath,
    `.getanny-${id}.${process.pid}.${randomUUID()}.publishing`,
  );
  await fs.mkdir(staging);
  try {
    for (const file of ready.files) {
      const destination = path.join(staging, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await publishTorrentFile(
        path.join(workPath, file.path),
        destination,
        id,
        copy,
      );
    }
    const name = sanitizeFilename(ready.name);
    if (process.platform === "win32") {
      return await claimUniqueTarget(savePath, name, false, (target) =>
        renameWindowsDirectory(staging, target),
      );
    }
    const target = await claimUniqueTarget(savePath, name, false, (candidate) =>
      fs.mkdir(candidate),
    );
    await commitDirectory(staging, target, ready.files);
    return target;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  loadVerifiedTorrent,
  publishTorrentOutput,
  recordVerifiedTorrent,
};
