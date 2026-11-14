import { useEffect, useRef, useState } from "react";
import { addRange } from "../utils/download-selection.mjs";

function scrollHost(list) {
  for (let element = list; element; element = element.parentElement) {
    if (
      /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight
    )
      return element;
  }
  return document.scrollingElement;
}

export function useDownloadMarquee({
  rows,
  selected,
  setSelected,
  virtual,
  visible,
}) {
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [band, setBand] = useState(null);
  const start = (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.target.closest(
        "button, a, input, select, textarea, [draggable='true']",
      )
    )
      return;
    const list = event.currentTarget;
    const scroller = virtual.current?.element || scrollHost(list);
    if (!scroller || !rows.length) return;
    drag.current = {
      id: event.pointerId,
      list,
      scroller,
      x: event.clientX,
      y: event.clientY,
      startScroll: scroller.scrollTop,
      baseline: event.ctrlKey || event.metaKey ? selected : [],
      startedSelected: selected.size > 0,
      moved: false,
    };
  };

  useEffect(() => {
    if (!visible) return;
    let animation = 0;
    const draw = () => {
      animation = 0;
      const state = drag.current;
      if (!state?.moved) return;
      const windowed = virtual.current;
      const clip =
        state.scroller === document.scrollingElement
          ? { top: 0, bottom: innerHeight }
          : state.scroller.getBoundingClientRect();
      const bounds = state.list.getBoundingClientRect();
      const scroll = state.scroller.scrollTop;
      const origin = state.y + state.startScroll - scroll;
      const top = Math.max(clip.top, Math.min(origin, state.currentY));
      const bottom = Math.min(clip.bottom, Math.max(origin, state.currentY));
      const left = Math.max(bounds.left, Math.min(state.x, state.currentX));
      const right = Math.min(
        bounds.right,
        Math.max(state.x, state.currentX, left + 1),
      );
      if (right > left && bottom > top) {
        setBand({ left, top, width: right - left, height: bottom - top });
        if (windowed) {
          const range = windowed.rangeAt(
            Math.min(origin, state.currentY),
            Math.max(origin, state.currentY),
          );
          setSelected(
            addRange(latestRows.current, range[0], range[1], state.baseline),
          );
        } else {
          const next = new Set(state.baseline);
          for (const row of state.list.querySelectorAll(
            "[data-download-row]",
          )) {
            const bounds = row.getBoundingClientRect();
            if (
              bounds.right > left &&
              bounds.left < right &&
              bounds.bottom > top &&
              bounds.top < bottom
            )
              next.add(row.dataset.downloadRow);
          }
          setSelected(next);
        }
      }
      const speed =
        state.currentY < clip.top + 24
          ? -18
          : state.currentY > clip.bottom - 24
            ? 18
            : 0;
      if (speed) {
        state.scroller.scrollTop += speed;
        if (state.scroller.scrollTop !== scroll)
          animation = requestAnimationFrame(draw);
      }
    };
    const move = (event) => {
      const state = drag.current;
      if (event.pointerId !== state?.id) return;
      if (
        !state.moved &&
        Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6
      )
        return;
      event.preventDefault();
      if (!state.moved) window.getSelection()?.removeAllRanges();
      state.moved = true;
      state.currentX = event.clientX;
      state.currentY = event.clientY;
      if (!animation) animation = requestAnimationFrame(draw);
    };
    const stop = (event) => {
      const state = drag.current;
      if (event.pointerId !== state?.id) return;
      if (state.moved) {
        if (animation) cancelAnimationFrame(animation);
        draw();
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
      drag.current = null;
      setBand(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (animation) cancelAnimationFrame(animation);
    };
  }, [setSelected, virtual, visible]);

  return {
    band,
    showToolbar: !band || drag.current?.startedSelected,
    start,
    captureClick(event) {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
