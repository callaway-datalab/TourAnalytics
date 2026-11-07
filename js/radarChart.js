// (update 611) The radar: the four parts of the game against tour average (the dashed circle; outside is better), the
// latest year in green and the year before it in gold (update 612: just last year). Used on Home and on Stats › Focus.
// (update 612) the corners: just the values (the years are in the key)
import { fmtSG } from "./sg.js";

const AXES = [["OTT", "Driving"], ["APP", "Approach"], ["ARG", "Short game"], ["PUTT", "Putting"]];

/** The radar: v (the latest season) and c (career), each { OTT, APP, ARG, PUTT } strokes gained a round. Tour average
 *  is the dashed circle; outside is better. (update 610) career in gold behind the season in green; each corner says both. */
export function radar(v, { small = false, c = null, cLabel = "before" } = {}) {
  const W = small ? 210 : 340, H = small ? 190 : 300, cx = W / 2, cy = H / 2 + (small ? 2 : 4), R = small ? 52 : 92, r0 = R * 0.55;
  const vals = AXES.map(([k]) => v[k] ?? 0), cv = c ? AXES.map(([k]) => c[k] ?? 0) : null;
  const lim = Math.max(0.5, Math.ceil(Math.max(...vals.map(Math.abs), ...(cv || []).map(Math.abs)) / 0.25) * 0.25);
  const rad = (x) => Math.max(4, r0 + (x / lim) * (R - r0));
  const ang = [-90, 0, 90, 180].map((a) => (a * Math.PI) / 180);
  const ptsOf = (xs) => xs.map((x, i) => [cx + rad(x) * Math.cos(ang[i]), cy + rad(x) * Math.sin(ang[i])]);
  const pts = ptsOf(vals), cpts = cv ? ptsOf(cv) : null, poly = (ps) => ps.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");
  const NS = "http://www.w3.org/2000/svg", s = (t, a = {}, kids = []) => { const e = document.createElementNS(NS, t); for (const [k, x] of Object.entries(a)) e.setAttribute(k, x); for (const k2 of kids) e.appendChild(k2); return e; };
  const col = (x) => (x >= 0 ? "#4cd17e" : "#ff8a7a"), fs = small ? 11 : 14, fv = small ? 10.5 : 13, fc = small ? 9.5 : 11.5;
  const lab = (i, [, name]) => {
    const txt = (t, size, fill, w, x, y) => { const e = s("text", { "font-size": size, fill, "font-weight": w, x, y }); e.textContent = t; return e; };
    const pos = [[cx, small ? 12 : 18, "middle"], [W - 4, cy - (small ? 12 : 16), "end"], [cx, H - (small ? 26 : 34), "middle"], [4, cy - (small ? 12 : 16), "start"]][i];
    const g = s("g", { "text-anchor": pos[2] }), lh = small ? 12 : 16;
    // (update 613) this year's value with a green ▲ (better than last year) or a red ▼ (worse)
    const vt = txt(fmtSG(vals[i]), fv, col(vals[i]), 700, pos[0], pos[1] + lh);
    if (cv && Math.abs(vals[i] - cv[i]) >= 0.005) { const up = vals[i] > cv[i], a = s("tspan", { fill: up ? "#4cd17e" : "#ff453a", "font-size": fv * 0.8 }); a.textContent = up ? " \u25B2" : " \u25BC"; vt.appendChild(a); }
    g.append(txt(name, fs, "#f5f5f7", 700, pos[0], pos[1]), vt);
    if (cv) g.append(txt(fmtSG(cv[i]), fc, "#d4b483", 600, pos[0], pos[1] + lh * 2 - (small ? 1 : 2)));
    return g;
  };
  return s("svg", { class: `hm-radar${small ? " sm" : ""}`, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": AXES.map(([k, n], i) => `${n} ${fmtSG(vals[i])}${cv ? `, ${cLabel} ${fmtSG(cv[i])}` : ""}`).join("; ") }, [
    s("g", { fill: "none", stroke: "#2a2a2e" }, [s("circle", { cx, cy, r: R }), s("line", { x1: cx, y1: cy - R, x2: cx, y2: cy + R }), s("line", { x1: cx - R, y1: cy, x2: cx + R, y2: cy })]),
    s("circle", { cx, cy, r: r0, fill: "rgba(255,255,255,.03)", stroke: "#8e8e93", "stroke-width": 1.5, "stroke-dasharray": "5 4" }),
    cpts ? s("polygon", { points: poly(cpts), fill: "rgba(212,180,131,.10)", stroke: "#d4b483", "stroke-width": small ? 1.6 : 2, "stroke-linejoin": "round" }) : s("g"),
    s("g", { class: "hm-shape", style: `transform-origin:${cx}px ${cy}px` }, [
      s("polygon", { points: poly(pts), fill: "rgba(76,209,126,.20)", stroke: "#4cd17e", "stroke-width": small ? 2 : 2.5, "stroke-linejoin": "round" }),
      ...pts.map((p, i) => s("circle", { cx: p[0], cy: p[1], r: small ? 3.5 : 5, fill: col(vals[i]) }))]),
    s("g", { "font-family": "-apple-system,Inter,sans-serif" }, AXES.map((a, i) => lab(i, a))),
  ]);
}


/** Strokes gained a round in each part of the game (and the total) over these rounds. */
export function catVals(rounds) {
  const n = rounds?.length || 0; if (!n) return null;
  const o = { OTT: 0, APP: 0, ARG: 0, PUTT: 0, TOTAL: 0 };
  for (const rd of rounds) for (const x of rd.shots || []) { const v = x.sg || 0; o.TOTAL += v; if (o[x.cat] != null) o[x.cat] += v; }
  for (const k of Object.keys(o)) o[k] /= n;
  return o;
}
const yr = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
/** The latest year's rounds and the rest, with their names ("2026"; "2024-25", "2025", "2019-25"). */
export function yearSplit(rounds) {
  const ys = [...new Set((rounds || []).map(yr).filter(Boolean))].sort();
  if (!ys.length) return null;
  const last = ys.at(-1), prev = ys.length > 1 ? ys.at(-2) : null; // (update 612: the year before the latest, not all of them)
  return { now: rounds.filter((rd) => yr(rd) === last), before: prev ? rounds.filter((rd) => yr(rd) === prev) : [], nowLabel: last, beforeLabel: prev || "" };
}
export const yearsLabel = (ys) => (!ys.length ? "" : ys.length === 1 || ys[0] === ys.at(-1) ? ys[0] : `${ys[0]}-${String(ys.at(-1)).slice(2)}`);
/** The key: the latest year, the years before, tour average. */
/** (update 613) a green ▲ or red ▼: this year against last year (nothing when there's no last year, or no change) */
export function trendArrow(el, now, before) {
  if (before == null || now == null || Math.abs(now - before) < 0.005) return null;
  const up = now > before;
  return el("span", { class: `hm-arr ${up ? "up" : "down"}`, title: up ? "Better than last year" : "Worse than last year", "aria-label": up ? "better than last year" : "worse than last year" }, up ? "\u25B2" : "\u25BC");
}
export function radarKey(el, nowLabel, beforeLabel) {
  return el("div", { class: "hm-key" }, [el("span", {}, [el("i", { class: "k-now" }), nowLabel]), beforeLabel ? el("span", {}, [el("i", { class: "k-car" }), beforeLabel]) : null, el("span", {}, [el("i", { class: "k-avg" }), "Tour average"])]);
}
