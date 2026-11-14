const test = require("node:test");
const assert = require("node:assert/strict");
const { translate } = require("../src/main/translate");
const languages = require("../src/shared/languages.json");
const english = require("../src/shared/locales/en.json");

test("native menus and update status have labels in every offered language", () => {
  const keys = Object.keys(english).filter(
    (key) => key.startsWith("menu.") || key === "updates.checking",
  );
  for (const { code } of languages) {
    const locale = require("../src/shared/locales/" + code + ".json");
    for (const key of keys) {
      assert.ok(locale[key], code + " is missing " + key);
      assert.equal(translate(code, key), locale[key]);
    }
  }
});

test("shared translation uses English fallback and keeps missing replacements visible", () => {
  assert.equal(
    translate("unknown", "updates.available", { version: "3.0" }),
    "GetANNY 3.0 is ready to download",
  );
  assert.equal(
    translate("en", "updates.available"),
    "GetANNY {version} is ready to download",
  );
});
