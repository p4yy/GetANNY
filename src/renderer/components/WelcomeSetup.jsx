import React, { useEffect, useRef, useState } from "react";
import { Dialog, Button, Select } from "./ui";
import { LuArrowLeft, LuArrowRight, LuClock3 } from "react-icons/lu";
import { api, errorMessage } from "../api";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { languages } from "../i18n";
import { themes } from "../utils/theme";
import { useI18n } from "../i18n/useI18n";
export default function WelcomeSetup() {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const settings = useSettingsStore((s) => s.settings),
    save = useSettingsStore((s) => s.save);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [step, setStep] = useState(0);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const video = videoRef.current;
      if (!video) return;
      if (
        document.hidden ||
        motion.matches ||
        settings.reduceMotion ||
        ["disabled", "reduced"].includes(settings.animationMode)
      )
        video.pause();
      else video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener?.("change", sync);
    sync();
    return () => {
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener?.("change", sync);
      videoRef.current?.pause();
    };
  }, [settings.reduceMotion, settings.animationMode]);
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = (browser) =>
    run(async () => {
      await save("welcomeCompleted", true);
      useUIStore.getState().setActiveTab(browser ? "browser" : "all");
    });
  return (
    <Dialog
      title={t(step ? "enhance.engineTitle" : "enhance.welcome")}
      description={t(step ? "enhance.engineIntro" : "enhance.welcomeNote")}
      busy={busy}
      onClose={() => finish(false)}
    >
      <div
        className={`dialog-body welcome-setup ${step ? "welcome-engine-step" : ""}`}
      >
        {step === 0 ? (
          <>
            <div className="welcome-motion" aria-label="Animated GetANNY logo">
              <video
                ref={videoRef}
                autoPlay={
                  !settings.reduceMotion &&
                  settings.animationMode !== "disabled"
                }
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="GetANNY logo animation"
                poster={`${import.meta.env.BASE_URL}icon.png`}
              >
                <source
                  src={`${import.meta.env.BASE_URL}welcome-motion.mp4`}
                  type="video/mp4"
                />
              </video>
              <div className="welcome-motion-copy">
                <strong>GetANNY</strong>
                <span>Make your workspace yours.</span>
              </div>
            </div>
            <label>
              {t("enhance.language")}
              <Select
                value={settings.language}
                disabled={busy}
                onChange={(e) => run(() => save("language", e.target.value))}
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName || l.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : (
          <>
            <div className="engine-coming-soon-card">
              <div className="engine-coming-soon-icon">
                <LuClock3 />
              </div>
              <div>
                <strong>{t("settings.avEngine.title")}</strong>
                <span className="coming-soon-badge">
                  {t("settings.avEngine.comingSoon")}
                </span>
                <p>{t("enhance.engineComingSoon")}</p>
              </div>
            </div>
          </>
        )}
        {step === 0 && (
          <>
            <label>
              Color theme
              <Select
                value={settings.theme || "contrast"}
                disabled={busy}
                onChange={(event) =>
                  run(() => save("theme", event.target.value))
                }
              >
                <option value="system">Follow Windows appearance</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              {t("enhance.size")}
              <Select
                value={settings.interfaceSize}
                disabled={busy}
                onChange={(e) =>
                  run(() => save("interfaceSize", e.target.value))
                }
              >
                {["minimal", "dense", "compact", "classic", "comfortable"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {t(`interface.${s}`)}
                    </option>
                  ),
                )}
              </Select>
            </label>
            <label>
              Typeface
              <Select
                value={settings.interfaceFont || "inter"}
                disabled={busy}
                onChange={(event) =>
                  run(() => save("interfaceFont", event.target.value))
                }
              >
                <option value="inter">Inter · Clean modern</option>
                <option value="system">System · Native</option>
                <option value="segoe">Segoe UI · Windows</option>
              </Select>
            </label>
            <p className="welcome-typography-note">
              Choose your preferred typeface and interface scale. Both can be
              changed later in Settings.
            </p>
            <label>
              {t("enhance.destination")}
              <bdi>{settings.defaultDownloadPath}</bdi>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const folder = await api.invoke("dialog:select-folder");
                    if (folder) await save("defaultDownloadPath", folder);
                  })
                }
              >
                {t("enhance.chooseFolder")}
              </Button>
            </label>
            {error && <p className="error-banner">{error}</p>}
          </>
        )}
      </div>
      <footer className="dialog-footer">
        {step === 0 ? (
          <>
            <Button disabled={busy} onClick={() => finish(false)}>
              {t("enhance.later")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              {t("enhance.nextEngine")} <LuArrowRight />
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={() => setStep(0)}>
              <LuArrowLeft /> {t("enhance.back")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => finish(true)}
            >
              {t("enhance.skipEngine")}
            </Button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
