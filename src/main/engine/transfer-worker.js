const { EventEmitter } = require("node:events");
const { fork } = require("node:child_process");
const path = require("node:path");
const { deserializeError, serializeError } = require("./worker-errors");

const IDLE_TIMEOUT = 5 * 60 * 1000;
// Short-lived HTTP workers should not keep a Node/Electron process resident
// for five minutes after the last download. Torrent lifecycle is unchanged.
const HTTP_IDLE_TIMEOUT = 15 * 1000;
const SHUTDOWN_TIMEOUT = 15000;
const ENTRY = path.join(__dirname, "transfer-worker-child.js");
const OPTIONS = [
  "id",
  "url",
  "savePath",
  "binPath",
  "browserPayloadPath",
  "filename",
  "filenameExplicit",
  "headers",
  "timeout",
  "connections",
  "maxConcurrentDownloads",
  "speedLimit",
  "tempPath",
  "torrentMetadataPath",
  "torrentTrackers",
  "selectedFiles",
  "torrentPriorities",
  "torrentOrder",
  "prioritizeFirstLast",
  "seedMinutes",
  "torrentName",
  "infoHash",
];

class WorkerTransfer extends EventEmitter {
  constructor(worker, options, torrent) {
    super();
    this.worker = worker;
    this.options = options;
    this.id = options.id;
    this.torrent = torrent;
    this.commands = new Map();
    this.nextCommand = 0;
    this.limiter = {
      setLimit: (limit) => this.sendCommand("limit", limit).catch(() => {}),
    };
  }

  start() {
    if (!this.task) {
      this.task = new Promise((resolve) => {
        this.settle = resolve;
      });
      this.emit("status", this.id, "connecting", { speed: 0 });
      this.worker.start(this);
    }
    return this.task;
  }

  sendCommand(command, value) {
    if (this.finished || !this.task) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const request = ++this.nextCommand;
      this.commands.set(request, { resolve, reject });
      this.worker.send({
        type: "control",
        id: this.id,
        request,
        command,
        value,
      });
    });
  }

  pause() {
    return this.sendCommand("pause");
  }
  cancel() {
    return this.sendCommand("cancel");
  }
  shutdown() {
    return this.sendCommand("shutdown");
  }
  resume() {
    this.keepTorrentPaused = false;
    this.sendCommand("resume").catch((error) => this.fail(error));
  }
  finishSeeding() {
    return this.sendCommand("finishSeeding");
  }
  // Bounded loopback peer injection for the packaged torrent smoke test.
  addPeer(peer) {
    return this.sendCommand("addPeer", peer);
  }

  message(message) {
    if (message.type === "event") {
      if (message.name === "error")
        this.reportFailure(deserializeError(message.error));
      else this.emit(message.name, this.id, ...message.args);
      return;
    }
    if (message.type === "reserve") {
      Promise.resolve()
        .then(() => this.options.reserveTarget(message.info))
        .then(
          (value) => this.worker.send({ type: "reserved", id: this.id, value }),
          (error) =>
            this.worker.send({
              type: "reserved",
              id: this.id,
              error: serializeError(error),
            }),
        );
      return;
    }
    if (message.type === "control-result") {
      const command = this.commands.get(message.request);
      this.commands.delete(message.request);
      if (!command) return;
      this.keepTorrentPaused = message.keepTorrentPaused;
      if (message.error) command.reject(deserializeError(message.error));
      else command.resolve(message.value);
    }
    if (message.type === "settled") {
      if (message.error) this.reportFailure(deserializeError(message.error));
      this.finished = true;
      this.settle();
    }
    if (this.finished && !this.commands.size) this.worker.release(this);
  }

  reportFailure(error) {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    this.emit("error", this.id, error);
  }

  fail(error) {
    if (!this.finished) {
      this.reportFailure(error);
      this.finished = true;
      this.settle();
    }
    for (const command of this.commands.values()) command.reject(error);
    this.commands.clear();
  }
}

class TransferWorker {
  constructor(kind, { startProcess = fork } = {}) {
    this.kind = kind;
    this.startProcess = startProcess;
    this.jobs = new Map();
    this.idleTimeout = kind === "http" ? HTTP_IDLE_TIMEOUT : IDLE_TIMEOUT;
  }

  createTransfer(options, torrent) {
    return new WorkerTransfer(this, options, torrent);
  }

  start(transfer) {
    clearTimeout(this.idleTimer);
    this.jobs.set(transfer.id, transfer);
    if (!this.child) {
      try {
        this.launch();
      } catch (error) {
        this.jobs.delete(transfer.id);
        transfer.fail(error);
        return;
      }
    }
    const options = Object.fromEntries(
      OPTIONS.map((key) => [key, transfer.options[key]]),
    );
    this.send({
      type: "start",
      id: transfer.id,
      options,
      torrent: transfer.torrent,
    });
  }

  launch() {
    const child = this.startProcess(ENTRY, [this.kind], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    this.child = child;
    child.on("message", (message) => {
      if (this.child === child) this.jobs.get(message.id)?.message(message);
    });
    child.on("error", (error) => this.fail(child, error));
    child.once("disconnect", () => this.fail(child));
    child.once("exit", () => this.fail(child));
  }

  send(message) {
    const child = this.child;
    if (!child?.connected) {
      this.fail(child);
      return;
    }
    child.send(message, (error) => {
      if (error) this.fail(child, error);
    });
  }

  throttle(limit) {
    if (this.child?.connected) this.send({ type: "throttle", limit });
  }

  fail(child, cause) {
    if (this.child !== child) return;
    this.child = null;
    clearTimeout(this.idleTimer);
    if (child?.connected) child.disconnect();
    const error = new Error(
      "The transfer process stopped. Retry to resume the download.",
      { cause },
    );
    error.code = "TRANSFER_PROCESS_EXITED";
    const interrupted = [...this.jobs.values()];
    this.jobs.clear();
    for (const transfer of interrupted) transfer.fail(error);
  }

  release(transfer) {
    if (this.jobs.get(transfer.id) !== transfer) return;
    this.jobs.delete(transfer.id);
    if (this.jobs.size) return;
    this.idleTimer = setTimeout(() => {
      // Guard against a job starting as the timer is dispatched.
      if (this.jobs.size === 0) this.close();
    }, this.idleTimeout);
    this.idleTimer.unref?.();
  }

  async close() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child) return;
    // A new HTTP download may arrive while an idle child is disconnecting.
    // Detach that child before awaiting exit, so start() can launch a fresh
    // worker instead of sending to a half-closed IPC pipe. Torrent lifecycle
    // and its existing shutdown behavior are deliberately unchanged.
    if (this.kind === "http" && this.jobs.size === 0) this.child = null;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
      }, SHUTDOWN_TIMEOUT);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      if (child.connected) child.disconnect();
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }
}

module.exports = { TransferWorker };
