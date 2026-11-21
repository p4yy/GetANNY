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
    "detected","browser","pairing","pair","message"];
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
