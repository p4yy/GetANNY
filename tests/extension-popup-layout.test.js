const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const popup = fs.readFileSync(path.resolve(__dirname,"../src/extension/popup.html"),"utf8");
const builder = fs.readFileSync(path.resolve(__dirname,"../scripts/build-extension.js"),"utf8");
test("extension UI preserves all the existing bridge control IDs", () => {
  const ids=["status","reconnect","download-form","url","kind","send","tab","automatic-capture",
    "capture-site-row","capture-site","keep-site","cookie-site","cookie-privacy",
    "include-site-cookies","overlay-settings","hide-overlay","download-social","detected-section",
    "detected","browser","pairing","pair","message","clear-recent","clear-recent-confirm",
    "cancel-clear-recent","confirm-clear-recent"];
  for(const id of ids) assert.match(popup,new RegExp('id="' + id + '"'),id);
});
test("extension provides three navigable views, a master switch and browser download history", () => {
  for(const name of ["downloads","capture","settings"]) {
    assert.match(popup,new RegExp('data-view="' + name + '"'));
    assert.match(popup,new RegExp('id="view-' + name + '"'));
  }
  assert.match(popup,/id="extension-enabled"/);
  assert.match(popup,/id="recent-downloads"/);
  assert.doesNotMatch(popup,/AV® Engine|engine-coming-soon/);
  assert.match(popup,/popup-enhancements\.js/);
  assert.match(builder,/"popup-enhancements\.js"/);
});

test("recent downloads can be cleared or individually hidden without deleting files", () => {
  const recent = fs.readFileSync(path.resolve(__dirname,"../src/extension/recent-downloads.js"),"utf8");
  const enhancements = fs.readFileSync(path.resolve(__dirname,"../src/extension/popup-enhancements.js"),"utf8");
  assert.match(popup,/id="clear-recent"/);
  assert.match(popup,/id="clear-recent-confirm"/);
  assert.match(enhancements,/id\("confirm-clear-recent"\)/);
  assert.match(enhancements,/download-remove/);
  assert.match(enhancements,/Recent list cleared\. Downloaded files were not deleted\./);
  assert.doesNotMatch(enhancements,/downloads\.erase/);
  assert.match(builder,/recent-downloads\.js/);
  assert.match(popup,/recent-downloads\.js/);
  assert.match(recent,/CLEARED_BEFORE_KEY/);
});
