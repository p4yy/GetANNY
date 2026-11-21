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

test("adaptive budget reduces concurrency after sustained measured throughput collapse", async () => {
  const budget = new HttpConnectionBudget({global: 8,initial: 4,maximum: 4});
  const origin = "https://slow-origin.example";
  const feedback = async (elapsedMs) => {
    const releases = await Promise.all(Array.from({length:3},() => budget.acquire(origin)));
    // Three requests were in flight: this is a rough aggregate-throughput sample.
    releases[0]({statusCode:206,complete:true,headers:{"content-length":"2097152"},elapsedMs});
    releases[1](); releases[2]();
  };
  await feedback(100);
  // Five observations warm up the baseline; six subsequent slow samples
  // are required before a reduction. A single slowdown must never tune it.
  for(let i=0;i<10;i++)await feedback(4500);
  const state=budget.origins.get(origin);
  assert.equal(state.limit,3);
  assert.equal(state.active,0);
  assert.equal(budget.active,0);
});

test("adaptive budget does not learn from incomplete, tiny or errored responses", async () => {
  const budget = new HttpConnectionBudget({global:8,initial:4,maximum:4});
  const origin="https://untrusted.example";
  const bad=[
    {statusCode:206,complete:false,headers:{"content-length":"99999999"},elapsedMs:5000},
    {statusCode:206,complete:true,headers:{"content-length":"1024"},elapsedMs:5000},
    {statusCode:500,complete:true,headers:{"content-length":"2097152"},elapsedMs:5000},
    {statusCode:206,complete:true,headers:{"content-length":"invalid"},elapsedMs:5000},
    {statusCode:206,complete:true,headers:{"content-length":"2097152"},elapsedMs:0},
  ];
  for(const response of bad){
    const releases=await Promise.all(Array.from({length:3},()=>budget.acquire(origin)));
    releases[0](response);releases[1]();releases[2]();
  }
  assert.equal(budget.origins.get(origin).limit,4);
  assert.equal(budget.origins.get(origin).observedSamples,0);
});

test("adaptive feedback remains isolated per origin", async () => {
  const budget=new HttpConnectionBudget({global:8,initial:3,maximum:3});
  const fast=await budget.acquire("https://fast.example");
  const slow=await budget.acquire("https://slow.example");
  slow({statusCode:429,retryAfterMs:1});
  fast({statusCode:206,complete:true,headers:{"content-length":"2097152"},elapsedMs:60});
  assert.equal(budget.origins.get("https://fast.example").limit,3);
  assert.equal(budget.origins.get("https://slow.example").limit,1);
});

test("duplicate lease release cannot corrupt global or per-origin capacity", async () => {
  const budget = new HttpConnectionBudget({ global: 1, initial: 1, maximum: 1 });
  const origin = "https://duplicate-release.example";
  const first = await budget.acquire(origin);
  const secondPending = budget.acquire(origin);
  first({ statusCode: 200 });
  const second = await secondPending;
  assert.equal(budget.active, 1);
  assert.equal(budget.origins.get(origin).active, 1);
  first({ statusCode: 429, retryAfterMs: 1000 });
  assert.equal(budget.active, 1);
  assert.equal(budget.origins.get(origin).active, 1);
  assert.equal(budget.origins.get(origin).limit, 1);
  second();
  second();
  assert.equal(budget.active, 0);
  assert.equal(budget.origins.get(origin).active, 0);
});
