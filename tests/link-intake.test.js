const { test } = require("node:test");
const assert = require("node:assert/strict");

test("link intake uses host boundaries and distinguishes direct media and torrent files", async () => {
  const { classifyLink } =
    await import("../src/renderer/utils/link-intake.mjs");
  assert.equal(
    classifyLink("https://www.youtube.com/watch?v=123").kind,
    "media",
  );
  assert.equal(
    classifyLink("https://youtube.com.example.org/watch").kind,
    "file",
  );
  assert.equal(
    classifyLink("https://example.org/?site=youtube.com").kind,
    "file",
  );
  assert.equal(
    classifyLink("https://vimeo.com/download/clip.mp4?token=abc").kind,
    "file",
  );
  assert.equal(
    classifyLink("https://example.org/open.torrent?token=abc").kind,
    "torrent",
  );
  assert.equal(
    classifyLink("magnet:?xt=urn:btih:ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD")
      .kind,
    "torrent",
  );
  assert.equal(classifyLink("magnet:?dn=missing-hash"), null);
  assert.equal(classifyLink("file:///C:/private.txt"), null);
});

test("multiline intake opens a review and retains invalid rows for feedback", async () => {
  const { BATCH_LIMIT, openLinkIntake } =
    await import("../src/renderer/utils/link-intake.mjs");
  let modal;
  const ui = {
    setAddModal: (value) => {
      modal = value;
    },
    setDetails() {},
  };
  assert.equal(
    openLinkIntake("# Uri list\r\nhttps://example.org/a.zip\r\ninvalid", ui),
    true,
  );
  assert.deepEqual(modal, {
    batch: true,
    text: "https://example.org/a.zip\ninvalid",
  });
  const links = Array.from(
    { length: BATCH_LIMIT + 2 },
    (_, index) => `https://example.org/${index}`,
  ).join("\n");
  assert.equal(openLinkIntake(links, ui), true);
  assert.equal(modal.text.split("\n").length, BATCH_LIMIT + 1);
});
