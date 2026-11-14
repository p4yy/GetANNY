const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  BrowserPayloads,
  MAX_BYTES,
} = require("../src/main/browser-integration/BrowserPayloads");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const {
  providerFor,
  classifyOutput,
} = require("../src/extension/site-downloads");
const { temporary, waitFor } = require("./helpers");

test("browser payload transfers ordered bytes and enforces session ownership", async (t) => {
  const folder = await temporary(t);
  const work = path.join(folder, "work");
  const manager = new DownloadManager({
    tempPath: work,
    settings: { defaultDownloadPath: folder },
  });
  const payloads = new BrowserPayloads(work, manager);
  t.after(async () => {
    await payloads.close();
    await manager.shutdown();
  });
  const begin = {
    action: "begin",
    filename: "artifact.txt",
    page: "https://claude.ai/chat/test",
    length: 5,
  };
  await assert.rejects(
    payloads.receive({ ...begin, length: MAX_BYTES + 1 }, "one"),
    /metadata/,
  );
  const { uploadId } = await payloads.receive(begin, "one");
  const chunk = {
    action: "chunk",
    uploadId,
    offset: 0,
    data: Buffer.from("hello").toString("base64"),
  };
  await assert.rejects(payloads.receive(chunk, "two"), /unavailable/);
  assert.equal((await payloads.receive(chunk, "one")).offset, 5);
  const { id } = await payloads.receive({ action: "finish", uploadId }, "one");
  await waitFor(() => manager.requireItem(id).status === "completed");
  assert.equal(
    await fs.readFile(path.join(folder, "artifact.txt"), "utf8"),
    "hello",
  );
  assert.equal(manager.getAll()[0].browserPayloadPath, undefined);
  assert.deepEqual(await fs.readdir(work), []);
});

test("provider output classifiers use exact origins and include Suno direct audio", () => {
  assert.equal(providerFor("https://perplexity.ai/search/test"), "Perplexity");
  assert.equal(providerFor("https://claude.ai.example.com/"), null);
  assert.equal(
    classifyOutput(
      "https://suno.com/song/test",
      "https://cdn1.suno.ai/fixture.mp3",
      "audio/mpeg",
    ).title,
    "Suno audio",
  );
  assert.equal(
    classifyOutput(
      "https://chatgpt.com/c/test",
      "https://files.oaiusercontent.com/image",
      "image/png",
    ).title,
    "ChatGPT image",
  );
  assert.equal(
    classifyOutput(
      "https://www.perplexity.ai/",
      "https://example.com/file",
      "",
      "attachment",
    ).title,
    "Perplexity file",
  );
});
