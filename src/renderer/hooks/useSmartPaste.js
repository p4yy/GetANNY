import { useEffect } from "react";
import useUIStore from "../stores/useUIStore";
import { intakeLines, openLinkIntake } from "../utils/link-intake.mjs";

export default function useSmartPaste() {
  useEffect(() => {
    const paste = (event) => {
      const target = event.target;
      const editable = target.closest?.(
        'input,textarea,[contenteditable="true"]',
      );
      const value = event.clipboardData?.getData("text/plain")?.trim();
      if (!value || event.defaultPrevented) return;
      if (target.closest?.(".workflow-controls")) return;
      if (document.querySelector(".dialog") || (editable && editable.id !== "media-url")) return;
      if (editable && intakeLines(value).length > 1) return;
      if (openLinkIntake(value, useUIStore.getState(), { allowFile: !editable })) {
        event.preventDefault();
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);
}
