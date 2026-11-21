const GLOBAL_CONNECTIONS = 48;
const INITIAL_CONNECTIONS_PER_ORIGIN = 6;
const MAX_CONNECTIONS_PER_ORIGIN = 24;
const RECOVERY_BYTES = 1024 * 1024;
const SLOW_SAMPLE_RATIO = 0.45;
const SLOW_SAMPLES_TO_BACKOFF = 6;

// Connection feedback deliberately requires successful, complete transfers.
// Untrusted Content-Length or partially received responses never tune limits.
function completedThroughput(response, concurrent) {
  const bytes = Number(response?.headers?.["content-length"]);
  const elapsed = Number(response?.elapsedMs);
  if (
    response?.complete !== true ||
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    !Number.isSafeInteger(bytes) ||
    bytes < RECOVERY_BYTES ||
    !Number.isFinite(elapsed) ||
    elapsed < 40 ||
    elapsed > 3_600_000
  ) return 0;
  return (bytes * 1000 / elapsed) * Math.max(1, concurrent);
}

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
        peakThroughput: 0,
        slowSamples: 0,
        observedSamples: 0,
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
    const concurrent = state.active;
    this.active--;
    state.active--;
    if (response?.statusCode === 429 || response?.statusCode === 503) {
      state.slowSamples = 0;
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
      Number(response.headers?.["content-length"]) >= RECOVERY_BYTES &&
      state.limit < this.maximum &&
      ++state.healthy >= state.limit
    ) {
      state.limit++;
      state.healthy = 0;
    }
    // A conservative fallback when measured aggregate throughput collapses
    // for several complete requests. Do not chase individual slow samples or
    // tune on redirects, server errors, partial responses, or tiny probes.
    const throughput = completedThroughput(response, concurrent);
    if (throughput > 0) {
      state.observedSamples++;
      state.peakThroughput = Math.max(
        throughput,
        state.peakThroughput * 0.98,
      );
      if (
        state.observedSamples >= SLOW_SAMPLES_TO_BACKOFF &&
        concurrent >= 2 &&
        throughput < state.peakThroughput * SLOW_SAMPLE_RATIO
      ) {
        state.slowSamples++;
      } else state.slowSamples = 0;
      if (state.slowSamples >= SLOW_SAMPLES_TO_BACKOFF && state.limit > 1) {
        state.limit = Math.max(1, state.limit - 1);
        state.healthy = 0;
        state.slowSamples = 0;
        state.observedSamples = 0;
        // Avoid pinning to a temporary historical peak after congestion.
        state.peakThroughput = throughput;
      }
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
      // The lease is consumed at most once. A duplicate close/error callback
      // must never create negative counts or release another request's slot.
      let released = false;
      entry.resolve((response) => {
        if (released) return;
        released = true;
        this.release(state, response);
      });
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
