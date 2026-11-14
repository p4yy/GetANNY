import React, { useState } from "react";
import {
  LuDownload,
  LuUpload,
  LuShieldCheck,
  LuFolderOpen,
  LuRotateCcw,
  LuFilm,
  LuMusic2,
  LuImage,
  LuFileText,
  LuArchive,
  LuAppWindow,
  LuFolder,
  LuMagnet,
  LuSettings2,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import { Button, ErrorBanner } from "./ui";
import useSettingsStore from "../stores/useSettingsStore";
import { useI18n } from "../i18n/useI18n";

const categories = [
  ["Video", LuFilm],
  ["Audio", LuMusic2],
  ["Images", LuImage],
  ["Documents", LuFileText],
  ["Archives", LuArchive],
  ["Applications", LuAppWindow],
  ["Torrents", LuMagnet],
  ["Other", LuFolder],
];
export default function WorkspaceTools({ section }) {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (key, action) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      if (await action()) setNotice(t("workflow.saved"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const folders = section === "storage";
  const HeaderIcon = folders ? LuFolderOpen : LuSettings2;
  return (
    <section className="settings-panel settings-tools">
      <header className="settings-section-heading settings-tools-heading">
        <span className="settings-tools-icon">
          <HeaderIcon aria-hidden="true" />
        </span>
        <div>
          <h2>{t(folders ? "workflow.rules" : "workflow.workspace")}</h2>
          <p>{t(folders ? "workflow.rulesNote" : "workflow.privacy")}</p>
        </div>
      </header>
      {error && (
        <div className="settings-tools-notice">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}
      {notice && (
        <p className="settings-tools-notice" role="status">
          {notice}
        </p>
      )}
      {folders ? (
        <div className="destination-rules-list">
          {categories.map(([category, Icon]) => {
            const folder = settings.destinationRules?.[category];
            return (
              <div className="destination-rule-row" key={category}>
                <span className="destination-rule-icon">
                  <Icon aria-hidden="true" />
                </span>
                <div className="destination-rule-copy">
                  <strong>{t(`workflow.category.${category}`)}</strong>
                  <span
                    className={
                      folder
                        ? "destination-rule-path"
                        : "destination-rule-default"
                    }
                  >
                    {folder ? (
                      <bdi title={folder}>{folder}</bdi>
                    ) : (
                      t("workflow.defaultFolder")
                    )}
                  </span>
                </div>
                <div className="destination-rule-actions">
                  <Button
                    icon={LuFolderOpen}
                    disabled={!!busy || !api.desktop}
                    busy={busy === category}
                    onClick={() =>
                      run(category, async () => {
                        const next = await api.invoke("dialog:select-folder");
                        if (!next) return false;
                        await useSettingsStore
                          .getState()
                          .save("destinationRules", {
                            ...(useSettingsStore.getState().settings
                              .destinationRules || {}),
                            [category]: next,
                          });
                        return true;
                      })
                    }
                  >
                    {t("workflow.choose")}
                  </Button>
                  {folder && (
                    <Button
                      variant="ghost"
                      icon={LuRotateCcw}
                      disabled={!!busy}
                      onClick={() =>
                        run(category, async () => {
                          const next = {
                            ...useSettingsStore.getState().settings
                              .destinationRules,
                          };
                          delete next[category];
                          await useSettingsStore
                            .getState()
                            .save("destinationRules", next);
                          return true;
                        })
                      }
                    >
                      {t("workflow.reset")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="settings-tools-actions">
          <div className="settings-tools-action-row">
            <span className="settings-tools-icon">
              <LuDownload aria-hidden="true" />
            </span>
            <div>
              <strong>{t("workflow.exportSettings")}</strong>
              <p>{t("settings.tools.exportHint")}</p>
            </div>
            <Button
              icon={LuDownload}
              disabled={!!busy || !api.desktop}
              busy={busy === "export"}
              onClick={() => run("export", () => api.invoke("settings:export"))}
            >
              {t("settings.tools.export")}
            </Button>
          </div>
          <div className="settings-tools-action-row">
            <span className="settings-tools-icon">
              <LuUpload aria-hidden="true" />
            </span>
            <div>
              <strong>{t("workflow.importSettings")}</strong>
              <p>{t("settings.tools.importHint")}</p>
            </div>
            <Button
              icon={LuUpload}
              disabled={!!busy || !api.desktop}
              busy={busy === "import"}
              onClick={() =>
                run("import", async () => {
                  const result = await api.invoke("settings:import");
                  if (result) useSettingsStore.getState().setSettings(result);
                  return result;
                })
              }
            >
              {t("settings.tools.import")}
            </Button>
          </div>
          <div className="settings-tools-action-row">
            <span className="settings-tools-icon">
              <LuShieldCheck aria-hidden="true" />
            </span>
            <div>
              <strong>{t("workflow.diagnostics")}</strong>
              <p>{t("settings.tools.diagnosticsHint")}</p>
            </div>
            <Button
              icon={LuShieldCheck}
              disabled={!!busy || !api.desktop}
              busy={busy === "diagnostics"}
              onClick={() =>
                run("diagnostics", () => api.invoke("app:diagnostics"))
              }
            >
              {t("settings.tools.report")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
