import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import useUIStore from "../stores/useUIStore";

export default function TransferStage({ item }) {
  const { t } = useI18n();
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(
    () => setLastActivity(Date.now()),
    [item.downloadedSize, item.status, item.stage, item.stageProgress],
  );
  const running = ["connecting", "downloading", "processing"].includes(
    item.status,
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [running]);
  const phase =
    (item.status === "processing" ? item.stage : null) ||
    (item.status === "connecting" && item.kind === "torrent"
      ? "peers"
      : item.status);
  const stalled =
    running && now - lastActivity > 45000 && item.status !== "processing";
  const noPeers = item.kind === "torrent" && !(item.peers > 0) && running;
  const showElapsed =
    item.status === "connecting" && Number.isFinite(item.metadataElapsed);
  const showProgress =
    item.status === "processing" && Number.isFinite(item.stageProgress);
  const showPhase = noPeers || phase !== item.status || showElapsed;
  if (!showPhase && !showProgress && !stalled) return null;
  return (
    <div className="transfer-stage">
      {showPhase && (
        <span>
          {t(`workflow.stage.${noPeers ? "peers" : phase}`)}
          {showElapsed ? ` · ${item.metadataElapsed}s / 180s` : ""}
        </span>
      )}
      {showProgress && (
        <progress
          max="100"
          value={item.stageProgress}
          aria-label={t(`workflow.stage.${phase}`)}
        />
      )}
      {(stalled || noPeers) && (
        <button
          type="button"
          className="recovery-hint"
          onClick={() => useUIStore.getState().setDetails(item.id)}
        >
          {t(noPeers ? "workflow.noPeers" : "workflow.stalled")}
        </button>
      )}
    </div>
  );
}
