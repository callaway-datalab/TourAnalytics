/*
 * (update 461) Simulate Round on a course with Strategy Maps: the hole's own image in place of the strip down the hole.
 * The ball, the pin, the line between them and every shot so far are drawn on it; tap where the shot finished and the
 * distance, how far offline (from the line to the pin) and the lie (read from the image: fairway, rough, sand, green)
 * fill in. Tee shots show the whole hole; after that the picture closes in on the ball and the pin.
 * Yards on the image: from the scoring file (each zone's distance from the pin against its pixels from the pin).
 */
import { svgEl } from "../practice/scene.js";
import { sameCourse } from "../sg.js";

const cache = new Map(); // course name → Promise<{ meta, data } | null>
const imgs = new Map(); // `${id}|${hole}` → { url, w, h }
const lieMaps = new Map(); // `${id}|${hole}|${pin}` → { cls, lies, s, gw, gh } | null

/** The course's Strategy Maps, if it has them (loaded once). */
export function simHeat(name) {
  if (!name) return Promise.resolve(null);
  if (!cache.has(name)) cache.set(name, (async () => {
    const { listHeatCourses, heatData } = await import("../courseHeat.js");
    const meta = (await listHeatCourses()).find((c) => c.dataChunks && sameCourse(c.name, name));
    if (!meta) return null;
    return { meta, data: await heatData(meta) };
  })().catch(() => null));
  return cache.get(name);
}
/** Loads it, then calls back once (to draw the round again with the picture). */
export function readyFor(name, then) {
  const p = simHeat(name);
  if (p.__v !== undefined) return p.__v;
  p.then((v) => { p.__v = v; if (v) then(); });
  return undefined;
}

