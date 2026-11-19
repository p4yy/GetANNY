const GLOBAL_CONNECTIONS = 48;
const INITIAL_CONNECTIONS_PER_ORIGIN = 6;
const MAX_CONNECTIONS_PER_ORIGIN = 24;
const RECOVERY_BYTES = 1024 * 1024;

// The budget owns active requests, including probes and redirect hops. A
// request queued here has not opened a socket or started its network timeout.
class HttpConnectionBudget {
  constructor({
    global = GLOBAL_CONNECTIONS,
    initial = INITIAL_CONNECTIONS_PER_ORIGIN,
    maximum = MAX_CONNECTIONS_PER_ORIGIN,
  } = {}) {
    this.global = global;
    this.initial = initial;
    this.maximum = maximum;
    this.origins = new Map();
    this.waiting = [];
    this.active = 0;
  }

  acquire(origin, signal) {
    signal?.throwIfAborted();
    if (!this.origins.has(origin)) {
      if (this.origins.size >= 256) {
        const idle = [...this.origins.entries()].find(
          ([, state]) =>
            state.active === 0 &&
            state.waiting === 0 &&
            state.retryAt <= Date.now(),
        );
        if (idle) this.origins.delete(idle[0]);
      }
      this.origins.set(origin, {
        active: 0,
        waiting: 0,
        limit: this.initial,
        healthy: 0,
        retryAt: 0,
      });
    }
    const state = this.origins.get(origin);
    return new Promise((resolve, reject) => {
      const entry = { state, signal, resolve };
      entry.abort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        state.waiting--;
        reject(signal.reason);
        this.drain();
      };
      state.waiting++;
      this.waiting.push(entry);
      signal?.addEventListener("abort", entry.abort, { once: true });
      this.drain();
    });
  }

  release(state, response) {
    this.active--;
    state.active--;
    if (response?.statusCode === 429 || response?.statusCode === 503) {
      state.limit = Math.max(1, Math.floor(state.limit / 2));
      state.healthy = 0;
      state.retryAt = Math.max(
        state.retryAt,
        Date.now() + (response.retryAfterMs || 1000),
      );
    } else if (
      response?.complete &&
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      Number(response.headers["content-length"]) >= RECOVERY_BYTES &&
      state.limit < this.maximum &&
      ++state.healthy >= state.limit
    ) {
      state.limit++;
      state.healthy = 0;
    }
    this.drain();
  }

  drain() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = Date.now();
    let nextRetry = Infinity;
    for (
      let index = 0;
      index < this.waiting.length && this.active < this.global;
    ) {
      const entry = this.waiting[index];
      const { state, signal } = entry;
      if (state.active >= state.limit || state.retryAt > now) {
        if (state.retryAt > now) nextRetry = Math.min(nextRetry, state.retryAt);
        index++;
        continue;
      }
      this.waiting.splice(index, 1);
      signal?.removeEventListener("abort", entry.abort);
      state.waiting--;
      state.active++;
      this.active++;
      entry.resolve((response) => this.release(state, response));
    }
    if (Number.isFinite(nextRetry))
      this.timer = setTimeout(() => this.drain(), Math.max(1, nextRetry - now));
  }
}

module.exports = {
  HttpConnectionBudget,
  GLOBAL_CONNECTIONS,
  MAX_CONNECTIONS_PER_ORIGIN,
};
