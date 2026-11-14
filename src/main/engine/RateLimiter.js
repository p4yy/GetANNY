const { setTimeout: delay } = require("node:timers/promises");

// One limiter is shared by all connections of a transfer, not one independent
// allowance per chunk. Backpressure propagates all the way to the HTTP socket.
class RateLimiter {
  constructor(bytesPerSecond = 0) {
    this.setLimit(bytesPerSecond);
  }
  setLimit(value) {
    const limit = Math.max(0, Number(value) || 0);
    if (limit === this.limit) return;
    this.changed?.abort();
    this.changed = new AbortController();
    this.limit = limit;
    this.next = performance.now();
  }
  async consume(bytes, signal) {
    signal?.throwIfAborted();
    while (this.limit) {
      const policy = this.changed.signal;
      const now = performance.now();
      this.next = Math.max(now, this.next) + (bytes * 1000) / this.limit;
      try {
        await delay(Math.max(0, this.next - now), undefined, {
          signal: signal ? AbortSignal.any([signal, policy]) : policy,
        });
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (!policy.aborted) throw error;
      }
    }
  }
}
module.exports = { RateLimiter };
