import React, { useState } from "react";
import { Button, Dialog, Field } from "./ui";
import { useI18n } from "../i18n/useI18n";
import useSettingsStore from "../stores/useSettingsStore";
import { errorMessage } from "../api";
import { binding, shortcutDefaults, shortcutKey } from "../utils/shortcuts.mjs";

export default function ShortcutsDialog({ onClose }) {
  const { t } = useI18n();
  const bindings = useSettingsStore((state) => state.settings.shortcuts);
  const save = useSettingsStore((state) => state.save);
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = (id) =>
    t(`shortcuts.${id === "searchAction" ? "searchDownloads" : id}`);
  const update = async (next) => {
    setBusy(true);
    setError("");
    try {
      await save("shortcuts", next);
      setRecording(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const query = search.trim().toLocaleLowerCase();
  return (
    <Dialog title={label("title")} onClose={onClose} busy={busy}>
      <Field id="shortcut-search" label={label("search")}>
        <input
          id="shortcut-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      <div className="shortcut-groups">
        {Object.entries(shortcutDefaults).map(([scope, entries]) => {
          const actions = Object.keys(entries).filter((action) =>
            `${label(action === "search" ? "searchAction" : action)} ${label(scope)} ${binding(bindings, scope, action)}`
              .toLocaleLowerCase()
              .includes(query),
          );
          if (!actions.length) return null;
          return (
            <section key={scope}>
              <h3>{label(scope)}</h3>
              {actions.map((action) => {
                const id = `${scope}.${action}`;
                return (
                  <div className="shortcut-row" key={id}>
                    <span>
                      {label(action === "search" ? "searchAction" : action)}
                    </span>
                    <Button
                      disabled={busy}
                      variant="ghost"
                      onClick={() => setRecording(id)}
                      onKeyDown={(event) => {
                        if (recording !== id) return;
                        if (event.key === "Tab") {
                          setRecording(null);
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Escape") {
                          setRecording(null);
                          return;
                        }
                        const key = shortcutKey(event);
                        if (key) void update({ ...bindings, [id]: key });
                      }}
                    >
                      {recording === id
                        ? label("record")
                        : binding(bindings, scope, action)}
                    </Button>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} variant="ghost" onClick={() => update({})}>
        {label("reset")}
      </Button>
    </Dialog>
  );
}
