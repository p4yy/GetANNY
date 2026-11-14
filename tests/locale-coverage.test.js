"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { REQUIRED, placeholders, compareResources, readProject } =
  require("../scripts/verify-locale-coverage");
test("locale checker requires the approved seven locales and detects every key/placeholder gap", () => {
  assert.deepEqual(REQUIRED, ["en","ar","fr","es","de","pt","ja"]);
  assert.deepEqual(placeholders("Value {count} {name} {count}"), ["count","name"]);
  const english = { hello:"Hello {user}", files:"{count} files" };
  const good = Object.fromEntries(REQUIRED.map((code) => [code, { ...english }]));
  const passing = compareResources(english, good, [...REQUIRED]);
  assert.equal(passing.passed, true);
  good.fr.hello = "Bonjour {utilisateur}";
  delete good.es.files;
  good.de.hello = "";
  good.ar.extra = "extra";
  delete good.pt;
  const result = compareResources(english, good, ["en","ar","fr","es","de"]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.missingCatalog, ["pt","ja"]);
  assert.deepEqual(result.locales.fr.placeholderMismatch[0].expected, ["user"]);
  assert.deepEqual(result.locales.fr.placeholderMismatch[0].actual, ["utilisateur"]);
  assert.deepEqual(result.locales.es.missing, ["files"]);
  assert.deepEqual(result.locales.de.empty, ["hello"]);
  assert.deepEqual(result.locales.ar.extra, ["extra"]);
  assert.equal(result.locales.pt.present, false);
});
test("all shipped interface languages have complete, placeholder-safe resources", () => {
  const report = readProject();
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
});
