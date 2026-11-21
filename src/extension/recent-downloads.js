(() => {
  "use strict";
  const CLEARED_BEFORE_KEY = "getanny:popup:recent-cleared-before";
  const HIDDEN_IDS_KEY = "getanny:popup:recent-hidden-ids";
  const MAX_HIDDEN_IDS = 2000;

  function fromStorage(values = {}) {
    const cutoff = Number(values[CLEARED_BEFORE_KEY]);
    const ids = Array.isArray(values[HIDDEN_IDS_KEY])
      ? values[HIDDEN_IDS_KEY].filter((id) => Number.isSafeInteger(id) && id >= 0).slice(-MAX_HIDDEN_IDS)
      : [];
    return {
      clearedBefore: Number.isFinite(cutoff) && cutoff > 0 ? cutoff : 0,
      hiddenIds: [...new Set(ids)],
    };
  }

  function startTime(item) {
    if (typeof item?.startTime === "number") return item.startTime;
    const value = Date.parse(item?.startTime || "");
    return Number.isFinite(value) ? value : null;
  }

  function visible(items, state) {
    const hidden = new Set(state.hiddenIds);
    return items.filter((item) => {
      if (Number.isSafeInteger(Number(item.id)) && hidden.has(Number(item.id))) return false;
      const started = startTime(item);
      return started === null || started > state.clearedBefore;
    });
  }

  function hide(state, id) {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 0) throw new TypeError("Invalid browser download ID.");
    return {
      ...state,
      hiddenIds: [...new Set([...state.hiddenIds, numericId])].slice(-MAX_HIDDEN_IDS),
    };
  }

  function clear(state, items, now = Date.now()) {
    if (!Number.isFinite(now) || now <= 0) throw new TypeError("Invalid clear timestamp.");
    const ids = items.map((item) => item.id).filter((id) => Number.isSafeInteger(id) && id >= 0);
    return {
      clearedBefore: Math.max(state.clearedBefore, now),
      hiddenIds: [...new Set([...state.hiddenIds, ...ids])].slice(-MAX_HIDDEN_IDS),
    };
  }

  globalThis.GetANNYRecentDownloads = Object.freeze({
    CLEARED_BEFORE_KEY,
    HIDDEN_IDS_KEY,
    fromStorage,
    visible,
    hide,
    clear,
  });
})();
