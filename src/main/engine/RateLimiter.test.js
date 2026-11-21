"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RateLimiter } = require("./RateLimiter");

test("changing the speed limit charges only the unconsumed part of a chunk", async () => {
  let now = 0;
  const waits = [];
  const limiter = new RateLimiter(1000, {
    now: () => now,
    wait: (milliseconds, _value, { signal }) =>
      new Promise((resolve, reject) => {
        const entry = { milliseconds, resolve };
        waits.push(entry);
        signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
  });

  const consumed = limiter.consume(1000);
  await new Promise(setImmediate);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].milliseconds, 1000);

  // 200 ms at 1,000 B/s accounts for 200 bytes before the policy changes.
  now = 200;
  limiter.setLimit(2000);
  await new Promise(setImmediate);

  assert.equal(waits.length, 2);
  assert.equal(waits[1].milliseconds, 400);
  now = 600;
  waits[1].resolve();
  await consumed;
});

test("removing the speed limit releases a chunk waiting on the old policy", async () => {
  let now = 0;
  let aborted = false;
  const limiter = new RateLimiter(100, {
    now: () => now,
    wait: (_milliseconds, _value, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
  });

  const consumed = limiter.consume(500);
  await new Promise(setImmediate);
  limiter.setLimit(0);
  await consumed;
  assert.equal(aborted, true);
});
