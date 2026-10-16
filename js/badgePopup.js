// (update 173) A Watchlist badge's pop-up: what's behind the badge, as a chart, a table, or both.
// The details come from watchlistData.js (badge.info()): { sub, blocks: [...] }, each block one of
//   { kind: "bars", items: [{ label, sub, v, on }], ref: [{ v, label, from?, to? }], fmt }  each round (or event) a bar; "on" ones in colour
//   { kind: "line", items: [{ label, sub, v, on }], ref, fmt, invert }                     a line (invert: 1st at the top, for ranks)
//   { kind: "table", title?, cols: [[title, "num"?]], rows: [{ cells, me?, strong?, gap? }] } a cell is text or { sg, arrow? }
// (update 181) also used by the Player Stats pills (renderBlocks): a chart can take fmtFn (any stat's format) and
// an item a tone ("pos" / "neg" / "gold"); a table cell can be { text, tone }.
import { el } from "./ui.js";
import { fmtSG } from "./sg.js";
import { ordinal } from "./watchlistData.js";

const NS = "http://www.w3.org/2000/svg";
const mk = (t, a = {}, text = null) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); if (text != null) n.textContent = text; return n; };
const HALO = { stroke: "#141416", "stroke-width": 3.5, "stroke-linejoin": "round", "paint-order": "stroke" }; // (labels stay readable over bars and lines)
const fmtOf = (fmt) => (fmt === "rank" ? (v) => ordinal(Math.round(v)) : (v) => fmtSG(v));
const tone = (v) => (v == null || Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
const C = { pos: "#30d158", neg: "#ff453a", off: "rgba(255,255,255,0.16)", gold: "#d4b483", grid: "rgba(255,255,255,0.08)", ink: "rgba(235,235,245,0.6)" };

/** Open the pop-up for one badge. */
export function openBadge(badge, playerLabel) {
  const info = badge.info?.();
  if (!info) return;
  const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "✕");
  const body = el("div", { class: "wl-pop-body" }, info.blocks.map(block));
  const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": badge.text }, el("div", { class: "gx-pop wl-pop" }, [
    el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, playerLabel), el("h2", {}, [badge.icon ? el("span", { "aria-hidden": "true" }, `${badge.icon} `) : null, badge.text]), info.sub ? el("p", { class: "gx-sub" }, info.sub) : null]), close]),
    body,
  ]));
  const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
  const onKey = (e) => { if (e.key === "Escape") shut(); };
  close.addEventListener("click", shut);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
  document.addEventListener("keydown", onKey);
  document.body.classList.add("gx-noscroll");
  document.body.appendChild(overlay);
  close.focus();
  return shut;
}

/** The blocks as page elements (for another page's own pop-up). */
export const renderBlocks = (blocks) => blocks.map(block).filter(Boolean);

function block(b) {
  if (b.kind === "table") return table(b);
  if (b.kind === "bars" || b.kind === "line") return chart(b);
  return null;
}

function table(b) {
  const cell = (c, num) => {
    if (c && typeof c === "object" && "text" in c) return el("td", { class: `num ${c.tone || ""}` }, c.text ?? "\u2014");
    if (c && typeof c === "object") {
      const v = c.sg;
      const txt = v == null || !Number.isFinite(v) ? "—" : c.arrow ? `${Math.round(v * 100) === 0 ? "" : v > 0 ? "▲ " : "▼ "}${Math.abs(v).toFixed(2)}` : fmtSG(v);
      return el("td", { class: `num ${v == null ? "" : tone(v)}` }, txt);
    }
    return el("td", { class: num ? "num" : "" }, c ?? "");
  };
  return el("div", { class: "wl-pop-block" }, [
    b.title ? el("p", { class: "wl-pop-t" }, b.title) : null,
    el("div", { class: "wl-pop-tw" }, el("table", { class: "wl-pop-table" }, [
      el("thead", {}, el("tr", {}, b.cols.map(([t, k]) => el("th", { class: k === "num" ? "num" : "" }, t)))),
      el("tbody", {}, b.rows.map((r) => (r.gap ? el("tr", { class: "gap" }, el("td", { colspan: b.cols.length }, "⋯"))
        : el("tr", { class: `${r.me ? "me" : ""}${r.strong ? " strong" : ""}` }, r.cells.map((c, i) => cell(c, b.cols[i]?.[1] === "num")))))),
    ])),
  ]);
}

