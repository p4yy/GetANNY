// Text is adjusted against every surface used by controls and cards so light
// themes receive the same readability guarantees as dark themes.
function rgb(hex) {
  return hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16));
}
function luminance(hex) {
  return rgb(hex)
    .map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readable(color, surfaces, mode, target = 4.5) {
  const end = mode === "light" ? "#111111" : "#ffffff";
  const start = rgb(color),
    finish = rgb(end);
  for (let step = 0; step <= 100; step++) {
    const next =
      "#" +
      start
        .map((v, i) =>
          Math.round(v + ((finish[i] - v) * step) / 100)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (surfaces.every((s) => contrast(next, s) >= target)) return next;
  }
  return end;
}
export function themeTokens(theme) {
  const c = { ...theme.colors },
    mode = theme.mode;
  const surfaces = [
    "--bg",
    "--sidebar",
    "--panel",
    "--raised",
    "--input",
    "--accent-soft",
  ].map((k) => c[k]);
  for (const key of ["--text", "--secondary", "--muted"])
    c[key] = readable(c[key], surfaces, mode);
  c["--success"] = readable(
    mode === "light" ? "#207443" : "#8bd6a8",
    surfaces,
    mode,
  );
  c["--info"] = readable(
    mode === "light" ? "#285da6" : "#9bbfee",
    surfaces,
    mode,
  );
  c["--red"] = readable(c["--red"], surfaces, mode);
  c["--amber"] = readable(c["--amber"], surfaces, mode);
  c["--focus"] = readable(c["--accent"], surfaces, mode, 3);
  c["--accent-text"] = readable(
    c["--accent-text"],
    [c["--accent"], c["--accent-hover"]],
    mode === "light" ? "dark" : "light",
  );
  return c;
}
