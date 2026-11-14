const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { verifyBranding } = require("../scripts/brand/verify-rendered-official-assets");

test("packaged and renderer artwork use the original GetANNY v2.5.0 assets", () => {
  verifyBranding();
  const config = fs.readFileSync("electron-builder.yml", "utf8");
  assert.match(config, /installerIcon: assets\/icon\.ico/);
  assert.match(config, /uninstallerIcon: assets\/icon\.ico/);
  const css = fs.readFileSync("src/renderer/index.css", "utf8");
  assert.match(css, /assets\/brand\/symbol-black\.png/);
  assert.match(css, /assets\/brand\/wordmark-black\.png/);
  assert.doesNotMatch(css, /assets\/branding\//);
});
