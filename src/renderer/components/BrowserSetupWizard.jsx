import React, { useEffect, useState } from "react";
import { Button, Select } from "./ui";
import { useI18n } from "../i18n/useI18n";
export default function BrowserSetupWizard({
  info,
  selected,
  onSelect,
  onDetect,
  onPrepare,
  onInstall,
  busy,
}) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(false), [selected]);
  const browser = info?.browsers?.find((value) => value.id === selected);
  const step = browser?.connected ? 4 : opened ? 3 : browser?.prepared ? 2 : 1;
  return (
    <section className="browser-setup-wizard">
      <h2>{t("setup.title")}</h2>
      <ol>
        {["detect", "prepare", "install", "confirm"].map((key, index) => (
          <li
            key={key}
            aria-current={step === index + 1 ? "step" : undefined}
            className={step > index + 1 || browser?.connected ? "done" : ""}
          >
            <b>{index + 1}</b>
            {t(`setup.${key}`)}
          </li>
        ))}
      </ol>
      <label>
        {t("setup.browser")}
        <Select
          value={selected}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          {(info?.browsers || []).map((browser) => (
            <option key={browser.id} value={browser.id}>
              {browser.name || browser.id}
              {browser.installed ? "" : " · " + t("setup.notDetected")}
            </option>
          ))}
        </Select>
      </label>
      <p role="status">
        {t(
          browser?.connected
            ? "setup.connected"
            : opened
              ? "setup.awaiting"
              : browser?.prepared
                ? "setup.ready"
                : "setup.start",
        )}
      </p>
      <div className="workflow-actions">
        <Button disabled={busy} onClick={onDetect}>
          {t("setup.detect")}
        </Button>
        {!browser?.prepared && (
          <Button busy={busy} onClick={onPrepare}>
            {t("setup.prepare")}
          </Button>
        )}
        {browser?.prepared && !browser?.connected && (
          <Button
            busy={busy}
            onClick={async () => {
              if (await onInstall()) setOpened(true);
            }}
          >
            {t("setup.install")}
          </Button>
        )}
        {opened && (
          <Button disabled={busy} onClick={onDetect}>
            {t("setup.confirm")}
          </Button>
        )}
        <Button busy={busy} onClick={onPrepare}>
          {t("setup.repair")}
        </Button>
      </div>
      <small>
        {t(selected === "firefox" ? "setup.firefox" : "setup.chromium")}
      </small>
    </section>
  );
}
