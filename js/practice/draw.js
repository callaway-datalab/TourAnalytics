/*
 * Practice visuals (update 136): the made-up hole, green and putt for each shot (with the "where to aim" heat map),
 * and the small charts on the summaries. Plain SVG, sized by viewBox, so they're sharp on any screen.
 */
import { teeValue, greenValue, puttLevels, fallOf, fallText, clockOf, FALL_SEV, fairwayX, holeSpot, startExpected, teeResult, surfaceAt } from "./model.js";
import { expectedStrokes } from "../roundCalc.js";
import { sceneDefs, rng, seedOf, PAL, blob, smoothPath, bunker, tree, flag, ball, vignette, pill } from "./scene.js";

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
export function holeSvg(shot, { aim = null, showHeat = true, result = null, onTap = null, carry = 285, sgStart = null, onAim = null, trail = null, full = false, preview = null, pinLine = false } = {}) {
  const half = shot.width / 2;
  const y0 = full ? -8 : Math.max(120, Math.min(carry, shot.hole - 50) - 120), y1 = full ? holeSpot(shot).y + 22 : Math.min(shot.hole + 10, Math.max(carry, 200) + 60);
  const cx = (y) => fairwayX(shot, y); // the middle of the fairway (a dogleg bends it)
  const bend = cx(y1);
  const X0 = Math.min(-70, bend - 70), W = Math.max(70, bend + 70) - X0, H = y1 - y0, AX = 15; // AX: the strip under the hole for the side-to-side axis
  const sy = (y) => y1 - y; // yards from the tee → svg y (down)
  const svg = svgEl("svg", { viewBox: `${X0} 0 ${W} ${H + AX}`, class: "pr-svg pr-hole", role: "img", "aria-label": `${shot.hole} yard hole, ${shot.width} yard fairway${shot.dogleg ? `, dogleg ${shot.dogleg.dir < 0 ? "left" : "right"}` : ""}` });
  // ---- the course (update 155: a flyover look) ----
  const ids = sceneDefs(svg, { grain: 1.5, relief: 0.03 });
  const rand = rng(seedOf(shot.hole, shot.width, shot.sides.left.at, shot.sides.right.at, shot.dogleg?.at || 0));
  const land = svgEl("g", { filter: ids.url("grass") });
  svg.appendChild(land);
  land.appendChild(svgEl("rect", { x: X0, y: -2, width: W, height: H + 4, fill: PAL.rough }));
  // deeper rough further out, in soft drifts
  for (let k = 0; k < 7; k++) land.appendChild(svgEl("path", { d: blob(X0 + rand() * W, rand() * H, 14 + rand() * 18, 20 + rand() * 30, rand, { wobble: 0.25 }), fill: PAL.roughDeep, opacity: 0.55 }));
  const edgePts = (side, at) => { const sg = side === "left" ? -1 : 1, pts = []; for (let y = y0 - 4; y <= y1 + 4; y += 4) pts.push([cx(y) + sg * (half + at) + (rand() - 0.5) * 1.2, sy(y)]); return pts; };
  const deco = svgEl("g");
  for (const side of ["left", "right"]) {
    const t = shot.sides[side], sg = side === "left" ? -1 : 1, out = sg < 0 ? X0 - 4 : X0 + W + 4;
    if (t.kind === "water") {
      const e = edgePts(side, t.at), poly = [...e, [out, e.at(-1)[1]], [out, e[0][1]]];
      const d = `M${poly.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join(" L")} Z`;
      land.appendChild(svgEl("path", { d, fill: "none", stroke: "#6b6a3a", "stroke-width": 3.2, "stroke-linejoin": "round", opacity: 0.6 })); // the bank
      deco.appendChild(svgEl("path", { d, fill: ids.url("waterG"), filter: ids.url("water") }));
      deco.appendChild(svgEl("path", { d: smoothPath(e, false), fill: "none", stroke: "rgba(255,255,255,0.28)", "stroke-width": 0.5, transform: `translate(${sg * 1.3} 0)` }));
    }
    if (t.kind === "ob") {
      const e = edgePts(side, t.at), poly = [...e, [out, e.at(-1)[1]], [out, e[0][1]]];
      land.appendChild(svgEl("path", { d: `M${poly.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join(" L")} Z`, fill: "#3b2a1d", opacity: 0.38 }));
      for (let y = Math.ceil(y0 / 18) * 18; y < y1; y += 18) {
        const x = cx(y) + sg * (half + t.at), yy = sy(y);
        deco.appendChild(svgEl("ellipse", { cx: x + 0.9, cy: yy + 1, rx: 0.9, ry: 0.5, fill: "#000", opacity: 0.5, filter: ids.url("shadow") }));
        deco.appendChild(svgEl("rect", { x: x - 0.55, y: yy - 2.6, width: 1.1, height: 2.8, rx: 0.3, fill: "#f4f4f2" }));
      }
    }
    if (t.kind === "trees") for (let y = y0 - 6; y < y1 + 6; y += 7 + rand() * 4) for (let k = 0; k < 4; k++) {
      const x = cx(y) + sg * (half + t.at + 4 + k * 8.5 + rand() * 4);
      if ((sg < 0 && x < X0 - 6) || (sg > 0 && x > X0 + W + 6)) continue;
      tree(deco, x, sy(y) + (rand() - 0.5) * 4, 3.6 + rand() * 2.6, ids, rand);
    }
    if (t.kind === "bunker") {
      for (let y = y0 + rand() * 20; y < y1; y += 34 + rand() * 18) {
        const x = cx(y) + sg * (half + t.at + 7);
        bunker(deco, blob(x, sy(y), 6 + rand() * 3, 11 + rand() * 6, rand, { wobble: 0.22, n: 11 }), ids);
      }
    }
  }
  // the fairway: first cut round it, then the fairway with its mowing stripes
  const fw = [];
  for (let y = y0 - 6; y <= y1 + 6; y += 6) fw.push([cx(y) - half + (rand() - 0.5) * 0.8, sy(y)]);
  for (let y = y1 + 6; y >= y0 - 6; y -= 6) fw.push([cx(y) + half + (rand() - 0.5) * 0.8, sy(y)]);
  const fwD = smoothPath(fw);
  land.appendChild(svgEl("path", { d: fwD, fill: PAL.cut, stroke: PAL.cut, "stroke-width": 5, "stroke-linejoin": "round" }));
  land.appendChild(svgEl("path", { d: fwD, fill: ids.url("fwG") }));
  const clip = svgEl("clipPath", { id: ids.id("fwclip") }, svgEl("path", { d: fwD }));
  svg.appendChild(clip);
  const stripes = svgEl("g", { "clip-path": `url(#${ids.id("fwclip")})` });
  for (let y = Math.floor(y0 / 12) * 12; y < y1 + 12; y += 12) stripes.appendChild(svgEl("rect", { x: X0, y: sy(y + 6), width: W, height: 6, fill: "#fff", opacity: 0.07 }));
  land.appendChild(stripes);
  if (shot.bunker) {
    const b = shot.bunker, c = cx((b.y0 + b.y1) / 2), bx = b.side < 0 ? c - half - b.depth / 2 + 1.5 : c + half + b.depth / 2 - 1.5;
    bunker(deco, blob(bx, sy((b.y0 + b.y1) / 2), b.depth / 2 + 1, (b.y1 - b.y0) / 2, rand, { wobble: 0.18, n: 12 }), ids);
  }
  // the green, when it's in view
  const hs = holeSpot(shot);
  if (hs.y <= y1 + 14) {
    deco.appendChild(svgEl("path", { d: blob(hs.x, sy(hs.y), 16, 14, rand, { wobble: 0.08 }), fill: PAL.collar }));
    deco.appendChild(svgEl("path", { d: blob(hs.x, sy(hs.y), 14, 12, rand, { wobble: 0.08 }), fill: ids.url("greenG"), filter: ids.url("grass") }));
    flag(deco, hs.x, sy(hs.y), 9, ids);
  }
  svg.appendChild(deco);
  // the strokes gained map (update 154): what each landing spot gains against the Tour baseline from the tee, by distance and lie
  if (showHeat) {
    // (update 160) water, dense forest and out of bounds: dark red; the rest has its pockets (see pocketAt)
    const cells = [], obCells = [], step = 3, base = sgStart ?? expectedStrokes(shot.startLie || "Tee box", shot.hole);
    for (let y = Math.max(y0, 120); y < y1; y += step)
      for (let x = X0; x < X0 + W; x += step) { if (teeResult(shot, y + step / 2, x + step / 2).penalty) { obCells.push([x, y]); continue; } cells.push([x, y, base - teeValue(shot, x + step / 2, y + step / 2) - 1]); }
    const g = svgEl("g", { opacity: 0.45, class: "pr-heat", filter: ids.url("soft"), "pointer-events": "none" });
    for (const [x, y, v] of cells) g.appendChild(svgEl("rect", { x, y: sy(y + step), width: step + 0.1, height: step + 0.1, fill: sgColor(v) }));
    svg.appendChild(g);
    const gOb = svgEl("g", { opacity: 0.72, class: "pr-heat pr-heat-ob", "pointer-events": "none" });
    for (const [x, y] of obCells) gOb.appendChild(svgEl("rect", { x, y: sy(y + step), width: step + 0.1, height: step + 0.1, fill: OB_RED }));
    svg.appendChild(gOb);
  }
  vignette(svg, X0, 0, W, H, ids);
  if (showHeat) svg.appendChild(sgKey(X0 + 1, 1, 5, true));
  // yardage lines (straight from the tee)
  for (let y = Math.ceil(y0 / 25) * 25; y <= y1; y += 25) {
    const c = cx(y);
    svg.appendChild(svgEl("line", { x1: c - half, x2: c + half, y1: sy(y), y2: sy(y), stroke: "rgba(255,255,255,0.32)", "stroke-width": 0.35, "stroke-dasharray": "1.5 1.5" }));
    pill(svg, c + half + 2.5, sy(y) + 1.2, String(y), 3.6);
  }
  // (update 157) the break-even line: a drive that finishes in the fairway past here gains strokes on the Tour baseline
  if (!full) {
    const base = sgStart ?? expectedStrokes(shot.startLie || "Tee box", shot.hole);
    let yz = null;
    for (let y = 80; y < shot.hole - 15; y += 1) if (base - teeValue(shot, cx(y), y) - 1 >= 0) { yz = y; break; }
    if (yz != null && yz > y0 + 2 && yz < y1 - 2) {
      const c = cx(yz);
      svg.appendChild(svgEl("line", { x1: c - half - 1, x2: c + half + 1, y1: sy(yz), y2: sy(yz), stroke: "#f5c542", "stroke-width": 0.9, "stroke-dasharray": "2.6 1.6", class: "pr-zero" }));
      pill(svg, c - half - 2.5, sy(yz) + 1.2, `0 SG \u00b7 ${yz}`, 3.4, { color: "#f5c542", anchor: "end" });
    }
  }
  // the target line and point
  if (aim) {
    const ln = svgEl("line", { x1: 0, y1: sy(0) < H ? sy(0) : H + 4, x2: aim.x, y2: sy(aim.y), stroke: "#d4b483", "stroke-width": 0.9, "stroke-dasharray": "3 2" });
    const ring = svgEl("circle", { cx: aim.x, cy: sy(aim.y), r: 3.4, fill: "none", stroke: "#d4b483", "stroke-width": 1.2 });
    const dot = svgEl("circle", { cx: aim.x, cy: sy(aim.y), r: 0.9, fill: "#d4b483" });
    // (update 160) a round's made-up hole: a grey line on from the target to the pin, and each line's length halfway along it
    const pinG = pinLine ? svgEl("g", { class: "pr-pinline", "pointer-events": "none" }) : null;
    const drawPin = (ax, ay) => { // (yards: across, from the tee)
      if (!pinG) return;
      while (pinG.firstChild) pinG.firstChild.remove();
      const hs = holeSpot(shot), top = y1 - 4, bot = Math.max(0, y0 + 2);
      // the grey line, up to where it leaves the picture
      const t = hs.y > top && hs.y > ay ? Math.max(0, (top - ay) / (hs.y - ay)) : 1, ex = ax + (hs.x - ax) * t, ey = ay + (hs.y - ay) * t;
      const toPin = Math.round(Math.hypot(hs.x - ax, hs.y - ay)), toAim = Math.round(Math.hypot(ax, ay));
      if (toPin >= 2) {
        pinG.appendChild(svgEl("line", { x1: ax, y1: sy(ay), x2: ex, y2: sy(ey), stroke: "#c7c7cc", "stroke-width": 0.9, "stroke-dasharray": "3 2", opacity: 0.9 }));
        pill(pinG, (ax + ex) / 2 + 2.5, sy((ay + ey) / 2) + 1.2, `${toPin} yds`, 3.6, { color: "#e5e5ea" });
      }
      // the gold line's length, halfway along the part you can see
      const my = (Math.max(bot, 0) + ay) / 2, mx = ay > 0 ? (ax * my) / ay : 0;
      if (my > y0) pill(pinG, mx + 2.5, sy(my) + 1.2, `${toAim} yds`, 3.6, { color: "#d4b483" });
    };
    svg.append(ln, ...(pinG ? [pinG] : []), ring, dot);
    drawPin(aim.x, aim.y);
    // (update 156) hold the end of the target line and drag it
    if (onAim) dragAim(svg, [ring, dot], (x, y) => { ln.setAttribute("x2", x); ln.setAttribute("y2", y); drawPin(x, y1 - y); }, (p) => [p.x, p.y], (p) => onAim(Math.round(p.x), Math.round(y1 - p.y)), 7);
  }
  // the shots so far on this hole (course prep, update 156): where each one finished, joined up
  if (trail?.length) {
    const pts = [[0, sy(0)], ...trail.map((q) => [q.x, sy(q.y)])];
    svg.appendChild(svgEl("polyline", { points: pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" "), fill: "none", stroke: "#fff", "stroke-width": 0.9, "stroke-dasharray": "2.4 1.6", opacity: 0.85 }));
    trail.forEach((q) => { ball(svg, q.x, sy(q.y), q.on ? 2.6 : 1.9, ids); if (q.label) pill(svg, q.x + 3.2, sy(q.y) + 1.2, q.label, 3.2, { color: q.on ? "#d4b483" : "#fff" }); });
  }
  if (result) ball(svg, Math.max(X0 + 2, Math.min(X0 + W - 2, result.offline)), sy(Math.max(y0 + 1, Math.min(y1 - 1, result.total))), 1.6, ids);
  if (!full) previewDot(svg, (p) => [Math.max(X0 + 2, Math.min(X0 + W - 2, p.x)), sy(Math.max(y0 + 1, Math.min(y1 - 1, p.y)))], 1.5, preview);
  // the side-to-side axis (update 151): yards from the centre of the fairway to each edge, the rough and the trouble
  svg.appendChild(svgEl("rect", { x: X0, y: H, width: W, height: AX, fill: "#101511" }));
  svg.appendChild(svgEl("line", { x1: X0, x2: X0 + W, y1: H + 0.4, y2: H + 0.4, stroke: "rgba(255,255,255,0.35)", "stroke-width": 0.5 }));
  const marks = [[0, "#d4b483"], [-half, "#7fbf86"], [half, "#7fbf86"]];
  for (const side of ["left", "right"]) {
    const t = shot.sides[side], sgn = side === "left" ? -1 : 1;
    if (t && t.kind && t.kind !== "none" && half + t.at < 68) marks.push([sgn * (half + t.at), t.kind === "water" ? "#5aa0d8" : t.kind === "ob" ? "#e0787f" : t.kind === "bunker" ? "#d8c597" : "#9bb59f"]);
  }
  if (shot.bunker) { const b = shot.bunker; marks.push([b.side < 0 ? -half - b.depth : half + b.depth, "#d8c597"]); }
  const seen = [];
  for (const [x, col] of marks.sort((a, b) => a[0] - b[0])) {
    svg.appendChild(svgEl("line", { x1: x, x2: x, y1: H, y2: H + 3.2, stroke: col, "stroke-width": 0.8 }));
    if (seen.some((v) => Math.abs(v - x) < 9)) continue;
    seen.push(x);
    svg.appendChild(svgEl("text", { x, y: H + 9, class: "pr-yd pr-axis", "text-anchor": "middle", fill: col }, String(Math.round(Math.abs(x)))));
  }
  svg.appendChild(svgEl("text", { x: X0 + 1.5, y: H + 13.6, class: "pr-yd pr-axis sm" }, "yds from centre"));
  svg.appendChild(svgEl("path", { d: `M0 ${H - 0.5} l-2.4 -3.6 l4.8 0 z`, fill: "#d4b483" }));
  if (onTap) {
    svg.classList.add("tappable");
    svg.addEventListener("click", (e) => { if (svg.__dragged) return; const p = svgPoint(svg, e); if (p.y > H) return; onTap(Math.round(y1 - p.y), Math.round(p.x)); });
  }
  return svg;
}

