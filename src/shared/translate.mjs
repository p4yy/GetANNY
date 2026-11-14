export function translate(resources, code, key, values = {}) {
  const table = resources[code] || resources.en;
  // Fallback to English keeps newly added strings readable instead of showing
  // raw translation keys when a locale has not caught up yet.
  const template = table[key] ?? resources.en[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}
