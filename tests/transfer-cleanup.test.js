const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  reconcileTemporaryFiles,
} = require("../src/main/engine/transfer-cleanup");
const { temporary } = require("./helpers");

test("startup removes abandoned staging without deleting resumable or unrelated files", async (t) => {
  const root = await temporary(t);
  const workRoot = path.join(root, "transfer-temp");
  const systemTemp = path.join(root, "system-temp");
  const defaultDestination = path.join(root, "out");
  await Promise.all(
    [workRoot, systemTemp, defaultDestination].map((folder) =>
      fs.mkdir(folder),
    ),
  );

  const [paused, failed, completed, active, orphan] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );
  const items = [
    { id: paused, status: "paused", savePath: defaultDestination },
    {
      id: failed,
      status: "failed",
      resumable: false,
      savePath: defaultDestination,
    },
    { id: completed, status: "completed", savePath: defaultDestination },
    { id: active, status: "downloading", savePath: defaultDestination },
  ];
  const activeIds = new Set([active]);
  for (const id of [paused, failed, completed, active, orphan, "unrelated"])
    await fs.mkdir(path.join(workRoot, id));

  const staging = path.join(
    defaultDestination,
    `.getanny-${completed}.publishing`,
  );
  const liveStage = path.join(
    defaultDestination,
    `.getanny-${active}.${process.pid}.${randomUUID()}.publishing`,
  );
  const unrelated = path.join(defaultDestination, "unrelated.publishing");
  await Promise.all(
    [staging, liveStage, unrelated].map((file) =>
      fs.writeFile(file, "fixture"),
    ),
  );

  const oldMetadata = path.join(systemTemp, "getanny-metadata-legacy");
  const liveMetadata = path.join(systemTemp, "getanny-metadata-live");
  await fs.mkdir(oldMetadata);
  await fs.mkdir(liveMetadata);
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(oldMetadata, old, old);
  await fs.writeFile(
    path.join(liveMetadata, ".getanny-owner"),
    String(process.pid),
  );

  const removed = [];
  const logger = {
    info: (_message, details) => removed.push(details),
    warn: assert.fail,
  };
  const counts = await reconcileTemporaryFiles({
    workRoot,
    items,
    activeIds,
    defaultDestination,
    systemTemp,
    startup: true,
    logger,
  });
  assert.deepEqual(counts, {
    workFolders: 3,
    publishingFiles: 1,
    metadataFolders: 1,
  });
  assert.equal(removed.length, 5);
  for (const file of [
    staging,
    oldMetadata,
    ...[failed, completed, orphan].map((id) => path.join(workRoot, id)),
  ])
    await assert.rejects(fs.access(file), { code: "ENOENT" });
  for (const file of [
    liveStage,
    liveMetadata,
    unrelated,
    ...[paused, active, "unrelated"].map((id) => path.join(workRoot, id)),
  ])
    await fs.access(file);
});

test("manual cleanup preserves every job-owned work folder so a retry cannot race cleanup", async (t) => {
  const workRoot = await temporary(t);
  const retained = randomUUID();
  const orphan = randomUUID();
  await fs.mkdir(path.join(workRoot, retained));
  await fs.mkdir(path.join(workRoot, orphan));
  const counts = await reconcileTemporaryFiles({
    workRoot,
    items: [{ id: retained, status: "failed" }],
    systemTemp: path.join(workRoot, "unused"),
  });
  assert.equal(counts.workFolders, 1);
  await fs.access(path.join(workRoot, retained));
  await assert.rejects(fs.access(path.join(workRoot, orphan)), {
    code: "ENOENT",
  });
});
