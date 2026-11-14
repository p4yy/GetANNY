const POLL_MS = 2500;

class TransferSpeedPolicy {
  constructor({ getSystemIdleTime, onChange, hasTransfers = true }) {
    this.getSystemIdleTime = getSystemIdleTime;
    this.onChange = onChange;
    this.hasTransfers = hasTransfers;
  }

  configure(settings) {
    this.settings = settings;
    this.refresh();
  }

  setTransferring(hasTransfers) {
    if (this.hasTransfers === hasTransfers) return;
    this.hasTransfers = hasTransfers;
    this.refresh();
  }

  refresh() {
    this.close();
    this.tick();
    if (this.hasTransfers && this.settings?.adaptiveSpeedLimit && this.getSystemIdleTime) {
      this.timer = setInterval(() => this.tick(), POLL_MS);
      this.timer.unref?.();
    }
  }

  tick() {
    const settings = this.settings;
    if (!settings) return;
    let limit = settings.speedLimit || 0;
    if (this.hasTransfers && settings.adaptiveSpeedLimit && this.getSystemIdleTime) {
      let idle = false;
      try {
        idle = this.getSystemIdleTime() >= settings.idleAfterSeconds;
      } catch {
        // When OS activity is unavailable, use the user's active limit.
      }
      limit = idle ? settings.idleSpeedLimit : settings.activeSpeedLimit;
    }
    if (this.limit === limit) return;
    this.limit = limit;
    this.onChange(limit);
  }

  close() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

module.exports = { TransferSpeedPolicy };
