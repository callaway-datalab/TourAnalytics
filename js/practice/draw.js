/*
 * Practice visuals (update 136): the made-up hole, green and putt for each shot (with the "where to aim" heat map),
 * and the small charts on the summaries. Plain SVG, sized by viewBox, so they're sharp on any screen.
 */
import { teeValue, greenValue, puttLevels, slopeText, breakText } from "./model.js";

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
export function holeSvg(shot, { aim = null, showHeat = true, result = null, onTap = null, carry = 285, sgStart = null } = {}) {
  const half = shot.width / 2;
  const y0 = Math.max(120, Math.min(carry, shot.hole - 50) - 120), y1 = Math.min(shot.hole + 10, Math.max(carry, 200) + 60);
  const X0 = -70, W = 140, H = y1 - y0, AX = 15; // AX: the strip under the hole for the side-to-side axis
  const sy = (y) => y1 - y; // yards from the tee → svg y (down)
  const svg = svgEl("svg", { viewBox: `${X0} 0 ${W} ${H + AX}`, class: "pr-svg pr-hole", role: "img", "aria-label": `${shot.hole} yard hole, ${shot.width} yard fairway` });
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
    // (a strokes gained map, update 153: what landing there gains, against the Tour baseline from the tee)
    if (sgStart != null) {
      const f = (v) => { const g2 = sgStart - v - 1; return `${g2 >= 0 ? "+" : "\u2212"}${Math.abs(g2).toFixed(2)}`; };
      svg.appendChild(svgEl("rect", { x: X0 + 1, y: 1, width: 66, height: 8, rx: 2, fill: "rgba(0,0,0,0.55)" }));
      svg.appendChild(svgEl("text", { x: X0 + 3, y: 6.6, class: "pr-yd pr-axis sm", style: "fill:#fff" }, `Green ${f(best)} SG \u00b7 red ${f(worst)} SG`));
    }
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
  // the side-to-side axis (update 151): yards from the centre of the fairway to each edge, the rough and the trouble
  svg.appendChild(svgEl("rect", { x: X0, y: H, width: W, height: AX, fill: "#101511" }));
  svg.appendChild(svgEl("line", { x1: X0, x2: X0 + W, y1: H + 0.4, y2: H + 0.4, stroke: "rgba(255,255,255,0.35)", "stroke-width": 0.5 }));
  const marks = [[0, "#d4b483"], [-half, "#7fbf86"], [half, "#7fbf86"]];
  for (const side of ["left", "right"]) {
    const t = shot.sides[side], sgn = side === "left" ? -1 : 1;
    if (t && t.kind && t.kind !== "none" && half + t.at < -X0 - 2) marks.push([sgn * (half + t.at), t.kind === "water" ? "#5aa0d8" : t.kind === "ob" ? "#e0787f" : t.kind === "bunker" ? "#d8c597" : "#9bb59f"]);
  }
  if (shot.bunker) { const b = shot.bunker; marks.push([b.side < 0 ? -half - b.depth : half + b.depth, "#d8c597"]); }
  const seen = [];
  for (const [x, col] of marks.sort((a, b) => a[0] - b[0])) {
    svg.appendChild(svgEl("line", { x1: x, x2: x, y1: H, y2: H + 3.2, stroke: col, "stroke-width": 0.8 }));
    if (seen.some((v) => Math.abs(v - x) < 9)) continue; // (too close to the last label to read)
    seen.push(x);
    svg.appendChild(svgEl("text", { x, y: H + 9, class: "pr-yd pr-axis", "text-anchor": "middle", fill: col }, String(Math.round(Math.abs(x)))));
  }
  svg.appendChild(svgEl("text", { x: X0 + 1.5, y: H + 13.6, class: "pr-yd pr-axis sm" }, "yds from centre"));
  // the tee: you, bottom centre
  svg.appendChild(svgEl("path", { d: `M0 ${H - 0.5} l-2.4 -3.6 l4.8 0 z`, fill: "#d4b483" }));
  if (onTap) {
    svg.classList.add("tappable");
    svg.addEventListener("click", (e) => { const p = svgPoint(svg, e); if (p.y > H) return; onTap(Math.round(y1 - p.y), Math.round(p.x)); });
  }
  return svg;
}

