"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { browsers } = require("../src/main/browser-integration/catalog");

function browserIconKeys(file) {
  const source = fs.readFileSync(file, "utf8");
  const definition = source.match(/const browserIcons = \{([\s\S]*?)\n\};/);
  assert.ok(definition, `Browser icon catalog not found in ${file}`);
  return new Set([...definition[1].matchAll(/^\s*([a-z]+):/gm)].map((match) => match[1]));
}
test("all supported browser IDs have an icon in desktop views", () => {
  const files = ["src/renderer/pages/BrowserPage.jsx", "src/renderer/App.jsx"];
  for (const file of files) {
    const keys = browserIconKeys(file);
    for (const browser of browsers)
      assert.ok(keys.has(browser.id), `${file}: missing icon for ${browser.id}`);
  }
});
test("unknown browsers cannot cause undefined React component type in Browser Setup", () => {
  const source = fs.readFileSync("src/renderer/pages/BrowserPage.jsx", "utf8");
  assert.match(source, /const BrowserIcon = browserIcons\[item\.id\] \|\| LuGlobe;/);
  assert.match(source, /<BrowserIcon \/>/);
});
