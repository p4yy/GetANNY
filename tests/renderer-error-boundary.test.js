"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("production renderer reports only component names for root or panel render failures", () => {
  const boundary = fs.readFileSync("src/renderer/components/ErrorBoundary.jsx", "utf8");
  const root = fs.readFileSync("src/renderer/main.jsx", "utf8");
  assert.match(boundary, /componentDidCatch\(error, info\)/);
  assert.match(boundary, /info\?\.componentStack/);
  assert.match(boundary, /componentNames\.join/);
  assert.doesNotMatch(boundary, /console\.error\([^)]*error\.message/);
  assert.match(root, /<ErrorBoundary>[\s\S]*<App\s*\/>[\s\S]*<\/ErrorBoundary>/);
});