/* ================================================ approach / around the green ================================================ */
/** The green for an approach or chip. opts: { aim, showHeat, result: {x,y}, onTap(x, y) } (yards, green centre at 0,0). */
export function greenSvg(shot, { aim = null, showHeat = true, result = null, onTap = null, sgStart = null, aimLine = false } = {}) {
  const { rx, ry } = shot.green, R0 = Math.max(rx, ry) + 12;
  // Your view (update 151): turned so the line from where you are to the pin points straight up, with you at
  // the bottom centre. Everything on the green is drawn in its own yards, then turned and slid into place.
  const vx = shot.pin.x - shot.from.x, vy = shot.pin.y - shot.from.y;
  const th = -90 - (Math.atan2(-vy, vx) * 180) / Math.PI, t = (th * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const rot = (x, y) => [x * c - y * sn, x * sn + y * c]; // (svg coords, y down)
  const [pX] = rot(shot.pin.x, -shot.pin.y);
  const R = R0 + Math.min(Math.abs(pX), R0 * 0.6), H2 = R0 + 6; // wider so the green still fits once it's slid over
  const place = (x, y) => { const [a, b] = rot(x, -y); return [a - pX, b]; }; // green yards → screen
  const svg = svgEl("svg", { viewBox: `${-R} ${-R0} ${2 * R} ${R0 + H2}`, class: "pr-svg pr-green", role: "img", "aria-label": `Green, pin ${describePin(shot)}, from ${shot.startDist} yards` });
  const Y = (y) => -y; // long = up
  svg.appendChild(svgEl("rect", { x: -R, y: -R0, width: 2 * R, height: R0 + H2, fill: "#1a2a1c" }));
  const g0 = svgEl("g", { transform: `translate(${-pX} 0) rotate(${th})` });
  svg.appendChild(g0);
  const BIG = 3 * R;
  for (const h of shot.hazards) if (h.type === "water") {
    const x = h.side > 0 ? h.from : -BIG, w = h.side > 0 ? BIG - h.from : BIG - h.from;
    g0.appendChild(svgEl("rect", { x, y: -BIG, width: w, height: 2 * BIG, fill: "#1d4a6e" }));
  }
  g0.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: rx + 1.4, ry: ry + 1.4, fill: "#2f5f37" }));
  g0.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx, ry, fill: "#3f7a46" }));
  for (const h of shot.hazards) if (h.type === "bunker") g0.appendChild(svgEl("circle", { cx: h.cx, cy: Y(h.cy), r: h.r, fill: "#d8c597", stroke: "#b9a576", "stroke-width": 0.4 }));
  if (showHeat) {
    // over the green and just round it (an oval 5 yds past the edge), coloured best → worst within that area
    const step = 1, cells = [], ex = rx + 5, ey = ry + 5;
    for (let x = -ex; x <= ex; x += step) for (let y = -ey; y <= ey; y += step) {
      const cx = x + step / 2, cy = y + step / 2;
      if ((cx / (ex + 1)) ** 2 + (cy / (ey + 1)) ** 2 > 1) continue;
      cells.push([x, y, greenValue(shot, cx, cy)]);
    }
    const vals = cells.map((q) => q[2]).sort((a, b) => a - b), best = vals[0], worst = vals[Math.floor(vals.length * 0.85)];
    const clipId = `pr-clip-${Math.random().toString(36).slice(2, 8)}`;
    g0.appendChild(svgEl("clipPath", { id: clipId }, svgEl("ellipse", { cx: 0, cy: 0, rx: ex, ry: ey })));
    const g = svgEl("g", { opacity: 0.38, class: "pr-heat", "clip-path": `url(#${clipId})`, "shape-rendering": "crispEdges" });
    for (const [x, y, v] of cells) g.appendChild(svgEl("rect", { x, y: Y(y + step), width: step + 0.05, height: step + 0.05, fill: heat(v, best, worst) }));
    g0.appendChild(g);
    if (sgStart != null) { const f = (v) => { const g2 = sgStart - v - 1; return `${g2 >= 0 ? "+" : "\u2212"}${Math.abs(g2).toFixed(2)}`; }; svg.__sgLegend = `Green ${f(best)} SG \u00b7 red ${f(worst)} SG`; }
  }
  // your target line (course prep, update 153): from where you are to the target
  if (aim && aimLine) g0.appendChild(svgEl("line", { x1: shot.from.x, y1: Y(shot.from.y), x2: aim.x, y2: Y(aim.y), stroke: "#d4b483", "stroke-width": 0.4, "stroke-dasharray": "1.2 0.8" }));
  // rings round the pin: 10, 20 and 30 ft (labelled on screen, below)
  const RINGS = [10, 20, 30];
  for (const ft of RINGS) g0.appendChild(svgEl("circle", { cx: shot.pin.x, cy: Y(shot.pin.y), r: ft / 3, fill: "none", stroke: "rgba(255,255,255,0.3)", "stroke-width": 0.25, "stroke-dasharray": "0.8 0.8" }));
  if (aim) {
    g0.appendChild(svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 1.6, fill: "none", stroke: "#d4b483", "stroke-width": 0.5 }));
    g0.appendChild(svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 0.45, fill: "#d4b483" }));
  }
  if (result && result.x != null) {
    g0.appendChild(svgEl("circle", { cx: result.x, cy: Y(result.y), r: 0.95, fill: "#fff", stroke: "#111", "stroke-width": 0.3, class: "pr-ball" }));
  }
  // the pin, upright on screen
  const [px, py] = place(shot.pin.x, shot.pin.y);
  svg.appendChild(svgEl("line", { x1: px, y1: py, x2: px, y2: py - 5.5, stroke: "#f5f5f7", "stroke-width": 0.35 }));
  svg.appendChild(svgEl("path", { d: `M${px} ${py - 5.5} l3 0.9 l-3 0.9 z`, fill: "#ff453a" }));
  svg.appendChild(svgEl("circle", { cx: px, cy: py, r: 0.45, fill: "#0b0b0c" }));
  // the rings' sizes, on the right of each ring
  for (const ft of RINGS) svg.appendChild(svgEl("text", { x: px + ft / 3 + 0.4, y: py + 0.9, class: "pr-yd pr-ring" }, `${ft}${ft === RINGS[RINGS.length - 1] ? " ft" : ""}`));
  // you: bottom centre (on the green's picture when you're that close, else at the bottom edge with the distance)
  const [fx, fy] = place(shot.from.x, shot.from.y);
  const inView = fy < H2 - 3;
  if (inView) svg.appendChild(svgEl("circle", { cx: fx, cy: fy, r: 1.1, fill: "#d4b483" }));
  const yy = inView ? fy : H2 - 1.2;
  svg.appendChild(svgEl("line", { x1: 0, y1: yy, x2: 0, y2: py + 1.5, stroke: "rgba(212,180,131,0.35)", "stroke-width": 0.3, "stroke-dasharray": "1 1" }));
  if (!inView) svg.appendChild(svgEl("path", { d: `M0 ${H2 - 4.6} l-2 3.4 l4 0 z`, fill: "#d4b483" }));
  svg.appendChild(svgEl("text", { x: 2.4, y: Math.min(H2 - 1.4, yy + 0.8), class: "pr-yd" }, `${shot.startDist} yds`));
  if (svg.__sgLegend) {
    svg.appendChild(svgEl("rect", { x: -R + 1, y: -R0 + 1, width: 34, height: 4.2, rx: 1, fill: "rgba(0,0,0,0.55)" }));
    svg.appendChild(svgEl("text", { x: -R + 2, y: -R0 + 4, class: "pr-yd pr-ring", style: "fill:#fff" }, svg.__sgLegend));
  }
  if (onTap) {
    svg.classList.add("tappable");
    // a tap on screen → back to the green's own yards
    svg.addEventListener("click", (e) => { const p = svgPoint(svg, e); const a = p.x + pX, b = p.y; const x = a * c + b * sn, y = -a * sn + b * c; onTap(f1(x), f1(-y)); });
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
  const lv = puttLevels(p), dir = Math.sign(lv.side);
  if (dir) for (let y = -6; y <= 6; y += 4) for (let x = -6; x <= 6; x += 6) svg.appendChild(svgEl("path", { d: `M${x - dir * 1.2} ${y} l${dir * 2.4} 0 m${-dir * 0.9} -0.6 l${dir * 0.9} 0.6 l${-dir * 0.9} 0.6`, stroke: "rgba(255,255,255,0.28)", "stroke-width": 0.18, fill: "none" }));
  if (lv.fwd) svg.appendChild(svgEl("text", { x: -R + 0.8, y: -R + 1.6, class: "pr-yd sm" }, `${lv.fwd > 0 ? "\u2191" : "\u2193"} ${slopeText(lv.fwd).toLowerCase()}`));
  // rings: 3 ft (should be a make) and 6 ft
  for (const ft of [3, 6]) svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: ft, fill: "none", stroke: "rgba(255,255,255,0.25)", "stroke-width": 0.08, "stroke-dasharray": "0.3 0.3" }));
  // your own aim, on one of your putting spots (update 151: no made-up read)
  if (p.myAim && (p.myAim.long || p.myAim.right)) {
    const ax = Math.max(-R + 0.4, Math.min(R - 0.4, p.myAim.right || 0)), ay = -Math.max(-R + 0.4, Math.min(R - 0.4, p.myAim.long || 0));
    svg.appendChild(svgEl("circle", { cx: ax, cy: ay, r: 0.3, fill: "none", stroke: "#d4b483", "stroke-width": 0.1 }));
    svg.appendChild(svgEl("circle", { cx: ax, cy: ay, r: 0.08, fill: "#d4b483" }));
    svg.appendChild(svgEl("text", { x: ax + 0.45, y: ay - 0.3, class: "pr-yd sm" }, "your aim"));
  }
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