/**
 * (update 157) A red dot where the hit distance and offline you've typed put the ball, moved as you type:
 * svg.__preview({ x, y }) in the picture's own units (null hides it).
 */
function previewDot(svg, toScreen, r, at = null) {
  const g = svgEl("g", { class: "pr-preview", "pointer-events": "none", visibility: "hidden" });
  const halo = svgEl("circle", { r: r * 1.9, fill: "rgba(255,59,48,0.25)" }), dot = svgEl("circle", { r, fill: "#ff3b30", stroke: "#fff", "stroke-width": r * 0.35 });
  g.append(halo, dot);
  svg.appendChild(g);
  svg.__preview = (pt) => {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { g.setAttribute("visibility", "hidden"); return; }
    const [x, y] = toScreen(pt);
    for (const c of [halo, dot]) { c.setAttribute("cx", x.toFixed(2)); c.setAttribute("cy", y.toFixed(2)); }
    g.setAttribute("visibility", "visible");
  };
  if (at) svg.__preview(at);
}

/** Drag the target's end: shapes move with the pointer (move(x, y) updates anything else), done(point) on release. */
function dragAim(svg, shapes, move, toLocal, done, r) {
  const [ring] = shapes;
  const handle = svgEl("circle", { cx: ring.getAttribute("cx"), cy: ring.getAttribute("cy"), r, fill: "transparent", class: "pr-aim-handle" });
  ring.parentNode.appendChild(handle);
  let on = false;
  // (update 160) on a phone, holding the target and dragging moved the whole page: the touch is kept for the drag
  handle.style.touchAction = "none";
  const stopScroll = (e) => { if (on && e.cancelable) e.preventDefault(); };
  handle.addEventListener("touchstart", (e) => { if (e.cancelable) e.preventDefault(); on = true; }, { passive: false });
  handle.addEventListener("touchmove", stopScroll, { passive: false }); // (a touch's moves all go to where it started)
  handle.addEventListener("pointerdown", (e) => { on = true; handle.setPointerCapture?.(e.pointerId); e.preventDefault(); e.stopPropagation(); });
  handle.addEventListener("pointermove", (e) => {
    if (!on) return;
    const [x, y] = toLocal(svgPoint(svg, e));
    for (const sh of [...shapes, handle]) { sh.setAttribute("cx", x); sh.setAttribute("cy", y); }
    move(x, y);
  });
  const end = (e) => {
    if (!on) return;
    on = false; svg.__dragged = true; setTimeout(() => { svg.__dragged = false; }, 60);
    done(svgPoint(svg, e));
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", (e) => { if (on && e.pointerType === "touch") end(e); on = false; });

  handle.addEventListener("click", (e) => e.stopPropagation());
}

/** Strokes gained → colour: deep green (gains a lot) → yellow (about even) → red (costs). */
export function sgColor(v) {
  const stops = [[-0.5, [214, 40, 40]], [-0.25, [238, 128, 44]], [0, [240, 210, 60]], [0.25, [130, 200, 70]], [0.5, [28, 150, 68]]];
  if (v <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
    return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
  }
  return `rgb(${stops.at(-1)[1]})`;
}
/** The key for the strokes gained map. */
const OB_RED = "#6e0a10"; // (update 160) out of bounds (and water, dense forest) on the strokes gained map
function sgKey(x, y, h, ob = false) {
  const g = svgEl("g", { class: "pr-sgkey" });
  const vals = [-0.5, -0.25, 0, 0.25, 0.5], w = h * 1.6, extra = ob ? h * 4.6 : 0;
  g.appendChild(svgEl("rect", { x, y, width: w * vals.length + h * 9 + extra, height: h * 1.7, rx: h * 0.3, fill: "rgba(0,0,0,0.6)" }));
  vals.forEach((v, i) => g.appendChild(svgEl("rect", { x: x + h * 0.4 + i * w, y: y + h * 0.35, width: w, height: h, fill: sgColor(v) })));
  g.appendChild(svgEl("text", { x: x + h * 0.8 + vals.length * w, y: y + h * 1.15, class: "pr-yd", style: `font-size:${h * 0.8}px;fill:#fff` }, "\u22120.5 \u00b7 0 \u00b7 +0.5 SG"));
  if (ob) {
    const ox = x + h * 0.4 + vals.length * w + h * 8.4;
    g.appendChild(svgEl("rect", { x: ox, y: y + h * 0.35, width: w, height: h, fill: OB_RED }));
    g.appendChild(svgEl("text", { x: ox + w + h * 0.3, y: y + h * 1.15, class: "pr-yd", style: `font-size:${h * 0.8}px;fill:#fff` }, "OB"));
  }
  return g;
}

/* ================================================ approach / around the green ================================================ */
/** The green for an approach or chip. opts: { aim, showHeat, result: {x,y}, onTap(x, y) } (yards, green centre at 0,0). */
export function greenSvg(shot, { aim = null, showHeat = true, result = null, onTap = null, sgStart = null, aimLine = false, onAim = null, preview = null, pinLine = false } = {}) {
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
  // ---- the course (update 155: a flyover look) ----
  const ids = sceneDefs(svg, { grain: 4.5, relief: 0.06, bump: 1.1 });
  const rand = rng(seedOf(rx, ry, shot.pin.x, shot.pin.y, shot.hazards.length));
  const BIG = 3 * R;
  const g0 = svgEl("g", { transform: `translate(${-pX} 0) rotate(${th})` });
  svg.appendChild(g0);
  const land = svgEl("g", { filter: ids.url("grass") });
  g0.appendChild(land);
  land.appendChild(svgEl("rect", { x: -BIG, y: -BIG, width: 2 * BIG, height: 2 * BIG, fill: PAL.rough }));
  for (let k = 0; k < 6; k++) land.appendChild(svgEl("path", { d: blob((rand() - 0.5) * 2 * R0, (rand() - 0.5) * 2 * R0, 5 + rand() * 7, 6 + rand() * 9, rand, { wobble: 0.3 }), fill: PAL.roughDeep, opacity: 0.5 }));
  // the fairway running up to the green from where you are (an approach), with its stripes
  {
    const fx0 = shot.from.x, fy0 = shot.from.y, L = Math.hypot(-fx0, -fy0) || 1, ux = -fx0 / L, uy = -fy0 / L, w = Math.min(rx, 14);
    if (shot.cat !== "ARG" || L > Math.max(rx, ry) + 6) {
      const ex = -ux * (ry * 0.6), ey = -uy * (ry * 0.6), sx = fx0 - ux * 20, sy0 = fy0 - uy * 20;
      const pts = [[sx - uy * w, sy0 + ux * w], [ex - uy * w * 0.9, ey + ux * w * 0.9], [ex + uy * w * 0.9, ey - ux * w * 0.9], [sx + uy * w, sy0 - ux * w]].map(([a, b]) => [a, Y(b)]);
      land.appendChild(svgEl("path", { d: `M${pts.map((q) => q.map((v) => v.toFixed(2)).join(" ")).join(" L")} Z`, fill: PAL.fairway, stroke: PAL.cut, "stroke-width": 2.2, "stroke-linejoin": "round" }));
    }
  }
  for (const h of shot.hazards) if (h.type === "water") {
    const x = h.side > 0 ? h.from : -BIG, w = h.side > 0 ? BIG - h.from : BIG - h.from;
    const edge = []; for (let yy = -BIG; yy <= BIG; yy += 3) edge.push([h.side * h.from + (rand() - 0.5) * 0.7, yy]);
    const poly = h.side > 0 ? [...edge, [BIG, BIG], [BIG, -BIG]] : [...edge, [-BIG, BIG], [-BIG, -BIG]];
    const d = `M${poly.map((q) => q.map((v) => v.toFixed(2)).join(" ")).join(" L")} Z`;
    void x; void w;
    land.appendChild(svgEl("path", { d, fill: "none", stroke: "#6b6a3a", "stroke-width": 1.6, opacity: 0.6 }));
    g0.appendChild(svgEl("path", { d, fill: ids.url("waterG"), filter: ids.url("water") }));
    g0.appendChild(svgEl("path", { d: smoothPath(edge, false), fill: "none", stroke: "rgba(255,255,255,0.3)", "stroke-width": 0.25, transform: `translate(${h.side * 0.7} 0)` }));
  }
  // the green: collar, then the putting surface (lit, with a fine grain)
  const top = svgEl("g");
  g0.appendChild(top);
  top.appendChild(svgEl("path", { d: blob(0, 0, rx + 1.5, ry + 1.5, rand, { wobble: 0.025, n: 16 }), fill: PAL.collar, filter: ids.url("grass") }));
  top.appendChild(svgEl("path", { d: blob(0, 0, rx, ry, rand, { wobble: 0.02, n: 16 }), fill: ids.url("greenG"), filter: ids.url("grass") }));
  // faint mowing pattern on the green
  const gclip = svgEl("clipPath", { id: ids.id("gclip") }, svgEl("ellipse", { cx: 0, cy: 0, rx, ry }));
  svg.appendChild(gclip);
  const gs = svgEl("g", { "clip-path": `url(#${ids.id("gclip")})` });
  for (let x = -rx; x < rx; x += 3) gs.appendChild(svgEl("rect", { x, y: -ry, width: 1.5, height: 2 * ry, fill: "#fff", opacity: 0.05 }));
  top.appendChild(gs);
  for (const h of shot.hazards) if (h.type === "bunker") bunker(top, blob(h.cx, Y(h.cy), h.r, h.r * (0.85 + rand() * 0.3), rand, { wobble: 0.15, n: 11, rot: rand() * 3 }), ids, { lip: 0.45 });
  if (showHeat) {
    // the strokes gained map (update 154): what finishing at each spot gains against the Tour baseline from where you are
    const base = sgStart ?? startExpected(shot), step = 1, cells = [], obCells = [];
    // (update 160) laid out on screen, so it covers the whole picture (the green's square, turned, didn't), in
    // a group that undoes the green's turn; each cell's value is looked up at its spot on the green
    for (let X = -R; X < R; X += step) for (let Ys = -R0; Ys < H2; Ys += step) {
      const a = X + step / 2 + pX, b = Ys + step / 2, gx = a * c + b * sn, gy = a * sn - b * c;
      if (surfaceAt(shot, gx, gy) === "Water") obCells.push([X, Ys]); else cells.push([X, Ys, base - greenValue(shot, gx, gy) - 1]);
    }
    const unturn = `rotate(${-th}) translate(${pX} 0)`;
    const g = svgEl("g", { opacity: 0.5, class: "pr-heat", filter: ids.url("soft"), "pointer-events": "none", transform: unturn });
    for (const [x, y, v] of cells) g.appendChild(svgEl("rect", { x, y, width: step + 0.05, height: step + 0.05, fill: sgColor(v) }));
    g0.appendChild(g);
    const gOb = svgEl("g", { opacity: 0.72, class: "pr-heat pr-heat-ob", "pointer-events": "none", transform: unturn });
    for (const [x, y] of obCells) gOb.appendChild(svgEl("rect", { x, y, width: step + 0.05, height: step + 0.05, fill: OB_RED }));
    g0.appendChild(gOb);
    svg.__sgKey = true;
  }
  // rings round the pin: 10, 20 and 30 ft (labelled on screen, below)
  const RINGS = [10, 20, 30];
  for (const ft of RINGS) g0.appendChild(svgEl("circle", { cx: shot.pin.x, cy: Y(shot.pin.y), r: ft / 3, fill: "none", stroke: "rgba(255,255,255,0.45)", "stroke-width": 0.18, "stroke-dasharray": "0.6 0.7" }));
  if (aim) {
    const ln = aimLine || onAim ? svgEl("line", { x1: shot.from.x, y1: Y(shot.from.y), x2: aim.x, y2: Y(aim.y), stroke: "#d4b483", "stroke-width": 0.4, "stroke-dasharray": "1.2 0.8" }) : null;
    const ring = svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 1.6, fill: "none", stroke: "#d4b483", "stroke-width": 0.5 });
    const dot = svgEl("circle", { cx: aim.x, cy: Y(aim.y), r: 0.45, fill: "#d4b483" });
    if (ln) g0.appendChild(ln);
    // (update 160) a round: a grey line from the target to the pin, and each line's length halfway along it (labels upright on screen)
    const pinLn = pinLine ? svgEl("line", { stroke: "#c7c7cc", "stroke-width": 0.4, "stroke-dasharray": "1.2 0.8", opacity: 0.9 }) : null;
    const labels = pinLine ? svgEl("g", { class: "pr-pinline", "pointer-events": "none" }) : null;
    const drawPin = (gx, gy) => { // (the green's own yards)
      if (!pinLn) return;
      pinLn.setAttribute("x1", gx); pinLn.setAttribute("y1", Y(gy)); pinLn.setAttribute("x2", shot.pin.x); pinLn.setAttribute("y2", Y(shot.pin.y));
      while (labels.firstChild) labels.firstChild.remove();
      const toPin = Math.hypot(shot.pin.x - gx, shot.pin.y - gy), toAim = Math.hypot(gx - shot.from.x, gy - shot.from.y);
      pinLn.setAttribute("visibility", toPin >= 1.5 ? "visible" : "hidden");
      const [ax, ay] = place(gx, gy), [ppx, ppy] = place(shot.pin.x, shot.pin.y);
      if (toPin >= 1.5) pill(labels, (ax + ppx) / 2 + 1.2, (ay + ppy) / 2 + 0.5, `${Math.round(toPin)} yds`, 1.9, { color: "#e5e5ea" });
      // the gold line, halfway along the part on screen
      const [fx0, fy0] = place(shot.from.x, shot.from.y), lim = R0 + 4, k = fy0 > lim && fy0 > ay ? (lim - ay) / (fy0 - ay) : 1;
      const vx = ax + (fx0 - ax) * k, vy = ay + (fy0 - ay) * k;
      pill(labels, (ax + vx) / 2 + 1.2, (ay + vy) / 2 + 0.5, `${Math.round(toAim)} yds`, 1.9, { color: "#d4b483" });
    };
    if (pinLn) g0.appendChild(pinLn);
    g0.append(ring, dot);
    if (onAim) {
      const toGreen = (p) => { const a = p.x + pX, b = p.y; return [a * c + b * sn, -a * sn + b * c]; }; // (screen → the green's own coordinates)
      dragAim(svg, [ring, dot], (x, y) => { if (ln) { ln.setAttribute("x2", x); ln.setAttribute("y2", y); } drawPin(x, -y); }, toGreen, (p) => { const [x, y] = toGreen(p); onAim(f1(x), f1(-y)); }, 3.2);
    }
    if (labels) { svg.__pinLabels = labels; drawPin(aim.x, aim.y); }
  }
  vignette(svg, -R, -R0, 2 * R, R0 + H2, ids);
  // the pin, upright on screen; the ball
  const [px, py] = place(shot.pin.x, shot.pin.y);
  flag(svg, px, py, 5.5, ids);
  if (result && result.x != null) { const [bx, by] = place(result.x, result.y); ball(svg, bx, by, 0.55, ids); }
  previewDot(svg, (p) => { const [a, b] = place(p.x, p.y); return [Math.max(-R + 0.8, Math.min(R - 0.8, a)), Math.max(-R0 + 0.8, Math.min(H2 - 0.8, b))]; }, 0.7, preview);
  // the rings' sizes, on the right of each ring
  for (const ft of RINGS) svg.appendChild(svgEl("text", { x: px + ft / 3 + 0.4, y: py + 0.9, class: "pr-yd pr-ring", style: "paint-order:stroke;stroke:rgba(0,0,0,0.55);stroke-width:0.35px" }, `${ft}${ft === RINGS[RINGS.length - 1] ? " ft" : ""}`));
  // you: bottom centre (on the green's picture when you're that close, else at the bottom edge with the distance)
  const [fx, fy] = place(shot.from.x, shot.from.y);
  const inView = fy < H2 - 3;
  if (inView) svg.appendChild(svgEl("circle", { cx: fx, cy: fy, r: 1.1, fill: "#d4b483" }));
  const yy = inView ? fy : H2 - 1.2;
  svg.appendChild(svgEl("line", { x1: 0, y1: yy, x2: 0, y2: py + 1.5, stroke: "rgba(212,180,131,0.35)", "stroke-width": 0.3, "stroke-dasharray": "1 1" }));
  if (!inView) svg.appendChild(svgEl("path", { d: `M0 ${H2 - 4.6} l-2 3.4 l4 0 z`, fill: "#d4b483" }));
  pill(svg, 2.4, Math.min(H2 - 1.8, yy + 0.4), `${shot.startDist} yds`, 2.2);
  if (svg.__pinLabels) svg.appendChild(svg.__pinLabels);
  if (svg.__sgKey) svg.appendChild(sgKey(-R + 1, -R0 + 1, 2.2, true));
  if (onTap) {
    svg.classList.add("tappable");
    // a tap on screen → back to the green's own yards
    svg.addEventListener("click", (e) => { if (svg.__dragged) return; const p = svgPoint(svg, e); const a = p.x + pX, b = p.y; const x = a * c + b * sn, y = -a * sn + b * c; onTap(f1(x), f1(-y)); });
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
export function puttSvg(p, { result = null, onTap = null, stimp = 11, showHeat = false, preview = null } = {}) {
  const R = 9;
  const svg = svgEl("svg", { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: "pr-svg pr-putt", role: "img", "aria-label": `${p.startDist} foot putt` });
  const ids = sceneDefs(svg, { grain: 9, relief: 0.12, bump: 0.22 });
  const surf = svgEl("g", { filter: ids.url("grass") });
  surf.appendChild(svgEl("rect", { x: -R - 1, y: -R - 1, width: 2 * R + 2, height: 2 * R + 2, fill: ids.url("greenG") }));
  for (let i = -R; i < R; i += 2) surf.appendChild(svgEl("rect", { x: i, y: -R - 1, width: 1, height: 2 * R + 2, fill: "#fff", opacity: 0.05 }));
  svg.appendChild(surf);
  // the strokes gained map (update 154): where the ball stops, against the Tour baseline for this putt
  if (showHeat) {
    const base = expectedStrokes("Green", Math.max(0.5, p.startDist)), step = 0.3;
    const g = svgEl("g", { opacity: 0.55, class: "pr-heat", filter: ids.url("soft"), "pointer-events": "none" });
    for (let x = -R; x < R; x += step) for (let y = -R; y < R; y += step) {
      const d = Math.hypot(x + step / 2, y + step / 2), v = base - (d <= 0.18 ? 0 : expectedStrokes("Green", Math.max(0.5, d))) - 1;
      g.appendChild(svgEl("rect", { x, y, width: step + 0.02, height: step + 0.02, fill: sgColor(v) }));
    }
    svg.appendChild(g);
  }
  // (update 157) the fall line: one arrow out of the hole, the way water would run off it (12 o'clock: straight
  // away from you, downhill; 6 o'clock: back towards you, so the putt is uphill), longer the more severe the slope
  const fall = fallOf(p);
  if (fall.sev) {
    const t = ((fall.clock % 12) * 30 * Math.PI) / 180, ux = Math.sin(t), uy = -Math.cos(t);
    const L = [0, 2.6, 4.2, 6][Math.min(3, Math.round(fall.sev))], hw = 0.55 + 0.12 * fall.sev, x0 = ux * 0.45, y0 = uy * 0.45, x1 = ux * L, y1 = uy * L;
    const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} L${(x1 - ux * hw * 0.8).toFixed(2)} ${(y1 - uy * hw * 0.8).toFixed(2)}`;
    const head = `M${x1.toFixed(2)} ${y1.toFixed(2)} L${(x1 - ux * hw * 1.6 - uy * hw).toFixed(2)} ${(y1 - uy * hw * 1.6 + ux * hw).toFixed(2)} L${(x1 - ux * hw * 1.6 + uy * hw).toFixed(2)} ${(y1 - uy * hw * 1.6 - ux * hw).toFixed(2)} Z`;
    const g = svgEl("g", { class: "pr-fall", "pointer-events": "none" });
    g.appendChild(svgEl("path", { d, stroke: "rgba(0,0,0,0.45)", "stroke-width": 0.42, "stroke-linecap": "round", fill: "none", transform: "translate(0.08 0.1)" }));
    g.appendChild(svgEl("path", { d: head, fill: "rgba(0,0,0,0.45)", transform: "translate(0.08 0.1)" }));
    g.appendChild(svgEl("path", { d, stroke: "#f4f1e6", "stroke-width": 0.3, "stroke-linecap": "round", fill: "none" }));
    g.appendChild(svgEl("path", { d: head, fill: "#f4f1e6" }));
    svg.appendChild(g);
  }
  // the read, top left
  pill(svg, -R + 0.5, -R + 1.2, `Fall line: ${fallText(p)}`, 0.62);
  // rings: 3 ft (should be a make) and 6 ft
  for (const ft of [3, 6]) svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: ft, fill: "none", stroke: "rgba(255,255,255,0.25)", "stroke-width": 0.08, "stroke-dasharray": "0.3 0.3" }));
  // your own aim, on one of your putting spots (update 151: no made-up read)
  if (p.myAim && (p.myAim.long || p.myAim.right)) {
    const ax = Math.max(-R + 0.4, Math.min(R - 0.4, p.myAim.right || 0)), ay = -Math.max(-R + 0.4, Math.min(R - 0.4, p.myAim.long || 0));
    svg.appendChild(svgEl("circle", { cx: ax, cy: ay, r: 0.3, fill: "none", stroke: "#d4b483", "stroke-width": 0.1 }));
    svg.appendChild(svgEl("circle", { cx: ax, cy: ay, r: 0.08, fill: "#d4b483" }));
    svg.appendChild(svgEl("text", { x: ax + 0.45, y: ay - 0.3, class: "pr-yd sm" }, "your aim"));
  }
  // the cup: dark, with a lighter rim
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 0.24, fill: "#e8f2e0", opacity: 0.5 }));
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 0.18, fill: ids.url("cup") }));
  // where the putt comes from
  svg.appendChild(svgEl("path", { d: `M0 ${R - 0.4} l-0.8 -1.2 m0.8 1.2 l0.8 -1.2`, stroke: "#d4b483", "stroke-width": 0.12, fill: "none" }));
  svg.appendChild(svgEl("text", { x: 0.6, y: R - 0.6, class: "pr-yd sm" }, `${p.startDist} ft`));
  if (showHeat) svg.appendChild(sgKey(-R + 0.3, R - 1.6, 0.75));
  if (result && result.x != null) ball(svg, Math.max(-R + 0.3, Math.min(R - 0.3, result.x)), Math.max(-R + 0.3, Math.min(R - 0.3, -result.y)), 0.14, ids);
  previewDot(svg, (q) => [Math.max(-R + 0.3, Math.min(R - 0.3, q.x)), Math.max(-R + 0.3, Math.min(R - 0.3, -q.y))], 0.2, preview);
  vignette(svg, -R, -R, 2 * R, 2 * R, ids);
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
const planeText = (side, fwd) => { const sev = Math.min(3, Math.round(Math.max(Math.abs(side), Math.abs(fwd)))); return sev ? `${clockOf(side, fwd)} o'clock \u00b7 ${FALL_SEV[sev].toLowerCase()}` : "flat"; };
export function planeSvg(side = 0, fwd = 0) {
  const svg = svgEl("svg", { viewBox: "0 0 100 64", class: "pr-svg pr-plane", role: "img", "aria-label": `Fall line ${planeText(side, fwd)}` });
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
  svg.appendChild(svgEl("text", { x: 2, y: 61, class: "pr-yd" }, `Fall line: ${planeText(side, fwd)}`));
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
