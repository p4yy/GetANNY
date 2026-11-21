const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "..", "src", "extension", "download-preferences.js");
function harness(saved = {}) {
  const context = { URL, globalThis: {} };
  vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), context, {filename:modulePath});
  const api = {storage:{local:{async get(keys) {
    return Object.fromEntries(keys.filter((key) => key in saved).map((key) => [key,saved[key]]));
  }}}};
  return {api,prefs:context.globalThis.GetANNYDownloadPreferences};
}
test("new installation enables integration and site cookies by default", async () => {
  const {api,prefs} = harness();
  const value = await prefs.get(api,"https://example.com","https://cdn.example.com/video.mp4");
  assert.equal(value.enabled,true);
  assert.equal(value.automatic,true);
  assert.equal(value.includeSiteCookies,true);
  assert.equal(value.keepInBrowser,false);
});
test("master off leaves the browser in control and prevents cookie forwarding", async () => {
  const {api,prefs} = harness({getannyExtensionEnabled:false});
  const value = await prefs.get(api,"https://example.com","https://cdn.example.com/file.zip");
  assert.equal(value.enabled,false);
  assert.equal(value.automatic,false);
  assert.equal(value.includeSiteCookies,false);
});
test("the site-specific cookie opt-out wins over automatic capture", async () => {
  const {api,prefs} = harness({"getanny:downloads:cookies:cdn.example.com":false});
  const value = await prefs.get(api,"https://example.com","https://cdn.example.com/file.zip");
  assert.equal(value.automatic,true);
  assert.equal(value.includeSiteCookies,false);
});
test("site exception leaves downloads in the browser", async () => {
  const {api,prefs} = harness({"getanny:downloads:keep:example.com":true});
  const value = await prefs.get(api,"https://example.com","https://cdn.example.com/file.zip");
  assert.equal(value.keepInBrowser,true);
});
test("internal pages have no HTTP cookie scope", async () => {
  const {api,prefs} = harness();
  const value = await prefs.get(api,"chrome://downloads","chrome://settings");
  assert.equal(value.includeSiteCookies,false);
});
