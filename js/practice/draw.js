/*
 * Practice visuals (update 136): the made-up hole, green and putt for each shot (with the "where to aim" heat map),
 * and the small charts on the summaries. Plain SVG, sized by viewBox, so they're sharp on any screen.
 */
import { teeValue, greenValue, puttRead } from "./model.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const k of [].concat(kids)) if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return n;
};
const f1 = (v) => Math.round(v * 10) / 10;
// strokes → colour for the heat map: green (best) → amber → red (worst), relative to the best spot
function heat(v, best, worst) {
  const t = Math.max(0, Math.min(1, (v - best) / Math.max(0.05, worst - best)));
  const r = Math.round(48 + t * (255 - 48)), g = Math.round(209 - t * (209 - 69)), b = Math.round(88 - t * (88 - 58));
  return `rgb(${r},${g},${b})`;
}
/** Convert a tap on an svg to its viewBox coordinates. */
function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  const e = evt.touches?.[0] || evt.changedTouches?.[0] || evt;
  pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM();
  return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}

/* ======================================================= off the tee ======================================================= */
/**
 * The hole for a tee shot. opts: { aim: {x,y}, showHeat, result: {total, offline}, onTap(total, offline), carry }
 * x is yards left (−) / right (+) of the target line; drawn with the tee at the bottom.
 */