/**
 * The green under the putt as a tilted plane (update 151): flat, then tipped by the break (side to side) and the
 * slope (towards / away from the hole), so you can picture it. side: + breaks left to right; fwd: + uphill.
 */
export function planeSvg(side = 0, fwd = 0) {
  const svg = svgEl("svg", { viewBox: "0 0 100 64", class: "pr-svg pr-plane", role: "img", "aria-label": `${breakText(side)}, ${slopeText(fwd)}` });
  const k = 0.1, N = 8;
  const z = (x, y) => k * fwd * y - k * side * x; // height: uphill = the far end higher; left to right = the left side higher
  const P = (x, y) => [50 + x * 30 + y * 6, 36 - y * 14 - z(x, y) * 42];
  const pts = (arr) => arr.map(([x, y]) => P(x, y).map((v) => v.toFixed(2)).join(",")).join(" ");
  // the flat green, for reference
  svg.appendChild(svgEl("polygon", { points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [50 + x * 30 + y * 6, 36 - y * 14].join(",")).join(" "), fill: "none", stroke: "rgba(255,255,255,0.25)", "stroke-width": 0.4, "stroke-dasharray": "1.2 1.2" }));
  const zs = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) zs.push(z(-1 + (2 * (i + 0.5)) / N, -1 + (2 * (j + 0.5)) / N));
  const lo = Math.min(...zs), hi = Math.max(...zs);
  for (let j = N - 1; j >= 0; j--) for (let i = 0; i < N; i++) {
    const x0 = -1 + (2 * i) / N, x1 = x0 + 2 / N, y0 = -1 + (2 * j) / N, y1 = y0 + 2 / N;
    const t = hi - lo < 1e-6 ? 0.5 : (z((x0 + x1) / 2, (y0 + y1) / 2) - lo) / (hi - lo);
    const g = Math.round(96 + t * 60), r = Math.round(46 + t * 30);
    svg.appendChild(svgEl("polygon", { points: pts([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), fill: `rgb(${r},${g},${Math.round(56 + t * 26)})`, stroke: "rgba(0,0,0,0.12)", "stroke-width": 0.2 }));
  }
  // which way it runs downhill
  if (side || fwd) {
    const len = Math.hypot(side, fwd), ux = (side / len) * 0.32, uy = (-fwd / len) * 0.32;
    for (const [cx, cy] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.45], [0.5, 0.45]]) {
      const [a, b] = P(cx - ux / 2, cy - uy / 2), [c2, d2] = P(cx + ux / 2, cy + uy / 2);
      svg.appendChild(svgEl("line", { x1: a, y1: b, x2: c2, y2: d2, stroke: "rgba(255,255,255,0.55)", "stroke-width": 0.6, "marker-end": "url(#pr-arrow)" }));
    }
    svg.insertBefore(svgEl("defs", {}, svgEl("marker", { id: "pr-arrow", viewBox: "0 0 6 6", refX: 5, refY: 3, markerWidth: 4, markerHeight: 4, orient: "auto" }, svgEl("path", { d: "M0 0 L6 3 L0 6 z", fill: "rgba(255,255,255,0.75)" }))), svg.firstChild);
  }
  // you (near end) and the hole (far end)
  const [bx, by] = P(0, -0.8), [hx, hy] = P(0, 0.8);
  svg.appendChild(svgEl("circle", { cx: bx, cy: by, r: 1.3, fill: "#fff", stroke: "#111", "stroke-width": 0.3 }));
  svg.appendChild(svgEl("ellipse", { cx: hx, cy: hy, rx: 1.5, ry: 0.8, fill: "#0b0b0c" }));
  svg.appendChild(svgEl("line", { x1: hx, y1: hy, x2: hx, y2: hy - 9, stroke: "#f5f5f7", "stroke-width": 0.35 }));
  svg.appendChild(svgEl("path", { d: `M${hx} ${hy - 9} l4 1.2 l-4 1.2 z`, fill: "#ff453a" }));
  svg.appendChild(svgEl("text", { x: 2, y: 61, class: "pr-yd" }, `${breakText(side)} \u00b7 ${slopeText(fwd)}`));
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
