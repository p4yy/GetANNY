"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("blob handoff falls back to a native browser download with numeric timer handles", async () => {
  const source = fs.readFileSync("src/extension/content.js", "utf8");
  let clickHandler;
  const timers = [];
  const appended = [];
  const anchor = {
    href: "blob:https://site.test/file-id",
    download: "clip.bin",
  };
  const fallback = {
    href: "",
    download: "",
    clicked: 0,
    removed: false,
    click() { this.clicked++; },
    remove() { this.removed = true; },
  };
  const api = {
    storage: {
      local: {
        get: async () => ({ getannyExtensionEnabled: true }),
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      id: "getanny-browser-test",
      sendMessage: () => Promise.reject(new Error("desktop unavailable")),
      onMessage: { addListener() {} },
    },
  };
  const document = {
    title: "Blob fallback fixture",
    documentElement: {},
    addEventListener(type, listener) {
      if (type === "click") clickHandler = listener;
    },
    createElement(tag) {
      assert.equal(tag, "a");
      return fallback;
    },
    body: { append(node) { appended.push(node); } },
    querySelectorAll() { return []; },
  };
  const window = {};
  window.top = window;
  vm.runInNewContext(source, {
    globalThis: {
      browser: api,
      GetANNYSiteDownloads: { providerFor: () => true },
      GetANNYSocialLinks: { socialSite: () => false },
      GetANNYDownloadPreferences: {
        enabledKey: "getannyExtensionEnabled",
        automaticKey: "getannyAutomaticCapture",
        siteKey: () => "keep-site",
        get: async () => ({ automatic: true, keepInBrowser: false }),
      },
    },
    window,
    document,
    location: {
      href: "https://site.test/download",
      origin: "https://site.test",
    },
    Element: class Element {},
    MutationObserver: class { observe() {} },
    Node: { ELEMENT_NODE: 1 },
    URL,
    Blob,
    fetch: async () => ({
      ok: true,
      headers: { get: () => null },
      blob: async () => new Blob(["payload"]),
    }),
    setTimeout(callback, milliseconds) {
      timers.push({ callback, milliseconds });
      return 7;
    },
    clearTimeout() {},
  });
  await new Promise(setImmediate);
  assert.equal(typeof clickHandler, "function");

  const event = {
    isTrusted: true,
    defaultPrevented: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { closest: (selector) => selector === "a[download]" ? anchor : null },
    preventDefault() { this.defaultPrevented = true; },
  };
  clickHandler(event);
  await new Promise(setImmediate);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(appended, [fallback]);
  assert.match(fallback.href, /^blob:/);
  assert.equal(fallback.download, "clip.bin");
  assert.equal(fallback.clicked, 1);
  assert.equal(fallback.removed, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].milliseconds, 30000);
  timers[0].callback();
});
