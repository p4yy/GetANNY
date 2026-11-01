import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Variable-height windowing for long download and playlist views. Heights are
// measured from rendered rows and retained by stable item key.
export default function VirtualList({
  items,
  getKey,
  estimate = 112,
  renderItem,
  className = "",
}) {
  const host = useRef(null);
  const heights = useRef(new Map());
  const getKeyRef = useRef(getKey);
  const renderItemRef = useRef(renderItem);
  const viewportRef = useRef({ top: 0, height: 520 });
  const [, renderMeasurements] = useState(0);
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
      setViewport((old) => ({ ...old }));
    },
    [estimate],
  );
  const scrollFrame = useRef(0);
  const viewport = viewportRef.current;
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const update = () =>
      setViewport((old) => ({ ...old, height: node.clientHeight || 520 }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);
  const offsets = useMemo(() => {
    const result = new Array(items.length + 1);
    result[0] = 0;
    for (let i = 0; i < items.length; i++)
      result[i + 1] =
        result[i] +
        (heights.current.get(getKeyRef.current(items[i])) || estimate);
    return result;
  }, [items, estimate]);
  // Find the first visible row in logarithmic time for long libraries.
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle + 1] < viewport.top) low = middle + 1;
    else high = middle;
  }
  const start = low;
  let end = start;
  const limit = viewport.top + viewport.height + estimate * 8;
  while (end < items.length && offsets[end] < limit) end++;
  const visible = items.slice(
    Math.max(0, start - 4),
    Math.min(items.length, end),
  );
  const first = Math.max(0, start - 4);
  return (
    <div
      ref={host}
      className={className}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = 0;
          setViewport((old) => (old.top === top ? old : { ...old, top }));
        });
      }}
    >
      <div
        style={{ height: offsets[first], position: "relative" }}
        aria-hidden="true"
      />
      {visible.map((item, index) => {
        const absoluteIndex = first + index;
        return (
          <MeasuredRow
            key={getKeyRef.current(item)}
            itemKey={getKeyRef.current(item)}
            onMeasure={onMeasure}
          >
            {renderItemRef.current(item, absoluteIndex)}
          </MeasuredRow>
        );
      })}
      <div
        style={{
          height: offsets[items.length] - offsets[Math.min(items.length, end)],
          position: "relative",
        }}
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