export function holeSvg(shot, { aim = null, showHeat = true, result = null, onTap = null, carry = 285 } = {}) {
  const half = shot.width / 2;
  const y0 = Math.max(120, Math.min(carry, shot.hole - 50) - 120), y1 = Math.min(shot.hole + 10, Math.max(carry, 200) + 60);
  const X0 = -70, W = 140, H = y1 - y0;
  const sy = (y) => y1 - y; // yards from the tee → svg y (down)
  const svg = svgEl("svg", { viewBox: `${X0} 0 ${W} ${H}`, class: "pr-svg pr-hole", role: "img", "aria-label": `${shot.hole} yard hole, ${shot.width} yard fairway` });
  svg.appendChild(svgEl("rect", { x: X0, y: 0, width: W, height: H, fill: "#17251a" }));
  // the two sides past the fairway: rough, then the trouble
  for (const side of ["left", "right"]) {
    const t = shot.sides[side], s = side === "left" ? -1 : 1, edge = half + t.at;
    const x = s < 0 ? X0 : edge, w = s < 0 ? -edge - X0 : X0 + W - edge;
    if (t.kind === "water") svg.appendChild(svgEl("rect", { x, y: 0, width: w, height: H, fill: "#1d4a6e" }));
    if (t.kind === "ob") {
      svg.appendChild(svgEl("rect", { x, y: 0, width: w, height: H, fill: "url(#pr-ob)" }));
      for (let yy = 8; yy < H; yy += 22) svg.appendChild(svgEl("rect", { x: s * edge - 0.9, y: yy, width: 1.8, height: 6, fill: "#f5f5f7" }));
    }
    if (t.kind === "trees") for (let yy = 6; yy < H; yy += 13) for (let k = 0; k < 3; k++) svg.appendChild(svgEl("circle", { cx: s * (edge + 5 + k * 9 + ((yy / 13) % 2) * 4), cy: yy, r: 5, fill: "#0e1d11", stroke: "#24402a", "stroke-width": 0.6 }));
    if (t.kind === "bunker") svg.appendChild(svgEl("rect", { x: s < 0 ? -edge - 16 : edge, y: 10, width: 16, height: H - 20, rx: 6, fill: "#c9b48a", opacity: 0.85 }));
  }
  const defs = svgEl("defs", {}, svgEl("pattern", { id: "pr-ob", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, [
    svgEl("rect", { width: 6, height: 6, fill: "#2a1416" }), svgEl("rect", { width: 2, height: 6, fill: "#4a1d22" })]));
  svg.insertBefore(defs, svg.firstChild);
  // the fairway, and a bunker by it
  svg.appendChild(svgEl("rect", { x: -half, y: 0, width: shot.width, height: H, fill: "#2d5a35" }));
  for (let yy = 0; yy < H; yy += 20) svg.appendChild(svgEl("rect", { x: -half, y: yy, width: shot.width, height: 10, fill: "#33653c", opacity: 0.6 }));
  if (shot.bunker) {
    const b = shot.bunker, bx = b.side < 0 ? -half - b.depth : half - 4;
    svg.appendChild(svgEl("rect", { x: bx, y: sy(b.y1), width: b.depth + 4, height: b.y1 - b.y0, rx: 5, fill: "#d8c597" }));
  }
  // where to aim: the heat map (strokes left after the drive) over the landing area
  if (showHeat) {
    const cells = [], step = 4;
    for (let y = Math.max(y0, (carry || 280) - 45); y <= Math.min(y1, (carry || 280) + 40); y += step)
      for (let x = X0; x < X0 + W; x += step) cells.push([x, y, teeValue(shot, x + step / 2, y + step / 2)]);
    const vals = cells.map((c) => c[2]).sort((a, b) => a - b), best = vals[0], worst = vals[Math.floor(vals.length * 0.92)];
    const g = svgEl("g", { opacity: 0.42, class: "pr-heat" });
    for (const [x, y, v] of cells) g.appendChild(svgEl("rect", { x, y: sy(y + step), width: step, height: step, fill: heat(v, best, worst) }));
    svg.appendChild(g);
  }
  // yardage lines
  for (let y = Math.ceil(y0 / 25) * 25; y <= y1; y += 25) {
    svg.appendChild(svgEl("line", { x1: -half, x2: half, y1: sy(y), y2: sy(y), stroke: "rgba(255,255,255,0.18)", "stroke-width": 0.5, "stroke-dasharray": "2 2" }));
    svg.appendChild(svgEl("text", { x: half + 2, y: sy(y) + 2, class: "pr-yd" }, String(y)));
  }
  // the aim line and point
  if (aim) {
    svg.appendChild(svgEl("line", { x1: 0, y1: H + 4, x2: aim.x, y2: sy(aim.y), stroke: "#d4b483", "stroke-width": 0.9, "stroke-dasharray": "3 2" }));
    svg.appendChild(svgEl("circle", { cx: aim.x, cy: sy(aim.y), r: 3.4, fill: "none", stroke: "#d4b483", "stroke-width": 1.2 }));
    svg.appendChild(svgEl("circle", { cx: aim.x, cy: sy(aim.y), r: 0.9, fill: "#d4b483" }));
  }
  if (result) {
    const cx = Math.max(X0 + 2, Math.min(X0 + W - 2, result.offline)), cy = sy(Math.max(y0 + 1, Math.min(y1 - 1, result.total)));
    svg.appendChild(svgEl("circle", { cx, cy, r: 2.6, fill: "#fff", stroke: "#111", "stroke-width": 0.8, class: "pr-ball" }));
  }
  if (onTap) {
    svg.classList.add("tappable");
    svg.addEventListener("click", (e) => { const p = svgPoint(svg, e); onTap(Math.round(y1 - p.y), Math.round(p.x)); });
  }
  return svg;
}

/* ================================================ approach / around the green ================================================ */
/** The green for an approach or chip. opts: { aim, showHeat, result: {x,y}, onTap(x, y) } (yards, green centre at 0,0). */
export function greenSvg(shot, { aim = null, showHeat = true, result = null, onTap = null } = {}) {
  const { rx, ry } = shot.green, R = Math.max(rx, ry) + 12;
  const svg = svgEl("svg", { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: "pr-svg pr-green", role: "img", "aria-label": `Green, pin ${describePin(shot)}` });
  const Y = (y) => -y; // long = up
  svg.appendChild(svgEl("rect", { x: -R, y: -R, width: 2 * R, height: 2 * R, fill: "#1a2a1c" }));
  for (const h of shot.hazards) if (h.type === "water") {
    const x = h.side > 0 ? h.from : -R, w = h.side > 0 ? R - h.from : R - h.from;
    svg.appendChild(svgEl("rect", { x, y: -R, width: w, height: 2 * R, fill: "#1d4a6e" }));
  }
  svg.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: rx + 1.4, ry: ry + 1.4, fill: "#2f5f37" }));
  svg.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx, ry, fill: "#3f7a46" }));
  for (const h of shot.hazards) if (h.type === "bunker") svg.appendChild(svgEl("circle", { cx: h.cx, cy: Y(h.cy), r: h.r, fill: "#d8c597", stroke: "#b9a576", "stroke-width": 0.4 }));
  if (showHeat) {
    // over the green and just round it (an oval 5 yds past the edge), coloured best → worst within that area
    const step = 1, cells = [], ex = rx + 5, ey = ry + 5;
    for (let x = -ex; x <= ex; x += step) for (let y = -ey; y <= ey; y += step) {
      const cx = x + step / 2, cy = y + step / 2;
      if ((cx / (ex + 1)) ** 2 + (cy / (ey + 1)) ** 2 > 1) continue;
      cells.push([x, y, greenValue(shot, cx, cy)]);
    }
    const vals = cells.map((c) => c[2]).sort((a, b) => a - b), best = vals[0], worst = vals[Math.floor(vals.length * 0.85)];
    const clipId = `pr-clip-${Math.random().toString(36).slice(2, 8)}`;
    svg.appendChild(svgEl("clipPath", { id: clipId }, svgEl("ellipse", { cx: 0, cy: 0, rx: ex, ry: ey })));
    const g = svgEl("g", { opacity: 0.38, class: "pr-heat", "clip-path": `url(#${clipId})`, "shape-rendering": "crispEdges" });
    for (const [x, y, v] of cells) g.appendChild(svgEl("rect", { x, y: Y(y + step), width: step + 0.05, height: step + 0.05, fill: heat(v, best, worst) }));
    svg.appendChild(g);
  }
  // rings round the pin: 10, 20 and 30 ft
  for (const ft of [10, 20, 30]) svg.appendChild(svgEl("circle", { cx: shot.pin.x, cy: Y(shot.pin.y), r: ft / 3, fill: "none", stroke: "rgba(255,255,255,0.22)", "stroke-width": 0.25, "stroke-dasharray": "0.8 0.8" }));
  // the pin
  svg.appendChild(svgEl("line", { x1: shot.pin.x, y1: Y(shot.pin.y), x2: shot.pin.x, y2: Y(shot.pin.y) - 5.5, stroke: "#f5f5f7", "stroke-width": 0.35 }));
  svg.appendChild(svgEl("path", { d: `M${shot.pin.x} ${Y(shot.pin.y) - 5.5} l3 0.9 l-3 0.9 z`, fill: "#ff453a" }));
  svg.appendChild(svgEl("circle", { cx: shot.pin.x, cy: Y(shot.pin.y), r: 0.45, fill: "#0b0b0c" }));
  // where you're playing from
  const fx = shot.from.x, fy = shot.from.y, d = Math.hypot(fx - shot.pin.x, fy - shot.pin.y);
  const inView = Math.abs(fx) < R - 2 && Math.abs(fy) < R - 2;
  const ux = (fx - shot.pin.x) / d, uy = (fy - shot.pin.y) / d;
  const ex = inView ? fx : shot.pin.x + ux * Math.min(d, R * 0.92), ey = inView ? fy : shot.pin.y + uy * Math.min(d, R * 0.92);
  if (inView) svg.appendChild(svgEl("circle", { cx: fx, cy: Y(fy), r: 1.1, fill: "#d4b483" }));
  else svg.appendChild(svgEl("path", { d: `M${ex} ${Y(ey)} l${-ux * 4 - uy * 1.6} ${uy * 4 - ux * 1.6} M${ex} ${Y(ey)} l${-ux * 4 + uy * 1.6} ${uy * 4 + ux * 1.6}`, stroke: "#d4b483", "stroke-width": 0.6, fill: "none" }));
  svg.appendChild(svgEl("text", { x: Math.max(-R + 2, Math.min(R - 14, ex + 2.5)), y: Math.max(-R + 4, Math.min(R - 1.5, Y(ey) + 1)), class: "pr-yd" }, `${shot.startDist} yds`));
  if (aim) {
    svg.appendChild(svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 1.6, fill: "none", stroke: "#d4b483", "stroke-width": 0.5 }));
    svg.appendChild(svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 0.45, fill: "#d4b483" }));
  }
  if (result && result.x != null) {
    const cx = Math.max(-R + 1, Math.min(R - 1, result.x)), cy = Y(Math.max(-R + 1, Math.min(R - 1, result.y)));
    svg.appendChild(svgEl("circle", { cx, cy, r: 0.95, fill: "#fff", stroke: "#111", "stroke-width": 0.3, class: "pr-ball" }));
  }
  if (onTap) {
    svg.classList.add("tappable");
    svg.addEventListener("click", (e) => { const p = svgPoint(svg, e); onTap(f1(p.x), f1(-p.y)); });
  }
  return svg;
}
export function describePin(shot) {
  const { rx, ry } = shot.green, { x, y } = shot.pin;
  const fb = y > ry * 0.3 ? "back" : y < -ry * 0.3 ? "front" : "middle", lr = x > rx * 0.3 ? "right" : x < -rx * 0.3 ? "left" : "";
  return fb === "middle" && !lr ? "middle" : [fb, lr].filter(Boolean).join("-");
}

