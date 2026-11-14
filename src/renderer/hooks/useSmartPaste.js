import { useEffect } from "react";
import useUIStore from "../stores/useUIStore";
// Handle explicit paste gestures only; never inspect the clipboard in the
// background. Ordinary text editing and multiline content keep native behavior.
export default function useSmartPaste() {
  useEffect(() => {
    const paste = (event) => {
      const target = event.target;
      const editable = target.closest?.(
        'input,textarea,[contenteditable="true"]',
      );
      const value = event.clipboardData?.getData("text/plain")?.trim();
      if (!value || /[\r\n]/.test(value)) return;
      if (target.closest?.(".workflow-controls")) return;
      if (
        editable &&
        !["url", "search"].includes(editable.type) &&
        editable.id !== "media-url"
      )
        return;
      if (document.querySelector(".dialog") && !editable) return;
      const ui = useUIStore.getState();
      if (/^magnet:\?/i.test(value)) {
        event.preventDefault();
        ui.setAddModal({ torrent: true, torrentUrl: value });
        return;
      }
      let url;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      if (!["https:", "http:"].includes(url.protocol)) return;
      const media =
        /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|soundcloud\.com)$/i.test(
          url.hostname,
        );
      if (media) {
        event.preventDefault();
        ui.setDetails(null);
        ui.setAddModal(null);
        ui.openMedia(url.href);
      } else if (!editable) {
        event.preventDefault();
        ui.setAddModal({ url: url.href });
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);
}
