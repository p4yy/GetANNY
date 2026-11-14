import React, { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { Button, Select } from "./ui";
import { useI18n } from "../i18n/useI18n";
export default function QueueActionBar({ banner = false }) {
  const { t } = useI18n();
  const [state, setState] = useState({ action: "none" }),
    [choice, setChoice] = useState("quit"),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    api
      .invoke("queue:action")
      .then(setState)
      .catch(() => {});
    return api.on("queue:action-state", setState);
  }, []);
  useEffect(() => {
    if (state.action === "none") return;
    const timer = setInterval(() => {
      setNow(Date.now());
      api
        .invoke("queue:action")
        .then(setState)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [state.action]);
  const change = async (action) => {
    setError("");
    try {
      setState(await api.invoke("queue:action", action));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  if (banner && state.action === "none") return null;
  return (
    <section className="queue-action-bar">
      <div>
        <strong>{t("enhance.afterQueue")}</strong>
        <p role="status">
          {state.deadline
            ? t("enhance.countdown", {
                seconds: Math.max(0, Math.ceil((state.deadline - now) / 1000)),
              })
            : t(
                state.action === "none" ? "enhance.queueNote" : "enhance.armed",
              )}
        </p>
      </div>
      {state.action === "none" ? (
        <>
          <Select
            aria-label={t("enhance.afterQueue")}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {["quit", "sleep", "shutdown"].map((a) => (
              <option value={a} key={a}>
                {t(`enhance.${a}`)}
              </option>
            ))}
          </Select>
          <Button onClick={() => change(choice)}>{t("enhance.arm")}</Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => change("none")}>
          {t("enhance.cancel")}
        </Button>
      )}
      {error && <p className="error-banner">{error}</p>}
    </section>
  );
}
