const test = require("node:test");
const assert = require("node:assert/strict");
const { TransferSpeedPolicy } = require("../src/main/engine/speed-policy");
const { RateLimiter } = require("../src/main/engine/RateLimiter");
const { DownloadManager } = require("../src/main/engine/DownloadManager");

test("adaptive speed follows system activity and honors the static limit when disabled", (t) => {
  let idleSeconds = 0;
  const limits = [];
  const policy = new TransferSpeedPolicy({
    getSystemIdleTime: () => idleSeconds,
    onChange: (limit) => limits.push(limit),
  });
  t.after(() => policy.close());
  const settings = {
    adaptiveSpeedLimit: true,
    speedLimit: 800,
    activeSpeedLimit: 500,
    idleSpeedLimit: 0,
    idleAfterSeconds: 30,
  };
  policy.configure(settings);
  idleSeconds = 29;
  policy.tick();
  idleSeconds = 30;
  policy.tick();
  idleSeconds = 0;
  policy.tick();
  policy.configure({ ...settings, adaptiveSpeedLimit: false });
  assert.deepEqual(limits, [500, 0, 500, 800]);
});

test(
  "a policy change releases pending rate-limit waits without swallowing job cancellation",
  { timeout: 3000 },
  async () => {
    const limiter = new RateLimiter(1);
    const pending = limiter.consume(2048);
    limiter.setLimit(0);
    await pending;
    limiter.setLimit(1);
    const controller = new AbortController();
    const cancelled = limiter.consume(2048, controller.signal);
    controller.abort(new Error("transfer cancelled"));
    await assert.rejects(cancelled, /transfer cancelled/);
  },
);

test("changing a speed limit charges only the bytes not already waited", async () => {
  let now = 0;
  let currentWait;
  const limiter = new RateLimiter(1000, {
    now: () => now,
    wait: (milliseconds, _value, { signal }) =>
      new Promise((resolve, reject) => {
        currentWait = { milliseconds, resolve };
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("policy changed");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  });
  const pending = limiter.consume(1000);
  assert.equal(currentWait.milliseconds, 1000);
  now = 500;
  limiter.setLimit(2000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentWait.milliseconds, 250);
  now = 750;
  currentWait.resolve();
  await pending;
});

test("live global limits preserve a stricter per-download cap", () => {
  const manager = new DownloadManager({ settings: { speedLimit: 1000 } });
  const limits = [];
  manager.items.set("one", { downloadSpeedLimit: 350 });
  manager.running.set("one", {
    limiter: { setLimit: (limit) => limits.push(limit) },
  });
  manager.setGlobalSpeedLimit(500);
  manager.setGlobalSpeedLimit(200);
  manager.setGlobalSpeedLimit(0);
  assert.deepEqual(limits, [350, 200, 350]);
});
test("no OS sampling or timer is needed between transfers", (t) => {
  let samples = 0;
  const limits = [];
  const policy = new TransferSpeedPolicy({
    hasTransfers: false,
    getSystemIdleTime: () => { samples++; return 60; },
    onChange: (limit) => limits.push(limit),
  });
  t.after(() => policy.close());
  policy.configure({
    adaptiveSpeedLimit: true,
    activeSpeedLimit: 500,
    idleSpeedLimit: 200,
    idleAfterSeconds: 30,
    speedLimit: 800,
  });
  assert.equal(policy.timer, undefined);
  assert.equal(samples, 0);
  policy.setTransferring(true);
  assert.ok(policy.timer);
  assert.equal(samples, 1);
  policy.setTransferring(false);
  assert.equal(policy.timer, undefined);
  assert.deepEqual(limits, [800, 200, 800]);
});
