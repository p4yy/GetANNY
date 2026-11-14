import { create } from "zustand";

// Download metadata changes infrequently. Keep high-frequency transfer values
// separate so a progress tick only notifies the row that owns that transfer.
const useDownloadStore = create((set) => ({
  downloads: [],
  downloadsById: new Map(),
  progressById: {},
  setDownloads: (downloads) =>
    set((state) => {
      const downloadsById = new Map(downloads.map((item) => [item.id, item]));
      const progressById = {};
      for (const [id, progress] of Object.entries(state.progressById)) {
        const status = downloadsById.get(id)?.status;
        if (status === "connecting" || status === "downloading" || status === "processing")
          progressById[id] = progress;
      }
      return { downloads, downloadsById, progressById };
    }),
  update: (id, data) =>
    set((state) => {
      if (!state.downloadsById.has(id)) return state;
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
