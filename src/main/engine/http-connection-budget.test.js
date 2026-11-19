const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpConnectionBudget } = require("./http-connection-budget");
const { request } = require("./http");
const { fixtureServer } = require("../../../tests/helpers");
const { finished } = require("node:stream/promises");

async function read(response) {
  response.resume();
  await finished(response);
}

test("socket budget caps simultaneous responses for one origin", async (t) => {
  const server = await fixtureServer(t, {
    size: 256 * 1024,
    extra(_request, response, _url, state) {
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      response.once("finish", () => {
        state.active--;
      });
      response.writeHead(200, { "Content-Length": state.data.length });
      setTimeout(() => response.end(state.data), 15);
      return true;
    },
  });
  const budget = new HttpConnectionBudget({
    global: 4,
    initial: 2,
    maximum: 2,
  });
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const { response } = await request(`${server.url}/file.bin`, { budget });
      await read(response);
    }),
  );
  assert.equal(server.state.maxActive, 2);
});

test("origin backoff permits another origin and can be cancelled while queued", async () => {
  const budget = new HttpConnectionBudget({
    global: 3,
    initial: 2,
    maximum: 3,
  });
  const origin = "http://example.test";
  const release = await budget.acquire(origin);
  release({ statusCode: 429, retryAfterMs: 30 });
  const startedAt = Date.now();
  const pending = budget.acquire(origin);
  const another = await budget.acquire("http://another.test");
  another();
  const controller = new AbortController();
  const aborted = budget.acquire(origin, controller.signal);
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  const recovered = await pending;
  assert.ok(Date.now() - startedAt >= 25);
  assert.equal(budget.origins.get(origin).limit, 1);
  recovered({
    complete: true,
    statusCode: 206,
    headers: { "content-length": "1048576" },
  });
  assert.equal(budget.origins.get(origin).limit, 2);
});
