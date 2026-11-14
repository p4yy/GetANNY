export function indexAtOffset(offsets, position) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= position) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, offsets.length - 2);
}

export function addRange(rows, from, to, initial) {
  const next = new Set(initial);
  if (from < 0 || to < 0) return next;
  for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
    if (rows[index]) next.add(rows[index].id);
  }
  return next;
}
