const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TransferWorker } = require("../src/main/engine/transfer-worker");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { fixtureServer, temporary, waitFor, checksum } = require("./helpers");

test("HTTP worker death fails the active job and frees its queue slot for a new process", async (t) => {
  const worker = new TransferWorker("http");
  let manager;
  t.after(async () => {
    try {
      await manager?.shutdown();
    } finally {
      await worker.close();
    }
  });
  const folder = await temporary(t);
  const server = await fixtureServer(t, {
    size: 2 * 1024 * 1024,
    delay: 35,
  });
  manager = new DownloadManager({
    settings: { defaultDownloadPath: folder, maxConcurrentDownloads: 1 },
    tempPath: path.join(folder, "work"),
    engineFactory: (_item, options) => worker.createTransfer(options),
  });
  const first = await manager.addDownload({
    url: server.url + "/file.bin?first=1",
  });
  const second = await manager.addDownload({
    url: server.url + "/file.bin?second=1",
  });
  await waitFor(() => manager.requireItem(first).downloadedSize > 0);
  const pid = worker.child.pid;
  worker.child.kill();
  await waitFor(
    () =>
      manager.requireItem(first).status === "failed" &&
      manager.requireItem(second).status === "completed",
  );
  assert.equal(manager.requireItem(first).errorCode, "TRANSFER_PROCESS_EXITED");
  assert.notEqual(worker.child.pid, pid);
  assert.equal(manager.requireItem(second).filename, "server-file (1).bin");
  assert.equal(
    checksum(await fs.readFile(manager.requireItem(second).filePath)),
    checksum(server.state.data),
  );
});

test("pause settles the worker writes and resume appends from the durable offset", async (t) => {
  const worker = new TransferWorker("http");
  let manager;
  t.after(async () => {
    try {
      await manager?.shutdown();
    } finally {
      await worker.close();
    }
  });
  const folder = await temporary(t);
  const server = await fixtureServer(t, { size: 1024 * 1024, delay: 45 });
  manager = new DownloadManager({
    settings: { defaultDownloadPath: folder, maxConnectionsPerDownload: 1 },
    tempPath: path.join(folder, "work"),
    engineFactory: (_item, options) => worker.createTransfer(options),
  });
  const id = await manager.addDownload({ url: server.url + "/file.bin" });
  await waitFor(() => manager.requireItem(id).downloadedSize > 0);
  await manager.pause(id);
  const paused = manager.requireItem(id);
  assert.equal(paused.status, "paused");
  assert.ok(
    paused.downloadedSize > 0 &&
      paused.downloadedSize < server.state.data.length,
  );
  const offset = paused.downloadedSize;
  assert.equal(manager.resume(id), true);
  await waitFor(() => manager.requireItem(id).status === "completed");
  assert.ok(
    server.state.requests.some((req) => req.range === `bytes=${offset}-`),
  );
  assert.deepEqual(
    await fs.readFile(manager.requireItem(id).filePath),
    server.state.data,
  );
});

test("torrent worker proxy sends loopback peer injection over control IPC", async () => {
  const worker = new TransferWorker("torrent");
  const outgoing = [];
  worker.start = (transfer) => worker.jobs.set(transfer.id, transfer);
  worker.send = (message) => outgoing.push(message);
  const transfer = worker.createTransfer({ id: "isolated-torrent-test" }, { shared: true });
  const running = transfer.start();
  const accepted = transfer.addPeer("127.0.0.1:45123");
  assert.deepEqual(outgoing, [{
    type: "control",
    id: "isolated-torrent-test",
    request: 1,
    command: "addPeer",
    value: "127.0.0.1:45123",
  }]);
  transfer.message({
    type: "control-result",
    id: "isolated-torrent-test",
    request: 1,
    value: true,
  });
  assert.equal(await accepted, true);
  transfer.message({ type: "settled", id: "isolated-torrent-test" });
  await running;
  clearTimeout(worker.idleTimer);
});

test("New HTTP transfer can start while the previous idle worker is closing", async () => {
  const oldChild = new EventEmitter();
  oldChild.connected = true;
  oldChild.exitCode = null;
  oldChild.signalCode = null;
  oldChild.disconnect = () => {
    oldChild.connected = false;
    setImmediate(() => oldChild.emit("exit", 0));
  };

  let launches = 0;
  const worker = new TransferWorker("http", {
    startProcess: () => {
      launches++;
      const child = new EventEmitter();
      child.connected = true;
      child.exitCode = null;
      child.signalCode = null;
      child.send = (_message, callback) => callback?.();
      child.disconnect = () => {
        child.connected = false;
        setImmediate(() => child.emit("exit", 0));
      };
      return child;
    },
  });
  worker.child = oldChild;
  const closing = worker.close();
  assert.equal(worker.child, null, "Closing idle worker must be detached immediately");

  const transfer = worker.createTransfer({ id: "new-transfer" });
  const task = transfer.start();
  const freshChild = worker.child;
  assert.equal(launches, 1);
  assert.ok(freshChild && freshChild !== oldChild);

  await closing;
  assert.equal(worker.child, freshChild, "Old process exit cannot discard the new worker");
  assert.equal(worker.jobs.size, 1);

  transfer.message({ type: "settled", id: transfer.id });
  await task;
  clearTimeout(worker.idleTimer);
  await worker.close();
});
