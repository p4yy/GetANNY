const languages = require("../shared/languages.json");
const { translate: translateText } = require("../shared/translate.mjs");

const resources = Object.fromEntries(
  languages.map(({ code }) => [
    code,
    require("../shared/locales/" + code + ".json"),
  ]),
);

const translate = (code, key, values) =>
  translateText(resources, code, key, values);

module.exports = { translate };
