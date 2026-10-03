// Auto-generated performance report (Reports → Performance Reports → "Auto-generate report").
// You pick the dates, categories, the data (Tour Events or Entered Rounds) and, optionally, to compare club
// models ("differentiate by product"). The portal works out the numbers and writes a PDF:
//   • overall strokes gained (per round and by category) and ranks among the players
//   • trends over the period (each round, and each category early vs late)
//   • peaks and valleys (best and worst rounds)
//   • by product: how each club model performs
//   • the top 3-5 things to work on, with the strokes they cost and a practice suggestion
// The insights are calculated from the numbers (not written by an AI). If an AI summary service is set up
// (PORTAL_CONFIG.insightsUrl, see functions/insights), its written summary is added too.
import { el, mount } from "./ui.js";
import { getState } from "./auth.js";
import { watchClientDatasets, getDatasetRows, getFieldStats, uploadDocument } from "./store.js";
import { detectColumns, isShotData, prepare, summaryPlayers, sliceTotals, sgBy, CATEGORIES, shortDate } from "./sg.js";
import { watchPlayerRounds, getAllRounds } from "./rounds.js";
import { roundToPrepared, enteredPlayers, ENTERED_IDX } from "./roundCalc.js";
import { PdfDoc, wrap, textWidth } from "./pdfLite.js";

