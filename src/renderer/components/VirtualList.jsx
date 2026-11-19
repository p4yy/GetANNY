import React, {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { indexAtOffset } from "../utils/download-selection.mjs";

// Variable-height windowing for long download and playlist views. Heights are
// measured from rendered rows and retained by stable item key.
export default function VirtualList({
  items,
  getKey,
  estimate = 112,
  renderItem,
  className = "",
  navigationRef,
  pinnedIndex,
  scrollParent,
}) {
  const host = useRef(null);
  const heights = useRef(new Map());
  const getKeyRef = useRef(getKey);
  const renderItemRef = useRef(renderItem);
  const viewportRef = useRef({ top: 0, height: 520 });
  const [, renderMeasurements] = useState(0);
  const [measurements, setMeasurements] = useState(0);
  const setViewport = useCallback((update) => {
    const next =
      typeof update === "function" ? update(viewportRef.current) : update;
    if (next === viewportRef.current) return;
    viewportRef.current = next;
    renderMeasurements((value) => value + 1);
  }, []);
  getKeyRef.current = getKey;
  renderItemRef.current = renderItem;
  const onMeasure = useCallback(
    (itemKey, height) => {
      if (Math.abs((heights.current.get(itemKey) || estimate) - height) < 2)
        return;
      heights.current.set(itemKey, height);
      setMeasurements((value) => value + 1);
    },
    [estimate],
  );
  const scrollFrame = useRef(0);
  const viewport = viewportRef.current;
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const external = scrollParent ? node.closest(scrollParent) : null;
    const update = () => {
      if (!external) {
        setViewport({ top: node.scrollTop, height: node.clientHeight || 520 });
        return;
      }
      const offset = external.getBoundingClientRect().top - node.getBoundingClientRect().top;
      setViewport((old) => {
        const top = Math.max(0, offset);
        const height = Math.max(0, external.clientHeight + Math.min(0, offset));
        return old.top === top && old.height === height ? old : { top, height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (external) {
      observer.observe(external);
      external.addEventListener("scroll", update, { passive: true });
    }
    return () => {
      observer.disconnect();
      external?.removeEventListener("scroll", update);
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    };
  }, [scrollParent, setViewport]);
  const offsets = useMemo(() => {
    const result = new Array(items.length + 1);
    result[0] = 0;
    for (let i = 0; i < items.length; i++)
      result[i + 1] =
        result[i] +
        (heights.current.get(getKeyRef.current(items[i])) || estimate);
    return result;
  }, [items, estimate, measurements]);
  useImperativeHandle(
    navigationRef,
    () => ({
      get element() {
        return host.current;
      },
      scrollToIndex(index) {
        const element = host.current;
        if (!element || offsets[index] === undefined) return;
        const top = offsets[index];
        const bottom = offsets[index + 1];
        if (top < element.scrollTop) element.scrollTop = top;
        else if (bottom > element.scrollTop + element.clientHeight)
          element.scrollTop = bottom - element.clientHeight;
        setViewport((old) =>
          old.top === element.scrollTop
            ? old
            : { ...old, top: element.scrollTop },
        );
      },
      rangeAt(top, bottom) {
        const element = host.current;
        if (!element || !items.length) return [-1, -1];
        const origin = element.getBoundingClientRect().top - element.scrollTop;
        if (bottom <= origin || top >= origin + offsets.at(-1)) return [-1, -1];
        return [
          indexAtOffset(offsets, top - origin),
          indexAtOffset(offsets, bottom - origin - 0.01),
        ];
      },
    }),
    [offsets, items.length, setViewport],
  );
  const start = Math.max(0, indexAtOffset(offsets, viewport.top));
  let end = start;
  const limit = viewport.top + viewport.height + estimate * 8;
  while (end < items.length && offsets[end] < limit) end++;
  const mounted = [];
  const first = Math.max(0, start - 4);
  for (let index = first; index < end; index++) mounted.push(index);
  if (
    Number.isInteger(pinnedIndex) &&
    pinnedIndex >= 0 &&
    pinnedIndex < items.length
  ) {
    if (pinnedIndex < first) mounted.unshift(pinnedIndex);
    else if (pinnedIndex >= end) mounted.push(pinnedIndex);
  }
  let previousEnd = 0;
  const windowedRows = mounted.flatMap((index) => {
    const item = items[index];
    const itemKey = getKeyRef.current(item);
    const gap = offsets[index] - previousEnd;
    previousEnd = offsets[index + 1];
    return [
      ...(gap > 0
        ? [
            <div
              key={`gap-${index}`}
              style={{ height: gap }}
              aria-hidden="true"
            />,
          ]
        : []),
      <MeasuredRow key={itemKey} itemKey={itemKey} onMeasure={onMeasure}>
        {renderItemRef.current(item, index)}
      </MeasuredRow>,
    ];
  });
  return (
    <div
      ref={host}
      className={className}
      onScroll={scrollParent ? undefined : (event) => {
        const top = event.currentTarget.scrollTop;
        if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = 0;
          setViewport((old) => (old.top === top ? old : { ...old, top }));
        });
      }}
    >
      {windowedRows}
      <div
        style={{ height: offsets[items.length] - previousEnd }}
        aria-hidden="true"
      />
    </div>
  );
}

function MeasuredRow({ itemKey, onMeasure, children }) {
  const ref = useRef(null);
  const measureRef = useRef(onMeasure);
  measureRef.current = onMeasure;
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      measureRef.current(
        itemKey,
        entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height,
      ),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [itemKey]);
  return <div ref={ref}>{children}</div>;
}
