// (update 750) Small charts drawn as SVG (themed by css: the mc-* classes), for Home's stories and the Stats page:
//   scatterSvg   ability against consistency: each player's average (across) against how much their rounds swing (up)
//   radarSvg     the parts of the game, two stretches overlaid (before / after)
//   pairBars     two bars side by side (before / after)
//   proxScatter  an illustration: shots round a pin, the tour's typical spread against a player's
const NS = "http://www.w3.org/2000/svg";
const mk = (tag, at = {}, txt = null) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) if (v != null) n.setAttribute(k, v); if (txt != null) n.textContent = txt; return n; };
const svgOf = (w, h, cls, label) => mk("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", class: `mc ${cls}`, role: "img", "aria-label": label });

/** pts: [{ x, y, label, hot }]; higher x better; lower y steadier. Quadrant words, the median lines, the hot ones named. */
export function scatterSvg(pts, { xLab = "Average", yLab = "Round-to-round swing", fmtX = (v) => v.toFixed(2), fmtY = (v) => `±${v.toFixed(2)}`, higherBetter = true } = {}) {
  const P = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)); if (P.length < 5) return null;
  const W = 340, H = 240, L = 52, R = 10, T = 12, B = 34;
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const px = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R), py = (v) => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - T - B); // (update 760: steadier truly lower on the page; it was upside down)
  const med = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; }, mx = med(xs), my = med(ys);
  const svg = svgOf(W, H, "mc-scatter", `${xLab} against ${yLab}`);
  svg.append(mk("rect", { x: L, y: T, width: W - L - R, height: H - T - B, class: "mc-frame" }));
  svg.append(mk("line", { x1: px(mx), x2: px(mx), y1: T, y2: H - B, class: "mc-mid" }), mk("line", { x1: L, x2: W - R, y1: py(my), y2: py(my), class: "mc-mid" }));
  const good = higherBetter ? W - R - 4 : L + 4, bad = higherBetter ? L + 4 : W - R - 4, anc = (x) => (x > W / 2 ? "end" : "start");
  svg.append(mk("text", { x: good, y: T + 11, "text-anchor": anc(good), class: "mc-q" }, "good, streaky"), mk("text", { x: good, y: H - B - 5, "text-anchor": anc(good), class: "mc-q mc-q-best" }, "good and steady"),
    mk("text", { x: bad, y: T + 11, "text-anchor": anc(bad), class: "mc-q" }, "struggling, streaky"), mk("text", { x: bad, y: H - B - 5, "text-anchor": anc(bad), class: "mc-q" }, "steady, below par"));
  for (const p of [...P].sort((a, b) => (a.hot ? 1 : 0) - (b.hot ? 1 : 0))) {
    const c = mk("circle", { cx: px(p.x).toFixed(1), cy: py(p.y).toFixed(1), r: p.hot ? 5 : 2.6, class: p.hot ? "mc-dot hot" : "mc-dot" }); c.append(mk("title", {}, `${p.label}: ${fmtX(p.x)}, ${fmtY(p.y)}`)); svg.append(c);
    if (p.hot) svg.append(mk("text", { x: (px(p.x) + (px(p.x) > W - 90 ? -8 : 8)).toFixed(1), y: (py(p.y) + 4).toFixed(1), "text-anchor": px(p.x) > W - 90 ? "end" : "start", class: "mc-name" }, p.label));
  }
  svg.append(mk("text", { x: (L + W - R) / 2, y: H - 6, "text-anchor": "middle", class: "mc-ax" }, `${xLab} →`), mk("text", { x: 10, y: (T + H - B) / 2, transform: `rotate(-90 10 ${(T + H - B) / 2})`, "text-anchor": "middle", class: "mc-ax" }, `${yLab} (lower: steadier)`));
  svg.append(mk("text", { x: L - 4, y: T + 8, "text-anchor": "end", class: "mc-tick" }, fmtY(y1)), mk("text", { x: L - 4, y: H - B, "text-anchor": "end", class: "mc-tick" }, fmtY(y0))); // (update 760: the y axis's top and bottom)
  svg.append(mk("text", { x: L, y: H - B + 12, class: "mc-tick" }, fmtX(x0)), mk("text", { x: W - R, y: H - B + 12, "text-anchor": "end", class: "mc-tick" }, fmtX(x1)));
  return svg;
}

