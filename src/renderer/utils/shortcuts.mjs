import defaults from "../../shared/shortcuts.json";

export const shortcutDefaults = defaults;

export function shortcutKey(event) {
  if (event.isComposing || event.key === "Dead") return null;
  const key =
    event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;
  if (
    !/^(?:[a-z0-9,.;/]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Space|Home|End|PageUp|PageDown)$/.test(
      key,
    )
  )
    return null;
  return [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function binding(overrides, scope, action) {
  return overrides?.[`${scope}.${action}`] ?? defaults[scope][action];
}

export function shortcutAction(event, overrides, scope) {
  const key = shortcutKey(event);
  return Object.keys(defaults[scope]).find(
    (action) => binding(overrides, scope, action) === key,
  );
}
