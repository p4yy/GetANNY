const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname,"../src/extension/recent-downloads.js"),"utf8");
function api() {
  const context = {};
  vm.runInNewContext(source,context,{filename:"recent-downloads.js"});
  return context.GetANNYRecentDownloads;
}
test("recent history is visible on a new extension install", () => {
  const recent=api();
  const state=recent.fromStorage({});
  const items=[{id:1,startTime:"2026-11-20T10:00:00.000Z"},{id:2,startTime:"2026-11-21T10:00:00.000Z"}];
  assert.deepEqual(recent.visible(items,state).map(x=>x.id),[1,2]);
});
test("clear recent hides existing browser history but keeps later downloads", () => {
  const recent=api();
  const state=recent.fromStorage({});
  const items=[
    {id:10,startTime:"2026-11-21T09:00:00.000Z"},
    {id:11,startTime:"2026-11-21T09:59:59.000Z"},
  ];
  const next=recent.clear(state,items,Date.parse("2026-11-21T10:00:00.000Z"));
  const after=[
    ...items,
    {id:12,startTime:"2026-11-21T10:00:01.000Z"},
  ];
  assert.deepEqual(recent.visible(after,next).map(x=>x.id),[12]);
  assert.equal(next.clearedBefore,Date.parse("2026-11-21T10:00:00.000Z"));
});
test("individual remove hides only the selected item", () => {
  const recent=api();
  const state=recent.fromStorage({});
  const next=recent.hide(state,2);
  const items=[{id:1,startTime:"2026-11-20T10:00:00Z"},{id:2,startTime:"2026-11-20T11:00:00Z"}];
  assert.deepEqual(recent.visible(items,next).map(x=>x.id),[1]);
});
test("persisted clear state handles invalid storage without hiding all history", () => {
  const recent=api();
  const state=recent.fromStorage({
    "getanny:popup:recent-cleared-before":"not-a-date",
    "getanny:popup:recent-hidden-ids":["bad",null,-1,2,2]
  });
  assert.equal(state.clearedBefore,0);
  assert.deepEqual(Array.from(state.hiddenIds),[2]);
  assert.deepEqual(recent.visible([{id:2},{id:3}],state).map(x=>x.id),[3]);
});
test("clear state is scoped to popup visibility and never invokes browser file deletion", () => {
  assert.doesNotMatch(source,/downloads\.erase|removeFile|unlinkSync/);
});
