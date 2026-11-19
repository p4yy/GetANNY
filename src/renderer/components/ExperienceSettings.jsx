import React, { useState } from "react";
import { LuSlidersHorizontal, LuGlobe, LuCaptions } from "react-icons/lu";
import { Button, Select, Switch } from "./ui";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { useI18n } from "../i18n/useI18n";
import { errorMessage } from "../api";
import QueueActionBar from "./QueueActionBar";
export default function ExperienceSettings() {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings),
    save = useSettingsStore((s) => s.save);
  const [prefs, setPrefs] = useState(
    settings.mediaPreferences || {
      height: 0,
      container: "any",
      audioLanguage: "",
      subtitleLanguage: "",
    },
  );
  const safeSave = async (key, value) => {
    try {
      await save(key, value);
      useUIStore.getState().notify(t("enhance.saved"));
    } catch (e) {
      useUIStore.getState().notify(errorMessage(e), "error");
    }
  };
  return (
    <>
      <section className="settings-panel experience-settings">
        <h2>
          <LuSlidersHorizontal /> {t("enhance.experience")}
        </h2>
        <div className="setting-row">
          <div>
            <h3>
              <LuGlobe /> {t("enhance.foreground")}
            </h3>
            <p>{t("enhance.foregroundNote")}</p>
          </div>
          <Switch
            checked={settings.bringToFrontOnCapture !== false}
            onChange={(v) => safeSave("bringToFrontOnCapture", v)}
            label={t("enhance.foreground")}
          />
        </div>
        <h3>
          <LuCaptions /> {t("enhance.mediaPrefs")}
        </h3>
        <div className="preference-grid">
          <label>
            {t("enhance.quality")}
            <Select
              value={prefs.height}
              onChange={(e) =>
                setPrefs({ ...prefs, height: Number(e.target.value) })
              }
            >
              {[480, 720, 1080, 1440, 2160, 4320, 0].map((n) => (
                <option key={n} value={n}>
                  {n ? `${n}p` : t("enhance.highest")}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {t("enhance.container")}
            <Select
              value={prefs.container}
              onChange={(e) =>
                setPrefs({ ...prefs, container: e.target.value })
              }
            >
              {["mp4", "webm", "any"].map((c) => (
                <option key={c} value={c}>
                  {c === "any" ? t("enhance.any") : c.toUpperCase()}
                </option>
              ))}
            </Select>
          </label>
          {["audioLanguage", "subtitleLanguage"].map((key) => (
            <label key={key}>
              {t(`enhance.${key}`)}
              <input
                dir="ltr"
                placeholder="en-US"
                maxLength={35}
                value={prefs[key]}
                onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p>{t("enhance.preferenceNote")}</p>
        <Button
          onClick={() =>
            safeSave("mediaPreferences", {
              ...prefs,
              audioLanguage: (prefs.audioLanguage || "").trim(),
              subtitleLanguage: (prefs.subtitleLanguage || "").trim(),
            })
          }
        >
          {t("enhance.save")}
        </Button>
      </section>
      <QueueActionBar />
    </>
  );
}
