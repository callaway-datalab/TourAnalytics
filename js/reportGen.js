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
import { PdfDoc, wrap } from "./pdfLite.js";

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
    if (gap < -0.05) focus.push({ cat: c.cat, kind: "category", lost: -gap, title: `${c.name} overall`,
      detail: `${fmtSG(c.value)} strokes gained per round${c.fieldAvg != null ? ` (other players ${fmtSG(c.fieldAvg)})` : ""}${c.rank ? `, ranked ${c.rank} of ${c.of}` : ""}.` });
  }
  const minShots = Math.max(5, mine.length * 0.5);
  for (const g of groups) {
    if (g.shots < minShots) continue;
    const gap = g.fieldAvg != null ? g.perRound - g.fieldAvg : g.perRound;
    if (gap < -0.05) focus.push({ cat: g.cat, kind: g.dim, label: g.label, lost: -gap, title: `${CAT_NAME[g.cat]} ${g.word} ${g.label}`,
      detail: `${fmtSG(g.perRound)} per round over ${Math.round(g.shots)} shots${g.fieldAvg != null ? ` (other players ${fmtSG(g.fieldAvg)})` : ""}.` });
  }
  for (const t of catTrend) if (t.change != null && t.change < -0.2) focus.push({ cat: t.cat, kind: "trend", lost: -t.change / 2, title: `${t.name} is slipping`,
    detail: `${fmtSG(t.early)} per round early in the period, ${fmtSG(t.late)} lately (${fmtSG(t.change)}).` });
  if (products) for (const p of products) if (p.shots >= 10 && p.perShot < -0.05) focus.push({ cat: null, kind: "product", lost: -p.total / Math.max(1, mine.length), title: `${p.club}`,
    detail: `${fmtSG(p.perShot, 3)} per shot over ${Math.round(p.shots)} shots (${fmtSG(p.total / Math.max(1, mine.length))} per round).` });
  // keep the biggest, at most two per category, preferring the specific over the general
  focus.sort((a, b) => b.lost - a.lost || (a.kind === "category") - (b.kind === "category"));
  const top = [];
  for (const f of focus) {
    if (top.length >= 5) break;
    if (f.cat && top.filter((t) => t.cat === f.cat).length >= 2) continue;
    if (top.some((t) => t.title === f.title)) continue;
    top.push({ ...f });
  }
  return { me: { key: me.key, label: me.label }, cats, from, to, overall, byCat, series, slope, catTrend, peaks: peaks.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })),
    valleys: valleys.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })), groups, products, focus: top, players: everyone.length, detail };
}