const lieOf = (s) => { const t = String(s || "").toLowerCase(); return /green/.test(t) && !/fringe/.test(t) ? "green" : /tee/.test(t) ? "tee" : /bunker|sand/.test(t) ? "bunker" : /fringe|fairway|fwy/.test(t) ? "fairway" : /rough|other|native|primary|intermediate/.test(t) ? "rough" : t; };
/** A hole's geometry on its image: the pin, the tee, and pixels a yard. */
function geoOf(heat, n, pinId) {
  const H = heat.data.holes?.[n], pin = H?.pins?.[pinId];
  if (!pin || pin.x == null) return null;
  const rows = pin.rows;
  const tees = rows.filter((r) => lieOf(r.lie) === "tee");
  const tee = tees.length ? { x: tees.reduce((t, r) => t + r.x, 0) / tees.length, y: tees.reduce((t, r) => t + r.y, 0) / tees.length } : (() => { const far = [...rows].sort((a, b) => Math.hypot(b.x - pin.x, b.y - pin.y) - Math.hypot(a.x - pin.x, a.y - pin.y))[0]; return far ? { x: far.x, y: far.y } : null; })();
  const ratios = rows.filter((r) => r.dist > 15 && lieOf(r.lie) !== "green").map((r) => Math.hypot(r.x - pin.x, r.y - pin.y) / r.dist).sort((a, b) => a - b);
  let ppy = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  if (!ppy && tee && H.yards) ppy = Math.hypot(tee.x - pin.x, tee.y - pin.y) / H.yards;
  if (!tee || !ppy) return null;
  return { pin: { x: pin.x, y: pin.y }, tee, ppy, rows };
}
/** The hole's pin for this round (one picked for each hole, kept with the round). */
function pinFor(s, heat, n) {
  const pins = Object.keys(heat.data.holes?.[n]?.pins || {});
  if (!pins.length) return null;
  s.simPins ||= {};
  if (!pins.includes(s.simPins[n])) s.simPins[n] = pins[Math.floor(Math.random() * pins.length)];
  return s.simPins[n];
}
/** Where the ball is after the shots so far (image pixels), from each shot's hit and offline along the line to the pin. */
function ballAt(g, shots) {
  let cur = { ...g.tee };
  for (const x of shots) {
    const r = x.result; if (!r) break;
    if (r.lie === "Holed") { cur = { ...g.pin }; continue; }
    if (r.penalty === "ob") continue;
    const dx = g.pin.x - cur.x, dy = g.pin.y - cur.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const k = (x.unit === "ft" ? 1 / 3 : 1) * g.ppy;
    if (r.penalty || r.hit == null) { const left = (r.unit === "ft" ? r.dist / 3 : r.dist) * g.ppy; cur = { x: g.pin.x - ux * left, y: g.pin.y - uy * left }; continue; }
    const h = r.hit * k, off = (r.off || 0) * k;
    cur = { x: cur.x + ux * h - uy * off, y: cur.y + uy * h + ux * off }; // (right of the line: + off)
  }
  return cur;
}
async function imageOf(heat, n) {
  const k = `${heat.meta.id}|${n}`;
  if (!imgs.has(k)) {
    const { heatImage } = await import("../courseHeat.js");
    const url = await heatImage(heat.meta, n); const hm = heat.meta.holes?.[n];
    imgs.set(k, url && hm ? { url, w: hm.w, h: hm.h } : null);
  }
  return imgs.get(k);
}
/** The lie under a pixel (from the image, as Strategy Maps reads it), or null. */
async function lieAt(heat, n, pinId, x, y, im) {
  const k = `${heat.meta.id}|${n}|${pinId}`;
  if (!lieMaps.has(k)) {
    const { zonesOf, keyZones, buildOverlay } = await import("../courseHeat.js");
    const img = new Image(); img.src = im.url; await img.decode().catch(() => {});
    const Z = zonesOf(heat.data.holes[n].pins[pinId], heat.data.holes[n].par || 4); keyZones(Z);
    const ov = buildOverlay(img.naturalWidth ? img : null, Z, { W: im.w, H: im.h, par: 4, mode: "score", res: 1200 });
    lieMaps.set(k, ov.map ? { ...ov.map, s: ov.s, gw: ov.gw, gh: ov.gh } : null);
  }
  const m = lieMaps.get(k); if (!m) return null;
  const i = Math.round(x * m.s), j = Math.round(y * m.s);
  if (i < 0 || j < 0 || i >= m.gw || j >= m.gh) return null;
  const c = m.cls[j * m.gw + i];
  return c >= 0 ? m.lies[c] : null;
}
const CHIP = { fairway: "Fairway", rough: "Rough", bunker: "Bunker", green: "Green" };

/**
 * The picture for this shot, or null when the course has no Strategy Maps (or not for this hole). getEntry: the shot's
 * entry panel (its __place(hit, off) and __setLie(lie)).
 */
