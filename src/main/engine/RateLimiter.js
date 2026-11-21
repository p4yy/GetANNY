const { setTimeout: delay } = require("node:timers/promises");

// One limiter is shared by all connections of a transfer, not one independent
// allowance per chunk. Backpressure propagates all the way to the HTTP socket.
class RateLimiter {
  constructor(bytesPerSecond = 0, { now = () => performance.now(), wait = delay } = {}) {
    this.now = now;
    this.wait = wait;
    this.setLimit(bytesPerSecond);
  }
  setLimit(value) {
    const limit = Math.max(0, Number(value) || 0);
    if (limit === this.limit) return;
    this.changed?.abort();
    this.changed = new AbortController();
    this.limit = limit;
    this.next = this.now();
  }
  async consume(bytes, signal) {
    signal?.throwIfAborted();
    let remaining = Math.max(0, Number(bytes) || 0);
    while (this.limit && remaining > 0) {
      const policy = this.changed.signal;
      const limit = this.limit;
      const now = this.now();
      const start = Math.max(now, this.next);
      this.next = start + (remaining * 1000) / limit;
      try {
        await this.wait(Math.max(0, this.next - now), undefined, {
          signal: signal ? AbortSignal.any([signal, policy]) : policy,
        });
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (!policy.aborted) throw error;
        const elapsed = Math.max(0, this.now() - start);
        remaining = Math.max(0, remaining - (elapsed * limit) / 1000);
      }
    }
  }
}
module.exports = { RateLimiter };
