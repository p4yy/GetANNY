const test = require("node:test");
const assert = require("node:assert/strict");
const { socialSite, postLink } = require("../src/extension/social-links");
test("social batch recognizes only canonical posts on the active platform", () => {
  assert.equal(socialSite("https://m.youtube.com/@channel"), "youtube");
  assert.equal(socialSite("https://x.com.example.com/me"), null);
  assert.equal(
    postLink(
      "/shorts/abcdefghijk?si=tracking",
      "https://www.youtube.com/@channel",
    ),
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  assert.equal(
    postLink("/reels/Clip/?tracking=yes", "https://www.instagram.com/profile"),
    "https://www.instagram.com/reel/Clip/",
  );
  assert.equal(
    postLink("https://twitter.com/test/status/123", "https://x.com/test"),
    "https://x.com/i/web/status/123",
  );
  assert.equal(
    postLink("/@name/video/678", "https://www.tiktok.com/@name"),
    "https://www.tiktok.com/@name/video/678",
  );
  assert.equal(
    postLink("https://x.com/test/status/123", "https://www.tiktok.com/@name"),
    null,
  );
  assert.equal(
    postLink("/profile/followers", "https://www.instagram.com/profile"),
    null,
  );
});

test("TikTok feed media resolves only the URL owned by the playing video card", () => {
  const { postForMediaElement } = require("../src/extension/social-links");
  const home = "https://www.tiktok.com/en/";
  const original = "https://www.tiktok.com/@creator/video/7390012345678901234";
  const another = "https://www.tiktok.com/@other/video/7390012345678901235";
  const card = {
    parentElement: null,
    querySelectorAll(selector) {
      return selector === "video" ? [video] : [{ href: original + "?lang=en" }];
    },
  };
  const video = { parentElement: card, querySelectorAll: () => [] };
  assert.equal(postForMediaElement(video, home), original);
  assert.equal(postForMediaElement(video, original), original);
  assert.equal(postForMediaElement(video, "https://www.youtube.com/watch"), null);
  const multi = {
    parentElement: null,
    querySelectorAll(selector) {
      return selector === "video" ? [video, { src: "blob:other" }] :
        [{ href: original }, { href: another }];
    },
  };
  video.parentElement = multi;
  assert.equal(postForMediaElement(video, home), null,
    "A feed holding multiple posts cannot be assigned an arbitrary URL");
});
