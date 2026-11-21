"use strict";

const { ACTIVE, DETACHED_SEED_LIMIT, isWithinSchedule } = require("./DownloadManagerShared");

const methods = {
  allocateQueueOrder() {
    let maximum = this.queueSequence;
    for (const item of this.items.values()) {
      if (Number.isFinite(item.queueOrder))
        maximum = Math.max(maximum, item.queueOrder);
    }
    this.queueSequence = maximum + 1;
    return this.queueSequence;
  },

  reorder(ids) {
    if (
      !Array.isArray(ids) ||
      ids.length > this.items.size ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Invalid queue order.");
    const candidates = ids.map((id) => this.requireItem(id));
    if (candidates.some((item) => item.status !== "queued"))
      throw new Error("Only queued downloads can be reordered.");
    const selected = new Set(ids);
    const remaining = [...this.items.values()]
      .filter((item) => item.status === "queued" && !selected.has(item.id))
      .sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0));
    const ordered = [...candidates, ...remaining];
    let sequence = Math.max(
      this.queueSequence,
      ...[...this.items.values()].map((item) =>
        Number.isFinite(item.queueOrder) ? item.queueOrder : 0,
      ),
    );
    for (const item of ordered) {
      item.queueOrder = ++sequence;
      this.persist(item);
    }
    this.queueSequence = sequence;
    this.snapshot();
    this.pump();
    return true;
  },

  pump() {
    // Do not replace a paused engine with a queued job mid-batch.
    if (this.stopped || this.bulkPauseInProgress) return;
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    if (this.queue.length && !isWithinSchedule(this.settings)) {
      // Recheck after clock changes or wake from sleep as well as at the next
      // minute. Running transfers are not interrupted by the window closing.
      this.scheduleTimer = setTimeout(() => this.pump(), 30000);
      this.scheduleTimer.unref?.();
      return;
    }
    this.queue.sort(
      (a, b) =>
        (this.items.get(b)?.priority || 0) -
          (this.items.get(a)?.priority || 0) ||
        (this.items.get(a)?.queueOrder || 0) -
          (this.items.get(b)?.queueOrder || 0),
    );
    const limit = Math.max(1, this.settings.maxConcurrentDownloads || 3);
    const occupiedSlots = () => {
      const seeding = [...this.running.keys()].filter((id) => {
        const item = this.items.get(id);
        return item?.status === "processing" && item.stage === "seeding";
      }).length;
      return this.running.size - Math.min(seeding, DETACHED_SEED_LIMIT);
    };
    while (occupiedSlots() < limit && this.queue.length) {
      const id = this.queue.shift();
      const item = this.items.get(id);
      if (!item || item.status !== "queued" || this.running.has(id)) continue;
      let engine, task;
      try {
        engine = this.pausedEngines.get(id) || this.createEngine(item);
        this.pausedEngines.delete(id);
        this.running.set(id, engine);
        if (engine.keepTorrentPaused) engine.resume();
        task = engine.start();
      } catch (error) {
        this.running.delete(id);
        this.pausedEngines.delete(id);
        this.failItem(item, error);
        continue;
      }
      Promise.resolve(task)
        .catch((error) => {
          if (engine.failure) return;
          engine.failure = error;
          this.failItem(item, error);
        })
        .finally(() => {
          if (this.running.get(id) !== engine) return;
          this.running.delete(id);
          if (
            !this.stopped &&
            item.status === "failed" &&
            (!item.sessionRequired || item.sessionHeaders) &&
            engine.failure?.retryable &&
            item.attempt < (this.settings.retryAttempts || 0)
          ) {
            item.attempt++;
            item.status = "retrying";
            item.retryAt =
              Date.now() +
              Math.max(
                Number(engine.failure?.retryAfterMs) || 0,
                Math.min(
                  120000,
                  (this.settings.retryDelaySeconds || 3) *
                    1000 *
                    2 ** (item.attempt - 1),
                ),
              );
            this.persist(item);
            const timer = setTimeout(() => {
              this.retryTimers.delete(id);
              if (item.status === "retrying") this.enqueue(item);
            }, item.retryAt - Date.now());
            this.retryTimers.set(id, timer);
            this.snapshot();
          }
          this.pump();
        });
    }
  },

  requireItem(id) {
    const item = this.items.get(id);
    if (!item) throw new Error("This download no longer exists.");
    return item;
  },

  clearRetry(id) {
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
  },

  enqueue(item, front = false) {
    this.clearRetry(item.id);
    item.status = "queued";
    item.error = null;
    item.retryAt = null;
    item.speed = 0;
    if (!this.queue.includes(item.id))
      front ? this.queue.unshift(item.id) : this.queue.push(item.id);
    this.persist(item);
    this.snapshot();
    this.pump();
    return true;
  },

  async pause(id) {
    const item = this.requireItem(id);
    if (ACTIVE.has(item.status)) {
      const engine = this.running.get(id);
      if (!engine) return false;
      if ((await engine.pause()) === false) return false;
      // The engine has stopped at this point. Remove its queue slot before
      // returning so an immediate Resume cannot race the start promise's
      // later finally callback and lose the newly queued job.
      if (this.running.get(id) === engine) {
        this.running.delete(id);
        if (engine.keepTorrentPaused) this.pausedEngines.set(id, engine);
        this.pump();
      }
    } else if (["queued", "retrying"].includes(item.status)) {
      this.clearRetry(id);
      this.queue = this.queue.filter((value) => value !== id);
      item.status = "paused";
      item.speed = 0;
      item.eta = null;
      this.persist(item);
      this.snapshot();
    } else return false;
    return true;
  },

  resume(id) {
    const item = this.requireItem(id);
    if (item.returnedToBrowser)
      throw new Error("This transfer was returned to your browser.");
    if (item.sessionRequired && !item.sessionHeaders)
      throw new Error(
        "Session expired. Refresh this download from your browser to resume it.",
      );
    if (
      !["paused", "failed", "cancelled"].includes(item.status) ||
      this.running.has(id)
    )
      return false;
    item.attempt = 0;
    item.pendingBrowserReconciliation = false;
    return this.enqueue(item, this.pausedEngines.has(id));
  },

  retry(id) {
    return this.resume(id);
  },

  async pauseAll({ ids, kind = "all" } = {}) {
    if (this.bulkPauseInProgress)
      throw new Error("Pause all is already running.");
    const selected = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const targets = [...this.items.values()].filter(
      (item) =>
        (!selected || selected.has(item.id)) &&
        (kind !== "torrent" || item.kind === "torrent") &&
        (ACTIVE.has(item.status) ||
          ["queued", "retrying"].includes(item.status)),
    );
    let count = 0,
      failed = 0;
    this.bulkPauseInProgress = true;
    try {
      // Disarm the queue and retry timers before awaiting active engines.
      // During the batch pump() cannot start an unintended replacement.
      const ordered = [
        ...targets.filter((item) => !ACTIVE.has(item.status)),
        ...targets.filter((item) => ACTIVE.has(item.status)),
      ];
      for (const item of ordered) {
        try {
          if (await this.pause(item.id)) count++;
          else failed++;
        } catch {
          failed++;
        }
      }
    } finally {
      this.bulkPauseInProgress = false;
      this.pump();
    }
    return { count, total: targets.length, failed };
  },

  resumeAll({ ids, kind = "all" } = {}) {
    if (this.bulkPauseInProgress)
      throw new Error("Cannot resume during Pause all.");
    const selected = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const targets = [...this.items.values()].filter(
      (item) =>
        item.status === "paused" &&
        (!selected || selected.has(item.id)) &&
        (kind !== "torrent" || item.kind === "torrent"),
    );
    let count = 0,
      failed = 0;
    for (const item of targets) {
      try {
        if (this.resume(item.id)) count++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { count, total: targets.length, failed };
  },

  async cancel(id) {
    const item = this.requireItem(id);
    if (["completed", "cancelled"].includes(item.status)) return false;
    this.clearRetry(id);
    this.queue = this.queue.filter((value) => value !== id);
    const engine = this.running.get(id) || this.pausedEngines.get(id);
    if (engine) {
      if ((await engine.cancel()) === false) return false;
      this.pausedEngines.delete(id);
    } else {
      item.status = "cancelled";
      item.speed = 0;
      item.eta = null;
      this.forgetSession(item);
      await this.cleanup(item);
      this.persist(item);
      this.snapshot();
    }
    return true;
  },

  limitFor(item) {
    const limit = Math.min(
      item.downloadSpeedLimit || Infinity,
      this.globalSpeedLimit || Infinity,
    );
    return Number.isFinite(limit) ? limit : 0;
  },

  setGlobalSpeedLimit(limit) {
    if (this.globalSpeedLimit === limit) return;
    this.globalSpeedLimit = limit;
    for (const [id, engine] of this.running) {
      const item = this.items.get(id);
      if (item) engine.limiter?.setLimit(this.limitFor(item));
    }
  },

  updateSettings(settings, { applySpeed = true } = {}) {
    this.settings = { ...settings };
    if (applySpeed) this.setGlobalSpeedLimit(settings.speedLimit || 0);
    this.pump();
  },

  async shutdown() {
    this.stopped = true;
    await Promise.all(
      [...this.items.values()]
        .filter((item) => item.privateSession)
        .map((item) => this.remove(item.id)),
    );
    this.flushProgress();
    this.flushPersistence();
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const engines = new Set([
      ...this.running.values(),
      ...this.pausedEngines.values(),
    ]);
    await Promise.all(
      [...engines].map((engine) =>
        typeof engine.shutdown === "function"
          ? engine.shutdown()
          : engine.pause(),
      ),
    );
    this.pausedEngines.clear();
    for (const item of this.items.values())
      if (["queued", "retrying"].includes(item.status)) {
        // Preserve scheduled queue entries across clean restarts. Retry timers
        // are not durable and remain paused rather than being silently reset.
        if (item.status === "queued" && this.settings.scheduleEnabled) {
          this.persist(item);
          continue;
        }
        item.status = "paused";
        item.speed = 0;
        this.persist(item);
      }
    for (const item of this.items.values()) this.burnSession(item);
    this.running.clear();
    await this.sessionVault?.flush();
  }
};

module.exports = methods;