/* ============================== the PDF ============================== */
// A quiet, premium layout: a dark cover with one big number, then white pages with lots of space, small
// spaced-out capitals over large headings, hairlines instead of boxes, and charts drawn as crisp vector lines.
const P = {
  night: "#0b0b0c", ink: "#1d1d1f", grey: "#6e6e73", soft: "#86868b", faint: "#aeaeb2", hair: "#d2d2d7", mist: "#f5f5f7",
  gold: "#b59a6a", goldLight: "#c8a97e", up: "#1f8a46", down: "#d1342c", upTint: "#9fd5b2", downTint: "#f0a9a4",
};
export function buildReportPdf(a, { aiSummary = null, sourceLabel = "" } = {}) {
  const d = new PdfDoc();
  const M = 56, W = d.W - 2 * M, H = d.H;
  const range = `${a.from != null ? fmtDate(a.from) : "All rounds"}${a.to != null ? ` \u2013 ${fmtDate(a.to)}` : a.from != null ? " \u2013 today" : ""}`;
  const catsTxt = a.cats.length === CATEGORIES.length ? "All categories" : a.cats.map((k) => CAT_NAME[k]).join(" \u00b7 ");
  const tone = (v) => (v == null ? P.grey : v >= 0 ? P.up : P.down);
  const label = (t, x, y, color = P.soft, align = "left") => d.text(t.toUpperCase(), x, y, { size: 7.5, bold: true, color, spacing: 1.6, align });
  let page = 1, y = 0;
  const footer = (dark = false) => {
    d.line(M, H - 44, M + W, H - 44, { color: dark ? "#2c2c2e" : P.hair, width: 0.5 });
    label("Tour Analytics", M, H - 28, dark ? "#636366" : P.faint);
    label(dark ? `Generated ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : `${a.me.label}  \u00b7  ${page}`, M + W, H - 28, dark ? "#636366" : P.faint, "right");
  };
  const newPage = () => { footer(); d.addPage(); page++; y = 72; };
  const need = (h) => { if (y + h > H - 70) newPage(); };
  // a heading keeps `room` points of what follows with it on the page
  const heading = (kicker, title, room = 110) => {
    need(56 + room);
    label(kicker, M, y, P.gold); y += 26;
    d.text(title, M, y, { size: 24, bold: true, color: P.ink }); y += 30;
  };
  const movingAvg = (vals, n = 5) => vals.map((_, i) => mean(vals.slice(Math.max(0, i - n + 1), i + 1)));

  /* ---------- cover ---------- */
  d.rect(0, 0, d.W, H, { fill: P.night });
  label("Performance Report", M, 86, P.goldLight);
  const nameLines = wrap(a.me.label, W, 40, true);
  y = 140;
  for (const l of nameLines) { d.text(l, M, y, { size: 40, bold: true, color: "#ffffff" }); y += 44; }
  d.text(range, M, y + 2, { size: 12, color: "#a1a1a6" });
  d.text(`${catsTxt}${sourceLabel ? `  \u00b7  ${sourceLabel}` : ""}`, M, y + 20, { size: 12, color: "#6e6e73" });
  // the hero number
  label("Strokes gained per round", M, 330, "#86868b");
  d.text(a.overall.rounds ? fmtSG(a.overall.value) : "\u2014", M - 4, 420, { size: 96, bold: true, color: "#ffffff", spacing: -2 });
  if (a.overall.fieldAvg != null) d.text(`against ${fmtSG(a.overall.fieldAvg)} for the other players`, M, 448, { size: 11, color: "#86868b" });
  // three supporting figures
  const fig = [["Rounds", String(a.overall.rounds)], ["Rank", a.overall.rank ? `${a.overall.rank} of ${a.overall.of}` : "\u2014"],
    ["Difference", a.overall.fieldAvg != null && a.overall.value != null ? fmtSG(a.overall.value - a.overall.fieldAvg) : "\u2014"]];
  fig.forEach(([l, v], i) => { const x = M + i * (W / 3); label(l, x, 512, "#86868b"); d.text(v, x, 546, { size: 26, bold: true, color: "#f5f5f7" }); });
  // the trend, as one fine line
  if (a.series.length >= 3) {
    const vals = movingAvg(a.series.map((s) => s.value));
    const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0), top = 600, ht = 90;
    const Y = (v) => top + ht - ((v - lo) / (hi - lo || 1)) * ht;
    d.line(M, Y(0), M + W, Y(0), { color: "#2c2c2e", width: 0.5 });
    const pts = vals.map((v, i) => [M + (i / (vals.length - 1)) * W, Y(v)]);
    d.polyline(pts, { color: P.goldLight, width: 1.6 });
    d.dot(...pts[pts.length - 1], 2.6, P.goldLight);
    label("Trend  \u00b7  5-round average", M, top + ht + 26, "#636366");
  }
  footer(true);
  if (!a.overall.rounds) return d.output();

  /* ---------- categories ---------- */
  d.addPage(); page++; y = 72;
  heading("Categories", "Where the strokes come from");
  const maxAbs = Math.max(0.25, ...a.byCat.flatMap((c) => [Math.abs(c.value || 0), Math.abs(c.fieldAvg || 0)]));
  const barX = M + W * 0.42, barW = W * 0.32; // a scale centred on zero
  for (const c of a.byCat) {
    need(74);
    d.text(c.name, M, y + 18, { size: 15, bold: true, color: P.ink });
    d.text(`${c.rank ? `Rank ${c.rank} of ${c.of}` : "Unranked"}${c.fieldAvg != null ? `   \u00b7   Others ${fmtSG(c.fieldAvg)}` : ""}`, M, y + 36, { size: 9.5, color: P.grey });
    // bar from zero, with a tick where the other players are
    const zx = barX + barW / 2, sc = (barW / 2) / maxAbs;
    d.line(zx, y + 8, zx, y + 40, { color: P.hair, width: 0.75 });
    if (c.value != null) { const w = Math.max(1.5, Math.abs(c.value) * sc); d.roundRect(c.value >= 0 ? zx : zx - w, y + 21, w, 6, 3, { fill: c.value >= 0 ? P.up : P.down }); }
    if (c.fieldAvg != null) { const fx = zx + c.fieldAvg * sc; d.line(fx, y + 15, fx, y + 33, { color: P.ink, width: 1.2 }); }
    d.text(fmtSG(c.value), M + W, y + 32, { size: 28, bold: true, color: tone(c.value), align: "right" });
    y += 56;
    d.line(M, y, M + W, y, { color: P.hair, width: 0.5 });
    y += 14;
  }
  d.text("Bar: this player, from zero   \u00b7   Mark: the other players' average", M, y + 4, { size: 8, color: P.faint });
  y += 40;

  /* ---------- where strokes are lost ---------- */
  heading("Focus", "Where strokes are lost");
  if (!a.focus.length) { d.para("Nothing stands out against the other players in this period.", M, y, W, { size: 11, color: P.grey }); y += 30; }
  a.focus.forEach((f, i) => {
    const lines = wrap(f.detail, W - 150, 10);
    need(30 + lines.length * 14);
    d.text(String(i + 1).padStart(2, "0"), M, y + 20, { size: 24, bold: true, color: P.hair });
    d.text(f.title, M + 46, y + 12, { size: 13, bold: true, color: P.ink });
    let yy = y + 28;
    for (const l of lines) { d.text(l, M + 46, yy, { size: 10, color: P.grey }); yy += 14; }
    d.text(`\u2212${Math.abs(f.lost).toFixed(2)}`, M + W, y + 18, { size: 20, bold: true, color: P.down, align: "right" });
    label("strokes / round", M + W, y + 32, P.faint, "right");
    y = Math.max(yy, y + 40) + 8;
    d.line(M + 46, y, M + W, y, { color: P.hair, width: 0.5 });
    y += 14;
  });

  /* ---------- AI summary (when set up) ---------- */
  if (aiSummary) {
    heading("Summary", "In a few words");
    const lines = wrap(aiSummary, W - 20, 13);
    need(lines.length * 19 + 20);
    d.line(M, y - 6, M, y + lines.length * 19 - 4, { color: P.gold, width: 2 });
    for (const l of lines) { d.text(l, M + 18, y + 8, { size: 13, color: P.ink }); y += 19; }
    label("Written by AI from the numbers in this report", M + 18, y + 12, P.faint); y += 40;
  }

  /* ---------- trajectory ---------- */
  newPage();
  heading("Trajectory", "Round by round");
  if (a.series.length >= 2) {
    const vals = a.series.map((s) => s.value), avg = movingAvg(vals);
    const lo = Math.min(-1, Math.floor(Math.min(...vals))), hi = Math.max(1, Math.ceil(Math.max(...vals)));
    const top = y + 6, ht = 180, left = M + 26, wd = W - 26;
    const Y = (v) => top + ht - ((v - lo) / (hi - lo)) * ht;
    for (const v of [lo, 0, hi]) { d.line(left, Y(v), M + W, Y(v), { color: v === 0 ? P.faint : P.mist, width: v === 0 ? 0.75 : 0.5 }); d.text(v === 0 ? "0" : fmtSG(v, 0), M, Y(v) + 3, { size: 8, color: P.faint }); }
    const bw = wd / vals.length;
    vals.forEach((v, i) => { const x = left + i * bw + bw * 0.22, w = Math.max(1, bw * 0.56); const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); d.rect(x, y0, w, Math.max(0.8, y1 - y0), { fill: v >= 0 ? P.upTint : P.downTint }); });
    d.polyline(avg.map((v, i) => [left + i * bw + bw / 2, Y(v)]), { color: P.gold, width: 2 });
    // the best and toughest rounds marked
    const iBest = vals.indexOf(Math.max(...vals)), iWorst = vals.indexOf(Math.min(...vals));
    for (const [i, c] of [[iBest, P.up], [iWorst, P.down]]) { const x = left + i * bw + bw / 2; d.dot(x, Y(vals[i]), 2.8, c); }
    const every = Math.max(1, Math.ceil(vals.length / 8));
    a.series.forEach((s, i) => { if (i % every === 0) { const t = day(s.date); d.text(t == null ? "" : shortDate(new Date(t)), left + i * bw + bw / 2, top + ht + 16, { size: 7.5, color: P.faint, align: "center" }); } });
    y = top + ht + 34;
    d.text("Bars: each round   \u00b7   Line: 5-round average", M, y, { size: 8, color: P.faint });
    y += 30;
  }
  if (a.slope != null) {
    const per10 = a.slope * 10, word = Math.abs(per10) < 0.1 ? "Holding steady" : per10 > 0 ? "Improving" : "Declining";
    need(60);
    d.text(word, M, y + 16, { size: 20, bold: true, color: Math.abs(per10) < 0.1 ? P.ink : tone(per10) });
    d.text(`${fmtSG(per10)} strokes per round every 10 rounds, over ${a.series.length} rounds.`, M, y + 36, { size: 11, color: P.grey });
    y += 64;
  }
  if (a.series.length >= 4) {
    need(40 + a.catTrend.length * 30);
    const cx = [M, M + W * 0.5, M + W * 0.7, M + W];
    label("Category", cx[0], y); label("Early", cx[1], y, P.soft, "right"); label("Lately", cx[2], y, P.soft, "right"); label("Change", cx[3], y, P.soft, "right");
    y += 10; d.line(M, y, M + W, y, { color: P.hair, width: 0.5 }); y += 4;
    for (const t of a.catTrend) {
      y += 20;
      d.text(t.name, cx[0], y, { size: 11, color: P.ink });
      d.text(fmtSG(t.early), cx[1], y, { size: 11, color: P.grey, align: "right" });
      d.text(fmtSG(t.late), cx[2], y, { size: 11, color: P.grey, align: "right" });
      d.text(fmtSG(t.change), cx[3], y, { size: 11, bold: true, color: tone(t.change), align: "right" });
      y += 9; d.line(M, y, M + W, y, { color: P.mist, width: 0.5 });
    }
    y += 34;
  }

  /* ---------- peaks and valleys ---------- */
  heading("Peaks and valleys", "The best and toughest rounds", 44 + Math.max(a.peaks.length, a.valleys.length) * 46);
  const colW = (W - 16) / 2;
  const card = (x, title, list, c) => {
    d.roundRect(x, y, colW, 44 + list.length * 46, 14, { fill: P.mist });
    label(title, x + 18, y + 26, c);
    list.forEach((s, i) => {
      const yy = y + 50 + i * 46;
      d.text(fmtSG(s.value), x + colW - 18, yy + 10, { size: 18, bold: true, color: c, align: "right" });
      d.text(wrap(`${s.event || "Round"}${s.roundNo ? ` R${s.roundNo}` : ""}`, colW - 110, 10.5, true)[0], x + 18, yy + 4, { size: 10.5, bold: true, color: P.ink });
      d.text(`${fmtDate(s.date)}   \u00b7   ${CAT_NAME[(c === P.up ? s.best : s.worst)[0]] || ""} ${fmtSG((c === P.up ? s.best : s.worst)[1])}`, x + 18, yy + 19, { size: 8.5, color: P.grey });
    });
  };
  card(M, "Best rounds", a.peaks, P.up);
  card(M + colW + 16, "Toughest rounds", a.valleys, P.down);
  y += 44 + Math.max(a.peaks.length, a.valleys.length) * 46 + 36;

  /* ---------- distance and lie ---------- */
  const enough = a.groups.filter((g) => g.shots >= Math.max(5, a.overall.rounds * 0.5)).sort((p, q) => q.perRound - p.perRound);
  if (enough.length >= 2) {
    heading("Distance and lie", "Strengths and weaknesses", 30 + 4 * 34);
    const list = (x, title, rows, c) => {
      label(title, x, y, c);
      rows.forEach((g, i) => {
        const yy = y + 26 + i * 34;
        d.text(`${CAT_NAME[g.cat]} ${g.word} ${g.label}`, x, yy, { size: 10.5, bold: true, color: P.ink });
        d.text(`${Math.round(g.shots)} shots${g.fieldAvg != null ? `   \u00b7   others ${fmtSG(g.fieldAvg)}` : ""}`, x, yy + 13, { size: 8.5, color: P.grey });
        d.text(fmtSG(g.perRound), x + colW, yy + 6, { size: 15, bold: true, color: tone(g.perRound), align: "right" });
      });
    };
    const strong = enough.slice(0, 4), weak = enough.slice(-4).reverse();
    list(M, "Strongest", strong, P.up);
    list(M + colW + 16, "Weakest", weak, P.down);
    y += 26 + Math.max(strong.length, weak.length) * 34 + 24;
  }

  /* ---------- by product ---------- */
  if (a.products) {
    heading("Equipment", "By club model");
    if (!a.products.length) { y = d.para("No club information on these shots: clubs come from Data Entry (with WITB) or a club column in an uploaded file.", M, y, W, { size: 10.5, color: P.grey }) + 10; }
    else {
      const cx = [M, M + W * 0.6, M + W * 0.78, M + W];
      label("Club", cx[0], y); label("Shots", cx[1], y, P.soft, "right"); label("Per shot", cx[2], y, P.soft, "right"); label("Total", cx[3], y, P.soft, "right");
      y += 10; d.line(M, y, M + W, y, { color: P.hair, width: 0.5 });
      for (const p of a.products.slice(0, 16)) {
        need(28); y += 20;
        d.text(p.club, cx[0], y, { size: 10.5, color: P.ink });
        d.text(String(Math.round(p.shots)), cx[1], y, { size: 10.5, color: P.grey, align: "right" });
        d.text(fmtSG(p.perShot, 3), cx[2], y, { size: 10.5, bold: true, color: tone(p.perShot), align: "right" });
        d.text(fmtSG(p.total), cx[3], y, { size: 10.5, color: P.grey, align: "right" });
        y += 9; d.line(M, y, M + W, y, { color: P.mist, width: 0.5 });
      }
      y += 24;
    }
  }
  need(60); y += 16;
  d.para(`Compared with ${a.players - 1} other player${a.players === 2 ? "" : "s"} over the same dates and categories. Strokes gained are per round unless noted.`, M, y, W, { size: 8, color: P.faint });
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
