import React from "react";
import { LuActivity } from "react-icons/lu";
import { useI18n } from "../i18n/useI18n";
export default function DownloadHealth({ item }) {
  const { t } = useI18n();
  const error = item.error || "";
  const key =
    (item.sessionRequired && ["failed", "paused"].includes(item.status)) ||
    /401|403|authentication|blocked/i.test(error)
      ? "healthAuth"
      : /ENOSPC|EACCES|EPERM|disk|space|permission/i.test(error)
        ? "healthDisk"
        : /404|410|expired|SOURCE_PAGE/i.test(error)
          ? "healthExpired"
          : item.status === "failed"
            ? "healthRetry"
            : ["queued", "retrying"].includes(item.status)
              ? "healthScheduled"
              : item.kind === "torrent" &&
                  ["connecting", "downloading"].includes(item.status) &&
                  !item.peers
                ? "healthPeers"
                : item.status === "processing"
                  ? "healthProcessing"
                  : "healthActive";
  return (
    <section className="download-health">
      <h3>
        <LuActivity /> {t("enhance.health")}
      </h3>
      <p>{t(`enhance.${key}`)}</p>
    </section>
  );
}