/** axes: ["Off-the-Tee", …]; series: [{ vals: [..], cls: "a" | "b", label }]; values (strokes gained) on a −1 to +1 scale, 0 the inner ring. */
export function radarSvg(axes, series, { lo = -1, hi = 1 } = {}) {
  const W = 220, H = 200, cx = W / 2, cy = 100, R = 72, n = axes.length; if (n < 3) return null;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n, rad = (v) => R * Math.max(0.04, Math.min(1, (v - lo) / (hi - lo)));
  const svg = svgOf(W, H, "mc-radar", "Before against after, by part of the game");
  for (const f of [0.25, 0.5, 0.75, 1]) svg.append(mk("polygon", { points: axes.map((_, i) => `${(cx + R * f * Math.cos(ang(i))).toFixed(1)},${(cy + R * f * Math.sin(ang(i))).toFixed(1)}`).join(" "), class: f === 0.5 ? "mc-ring mc-zero" : "mc-ring" }));
  axes.forEach((a, i) => { svg.append(mk("line", { x1: cx, y1: cy, x2: (cx + R * Math.cos(ang(i))).toFixed(1), y2: (cy + R * Math.sin(ang(i))).toFixed(1), class: "mc-ring" }));
    const tx = cx + (R + 12) * Math.cos(ang(i)), ty = cy + (R + 12) * Math.sin(ang(i)) + 3; svg.append(mk("text", { x: tx.toFixed(1), y: ty.toFixed(1), "text-anchor": Math.abs(Math.cos(ang(i))) < 0.3 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end", class: "mc-ax" }, String(a).split("\n")[0]));
    const l2 = String(a).split("\n")[1]; if (l2) svg.append(mk("text", { x: tx.toFixed(1), y: (ty + 10).toFixed(1), "text-anchor": Math.abs(Math.cos(ang(i))) < 0.3 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end", class: "mc-ax mc-ax-v" }, l2)); }); // (update 760: the value on a line of its own)
  for (const s of series) { const p = mk("polygon", { points: s.vals.map((v, i) => `${(cx + rad(v) * Math.cos(ang(i))).toFixed(1)},${(cy + rad(v) * Math.sin(ang(i))).toFixed(1)}`).join(" "), class: `mc-area ${s.cls}` }); p.append(mk("title", {}, s.label || "")); svg.append(p); }
  return svg;
}

/** Two bars (before, after) with their values; signed (strokes gained) when either is below zero. */
export function pairBars(a, b, { la = "Before", lb = "Now", fmt = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) } = {}) {
  const W = 220, H = 128, top = 16, bot = 36, vs = [a, b], lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc;
  const svg = svgOf(W, H, "mc-pair", `${la} ${fmt(a)}, ${lb} ${fmt(b)}`);
  [[a, la, "a"], [b, lb, "b"]].forEach(([v, l, c], i) => { const x = 40 + i * 90, h = Math.max(1.5, Math.abs(v) * sc), y = v >= 0 ? y0 - h : y0;
    svg.append(bar0(mk, { x, y: y.toFixed(1), width: 50, height: h.toFixed(1), rx: 3, class: `mc-bar ${c} ${v >= 0 ? "up" : "down"}` }, v >= 0), mk("text", { x: x + 25, y: (v >= 0 ? y - 4 : y + h + 11).toFixed(1), "text-anchor": "middle", class: "mc-val" }, fmt(v)), mk("text", { x: x + 25, y: H - 5, "text-anchor": "middle", class: "mc-ax" }, l)); });
  svg.append(mk("line", { x1: 20, x2: W - 20, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "mc-mid" }));
  return svg;
}

/** An illustration: 24 shots round a pin at a player's typical distance from it, with the tour's typical ring (feet). */
export function proxScatter(tourFt, mineFt, { seed = 1, who = "This player", aLab = "tour" } = {}) {
  if (!(tourFt > 0) || !(mineFt > 0)) return null;
  const W = 220, H = 200, cx = W / 2, cy = 96, M = Math.max(tourFt, mineFt) * 1.35, k = 80 / M;
  let s = Math.floor(seed * 2147483646) + 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const svg = svgOf(W, H, "mc-prox", `Illustration: ${who} about ${Math.round(mineFt)} ft from the hole, ${aLab} about ${Math.round(tourFt)} ft`);
  svg.append(mk("circle", { cx, cy, r: (tourFt * k).toFixed(1), class: "mc-ring mc-tour" }), mk("circle", { cx, cy, r: (mineFt * k).toFixed(1), class: "mc-ring mc-mine" }));
  for (let i = 0; i < 24; i++) { const a = rnd() * 2 * Math.PI, r = mineFt * k * Math.sqrt(-2 * Math.log(Math.max(1e-6, rnd()))) * 0.85; svg.append(mk("circle", { cx: (cx + r * Math.cos(a)).toFixed(1), cy: (cy + r * Math.sin(a) * 0.8).toFixed(1), r: 2.4, class: "mc-dot" })); }
  svg.append(mk("circle", { cx, cy, r: 3, class: "mc-pin" }), mk("line", { x1: cx, y1: cy, x2: cx, y2: cy - 18, class: "mc-flag" }));
  svg.append(mk("text", { x: 6, y: H - 20, class: "mc-ax" }, `— ${aLab} ~${Math.round(tourFt)} ft`), mk("text", { x: 6, y: H - 7, class: "mc-ax mc-mine-t" }, `— ${who} ~${Math.round(mineFt)} ft`), mk("text", { x: W - 6, y: H - 7, "text-anchor": "end", class: "mc-ax" }, "illustration"));
  return svg;
}

/** (update 751) Pairs of bars, one pair a group (e.g. a distance range): a (before) and b (now), signed values. */
export function groupBars(groups, { la = "Before", lb = "Now", fmt = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) } = {}) {
  const G = groups.filter((g) => g.a != null || g.b != null); if (!G.length) return null;
  const W = Math.max(300, G.length * 70 + 30), H = 196, top = 18, bot = 38, L = 14;
  const vs = G.flatMap((g) => [g.a ?? 0, g.b ?? 0]), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc, gw = (W - L * 2) / G.length, bw = Math.min(22, gw * 0.34);
  const svg = svgOf(W, H, "mc-group", `${la} against ${lb}`);
  G.forEach((g, i) => { const gx = L + i * gw + gw / 2;
    [[g.a, "a", -1], [g.b, "b", 1]].forEach(([v, c, side]) => { if (v == null) return; const h = Math.max(1.5, Math.abs(v) * sc), x = gx + (side < 0 ? -bw - 1 : 1), y = v >= 0 ? y0 - h : y0;
      const r = bar0(mk, { x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), rx: 2, class: `mc-bar ${c} ${v >= 0 ? "up" : "down"}` }, v >= 0); r.append(mk("title", {}, `${g.label} · ${c === "a" ? la : lb}: ${fmt(v)}`)); svg.append(r);
      svg.append(mk("text", { x: (x + bw / 2).toFixed(1), y: (v >= 0 ? y - 3 : y + h + 10).toFixed(1), "text-anchor": "middle", class: "mc-val mc-val-s" }, fmt(v))); });
    svg.append(mk("text", { x: gx.toFixed(1), y: H - 6, "text-anchor": "middle", class: "mc-ax" }, g.label)); }); // (update 760: under the values, never over them)
  svg.append(mk("line", { x1: L, x2: W - L, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "mc-mid" }));
  return svg;
}

/** (update 760) a bar square on the zero line, rounded only at its far end: a <path> in place of a <rect> (the same other
 * attributes). up: the bar rises from zero (else it hangs below it); side: true for a bar going right from zero. */
export function bar0(mkFn, attrs, up = true, side = false) {
  const { x, y, width, height, rx = 0, ry, ...rest } = attrs; void ry;
  const X = +x, Y = +y, w = +width, h = +height, r = Math.max(0, Math.min(+rx || 0, w / 2, h / 2)), f = (n) => +n.toFixed(2);
  let d;
  if (!r) d = `M${f(X)},${f(Y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
  else if (side) d = up ? `M${f(X)},${f(Y)}H${f(X + w - r)}Q${f(X + w)},${f(Y)} ${f(X + w)},${f(Y + r)}V${f(Y + h - r)}Q${f(X + w)},${f(Y + h)} ${f(X + w - r)},${f(Y + h)}H${f(X)}Z`
    : `M${f(X + w)},${f(Y)}H${f(X + r)}Q${f(X)},${f(Y)} ${f(X)},${f(Y + r)}V${f(Y + h - r)}Q${f(X)},${f(Y + h)} ${f(X + r)},${f(Y + h)}H${f(X + w)}Z`;
  else d = up ? `M${f(X)},${f(Y + h)}V${f(Y + r)}Q${f(X)},${f(Y)} ${f(X + r)},${f(Y)}H${f(X + w - r)}Q${f(X + w)},${f(Y)} ${f(X + w)},${f(Y + r)}V${f(Y + h)}Z`
    : `M${f(X)},${f(Y)}H${f(X + w)}V${f(Y + h - r)}Q${f(X + w)},${f(Y + h)} ${f(X + w - r)},${f(Y + h)}H${f(X + r)}Q${f(X)},${f(Y + h)} ${f(X)},${f(Y + h - r)}Z`;
  return mkFn("path", { d, ...rest });
}