/* ======================================================= putting ======================================================= */
/** The hole and the last few feet round it, the break shown with arrows. opts: { result: {x,y}, onTap(x, y) } (feet). */
export function puttSvg(p, { result = null, onTap = null, stimp = 11 } = {}) {
  const R = 9;
  const svg = svgEl("svg", { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: "pr-svg pr-putt", role: "img", "aria-label": `${p.startDist} foot putt` });
  svg.appendChild(svgEl("rect", { x: -R, y: -R, width: 2 * R, height: 2 * R, fill: "#3f7a46" }));
  for (let i = -R; i < R; i += 1.5) svg.appendChild(svgEl("rect", { x: i, y: -R, width: 0.75, height: 2 * R, fill: "#447f4b", opacity: 0.5 }));
  // the fall line: arrows the way the ball breaks
  const dir = p.breakDir === "lr" ? 1 : p.breakDir === "rl" ? -1 : 0;
  if (dir) for (let y = -6; y <= 6; y += 4) for (let x = -6; x <= 6; x += 6) svg.appendChild(svgEl("path", { d: `M${x - dir * 1.2} ${y} l${dir * 2.4} 0 m${-dir * 0.9} -0.6 l${dir * 0.9} 0.6 l${-dir * 0.9} 0.6`, stroke: "rgba(255,255,255,0.28)", "stroke-width": 0.18, fill: "none" }));
  if (p.slope !== "flat") svg.appendChild(svgEl("text", { x: -R + 0.8, y: -R + 1.6, class: "pr-yd sm" }, p.slope === "up" ? "↑ uphill" : "↓ downhill"));
  // rings: 3 ft (should be a make) and 6 ft
  for (const ft of [3, 6]) svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: ft, fill: "none", stroke: "rgba(255,255,255,0.25)", "stroke-width": 0.08, "stroke-dasharray": "0.3 0.3" }));
  // the aim (outside the hole by the read)
  const rd = puttRead(p, stimp), aimX = (rd.aimSide === "left" ? -1 : 1) * rd.aimIn / 12;
  if (rd.aimIn) svg.appendChild(svgEl("circle", { cx: aimX, cy: 0, r: 0.22, fill: "none", stroke: "#d4b483", "stroke-width": 0.08 }));
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 0.18, fill: "#0b0b0c" }));
  // where the putt comes from
  svg.appendChild(svgEl("path", { d: `M0 ${R - 0.4} l-0.8 -1.2 m0.8 1.2 l0.8 -1.2`, stroke: "#d4b483", "stroke-width": 0.12, fill: "none" }));
  svg.appendChild(svgEl("text", { x: 0.6, y: R - 0.6, class: "pr-yd sm" }, `${p.startDist} ft`));
  if (result && result.x != null) svg.appendChild(svgEl("circle", { cx: Math.max(-R + 0.3, Math.min(R - 0.3, result.x)), cy: Math.max(-R + 0.3, Math.min(R - 0.3, -result.y)), r: 0.14, fill: "#fff", stroke: "#111", "stroke-width": 0.04, class: "pr-ball" }));
  if (onTap) {
    svg.classList.add("tappable");
    svg.addEventListener("click", (e) => { const q = svgPoint(svg, e); onTap(f1(q.x), f1(-q.y)); });
  }
  return svg;
}

