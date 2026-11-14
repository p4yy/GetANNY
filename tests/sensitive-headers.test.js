const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSensitiveHeader,
  redactLogText,
} = require("../src/main/utils/sensitive-headers");

test("credential redaction covers complete bearer, cookie and API-key values", () => {
  assert.equal(
    redactLogText("Authorization: Bearer secret-token"),
    "Authorization: [redacted]",
  );
  assert.equal(redactLogText("Cookie: a=one; b=two"), "Cookie: [redacted]");
  assert.equal(redactLogText("x-api-key: test"), "x-api-key: [redacted]");
  for (const header of [
    "X-Amz-Security-Token",
    "X-CSRF-Token",
    "X-Api-Key",
    "Authorization",
  ])
    assert.equal(isSensitiveHeader(header), true);
  assert.equal(isSensitiveHeader("Content-Disposition"), false);
});
