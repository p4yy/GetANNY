"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { MAX_TORRENT_BYTES, readRemoteTorrent } = require("./remote-torrent");

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/source.torrent`;
}

test("remote torrent metadata is streamed and returned byte-for-byte", async (t) => {
  const bytes = Buffer.from("d4:infod4:name4:testee");
  const url = await fixture(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/x-bittorrent" });
    response.end(bytes);
  });
  assert.deepEqual(await readRemoteTorrent(url), bytes);
});

test("remote torrent metadata rejects an oversized declared response", async (t) => {
  const url = await fixture(t, (_request, response) => {
    response.writeHead(200, { "content-length": MAX_TORRENT_BYTES + 1 });
    response.end();
  });
  await assert.rejects(readRemoteTorrent(url), /16 MB limit/);
});

test("remote torrent metadata rejects an oversized streamed response", async (t) => {
  const url = await fixture(t, (_request, response) => {
    response.writeHead(200, { "transfer-encoding": "chunked" });
    response.end(Buffer.alloc(MAX_TORRENT_BYTES + 1));
  });
  await assert.rejects(readRemoteTorrent(url), /16 MB limit/);
});

test("remote torrent metadata enforces its request deadline", async (t) => {
  const url = await fixture(t, () => {});
  await assert.rejects(
    readRemoteTorrent(url, { timeoutMs: 30 }),
    /request timed out/,
  );
});
