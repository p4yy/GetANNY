const test = require("node:test");
const assert = require("node:assert/strict");

test("selection ranges remain correct across a 10,000-row virtual viewport", async () => {
  const { indexAtOffset, addRange } =
    await import("../src/renderer/utils/download-selection.mjs");
  const rows = Array.from({ length: 10000 }, (_, index) => ({
    id: `job-${index}`,
  }));
  const offsets = Array.from(
    { length: rows.length + 1 },
    (_, index) => index * 112,
  );
  assert.equal(indexAtOffset(offsets, 1000 * 112), 1000);
  assert.equal(indexAtOffset(offsets, 1000 * 112 - 1), 999);
  assert.equal(indexAtOffset(offsets, 10000 * 112), 9999);
  const selected = addRange(rows, 9999, 0, new Set(["outside-filter"]));
  assert.equal(selected.size, 10001);
  assert.ok(selected.has("job-0"));
  assert.ok(selected.has("job-9999"));
  assert.ok(selected.has("outside-filter"));
});
