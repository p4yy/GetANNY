"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const script = fs.readFileSync(
  path.resolve(__dirname, "../src/extension/content.js"), "utf8",
);

async function handoff({ body = Buffer.from("exact AI download bytes"), header = null, oversized = false, desktopAvailable = true } = {}) {
  const messages = [];
  let nativeClicks = 0;
  let handler;
  let resolveFinished;
  const finished = new Promise((resolve) => { resolveFinished = resolve; });
  const document = {
    title: "ChatGPT file",
    documentElement: {},
    querySelectorAll: () => [],
    addEventListener(name, listener) {
      if (name === "click") handler = listener;
    },
    createElement() {
      return {
        href: "",
        download: "",
        click() { nativeClicks++; resolveFinished(); },
        remove() {},
      };
    },
    body: { append() {} },
  };
  const response = {
    ok: true,
    headers: { get: () => header },
    blob: async () => oversized
      ? { size: 64 * 1024 * 1024 + 1 }
      : new Blob([body]),
  };
  const window = {};
  window.top = window;
  const context = {
    chrome: {
      runtime: {
        id: "getanny-fixture",
        onMessage: { addListener() {} },
        async sendMessage(message) {
          messages.push(message);
          if (!desktopAvailable) return { success: false, error: "Desktop unavailable." };
          if (message.action === "begin") return { success: true, uploadId: "upload-1" };
          if (message.action === "finish") resolveFinished();
          return { success: true };
        },
      },
    },
    window,
    document,
    location: { href: "https://chatgpt.com/c/test", origin: "https://chatgpt.com" },
    GetANNYSiteDownloads: { providerFor: () => "ChatGPT" },
    GetANNYSocialLinks: { socialSite: () => null, postLink: () => null },
    fetch: async () => response,
    URL, Blob, Uint8Array,
    btoa: (data) => Buffer.from(data, "binary").toString("base64"),
    Element: class Element {},
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class { observe() {} },
    clearTimeout, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(script, context, { filename: "content.js" });
  assert.equal(typeof handler, "function", "AI-provider click handler should install");
  let prevented = false;
  handler({
    isTrusted: true, defaultPrevented: false, button: 0,
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    target: { closest: () => ({
      href: "blob:https://chatgpt.com/550e8400-e29b-41d4-a716-446655440000",
      download: "assistant-file.bin",
    }) },
    preventDefault() { prevented = true; },
  });
  await Promise.race([
    finished,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Blob handoff did not settle")), 1500)),
  ]);
  return { prevented, nativeClicks, messages };
}

for (const header of [null, "0"]) {
  test("AI Blob handoff uses actual bytes when Content-Length is " + String(header), async () => {
    const body = Buffer.from([0, 1, 2, 128, 255, 10, 13, 42]);
    const result = await handoff({ body, header });
    assert.equal(result.prevented, true);
    assert.equal(result.nativeClicks, 0, "one owner: no duplicate browser copy");
    const begin = result.messages.find((message) => message.action === "begin");
    assert.equal(begin.length, body.length);
    const chunks = result.messages.filter((message) => message.action === "chunk");
    assert.deepEqual(Buffer.concat(chunks.map((chunk) =>
      Buffer.from(chunk.data, "base64"))), body);
    assert.equal(result.messages.at(-1).action, "finish");
  });
}

test("oversized browser Blob falls back before desktop upload begins", async () => {
  const result = await handoff({ oversized: true });
  assert.equal(result.nativeClicks, 1);
  assert.equal(result.messages.length, 0);
});

test("desktop rejection returns Blob to browser with no finish acknowledgement", async () => {
  const result = await handoff({ desktopAvailable: false });
  assert.equal(result.nativeClicks, 1);
  assert.equal(result.messages.some((message) => message.action === "finish"), false);
});