const CAT_NAME = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));
const fmtSG = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(dp)}`);
const day = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? t : null; };
const fmtDate = (d) => { const t = day(d); return t == null ? String(d || "") : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* ============================== the numbers ============================== */
/**
 * me: { key, label, rounds }  field: [{ key, label, rounds, summaryOnly? }]  (prepared rounds, as on the stats page)
 * opts: { from, to (ms or null), cats: ["OTT", …], byProduct, idx }
 */
export function analyzePerformance(me, field, { from = null, to = null, cats = CATEGORIES.map(([k]) => k), byProduct = false, idx = {} } = {}) {
  const inRange = (rd) => { const t = day(rd.date); return t == null || ((from == null || t >= from) && (to == null || t <= to)); };
  const pick = (rounds) => rounds.filter(inRange).map((rd) => ({ ...rd, shots: rd.shots.filter((s) => cats.includes(s.cat)) }))
    .sort((a, b) => (day(a.date) ?? 0) - (day(b.date) ?? 0));
  const mine = pick(me.rounds);
  const others = field.filter((p) => p.key !== me.key).map((p) => ({ ...p, rounds: pick(p.rounds) })).filter((p) => p.rounds.length);
  const everyone = [{ key: me.key, label: me.label, rounds: mine }, ...others];
  const detail = !field.some((p) => p.summaryOnly);
  const perRound = (rounds, cat) => sliceTotals(cat ? rounds.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => s.cat === cat) })) : rounds).sgPerRound;

  // overall and by category, with ranks
  const rankOf = (cat) => {
    const vals = everyone.map((p) => ({ key: p.key, v: perRound(p.rounds, cat) })).filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
    const i = vals.findIndex((x) => x.key === me.key);
    const fieldVals = vals.filter((x) => x.key !== me.key).map((x) => x.v);
    return { rank: i >= 0 ? i + 1 : null, of: vals.length, fieldAvg: mean(fieldVals), best: vals[0] || null };
  };
  const overall = { value: perRound(mine), rounds: mine.length, ...rankOf(null) };
  const byCat = cats.map((k) => ({ cat: k, name: CAT_NAME[k], value: perRound(mine, k), ...rankOf(k) }));

  // each round, trend line, early vs late by category
  const series = mine.map((rd) => ({ date: rd.date, event: rd.event, roundNo: rd.roundNo, value: rd.shots.reduce((t, s) => t + s.sg, 0),
    byCat: Object.fromEntries(cats.map((k) => [k, rd.shots.filter((s) => s.cat === k).reduce((t, s) => t + s.sg, 0)])) }));
  let slope = null;
  if (series.length >= 3) {
    const xs = series.map((_, i) => i), mx = mean(xs), my = mean(series.map((s) => s.value));
    slope = xs.reduce((t, x, i) => t + (x - mx) * (series[i].value - my), 0) / xs.reduce((t, x) => t + (x - mx) ** 2, 0);
  }
  const half = Math.floor(series.length / 2);
  const early = series.slice(0, half), late = series.slice(series.length - half);
  const catTrend = cats.map((k) => {
    const a = mean(early.map((s) => s.byCat[k])), b = mean(late.map((s) => s.byCat[k]));
    return { cat: k, name: CAT_NAME[k], early: a, late: b, change: a != null && b != null ? b - a : null };
  });
  const ranked = [...series].sort((a, b) => b.value - a.value);
  const peaks = ranked.slice(0, Math.min(3, ranked.length));
  const valleys = ranked.slice(-Math.min(3, ranked.length)).reverse();
  const bestCat = (s) => cats.map((k) => [k, s.byCat[k]]).sort((a, b) => b[1] - a[1])[0];
  const worstCat = (s) => cats.map((k) => [k, s.byCat[k]]).sort((a, b) => a[1] - b[1])[0];

  // breakdowns (distance / lie) for each category, with the other players' average for the same group
  const dims = [["distanceRange", "from"], ["lie", "from the"]].filter(([f]) => idx[f] !== undefined);
  const groups = [];
  for (const k of cats) for (const [f, word] of dims) {
    const gs = sgBy(mine, idx, k, f) || [];
    for (const g of gs) {
      const vals = detail ? others.map((p) => (sgBy(p.rounds, idx, k, f) || []).find((x) => x.label === g.label)?.perRound).filter((v) => v != null) : [];
      groups.push({ cat: k, dim: f, word, label: g.label, perRound: g.perRound, shots: g.shots, fieldAvg: mean(vals) });
    }
  }

  // by product: club models (the club as recorded on each shot)
  let products = null;
  if (byProduct) {
    const m = new Map();
    for (const rd of mine) for (const s of rd.shots) {
      const club = s.club || (s.r && idx.club !== undefined ? s.r[idx.club] : null);
      if (!club) continue;
      const g = m.get(club) || { club: String(club), cat: s.clubCat || null, sg: 0, shots: 0, rounds: new Set() };
      g.sg += s.sg; g.shots += s.w || 1; g.rounds.add(rd.key); m.set(club, g);
    }
    products = [...m.values()].map((g) => ({ club: g.club, group: g.cat, shots: g.shots, rounds: g.rounds.size, perShot: g.sg / g.shots, total: g.sg }))
      .sort((a, b) => b.shots - a.shots);
  }

  // the top 3-5 things to work on: where the most strokes go, per round
  const focus = [];
  for (const c of byCat) {
    if (c.value == null) continue;
    const gap = c.fieldAvg != null ? c.value - c.fieldAvg : c.value;
    if (gap < -0.05) focus.push({ cat: c.cat, kind: "category", lost: -gap, title: `${c.name}`,
      detail: `${c.value >= 0 ? `Gains ${c.value.toFixed(2)}` : `Loses ${Math.abs(c.value).toFixed(2)}`} strokes a round${c.fieldAvg != null ? `, while the others average ${fmtSG(c.fieldAvg)}` : ""}${c.rank ? `. Ranked ${c.rank} of ${c.of}.` : "."}` });
  }
  const minShots = Math.max(5, mine.length * 0.5);
  for (const g of groups) {
    if (g.shots < minShots) continue;
    const gap = g.fieldAvg != null ? g.perRound - g.fieldAvg : g.perRound;
    if (gap < -0.05) focus.push({ cat: g.cat, kind: g.dim, label: g.label, lost: -gap, title: `${CAT_NAME[g.cat]} ${g.word} ${g.label}`,
      detail: `${g.perRound >= 0 ? `Gains only ${g.perRound.toFixed(2)}` : `Loses ${Math.abs(g.perRound).toFixed(2)}`} strokes a round here${g.fieldAvg != null ? ` (the others: ${fmtSG(g.fieldAvg)})` : ""}, over ${Math.round(g.shots)} shots.` });
  }
  for (const t of catTrend) if (t.change != null && t.change < -0.2) focus.push({ cat: t.cat, kind: "trend", lost: -t.change / 2, title: `Slipping: ${t.name}`,
    detail: `Earlier rounds: ${fmtSG(t.early)} a round. Recent rounds: ${fmtSG(t.late)} a round. That's ${Math.abs(t.change).toFixed(2)} strokes a round worse.` });
  if (products) for (const p of products) if (p.shots >= 10 && p.perShot < -0.05) focus.push({ cat: null, kind: "product", lost: -p.total / Math.max(1, mine.length), title: `${p.club}`,
    detail: `Loses ${Math.abs(p.perShot).toFixed(3)} strokes a shot, over ${Math.round(p.shots)} shots (about ${Math.abs(p.total / Math.max(1, mine.length)).toFixed(2)} a round).` });
  // keep the biggest, at most two per category, preferring the specific over the general
  focus.sort((a, b) => b.lost - a.lost || (a.kind === "category") - (b.kind === "category"));
  const top = [];
  for (const f of focus) {
    if (top.length >= 5) break;
    if (f.cat && top.filter((t) => t.cat === f.cat).length >= 2) continue;
    if (top.some((t) => t.title === f.title)) continue;
    top.push({ ...f });
  }
  // Strengths: where they're elite (top of the group, or clearly better than the others), and what's on the rise.
  const elite = [];
  for (const c of byCat) {
    if (c.value == null || c.value <= 0) continue;
    const top = c.rank && c.of >= 3 && c.rank <= Math.max(1, Math.ceil(c.of * 0.15));
    const ahead = c.fieldAvg != null && c.value - c.fieldAvg >= 0.25;
    if (top || ahead) elite.push({ cat: c.cat, score: (c.value - (c.fieldAvg ?? 0)) + (c.rank === 1 ? 0.3 : 0), title: c.rank === 1 ? `Best in the group: ${c.name}` : `${c.name}`,
      text: `Gains ${Math.abs(c.value).toFixed(2)} strokes a round${c.fieldAvg != null ? ` (the others: ${fmtSG(c.fieldAvg)})` : ""}${c.rank ? `. Ranked ${c.rank} of ${c.of}.` : "."}` });
  }
  for (const g of groups) {
    if (g.shots < minShots || g.perRound < 0.25) continue;
    if (g.fieldAvg != null && g.perRound - g.fieldAvg < 0.2) continue;
    elite.push({ cat: g.cat, score: g.perRound - (g.fieldAvg ?? 0), title: `${CAT_NAME[g.cat]} ${g.word} ${g.label}`,
      text: `Gains ${g.perRound.toFixed(2)} strokes a round${g.fieldAvg != null ? ` (the others: ${fmtSG(g.fieldAvg)})` : ""}, over ${Math.round(g.shots)} shots.` });
  }
  elite.sort((p, q) => q.score - p.score);
  const rising = catTrend.filter((t) => t.change != null && t.change >= 0.2).sort((p, q) => q.change - p.change).map((t) => ({
    cat: t.cat, title: t.early < 0 && t.late >= 0 ? `Turned it around: ${t.name}` : `On the rise: ${t.name}`,
    text: `Earlier rounds: ${fmtSG(t.early)} a round. Recent rounds: ${fmtSG(t.late)} a round. That's ${t.change.toFixed(2)} strokes a round better.` }));
  // recent form, in plain terms: the last 10 rounds against the first 10 (or halves when there are fewer)
  const n10 = Math.min(10, Math.floor(series.length / 2));
  const form = n10 >= 2 ? { n: n10, first: mean(series.slice(0, n10).map((q) => q.value)), last: mean(series.slice(-n10).map((q) => q.value)) } : null;
  return { me: { key: me.key, label: me.label }, cats, from, to, overall, byCat, series, slope, catTrend, elite: elite.slice(0, 4), rising, form, peaks: peaks.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })),
    valleys: valleys.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })), groups, products, focus: top, players: everyone.length, detail };
}