function chart(b) {
  const items = b.items.filter((x) => x.v != null && Number.isFinite(x.v));
  if (!items.length) return el("p", { class: "muted small" }, "Nothing to chart yet.");
  const fmt = b.fmtFn || fmtOf(b.fmt);
  const W = 560, H = 230, L = 46, R = 14, T = 14, B = 30;
  const ref = (b.ref || []).filter((r) => r.v != null && Number.isFinite(r.v));
  const vals = [...items.map((x) => x.v), ...ref.map((r) => r.v)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const fromZero = b.kind === "bars" && b.zero !== false; // (zero: false, a stat like Hit Green %: bars rise from just under the lowest)
  if (fromZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (b.fmt === "rank") { lo = 1; hi = Math.max(hi, 2); }
  const pad = (hi - lo) * 0.08 || 0.5;
  if (b.fmt !== "rank") { lo -= fromZero && lo === 0 ? 0 : b.kind === "bars" && !fromZero ? pad * 2 : pad; hi += fromZero && hi === 0 ? 0 : pad; }
  const Y = (v) => { const t = (v - lo) / (hi - lo || 1); return b.invert ? T + t * (H - T - B) : H - B - t * (H - T - B); };
  const n = items.length, slot = (W - L - R) / n;
  const X = (i) => L + slot * (i + 0.5);
  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "wl-pop-chart", role: "img", "aria-label": `${items.length} values, from ${fmt(items[0].v)} to ${fmt(items.at(-1).v)}` });
  // grid: 4 lines with their values
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3, y = Y(v);
    svg.append(mk("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: C.grid }), mk("text", { x: L - 6, y: y + 3.5, "text-anchor": "end", "font-size": 10.5, fill: C.ink }, fmt(v)));
  }
  if (b.kind === "bars") {
    const baseV = fromZero ? 0 : lo;
    svg.append(mk("line", { x1: L, x2: W - R, y1: Y(baseV), y2: Y(baseV), stroke: "rgba(255,255,255,0.3)" }));
    const bw = Math.max(2, Math.min(26, slot * 0.7));
    items.forEach((x, i) => {
      const y0 = Y(baseV), y1 = Y(x.v);
      const r = mk("rect", { x: X(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), rx: Math.min(3, bw / 3), fill: x.on ? (x.tone ? C[x.tone] || C.gold : x.v >= 0 ? C.pos : C.neg) : C.off });
      r.append(mk("title", {}, `${x.label}${x.sub ? ` · ${x.sub}` : ""}: ${fmt(x.v)}`));
      svg.append(r);
    });
  } else {
    const pts = items.map((x, i) => [X(i), Y(x.v)]);
    const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const base = b.invert ? T : H - B;
    svg.append(mk("path", { d: `${d} L${pts.at(-1)[0]} ${base} L${pts[0][0]} ${base} Z`, fill: "rgba(212,180,131,0.12)" }), mk("path", { d, fill: "none", stroke: C.gold, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    items.forEach((x, i) => {
      const c = mk("circle", { cx: pts[i][0], cy: pts[i][1], r: x.on ? 4.5 : n > 25 ? 0 : 2.4, fill: x.on ? "#fff" : C.gold, stroke: x.on ? C.gold : "none", "stroke-width": 2 });
      const hit = mk("rect", { x: pts[i][0] - slot / 2, y: T, width: slot, height: H - T - B, fill: "transparent" });
      hit.append(mk("title", {}, `${x.label}${x.sub ? ` · ${x.sub}` : ""}: ${fmt(x.v)}`));
      svg.append(c, hit);
      if (x.on) { const py = pts[i][1], above = py - 10 > T + 8; svg.append(mk("text", { x: pts[i][0] - 8, y: above ? py - 10 : py + 18, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: "#fff", ...HALO }, fmt(x.v))); }
    });
  }
  // reference lines (an average; over part of the chart when from / to are given)
  for (const r of ref) {
    const x1 = r.from != null ? L + slot * r.from : L, x2 = r.to != null ? L + slot * r.to : W - R, y = Y(r.v);
    svg.append(mk("line", { x1, x2, y1: y, y2: y, stroke: C.gold, "stroke-width": 1.4, "stroke-dasharray": "5 4" }),
      mk("text", { x: x2 - 3, y: y - 5, "text-anchor": "end", "font-size": 10.5, "font-weight": 600, fill: C.gold, ...HALO }, `${r.label} ${fmt(r.v)}`));
  }
  // dates: the first, the last, and one in the middle
  const marks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => n > 1 || i === 0);
  for (const i of marks) svg.append(mk("text", { x: X(i), y: H - 9, "text-anchor": i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle", "font-size": 10.5, fill: C.ink }, items[i].label));
  return el("div", { class: "wl-pop-block" }, [b.title ? el("p", { class: "wl-pop-t" }, b.title) : null, el("div", { class: "wl-pop-cw" }, svg)]);
}