/* ======================================================= charts ======================================================= */
/** Dots on a plain field (a dispersion pattern). pts: [{x, y, good}] in the given units; target at (0,0). */
export function scatterSvg(pts, { range = 30, unit = "ft", rings = [10, 20, 30], label = "" } = {}) {
  const R = range;
  const svg = svgEl("svg", { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: "pr-svg pr-scatter", role: "img", "aria-label": label || "Where the shots finished" });
  svg.appendChild(svgEl("rect", { x: -R, y: -R, width: 2 * R, height: 2 * R, fill: "#141416" }));
  for (const r of rings) {
    svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r, fill: "none", stroke: "rgba(255,255,255,0.12)", "stroke-width": R / 140 }));
    svg.appendChild(svgEl("text", { x: r * 0.71 + R / 60, y: -r * 0.71, class: "pr-yd", style: `font-size:${R / 14}px` }, `${r}${unit === "ft" ? "′" : ""}`));
  }
  svg.appendChild(svgEl("line", { x1: -R, x2: R, y1: 0, y2: 0, stroke: "rgba(255,255,255,0.08)", "stroke-width": R / 200 }));
  svg.appendChild(svgEl("line", { y1: -R, y2: R, x1: 0, x2: 0, stroke: "rgba(255,255,255,0.08)", "stroke-width": R / 200 }));
  for (const p of pts) svg.appendChild(svgEl("circle", { cx: Math.max(-R, Math.min(R, p.x)), cy: Math.max(-R, Math.min(R, -p.y)), r: R / 50, fill: p.good ? "rgba(48,209,88,0.8)" : "rgba(212,180,131,0.8)" }));
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: R / 70, fill: "#fff" }));
  return svg;
}

