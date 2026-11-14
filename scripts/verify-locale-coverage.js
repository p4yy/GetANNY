"use strict";
/* Explicit seven-language release QA. Non-strict mode reports all defects
 * without blocking incremental development; --strict blocks publication. */
const fs = require("node:fs");
const path = require("node:path");
const { writeFileSync, readFileSync } = fs;
const REQUIRED = Object.freeze(["en", "ar", "fr", "es", "de", "pt", "ja"]);
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
function placeholders(value) {
  return [...new Set([...String(value).matchAll(PLACEHOLDER)].map((match) => match[1]))].sort();
}
function compareResources(base, translations, catalogCodes, required = REQUIRED) {
  const keys = Object.keys(base).sort();
  const invalidEnglish = keys.filter((key) => typeof base[key] !== "string" || !base[key].trim());
  const missingCatalog = required.filter((code) => !catalogCodes.includes(code));
  const unexpectedCatalog = catalogCodes.filter((code) => !required.includes(code));
  const locales = {};
  for (const code of required) {
    const table = translations[code];
    if (!table) {
      locales[code] = {
        present: false,
        translated: 0,
        expected: keys.length,
        missing: keys,
        empty: [],
        extra: [],
        placeholderMismatch: [],
      };
      continue;
    }
    const missing = [], empty = [], placeholderMismatch = [];
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) {
        missing.push(key);
        continue;
      }
      if (typeof table[key] !== "string" || !table[key].trim()) {
        empty.push(key);
        continue;
      }
      const expected = placeholders(base[key]);
      const actual = placeholders(table[key]);
      if (expected.join("\0") !== actual.join("\0"))
        placeholderMismatch.push({ key, expected, actual });
    }
    const extra = Object.keys(table).filter((key) => !Object.prototype.hasOwnProperty.call(base, key)).sort();
    locales[code] = {
      present: true,
      translated: keys.length - missing.length - empty.length,
      expected: keys.length,
      missing,
      empty,
      extra,
      placeholderMismatch,
    };
  }
  const passed =
    invalidEnglish.length === 0 &&
    !missingCatalog.length &&
    !unexpectedCatalog.length &&
    required.every((code) => {
      const row = locales[code];
      return row.present && !row.missing.length && !row.empty.length &&
        !row.extra.length && !row.placeholderMismatch.length;
    });
  return {
    passed,
    expectedLanguages: required,
    expectedKeysPerLocale: keys.length,
    invalidEnglish,
    missingCatalog,
    unexpectedCatalog,
    locales,
    limitations: [
      "Key and parameter parity cannot establish the quality or accuracy of any translation.",
      "Human proofreading, RTL layout and real visible UI audits remain required before a release.",
    ],
  };
}
function readProject(root = path.resolve(__dirname, "..")) {
  const localeDir = path.join(root, "src", "shared", "locales");
  const catalog = JSON.parse(readFileSync(path.join(root, "src", "shared", "languages.json"), "utf8"));
  const codes = catalog.map((entry) => entry.code);
  const source = JSON.parse(readFileSync(path.join(localeDir, "en.json"), "utf8"));
  const translations = {};
  for (const code of REQUIRED) {
    const file = path.join(localeDir, code + ".json");
    if (fs.existsSync(file))
      translations[code] = JSON.parse(readFileSync(file, "utf8"));
  }
  return compareResources(source, translations, codes);
}
function main() {
  const root = path.resolve(__dirname, "..");
  const strict = process.argv.includes("--strict");
  const report = readProject(root);
  report.source = "src/shared/locales/en.json";
  const dest = path.join(root, "test-results", "windows", "locale-coverage.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  for (const code of REQUIRED) {
    const row = report.locales[code];
    console.log(code + ": " + row.translated + "/" + row.expected + " keys, " +
      row.missing.length + " missing, " + row.empty.length + " empty, " +
      row.placeholderMismatch.length + " placeholder mismatches" +
      (row.present ? "" : " (MISSING FILE)"));
  }
  if (report.missingCatalog.length)
    console.log("Language menu is missing: " + report.missingCatalog.join(", "));
  console.log("Detailed key-level QA evidence: test-results/windows/locale-coverage.json");
  if (strict && !report.passed) {
    console.error("Release blocked: seven complete translations and placeholder parity are mandatory.");
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { REQUIRED, placeholders, compareResources, readProject };
