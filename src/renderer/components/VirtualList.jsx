import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

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
  const [viewport, setViewport] = useState({ top: 0, height: 520 });
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const update = () =>
      setViewport((old) => ({ ...old, height: node.clientHeight || 520 }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const offsets = useMemo(() => {
    const result = new Array(items.length + 1);
    result[0] = 0;
    for (let i = 0; i < items.length; i++)
      result[i + 1] =
        result[i] + (heights.current.get(getKey(items[i])) || estimate);
    return result;
  }, [items, getKey, estimate]);
  let start = 0;
  while (start < items.length && offsets[start + 1] < viewport.top) start++;
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
      onScroll={(event) =>
        setViewport((old) => ({ ...old, top: event.currentTarget.scrollTop }))
      }
    >
      <div
        style={{ height: offsets[first], position: "relative" }}
        aria-hidden="true"
      />
      {visible.map((item, index) => {
        const absoluteIndex = first + index;
        return (
          <MeasuredRow
            key={getKey(item)}
            itemKey={getKey(item)}
            onMeasure={(height) => {
              if (
                Math.abs(
                  (heights.current.get(getKey(item)) || estimate) - height,
                ) < 2
              )
                return;
              heights.current.set(getKey(item), height);
              // A ResizeObserver update rerenders through a tiny host state change.
              setViewport((old) => ({ ...old }));
            }}
          >
            {renderItem(item, absoluteIndex)}
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
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      onMeasure(
        entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height,
      ),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [itemKey, onMeasure]);
  return <div ref={ref}>{children}</div>;
}