/** Tee shots: offline (x) against distance (y), with the fairway width shaded. pts: [{x (offline), y (total), good}] */
export function driveScatterSvg(pts, { width = 32 } = {}) {
  const ys = pts.map((p) => p.y), lo = Math.min(220, ...ys) - 10, hi = Math.max(320, ...ys) + 10, W = 120;
  const svg = svgEl("svg", { viewBox: `${-W / 2} 0 ${W} ${hi - lo}`, class: "pr-svg pr-scatter", role: "img", "aria-label": "Where your drives finished" });
  svg.appendChild(svgEl("rect", { x: -W / 2, y: 0, width: W, height: hi - lo, fill: "#17251a" }));
  svg.appendChild(svgEl("rect", { x: -width / 2, y: 0, width, height: hi - lo, fill: "#2d5a35" }));
  for (let y = Math.ceil(lo / 25) * 25; y < hi; y += 25) {
    svg.appendChild(svgEl("line", { x1: -W / 2, x2: W / 2, y1: hi - y, y2: hi - y, stroke: "rgba(255,255,255,0.1)", "stroke-width": 0.4 }));
    svg.appendChild(svgEl("text", { x: -W / 2 + 1.5, y: hi - y - 1, class: "pr-yd" }, String(y)));
  }
  for (const p of pts) svg.appendChild(svgEl("circle", { cx: Math.max(-W / 2, Math.min(W / 2, p.x)), cy: hi - p.y, r: 1.7, fill: p.good ? "rgba(48,209,88,0.85)" : "rgba(212,180,131,0.85)" }));
  return svg;
}

/** SG per shot, one point per session, with a zero line. vals: [{ label, v }] */
export function trendSvg(vals, { height = 120 } = {}) {
  const W = 320, H = height, pad = 18, n = vals.length;
  const ys = vals.map((d) => d.v), lo = Math.min(-0.2, ...ys), hi = Math.max(0.2, ...ys);
  const X = (i) => pad + (n <= 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1)), Y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "pr-svg pr-trend", role: "img", "aria-label": "Strokes gained per shot, session by session" });
  svg.appendChild(svgEl("line", { x1: pad, x2: W - pad, y1: Y(0), y2: Y(0), stroke: "rgba(255,255,255,0.25)", "stroke-width": 0.8, "stroke-dasharray": "3 3" }));
  svg.appendChild(svgEl("text", { x: W - pad, y: Y(0) - 3, class: "pr-yd", "text-anchor": "end" }, "Tour baseline"));
  if (n > 1) svg.appendChild(svgEl("polyline", { points: vals.map((d, i) => `${X(i)},${Y(d.v)}`).join(" "), fill: "none", stroke: "#d4b483", "stroke-width": 1.6, "stroke-linejoin": "round" }));
  vals.forEach((d, i) => svg.appendChild(svgEl("circle", { cx: X(i), cy: Y(d.v), r: 2.6, fill: d.v >= 0 ? "#30d158" : "#ff453a" }, svgEl("title", {}, `${d.label}: ${d.v >= 0 ? "+" : ""}${d.v.toFixed(2)}`))));
  svg.appendChild(svgEl("text", { x: pad, y: 11, class: "pr-yd" }, `${hi >= 0 ? "+" : ""}${hi.toFixed(2)}`));
  svg.appendChild(svgEl("text", { x: pad, y: H - 4, class: "pr-yd" }, lo.toFixed(2)));
  return svg;
}
