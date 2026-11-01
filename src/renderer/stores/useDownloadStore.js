import { create } from "zustand";

// Download metadata changes infrequently. Keep high-frequency transfer values
// separate so a progress tick only notifies the row that owns that transfer.
const useDownloadStore = create((set) => ({
  downloads: [],
  progressById: {},
  setDownloads: (downloads) =>
    set((state) => {
      const liveIds = new Set(downloads.map((item) => item.id));
      const statusById = new Map(
        downloads.map((item) => [item.id, item.status]),
      );
      const progressById = {};
      for (const [id, progress] of Object.entries(state.progressById))
        if (liveIds.has(id)) {
          const stillLive = [
            "connecting",
            "downloading",
            "processing",
          ].includes(statusById.get(id));
          if (stillLive) progressById[id] = progress;
        }
      return { downloads, progressById };
    }),
  update: (id, data) =>
    set((state) => {
      if (!state.downloads.some((item) => item.id === id)) return state;
      const previous = state.progressById[id] || {};
      const next = { ...previous, ...data };
      if (
        previous &&
        Object.keys(data).every((key) => Object.is(previous[key], data[key]))
      )
        return state;
      return {
        progressById: { ...state.progressById, [id]: next },
      };
    }),
}));

export default useDownloadStore;
