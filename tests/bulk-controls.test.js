"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DownloadManager } = require("../src/main/engine/DownloadManager");

const item = (id, kind, status) => ({
  id, kind, status, headers: {}, filename: id + ".bin", savePath: ".",
  createdAt: "2026-11-13T00:00:00.000Z",
});
const outsideSchedule = () => {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  return {
    scheduleEnabled: true,
    scheduleStartMinute: (minute + 5) % 1440,
    scheduleEndMinute: (minute + 6) % 1440,
    maxConcurrentDownloads: 1,
  };
};

test("torrent Pause all stops queued and retrying before active jobs without pumping another job", async (t) => {
  const manager = new DownloadManager({ settings: outsideSchedule() });
  t.after(() => clearTimeout(manager.scheduleTimer));
  const active = item("torrent-active", "torrent", "downloading");
  const queued = item("torrent-queued", "torrent", "queued");
  const retrying = item("torrent-retry", "torrent", "retrying");
  const other = item("ordinary", "file", "queued");
  for (const value of [active, queued, retrying, other])
    manager.items.set(value.id, value);
  manager.queue = [queued.id, other.id];
  const timer = setTimeout(() => {}, 60000);
  timer.unref?.();
  manager.retryTimers.set(retrying.id, timer);
  manager.running.set(active.id, {
    async pause() {
      assert.equal(manager.bulkPauseInProgress, true);
      await Promise.resolve();
      active.status = "paused";
    },
  });
  manager.createEngine = () => { throw new Error("Nothing may start during a paused schedule"); };
  const result = await manager.pauseAll({ kind: "torrent" });
  assert.deepEqual(result, { count: 3, total: 3, failed: 0 });
  assert.equal(active.status, "paused");
  assert.equal(queued.status, "paused");
  assert.equal(retrying.status, "paused");
  assert.equal(manager.retryTimers.has(retrying.id), false);
  assert.equal(manager.queue.includes(queued.id), false);
  assert.equal(other.status, "queued");
  assert.equal(manager.queue.includes(other.id), true);
  assert.equal(manager.bulkPauseInProgress, false);

  const resumed = manager.resumeAll({ kind: "torrent" });
  assert.deepEqual(resumed, { count: 3, total: 3, failed: 0 });
  for (const value of [active, queued, retrying])
    assert.equal(value.status, "queued");
  assert.equal(other.status, "queued");
  assert.equal(manager.running.size, 0);
});

test("resume all uses only eligible paused IDs, never failed, completed or other kinds", (t) => {
  const manager = new DownloadManager({ settings: outsideSchedule() });
  t.after(() => clearTimeout(manager.scheduleTimer));
  for (const value of [
    item("one", "torrent", "paused"),
    item("two", "torrent", "paused"),
    item("failed", "torrent", "failed"),
    item("done", "torrent", "completed"),
    item("file", "file", "paused"),
  ]) manager.items.set(value.id, value);
  manager.createEngine = () => { throw new Error("Schedule unexpectedly started a transfer"); };
  assert.deepEqual(manager.resumeAll({ kind: "torrent", ids: ["one", "failed", "file"] }),
    { count: 1, total: 1, failed: 0 });
  assert.equal(manager.requireItem("one").status, "queued");
  assert.equal(manager.requireItem("two").status, "paused");
  assert.equal(manager.requireItem("failed").status, "failed");
  assert.equal(manager.requireItem("file").status, "paused");
});
