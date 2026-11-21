// Low-overhead event-loop health monitoring. This intentionally records stalls
// without force-restarting an active transfer or leaking URLs/credentials.
class ResponsivenessWatchdog {
  constructor({
    intervalMs = 1000,
    stallMs = 5000,
    cooldownMs = 60000,
    now = () => performance.now(),
    onStall = () => {},
  } = {}) {
    this.intervalMs = intervalMs;
    this.stallMs = stallMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.onStall = onStall;
    this.expectedAt = null;
    this.lastReportAt = -Infinity;
    this.timer = null;
  }

  sample(at = this.now()) {
    if (!Number.isFinite(at)) return 0;
    if (this.expectedAt === null) {
      this.expectedAt = at + this.intervalMs;
      return 0;
    }
    const lagMs = Math.max(0, at - this.expectedAt);
    // Reset the baseline each tick; a single stall must not emit many alerts.
    this.expectedAt = at + this.intervalMs;
    if (lagMs >= this.stallMs && at - this.lastReportAt >= this.cooldownMs) {
      this.lastReportAt = at;
      this.onStall({lagMs: Math.round(lagMs)});
    }
    return lagMs;
  }

  start() {
    if (this.timer) return;
    this.expectedAt = this.now() + this.intervalMs;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.expectedAt = null;
  }
}

module.exports = {ResponsivenessWatchdog};
