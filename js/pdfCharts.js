// (update 515) Shared PDF charts for the reports (pdfLite): every event as a bar, coloured by the product used in it.
import { wrap, textWidth } from "./pdfLite.js";

const f2 = (v) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

/**
 * Each tournament (event and year) from rounds tagged with a product: strokes gained a round in it, and the product used
 * most in it (by shots). items: [{ key, name, color, rounds: [{ event, year, date, sg, shots }] }] (sg: that round's
 * strokes gained with these products; shots: how many). Returns [{ label, date, v, color, key }] oldest first.
 */
export function eventBarsOf(items) {
  const evs = new Map();
  for (const it of items) for (const rd of it.rounds) {
    const d = String(rd.date || ""), yr = String(rd.year || d.slice(0, 4) || "");
    const k = `${rd.event || d}|${yr}`;
    const e = evs.get(k) || evs.set(k, { event: rd.event || d, yr, date: d, sg: 0, n: 0, by: new Map() }).get(k);
    e.sg += rd.sg; e.n++; if (d > e.date) e.date = d;
    e.by.set(it.key, (e.by.get(it.key) || 0) + (rd.shots || 1));
  }
  const color = new Map(items.map((it) => [it.key, it.color]));
  return [...evs.values()].filter((e) => e.n).sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    const top = [...e.by].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { label: `${e.event}${e.yr ? ` '${e.yr.slice(-2)}` : ""}`, date: e.date, v: e.sg / e.n, color: color.get(top) || "#8e8e93", key: top };
  });
}

/**
 * Draws the bars: a key (colour and name) on top, the bars from a dashed zero line with each value, the events turned
 * under them. Returns the height used. The caller makes room first (see eventBarsHeight).
 */
const md = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : String(s || ""); };
/* (update 516) dates: the x axis as dates (a few, level, spaced out) in place of every event's name; gap: the room
   between the bars and the axis labels */
export function drawEventBars(d, x, y, w, bars, legend, { ink = "#1d1d1f", grey = "#5f6368", hair = "#e3e3e8", plotH = 150, dates = false, gap = 8, pad = 0, yTitle = null } = {}) { // (update 586) yTitle: up the left side // (update 517) pad: room under the lowest bar before the axis
  const y0 = y;
  // the key
  let lx = x, ly = y + 8;
  for (const L of legend) {
    const nm = wrap(L.name, w * 0.45, 8, true)[0], lw = 12 + textWidth(nm, 8, true) + 18;
    if (lx + lw > x + w && lx > x) { lx = x; ly += 13; }
    d.rect(lx, ly - 7, 8, 8, { fill: L.color });
    d.text(nm, lx + 12, ly, { size: 8, bold: true, color: ink });
    lx += lw;
  }
  y = ly + 14;
  if (!bars.length) return y - y0;
  // (update 586) the y axis's title, turned to run up the left side, centred on the plot (the bars move over for it)
  if (yTitle) { d.text(String(yTitle).toUpperCase(), x + 6, y + 10 + plotH / 2, { size: 6.5, bold: true, color: grey, align: "center", rotate: 90 }); x += 16; w -= 16; }
  const vals = bars.map((b) => b.v), hi = Math.max(0.25, ...vals), lo = Math.min(-0.25, ...vals);
  const top = y + 10, Y = (v) => top + ((hi - v) / (hi - lo)) * plotH, zy = Y(0);
  const slot = w / bars.length, bw = Math.max(1.5, Math.min(18, slot * 0.62)), showV = slot >= 9;
  bars.forEach((b, i) => {
    const cx = x + slot * (i + 0.5), yv = Y(b.v), h = Math.abs(yv - zy);
    if (h >= 0.3) d.rect(cx - bw / 2, Math.min(yv, zy), bw, h, { fill: b.color });
    if (showV) d.text(f2(b.v), cx, b.v >= 0 ? yv - 2.5 : yv + 7, { size: slot >= 16 ? 6.5 : 5.2, bold: true, color: ink, align: "center" });
  });
  d.line(x, zy, x + w, zy, { color: grey, width: 0.7, dash: [3, 2] });
  const ax = top + plotH + 2 + pad;
  d.line(x, ax, x + w, ax, { color: hair, width: 0.4 });
  if (dates) {
    // a date under every few bars, level, never closer than a label's width
    const lw = 34, every = Math.max(1, Math.ceil(lw / slot)), by = ax + gap + 6;
    bars.forEach((b, i) => { if (i % every) return; const cx = x + slot * (i + 0.5); d.line(cx, ax, cx, ax + 3, { color: grey, width: 0.4 }); d.text(md(b.date), cx, by, { size: 6.5, color: grey, align: "center" }); });
    return by + 6 - y0;
  }
  // the events, turned, ending under their bar
  const lsz = slot >= 12 ? 6.5 : 5.5, maxL = Math.min(110, Math.max(...bars.map((b) => textWidth(b.label, lsz))));
  const base = ax - 2 + gap;
  const every = Math.max(1, Math.ceil(lsz * 1.25 / slot)); // (crowded: every other label, or fewer)
  bars.forEach((b, i) => {
    if (i % every) return;
    const cx = x + slot * (i + 0.5);
    const room = Math.min(110, (cx - 18) / Math.cos((55 * Math.PI) / 180)); // (never off the page's left edge)
    let t = b.label; while (textWidth(t, lsz) > room && t.length > 4) t = `${t.slice(0, -2)}…`;
    d.text(t, cx + 2, base, { size: lsz, color: grey, align: "right", rotate: 55 });
  });
  return base + maxL * Math.sin((55 * Math.PI) / 180) + 6 - y0;
}

/** The room drawEventBars will take (about). */
export function eventBarsHeight(w, bars, legend, { plotH = 150, dates = false, gap = 8, pad = 0 } = {}) {
  plotH += pad;
  const keyRows = Math.max(1, Math.ceil(legend.reduce((t, L) => t + 30 + textWidth(L.name, 8, true), 0) / w));
  const lsz = w / Math.max(1, bars.length) >= 12 ? 6.5 : 5.5;
  const maxL = bars.length ? Math.min(110, Math.max(...bars.map((b) => textWidth(b.label, lsz)))) : 0;
  if (dates) return keyRows * 13 + 8 + 14 + 10 + plotH + 2 + gap + 12;
  return keyRows * 13 + 8 + 14 + 10 + plotH + gap + maxL * 0.82 + 6;
}
