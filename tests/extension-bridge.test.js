"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
test("native GetANNY bootstrap upgrades to direct credential only after durable storage and idle ownership",()=>{
  const source=fs.readFileSync("src/extension/background.js","utf8");
  assert.match(source,/function scheduleNativeUpgrade\(\)/);
  assert.match(source,/directUpgradeRounds >= 1/);
  assert.match(source,/directUpgradeRounds\+\+/);
  assert.match(source,/pairingKey === provisionedKey/);
  assert.match(source,/pending\.size > 0 \|\| \(interceptor\?\.entries\?\.size \|\| 0\) > 0/);
  assert.match(source,/resetConnection\("Switching from native bootstrap/);
  assert.match(source,/connect\(\)\.catch/);
  assert.match(source,/if \(pairingKey\) startWebSocket\(generation\)/);
  assert.match(source,/api\.storage\.local[\s\S]*\.set\([\s\S]*\.then\(\(\) =>/);
});
