import React, { useState, useEffect } from "react";
import { api } from "../api";
import { useI18n } from "../i18n/useI18n";
import useSettingsStore from "../stores/useSettingsStore";
export default function DestinationPreview({
  kind,
  url,
  filename,
  media,
  savePath,
}) {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const [destination, setDestination] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () =>
        api
          .invoke("download:destination", {
            kind,
            url,
            filename,
            media,
            savePath,
          })
          .then((value) => {
            if (!cancelled) setDestination(value);
          })
          .catch(() => {
            if (!cancelled) setDestination(null);
          }),
      150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    kind,
    url,
    filename,
    media?.audioOnly,
    media?.type,
    savePath,
    settings.destinationRules,
    settings.organizeByType,
    settings.defaultDownloadPath,
  ]);
  return destination ? (
    <p className="destination-preview">
      {t("workflow.destination")} <bdi>{destination.folder}</bdi>
    </p>
  ) : null;
}
