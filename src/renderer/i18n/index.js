import { translate as translateText } from "../../shared/translate.mjs";
import en from "../../shared/locales/en.json";
import ar from "../../shared/locales/ar.json";
import fr from "../../shared/locales/fr.json";
import es from "../../shared/locales/es.json";
import de from "../../shared/locales/de.json";
import pt from "../../shared/locales/pt.json";
import ja from "../../shared/locales/ja.json";
import languages from "../../shared/languages.json";

const resources = { en, ar, fr, es, de, pt, ja };

export const translate = (code, key, values) =>
  translateText(resources, code, key, values);
export { languages };

export const isRtl = (code) =>
  languages.find((language) => language.code === code)?.dir === "rtl";