/* ============================== the PDF ============================== */
// Premium but lively: a dark gradient hero with a gold edge and one big number, badges, coloured insight cards
// (strengths in green, things to watch in red), gauge bars, and plain-English sentences under every number.
const P = {
  night: "#0a0a0b", night2: "#16201a", ink: "#1d1d1f", grey: "#5f6368", soft: "#86868b", faint: "#a1a1a6", hair: "#e3e3e8", mist: "#f5f5f7",
  gold: "#b08d57", goldLight: "#d4b483", up: "#1e8e4a", upDeep: "#14703a", upTint: "#e7f5ec", down: "#d0342c", downDeep: "#a8241e", downTint: "#fdecea",
  track: "#eceef1", note: "#faf6ee",
};
export function buildReportPdf(a, { aiSummary = null, sourceLabel = "" } = {}) {
  const d = new PdfDoc();
  const M = 44, W = d.W - 2 * M, H = d.H;
  const range = `${a.from != null ? fmtDate(a.from) : "All rounds"}${a.to != null ? ` \u2013 ${fmtDate(a.to)}` : a.from != null ? " \u2013 today" : ""}`;
  const catsTxt = a.cats.length === CATEGORIES.length ? "All categories" : a.cats.map((k) => CAT_NAME[k]).join(" \u00b7 ");
  const tone = (v) => (v == null ? P.grey : v >= 0 ? P.up : P.down);
  const cap = (t, x, y, color = P.soft, align = "left", size = 7) => d.text(t.toUpperCase(), x, y, { size, bold: true, color, spacing: 1.4, align });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let page = 1, y = 0;
  const footer = () => {
    d.line(M, H - 34, M + W, H - 34, { color: P.hair, width: 0.5 });
    cap("Tour Analytics", M, H - 20, P.faint);
    cap(`${a.me.label}  \u00b7  Page ${page}`, M + W, H - 20, P.faint, "right");
  };
  const newPage = () => { footer(); d.addPage(); page++; y = 46; };
  const need = (h) => { if (y + h > H - 50) newPage(); };
  const section = (kicker, title, room = 80) => {
    need(40 + room);
    d.rect(M, y - 7, 3, 9, { fill: P.gold });
    cap(kicker, M + 9, y, P.gold); y += 19;
    d.text(title, M, y, { size: 17, bold: true, color: P.ink }); y += 14;
  };
  const badge = (text, x, yy, fill, color = "#ffffff") => {
    const T = text.toUpperCase(), w = textWidth(T, 7, true) + 1.1 * (T.length - 1) + 16;
    d.roundRect(x, yy - 10, w, 15, 7.5, { fill });
    d.text(text.toUpperCase(), x + 8, yy, { size: 7, bold: true, spacing: 1.1, color });
    return w;
  };
  const ma = (vals, n = 5) => vals.map((_, i) => mean(vals.slice(Math.max(0, i - n + 1), i + 1)));

  /* ---------- hero ---------- */
  const heroH = 268;
  d.gradient(0, 0, d.W, heroH, P.night, P.night2, { dir: "v", steps: 60 });
  d.gradient(0, heroH - 3, d.W, 3, P.gold, P.goldLight, { dir: "h", steps: 40 });
  cap("Performance Report", M, 40, P.goldLight, "left", 7.5);
  d.text(`${range}   \u00b7   ${catsTxt}${sourceLabel ? `   \u00b7   ${sourceLabel}` : ""}`, M + W, 40, { size: 8.5, color: "#8e8e93", align: "right" });
  d.text(wrap(a.me.label, W * 0.6, 30, true)[0], M, 82, { size: 30, bold: true, color: "#ffffff" });
  cap("Strokes gained per round", M, 116, "#8e8e93");
  d.text(a.overall.rounds ? fmtSG(a.overall.value) : "\u2014", M - 3, 182, { size: 72, bold: true, color: a.overall.value >= 0 ? "#7ee2a2" : "#ff8a80", spacing: -1.5 });
  const versus = a.overall.fieldAvg != null && a.overall.value != null ? a.overall.value - a.overall.fieldAvg : null;
  wrap(a.overall.rounds ? `${a.overall.value >= 0 ? "Better" : "Worse"} than the baseline by ${Math.abs(a.overall.value).toFixed(2)} strokes a round${versus != null ? `, and ${Math.abs(versus).toFixed(2)} ${versus >= 0 ? "better" : "worse"} than the other players (${fmtSG(a.overall.fieldAvg)}).` : "."}` : "No rounds in this period.", W * 0.56, 9.5)
    .slice(0, 2).forEach((l, i) => d.text(l, M, 202 + i * 12, { size: 9.5, color: "#c7c7cc" }));
  // badges
  let bx = M;
  if (a.overall.rank) bx += badge(`Rank ${a.overall.rank} of ${a.overall.of}`, bx, 244, a.overall.rank === 1 ? P.gold : "#3a3a3c", a.overall.rank === 1 ? P.night : "#ffffff") + 6;
  bx += badge(plural(a.overall.rounds, "round"), bx, 244, "#3a3a3c") + 6;
  if (a.form) { const ch = a.form.last - a.form.first; bx += badge(Math.abs(ch) < 0.15 ? "Form: steady" : ch > 0 ? "Form: improving" : "Form: cooling off", bx, 244, Math.abs(ch) < 0.15 ? "#3a3a3c" : ch > 0 ? P.up : P.down) + 6; }
  // form sparkline (right side)
  if (a.series.length >= 3) {
    const vals = ma(a.series.map((q) => q.value)), x0 = M + W * 0.62, w = W * 0.38, top = 104, ht = 92;
    const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0), Y = (v) => top + ht - ((v - lo) / (hi - lo || 1)) * ht;
    d.roundRect(x0 - 12, top - 22, w + 12, ht + 52, 12, { fill: "#141815" });
    cap("Form  \u00b7  average of the last 5 rounds", x0, top - 6, "#8e8e93", "left", 6.5);
    d.line(x0, Y(0), x0 + w - 12, Y(0), { color: "#3a3a3c", width: 0.5, dash: [2, 2] });
    const pts = vals.map((v, i) => [x0 + (i / (vals.length - 1)) * (w - 12), Y(v)]);
    d.polyline(pts, { color: P.goldLight, width: 1.8 });
    d.dot(...pts[pts.length - 1], 3, P.goldLight);
    d.text("Above the dotted line = gaining strokes", x0, top + ht + 18, { size: 6.5, color: "#8e8e93" });
  }
  y = heroH + 22;
  if (!a.overall.rounds) { footer(); return d.output(); }

  /* ---------- how to read ---------- */
  d.roundRect(M, y - 4, W, 34, 8, { fill: P.note });
  d.text("How to read this:", M + 12, y + 9, { size: 8.5, bold: true, color: P.gold });
  d.text("Strokes gained compares every shot with what a typical tour player would do from the same spot.", M + 92, y + 9, { size: 8.5, color: P.ink });
  d.text("Plus (green) = better than that; minus (red) = worse. +1.00 means one stroke a round better.", M + 92, y + 21, { size: 8.5, color: P.ink });
  y += 46;

  /* ---------- highlights: strengths and things to watch ---------- */
  // (at most two strengths from the same category, so they don't repeat each other)
  const strengths = [];
  for (const it of [...a.elite.map((e) => ({ ...e, tag: "Elite", title: e.title.replace(/^Best in the group: (.*)$/, "$1: best in the group") })),
    ...a.rising.map((r) => ({ ...r, tag: r.title.startsWith("Turned") ? "Turnaround" : "Rising", title: r.title.replace(/^(Turned it around|On the rise): /, "") }))]) {
    if (strengths.length >= 4) break;
    if (strengths.filter((x) => x.cat === it.cat).length >= 2) continue;
    strengths.push(it);
  }
  const watch = a.focus.slice(0, 4).map((f) => ({ title: f.title.replace(/^Slipping: /, ""), text: f.detail, tag: f.kind === "trend" ? "Slipping" : "Costing strokes", lost: f.lost }));
  const colW = (W - 14) / 2;
  const cardsH = (list) => list.reduce((t, it) => t + 30 + wrap(it.text, colW - 30, 8.5).length * 11, 0) + 26;
  section("Highlights", "What stands out", Math.max(cardsH(strengths), cardsH(watch)));
  const cards = (x, title, list, accent, tint, empty) => {
    let yy = y + 4;
    cap(title, x, yy + 6, accent); yy += 14;
    if (!list.length) { d.text(empty, x, yy + 10, { size: 9, color: P.grey }); return yy + 20; }
    for (const it of list) {
      const lines = wrap(it.text, colW - 30, 8.5), h = 24 + lines.length * 11;
      d.roundRect(x, yy, colW, h, 8, { fill: tint });
      d.roundRect(x, yy, 4, h, 2, { fill: accent });
      const tw = badge(it.tag, x + 14, yy + 14, accent);
      d.text(wrap(it.title, colW - 30 - tw - 8, 9.5, true)[0], x + 14 + tw + 6, yy + 14, { size: 9.5, bold: true, color: P.ink });
      lines.forEach((l, i) => d.text(l, x + 14, yy + 27 + i * 11, { size: 8.5, color: "#3a3a3c" }));
      yy += h + 6;
    }
    return yy;
  };
  const yl = cards(M, "Strengths", strengths, P.up, P.upTint, "No clear standouts against the others in this period.");
  const yr = cards(M + colW + 14, "Watch", watch, P.down, P.downTint, "Nothing is costing strokes against the others in this period.");
  y = Math.max(yl, yr) + 10;

  /* ---------- by category: gauges ---------- */
  section("By category", "Where the strokes come from", 30 + Math.min(2, a.byCat.length) * 40);
  d.text("The bar starts in the middle: to the right (green) is gaining strokes, to the left (red) is losing them. The dark dot is the other players' average.", M, y + 6, { size: 8, color: P.grey });
  y += 18;
  const maxAbs = Math.max(0.25, ...a.byCat.flatMap((c) => [Math.abs(c.value || 0), Math.abs(c.fieldAvg || 0)])) * 1.1;
  const gx = M + 150, gw = W - 150 - 150, zx = gx + gw / 2, sc = (gw / 2) / maxAbs;
  for (const c of a.byCat) {
    need(40);
    const t = a.catTrend.find((q) => q.cat === c.cat);
    d.text(c.name, M, y + 15, { size: 11.5, bold: true, color: P.ink });
    d.text(c.rank ? `Rank ${c.rank} of ${c.of}` : "", M, y + 27, { size: 8, color: P.grey });
    // track, centre line, bar with a darker end, others' dot
    d.roundRect(gx, y + 8, gw, 12, 6, { fill: P.track });
    if (c.value != null) {
      const w = Math.max(12, Math.abs(c.value) * sc), x0 = c.value >= 0 ? zx : zx - w;
      d.roundRect(x0, y + 8, w, 12, 6, { fill: c.value >= 0 ? P.up : P.down });
      d.roundRect(x0 + 3, y + 9.5, Math.max(4, w - 6), 3.5, 1.75, { fill: c.value >= 0 ? "#4fb97a" : "#e8665e" }); // highlight
    }
    d.line(zx, y + 4, zx, y + 24, { color: "#b0b3b8", width: 0.8 });
    if (c.fieldAvg != null) { const fx = zx + c.fieldAvg * sc; d.dot(fx, y + 14, 3.6, "#ffffff"); d.dot(fx, y + 14, 2.6, P.ink); }
    d.text(fmtSG(c.value), M + W - 66, y + 19, { size: 18, bold: true, color: tone(c.value), align: "right" });
    if (t && t.change != null && Math.abs(t.change) >= 0.15) badge(t.change > 0 ? `Up ${t.change.toFixed(2)}` : `Down ${Math.abs(t.change).toFixed(2)}`, M + W - 58, y + 18, t.change > 0 ? P.up : P.down);
    else if (t && t.change != null) badge("Steady", M + W - 58, y + 18, "#8e8e93");
    y += 36;
  }
  d.text("Up / Down: how much better or worse the recent rounds are than the earlier ones, in strokes a round.", M, y + 4, { size: 7.5, color: P.faint });
  y += 18;

  /* ---------- AI summary (when set up) ---------- */
  if (aiSummary) {
    const lines = wrap(aiSummary, W - 28, 10.5);
    section("Summary", "In a few words", lines.length * 15 + 20);
    d.roundRect(M, y, W, lines.length * 15 + 22, 10, { fill: P.mist });
    lines.forEach((l, i) => d.text(l, M + 14, y + 18 + i * 15, { size: 10.5, color: P.ink }));
    y += lines.length * 15 + 30;
    cap("Written by AI from the numbers in this report", M, y, P.faint); y += 14;
  }

  /* ---------- form over time ---------- */
  section("Form", "Round by round", 200);
  if (a.form) {
    const ch = a.form.last - a.form.first;
    d.text(`Last ${a.form.n} rounds: ${fmtSG(a.form.last)} a round.   First ${a.form.n} rounds: ${fmtSG(a.form.first)} a round.   ${Math.abs(ch) < 0.15 ? "About the same." : `${ch > 0 ? "Better" : "Worse"} lately by ${Math.abs(ch).toFixed(2)} strokes a round.`}`, M, y + 6, { size: 9.5, bold: true, color: Math.abs(ch) < 0.15 ? P.ink : tone(ch) });
    y += 14;
  }
  if (a.series.length >= 2) {
    const vals = a.series.map((q) => q.value), avg = ma(vals);
    const lo = Math.min(-1, Math.floor(Math.min(...vals))), hi = Math.max(1, Math.ceil(Math.max(...vals)));
    const top = y + 8, ht = 130, left = M + 22, wd = W - 22;
    const Y = (v) => top + ht - ((v - lo) / (hi - lo)) * ht;
    d.roundRect(M - 6, top - 10, W + 12, ht + 42, 10, { fill: P.mist });
    for (const v of [lo, 0, hi]) { d.line(left, Y(v), M + W, Y(v), { color: v === 0 ? "#b0b3b8" : "#e5e5ea", width: v === 0 ? 0.8 : 0.5 }); d.text(v === 0 ? "0" : fmtSG(v, 0), M, Y(v) + 3, { size: 7, color: P.faint }); }
    const bw = wd / vals.length;
    vals.forEach((v, i) => { const x = left + i * bw + bw * 0.18, w = Math.max(1.2, bw * 0.64); const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); d.rect(x, y0, w, Math.max(0.8, y1 - y0), { fill: v >= 0 ? "#8fd4a8" : "#f2a39d" }); });
    d.polyline(avg.map((v, i) => [left + i * bw + bw / 2, Y(v)]), { color: P.gold, width: 2.2 });
    const iBest = vals.indexOf(Math.max(...vals)), iWorst = vals.indexOf(Math.min(...vals));
    for (const [i, c, txt] of [[iBest, P.up, "Best"], [iWorst, P.down, "Toughest"]]) { const x = left + i * bw + bw / 2, yy = Y(vals[i]); d.dot(x, yy, 3, c); d.text(txt, x, vals[i] >= 0 ? yy - 6 : yy + 12, { size: 7, bold: true, color: c, align: "center" }); }
    const every = Math.max(1, Math.ceil(vals.length / 8));
    a.series.forEach((q, i) => { if (i % every === 0) { const t = day(q.date); d.text(t == null ? "" : shortDate(new Date(t)), left + i * bw + bw / 2, top + ht + 13, { size: 7, color: P.faint, align: "center" }); } });
    y = top + ht + 36;
    d.text("Each bar is one round (green = gained strokes, red = lost). The gold line is the average of the last 5 rounds: when it rises, the player is playing better.", M, y, { size: 8, color: P.grey });
    y += 22;
  }

  /* ---------- best and toughest rounds ---------- */
  const rowsH = 30 + Math.max(a.peaks.length, a.valleys.length) * 30;
  section("Rounds", "Best and toughest", rowsH);
  const roundsCol = (x, title, list, c, tint) => {
    d.roundRect(x, y, colW, rowsH - 6, 10, { fill: tint });
    cap(title, x + 12, y + 16, c);
    list.forEach((q, i) => {
      const yy = y + 34 + i * 30, part = c === P.up ? q.best : q.worst;
      d.text(wrap(`${q.event || "Round"}${q.roundNo ? ` R${q.roundNo}` : ""}`, colW - 90, 9.5, true)[0], x + 12, yy, { size: 9.5, bold: true, color: P.ink });
      d.text(`${fmtDate(q.date)}  \u00b7  ${c === P.up ? "best part" : "hardest part"}: ${CAT_NAME[part[0]] || ""} ${fmtSG(part[1])}`, x + 12, yy + 11, { size: 7.5, color: P.grey });
      d.text(fmtSG(q.value), x + colW - 12, yy + 6, { size: 15, bold: true, color: c, align: "right" });
    });
  };
  roundsCol(M, "Best rounds", a.peaks, P.up, P.upTint);
  roundsCol(M + colW + 14, "Toughest rounds", a.valleys, P.down, P.downTint);
  y += rowsH + 6;

  /* ---------- distance and lie ---------- */
  const enough = a.groups.filter((g) => g.shots >= Math.max(5, a.overall.rounds * 0.5)).sort((p, q) => q.perRound - p.perRound);
  if (enough.length >= 2) {
    const strong = enough.slice(0, 4), weak = enough.slice(-4).reverse();
    section("Detail", "By distance and lie", 26 + Math.max(strong.length, weak.length) * 24);
    const list = (x, title, rows, c) => {
      cap(title, x, y + 6, c);
      rows.forEach((g, i) => {
        const yy = y + 24 + i * 24;
        d.text(`${CAT_NAME[g.cat]} ${g.word} ${g.label}`, x, yy, { size: 9.5, bold: true, color: P.ink });
        d.text(`${Math.round(g.shots)} shots${g.fieldAvg != null ? `  \u00b7  others ${fmtSG(g.fieldAvg)}` : ""}`, x, yy + 10, { size: 7.5, color: P.grey });
        d.text(fmtSG(g.perRound), x + colW, yy + 5, { size: 13, bold: true, color: tone(g.perRound), align: "right" });
        d.line(x, yy + 15, x + colW, yy + 15, { color: P.hair, width: 0.4 });
      });
    };
    list(M, "Gaining the most", strong, P.up);
    list(M + colW + 14, "Losing the most", weak, P.down);
    y += 26 + Math.max(strong.length, weak.length) * 24 + 4;
  }

  /* ---------- by product ---------- */
  if (a.products) {
    section("Equipment", "By club model", 40 + Math.min(16, a.products.length) * 20);
    if (!a.products.length) { y = d.para("No club information on these shots: clubs come from Data Entry (with WITB) or a club column in an uploaded file.", M, y, W, { size: 9, color: P.grey }) + 6; }
    else {
      const cx = [M, M + W * 0.6, M + W * 0.8, M + W];
      cap("Club", cx[0], y + 4); cap("Shots", cx[1], y + 4, P.soft, "right"); cap("Per shot", cx[2], y + 4, P.soft, "right"); cap("Total", cx[3], y + 4, P.soft, "right");
      y += 10;
      for (const p of a.products.slice(0, 16)) {
        need(20); y += 16;
        d.text(p.club, cx[0], y, { size: 9.5, color: P.ink });
        d.text(String(Math.round(p.shots)), cx[1], y, { size: 9.5, color: P.grey, align: "right" });
        d.text(fmtSG(p.perShot, 3), cx[2], y, { size: 9.5, bold: true, color: tone(p.perShot), align: "right" });
        d.text(fmtSG(p.total), cx[3], y, { size: 9.5, color: P.grey, align: "right" });
        d.line(M, y + 5, M + W, y + 5, { color: P.hair, width: 0.4 });
      }
      y += 14;
    }
  }
  need(30);
  d.text(`Compared with ${plural(a.players - 1, "other player")} over the same dates and categories. All figures are strokes a round unless noted.`, M, y + 8, { size: 7.5, color: P.faint });
  footer();
  return d.output();
}