export function simImage(ctx, s, hole, shot, getEntry, heat) {
  if (!heat) return null;
  const n = hole.n, pinId = pinFor(s, heat, n), g = pinId ? geoOf(heat, n, pinId) : null, hm = heat.meta.holes?.[n];
  if (!g || !hm) return null;
  const idx = hole.shots.indexOf(shot), before = hole.shots.slice(0, idx < 0 ? hole.shots.length : idx);
  const ball = ballAt(g, before);
  const putt = shot.unit === "ft", tee = before.length === 0;
  // the view: the whole hole off the tee; else the ball and the pin, with room around them
  const W = hm.w, H = hm.h;
  let vb;
  if (tee) vb = [0, 0, W, H];
  else {
    const pad = Math.max(putt ? 18 : 40, Math.hypot(g.pin.x - ball.x, g.pin.y - ball.y) * 0.45) + g.ppy * (putt ? 4 : 12);
    const x0 = Math.min(ball.x, g.pin.x) - pad, x1 = Math.max(ball.x, g.pin.x) + pad, y0 = Math.min(ball.y, g.pin.y) - pad, y1 = Math.max(ball.y, g.pin.y) + pad;
    let w = x1 - x0, h = y1 - y0; const ar = W / H; // (the image's own shape, so it isn't stretched)
    if (w / h < ar) { const nw = h * ar; vb = [x0 - (nw - w) / 2, y0, nw, h]; } else { const nh = w / ar; vb = [x0, y0 - (nh - h) / 2, w, nh]; }
    vb[2] = Math.min(vb[2], W); vb[3] = Math.min(vb[3], H); vb[0] = Math.max(0, Math.min(W - vb[2], vb[0])); vb[1] = Math.max(0, Math.min(H - vb[3], vb[1]));
  }
  // a wide view on a phone: turned upright, tee at the bottom (image (x, y) shows at (y, −x))
  const rot = matchMedia("(max-width: 600px)").matches && vb[2] > vb[3] * 1.15;
  const svg = svgEl("svg", { viewBox: (rot ? [vb[1], -(vb[0] + vb[2]), vb[3], vb[2]] : vb).join(" "), class: "pr-svg pr-himg", role: "img", "aria-label": `Hole ${n}: tap where your shot finished` });
  const root = svgEl("g", rot ? { transform: "rotate(-90)" } : {});
  svg.appendChild(root);
  const image = svgEl("image", { x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none" });
  root.appendChild(image);
  imageOf(heat, n).then((im) => { if (im) image.setAttribute("href", im.url); });
  const u = (rot ? vb[3] : vb[2]) / 300; // (a size that looks the same however close the view)
  // the shots so far, the line to the pin, the ball and the pin
  let cur = { ...g.tee };
  before.forEach((x, i) => { const nx = ballAt(g, before.slice(0, i + 1)); root.appendChild(svgEl("line", { x1: cur.x, y1: cur.y, x2: nx.x, y2: nx.y, stroke: "#fff", "stroke-width": u * 0.9, opacity: 0.85 })); root.appendChild(svgEl("circle", { cx: nx.x, cy: nx.y, r: u * 1.6, fill: "#fff", stroke: "#111", "stroke-width": u * 0.4 })); cur = nx; });
  root.appendChild(svgEl("line", { x1: ball.x, y1: ball.y, x2: g.pin.x, y2: g.pin.y, stroke: "#d4b483", "stroke-width": u * 0.7, "stroke-dasharray": `${u * 3} ${u * 2}`, opacity: 0.9 }));
  const s5 = u * 3;
  root.appendChild(svgEl("path", { d: `M${g.pin.x} ${g.pin.y - s5}L${g.pin.x + s5} ${g.pin.y}L${g.pin.x} ${g.pin.y + s5}L${g.pin.x - s5} ${g.pin.y}Z`, fill: "#ffd60a", stroke: "#111", "stroke-width": u * 0.5 }));
  root.appendChild(svgEl("circle", { cx: ball.x, cy: ball.y, r: u * 2.4, fill: "#fff", stroke: "#111", "stroke-width": u * 0.7 }));
  const mark = svgEl("circle", { r: u * 2.6, fill: "#ff453a", stroke: "#fff", "stroke-width": u * 0.7, visibility: "hidden" });
  root.appendChild(mark);
  // a tap: where it finished. Hit: along the line to the pin; offline: off it (right is plus); the lie from the image
  svg.addEventListener("click", async (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = root.getScreenCTM(); if (!m) return; // (the image's own pixels, turned or not)
    const p = pt.matrixTransform(m.inverse());
    mark.setAttribute("cx", p.x); mark.setAttribute("cy", p.y); mark.setAttribute("visibility", "visible");
    const dx = g.pin.x - ball.x, dy = g.pin.y - ball.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const vx = p.x - ball.x, vy = p.y - ball.y, k = putt ? g.ppy / 3 : g.ppy;
    const along = (vx * ux + vy * uy) / k, off = (-vx * uy + vy * ux) / k;
    const entry = getEntry();
    if (!putt) { const im = imgs.get(`${heat.meta.id}|${n}`); const L = im ? await lieAt(heat, n, pinId, p.x, p.y, im).catch((err) => { console.warn("lie", err); return null; }) : null; if (L && CHIP[L]) entry?.__setLie?.(CHIP[L]); }
    entry?.__place?.(Math.max(0.1, along), off);
  });
  return svg;
}
