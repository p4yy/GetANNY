const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSetting } = require("../src/main/settings/schema");

test("keyboard shortcuts validate scope, modifiers, and conflicts with default bindings", () => {
  const custom = { "global.new": "Mod+Shift+n", "preview.play": "p" };
  assert.deepEqual(validateSetting("shortcuts", custom), custom);
  assert.throws(
    () => validateSetting("shortcuts", { "global.new": "n" }),
    /valid shortcut/,
  );
  assert.throws(
    () => validateSetting("shortcuts", { "global.new": "Mod+f" }),
    /already in use/,
  );
  assert.throws(
    () => validateSetting("shortcuts", { "preview.play": "F1" }),
    /already in use/,
  );
  assert.throws(
    () => validateSetting("shortcuts", { "other.command": "p" }),
    /valid shortcut/,
  );
});
test("download list and timeline support their own non-conflicting rebindings", () => {
  assert.doesNotThrow(() => validateSetting("shortcuts", {
    "downloadsPanel.rowFirst": "PageUp",
    "timeline.earlier": "Home",
    "timeline.timelineStart": "ArrowLeft",
  }));
  assert.throws(() => validateSetting("shortcuts", { "downloadsPanel.rowFirst": "ArrowUp" }), /already in use/);
});