/* ============================== loading the player's data ============================== */
const once = (watchFn, ...args) => new Promise((res) => { let un = null; un = watchFn(...args, (v) => { res(v); setTimeout(() => un?.(), 0); }); });
async function loadSource(source, playerKey, label) {
  if (source === "entered") {
    const state = getState();
    const rounds = await once(watchPlayerRounds, playerKey);
    const me = { key: playerKey, label, rounds: rounds.map(roundToPrepared) };
    let field = [];
    if (state.isAdmin) { try { field = enteredPlayers(await getAllRounds()); } catch { field = []; } }
    return { me, field: field.length ? field : [me], idx: ENTERED_IDX };
  }
  const datasets = await once(watchClientDatasets, playerKey);
  const shot = (datasets || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
  if (!shot) return null;
  const idx = detectColumns(shot.columns || []);
  const [rows, summary] = await Promise.all([getDatasetRows(playerKey, shot.id, shot.chunkCount), getFieldStats(shot.id).catch(() => null)]);
  const me = { key: playerKey, label, rounds: prepare(rows, idx) };
  const field = summaryPlayers(summary);
  return { me, field: field.length ? field.map((p) => (p.key === playerKey ? { ...me } : p)) : [me], idx };
}

/* ============================== the panel ============================== */
/** "Auto-generate report" for one player. canSave: the admin can also put it in the player's reports. */
export function reportBuilder({ playerKey, playerLabel, canSave = false, flash = () => {} }) {
  const wrapEl = el("div", { class: "report-gen" });
  const openBtn = el("button", { type: "button", class: "btn ghost report-gen-open" }, "\u2728 Auto-generate report");
  const panel = el("div", { class: "report-gen-panel", hidden: true });
  openBtn.addEventListener("click", () => { panel.hidden = !panel.hidden; openBtn.setAttribute("aria-expanded", panel.hidden ? "false" : "true"); });

  // dates
  const fromIn = el("input", { type: "date", "aria-label": "From" }), toIn = el("input", { type: "date", "aria-label": "To" });
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const presets = [["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"], ["year", "This year"], ["all", "All time"]];
  let preset = "all";
  const presetBox = el("div", { class: "subnav small report-presets" });
  const drawPresets = () => mount(presetBox, presets.map(([v, l]) => {
    const a = el("a", { href: "#", "aria-current": preset === v ? "page" : null }, l);
    a.addEventListener("click", (e) => {
      e.preventDefault(); preset = v;
      const now = Date.now();
      if (v === "all") { fromIn.value = ""; toIn.value = ""; }
      else if (v === "year") { fromIn.value = `${new Date().getFullYear()}-01-01`; toIn.value = iso(now); }
      else { fromIn.value = iso(now - Number(v) * 864e5); toIn.value = iso(now); }
      drawPresets();
    });
    return a;
  }));
  [fromIn, toIn].forEach((i) => i.addEventListener("change", () => { preset = null; drawPresets(); }));
  drawPresets();
  // categories
  let cats = CATEGORIES.map(([k]) => k);
  const catBox = el("div", { class: "report-cats" });
  const drawCats = () => mount(catBox, CATEGORIES.map(([k, l]) => {
    const b = el("button", { type: "button", class: "chip" + (cats.includes(k) ? " on" : ""), "aria-pressed": cats.includes(k) ? "true" : "false" }, l);
    b.addEventListener("click", () => { cats = cats.includes(k) ? cats.filter((x) => x !== k) : [...cats, k]; if (!cats.length) cats = [k]; drawCats(); });
    return b;
  }));
  drawCats();
  // data and product
  const source = el("select", { "aria-label": "Data" }, [el("option", { value: "tour" }, "Tour Events"), el("option", { value: "entered" }, "Entered Rounds")]);
  const product = el("input", { type: "checkbox", "aria-label": "Differentiate by product" });
  const go = el("button", { type: "button", class: "btn" }, "Generate report");
  const status = el("p", { class: "muted small", role: "status" });
  const result = el("div", { class: "report-gen-result" });
  go.addEventListener("click", async () => {
    go.disabled = true; mount(result, null);
    status.textContent = "Loading the rounds\u2026";
    try {
      const data = await loadSource(source.value, playerKey, playerLabel);
      if (!data || !data.me.rounds.length) { status.textContent = source.value === "tour" ? "No Tour Events data for this player yet." : "No entered rounds for this player yet."; return; }
      status.textContent = "Working out the insights\u2026";
      const from = fromIn.value ? Date.parse(`${fromIn.value}T00:00:00`) : null, to = toIn.value ? Date.parse(`${toIn.value}T23:59:59`) : null;
      const a = analyzePerformance(data.me, data.field, { from, to, cats, byProduct: product.checked, idx: data.idx });
      let aiSummary = null;
      const url = window.PORTAL_CONFIG?.insightsUrl;
      if (url && a.overall.rounds) {
        status.textContent = "Writing the summary\u2026";
        try {
          const token = await getState().user?.getIdToken?.();
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ analysis: { ...a, groups: a.groups.slice(0, 40) } }) });
          if (res.ok) aiSummary = (await res.json()).summary || null;
        } catch { /* the report still works without it */ }
      }
      status.textContent = "Making the PDF\u2026";
      const bytes = buildReportPdf(a, { aiSummary, sourceLabel: source.value === "tour" ? "Tour Events" : "Entered Rounds" });
      const name = `${playerLabel.replace(/[^\w -]/g, "")} performance report ${new Date().toISOString().slice(0, 10)}.pdf`;
      const blob = new Blob([bytes], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const save = canSave ? el("button", { type: "button", class: "btn ghost" }, `Save to ${playerLabel}'s reports`) : null;
      save?.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const range = fromIn.value || toIn.value ? `${fromIn.value || "start"} to ${toIn.value || "today"}` : "all rounds";
          await uploadDocument({ title: `Performance report (${range})`, description: `${cats.length === 4 ? "All categories" : cats.map((k) => CAT_NAME[k]).join(", ")} \u00b7 auto-generated`, audienceClientKey: playerKey, category: "performance", file: new File([blob], name, { type: "application/pdf" }) });
          flash(`Saved to ${playerLabel}'s Performance Reports.`, "ok");
        } catch { flash("Couldn't save the report.", "error"); save.disabled = false; }
      });
      mount(result, [
        el("p", {}, [el("strong", {}, `Report ready: ${a.overall.rounds} rounds, ${a.focus.length} focus area${a.focus.length === 1 ? "" : "s"}.`)]),
        el("div", { class: "report-gen-actions" }, [el("a", { class: "btn", href, download: name }, "Download PDF"), el("a", { class: "btn ghost", href, target: "_blank", rel: "noopener" }, "Open"), save]),
      ]);
      status.textContent = "";
    } catch (err) {
      console.error(err);
      status.textContent = "Couldn't make the report. Try again.";
    } finally { go.disabled = false; }
  });

  mount(panel, [
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Dates"), presetBox, el("div", { class: "report-dates" }, [fromIn, el("span", { class: "muted" }, "to"), toIn])]),
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Categories"), catBox]),
    el("div", { class: "report-row" }, [el("label", {}, ["Data", source]), el("label", { class: "report-check" }, [product, "Differentiate by product (club models)"])]),
    el("div", { class: "report-gen-actions" }, [go]), status, result,
  ]);
  mount(wrapEl, [openBtn, panel]);
  return wrapEl;
}
