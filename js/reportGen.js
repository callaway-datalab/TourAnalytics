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
    top.push({ ...f, tip: practiceTip(f) });
  }
  return { me: { key: me.key, label: me.label }, cats, from, to, overall, byCat, series, slope, catTrend, peaks: peaks.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })),
    valleys: valleys.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })), groups, products, focus: top, players: everyone.length, detail };
}

/** A practice suggestion for a focus area. */
function practiceTip(f) {
  const n = parseFloat(String(f.label || "").replace(/[^\d.]/g, "")) || null;
  if (f.kind === "product") return "Compare it with the alternative on a launch monitor (carry, dispersion, spin) before keeping it in the bag.";
  if (f.kind === "trend") return "Something has changed recently: compare recent rounds with earlier ones (equipment, swing changes, course mix) and get back to what worked.";
  switch (f.cat) {
    case "OTT": return f.kind === "lie" ? "Tee-shot strategy and club choice: pick targets that keep the ball in play." : "Driving: start-line and curve control drills (alignment-stick gate), and a reliable fairway-finder shot.";
    case "APP": return f.kind === "distanceRange" ? `Distance control from ${f.label}: carry-distance ladders and dispersion tracking with the clubs used from there.` : f.kind === "lie" ? `Approaches from the ${String(f.label).toLowerCase()}: practise strike and how the ball comes out of that lie.` : "Approach play: distance control and start lines; know each club's carry.";
    case "ARG": return f.kind === "lie" ? `Short game from the ${String(f.label).toLowerCase()}: up-and-down games from that lie.` : "Short game: landing-spot and up-and-down games around the green.";
    case "PUTT": return n != null && n <= 6 ? "Short putts: make-percentage drills inside 6 feet (circle drill, gate for start line)." : n != null ? `Speed control from ${f.label}: lag-putting ladders to finish inside 3 feet.` : "Putting: start line inside 6 feet and speed on longer putts.";
    default: return "Spend focused practice here: it's costing the most strokes.";
  }
}

/* ============================== charts (drawn for the PDF) ============================== */
function chartCanvas(w, h) { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); return [c, x]; }
function axes(x, w, h, pad, lo, hi) {
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
  x.strokeStyle = "#e5e5e5"; x.lineWidth = 1; x.font = "18px Helvetica, Arial, sans-serif"; x.fillStyle = "#666"; x.textAlign = "right";
  const step = (hi - lo) / 4;
  for (let i = 0; i <= 4; i++) { const v = lo + step * i, yy = y(v); x.beginPath(); x.moveTo(pad.l, yy); x.lineTo(w - pad.r, yy); x.stroke(); x.fillText(Math.abs(v) >= 2 ? v.toFixed(0) : v.toFixed(1), pad.l - 8, yy + 6); }
  x.strokeStyle = "#555"; x.lineWidth = 2; x.beginPath(); x.moveTo(pad.l, y(0)); x.lineTo(w - pad.r, y(0)); x.stroke();
  return y;
}
/** Each round's strokes gained (bars) with a 5-round average line. */
function trendChart(series) {
  const W = 1600, H = 560, pad = { l: 70, r: 20, t: 20, b: 60 };
  const [c, x] = chartCanvas(W, H);
  const vals = series.map((s) => s.value);
  const lo = Math.min(-1, Math.floor(Math.min(...vals))), hi = Math.max(1, Math.ceil(Math.max(...vals)));
  const y = axes(x, W, H, pad, lo, hi);
  const bw = (W - pad.l - pad.r) / Math.max(1, series.length);
  series.forEach((s, i) => { x.fillStyle = s.value >= 0 ? "#1fa34a" : "#d93a30"; const x0 = pad.l + i * bw + bw * 0.15, y0 = y(Math.max(0, s.value)), y1 = y(Math.min(0, s.value)); x.fillRect(x0, y0, bw * 0.7, Math.max(1, y1 - y0)); });
  // 5-round average
  x.strokeStyle = "#b08d57"; x.lineWidth = 4; x.beginPath();
  series.forEach((s, i) => { const win = series.slice(Math.max(0, i - 4), i + 1), v = mean(win.map((q) => q.value)); const xx = pad.l + i * bw + bw / 2; if (i) x.lineTo(xx, y(v)); else x.moveTo(xx, y(v)); });
  x.stroke();
  // a few dates under the bars
  x.fillStyle = "#666"; x.textAlign = "center"; x.font = "17px Helvetica, Arial, sans-serif";
  const every = Math.max(1, Math.ceil(series.length / 10));
  series.forEach((s, i) => { const t = day(s.date); if (i % every === 0) x.fillText(t == null ? String(s.date) : shortDate(new Date(t)), pad.l + i * bw + bw / 2, H - pad.b + 30); });
  return c;
}
/** Player vs the other players, by category. */
function catChart(byCat) {
  const W = 1600, H = 480, pad = { l: 70, r: 20, t: 20, b: 60 };
  const [c, x] = chartCanvas(W, H);
  const vals = byCat.flatMap((b) => [b.value, b.fieldAvg]).filter((v) => v != null);
  const lo = Math.min(-0.5, Math.floor(Math.min(...vals) * 2) / 2), hi = Math.max(0.5, Math.ceil(Math.max(...vals) * 2) / 2);
  const y = axes(x, W, H, pad, lo, hi);
  const gw = (W - pad.l - pad.r) / byCat.length;
  byCat.forEach((b, i) => {
    const gx = pad.l + i * gw;
    if (b.value != null) { x.fillStyle = b.value >= 0 ? "#1fa34a" : "#d93a30"; const y0 = y(Math.max(0, b.value)), y1 = y(Math.min(0, b.value)); x.fillRect(gx + gw * 0.2, y0, gw * 0.35, Math.max(1, y1 - y0)); }
    if (b.fieldAvg != null) { x.fillStyle = "#9aa0a6"; const y0 = y(Math.max(0, b.fieldAvg)), y1 = y(Math.min(0, b.fieldAvg)); x.fillRect(gx + gw * 0.57, y0, gw * 0.2, Math.max(1, y1 - y0)); }
    x.fillStyle = "#333"; x.textAlign = "center"; x.font = "bold 19px Helvetica, Arial, sans-serif"; x.fillText(b.name, gx + gw / 2, H - pad.b + 32);
  });
  return c;
}

/* ============================== the PDF ============================== */
const C = { ink: "#111111", muted: "#6b6b70", line: "#e3e3e6", head: "#0b0d0b", gold: "#b08d57", green: "#1a8f3f", red: "#c8302a", band: "#f4f2ee" };
export function buildReportPdf(a, { aiSummary = null, sourceLabel = "" } = {}) {
  const d = new PdfDoc();
  const M = 42, W = d.W - 2 * M;
  let y = 0;
  const range = `${a.from != null ? fmtDate(a.from) : "All rounds"}${a.to != null ? ` \u2013 ${fmtDate(a.to)}` : a.from != null ? " \u2013 today" : ""}`;
  const catsTxt = a.cats.length === CATEGORIES.length ? "All categories" : a.cats.map((k) => CAT_NAME[k]).join(", ");
  // header
  d.rect(0, 0, d.W, 96, { fill: C.head });
  d.text("PERFORMANCE REPORT", M, 34, { size: 9, bold: true, color: "#c8a97e" });
  d.text(a.me.label, M, 62, { size: 22, bold: true, color: "#ffffff" });
  d.text(`${range} \u00b7 ${catsTxt}${sourceLabel ? ` \u00b7 ${sourceLabel}` : ""}`, M, 82, { size: 9.5, color: "#d6d6d6" });
  d.text(`Generated ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`, d.W - M, 34, { size: 8.5, color: "#bdbdbd", align: "right" });
  y = 120;
  const need = (h) => { if (y + h > d.H - 46) { footer(); d.addPage(); y = 50; } };
  let pageNo = 1;
  const footer = () => { d.text(`${a.me.label} \u00b7 Performance report \u00b7 page ${pageNo++}`, d.W / 2, d.H - 24, { size: 8, color: C.muted, align: "center" }); };
  // a heading keeps at least `room` points of what follows on the same page
  const section = (title, room = 90) => { need(22 + room); d.text(title.toUpperCase(), M, y, { size: 9.5, bold: true, color: C.gold }); d.line(M, y + 6, M + W, y + 6, { color: C.line, width: 1 }); y += 22; };
  const sgColor = (v) => (v == null ? C.muted : v >= 0 ? C.green : C.red);
  const table = (cols, rows) => {
    const rh = 18;
    need(rh * (Math.min(rows.length, 3) + 1));
    d.rect(M, y - 12, W, rh, { fill: C.band });
    let x = M;
    for (const col of cols) { d.text(col.label, col.align === "right" ? x + col.w - 6 : x + 6, y + 1, { size: 8, bold: true, color: C.muted, align: col.align === "right" ? "right" : "left" }); x += col.w; }
    y += rh;
    rows.forEach((r) => {
      need(rh);
      x = M;
      cols.forEach((col, i) => {
        const cell = r[i]; const t = typeof cell === "object" && cell ? cell.t : cell;
        d.text(String(t ?? "\u2014"), col.align === "right" ? x + col.w - 6 : x + 6, y + 1, { size: 9, bold: !!cell?.b, color: cell?.c || C.ink, align: col.align === "right" ? "right" : "left" });
        x += col.w;
      });
      d.line(M, y + 6, M + W, y + 6, { color: C.line, width: 0.6 });
      y += rh;
    });
    y += 8;
  };

  // ---- the headline numbers ----
  section("Overall");
  const boxes = [["SG per round", fmtSG(a.overall.value), sgColor(a.overall.value)], ["Rounds", String(a.overall.rounds), C.ink],
    ["Rank", a.overall.rank ? `${a.overall.rank} of ${a.overall.of}` : "\u2014", C.ink], ["Other players", fmtSG(a.overall.fieldAvg), C.muted]];
  const bw = (W - 18) / 4;
  boxes.forEach(([l, v, c], i) => { const x = M + i * (bw + 6); d.rect(x, y - 4, bw, 50, { fill: C.band }); d.text(l.toUpperCase(), x + 10, y + 10, { size: 7.5, bold: true, color: C.muted }); d.text(v, x + 10, y + 36, { size: 17, bold: true, color: c }); });
  y += 62;
  if (a.overall.rounds === 0) { d.para("No rounds in this period for the chosen categories.", M, y, W, { size: 10, color: C.muted }); footer(); return d.output(); }
  table([{ label: "Category", w: 170 }, { label: "SG / round", w: 90, align: "right" }, { label: "Other players", w: 100, align: "right" }, { label: "Rank", w: 80, align: "right" }, { label: "Best player", w: W - 440, align: "right" }],
    a.byCat.map((c) => [c.name, { t: fmtSG(c.value), b: true, c: sgColor(c.value) }, fmtSG(c.fieldAvg), c.rank ? `${c.rank} of ${c.of}` : "\u2014", c.best && c.rank !== 1 ? `${fmtSG(c.best.v)}` : c.rank === 1 ? "(this player)" : "\u2014"]));
  if (a.byCat.length > 1) { need(180); const cc = catChart(a.byCat); d.image(cc.toDataURL("image/jpeg", 0.9), M, y, W, W * cc.height / cc.width, cc.width, cc.height); y += W * cc.height / cc.width + 4;
    d.text("Green / red: this player   \u00b7   Grey: the other players' average", M, y + 8, { size: 8, color: C.muted }); y += 22; }

  // ---- focus areas, near the top ----
  section(`Top ${a.focus.length || ""} things to work on`.replace("  ", " "));
  if (!a.focus.length) y = d.para("Nothing stands out as costing strokes against the other players in this period. Keep doing what's working.", M, y, W, { size: 10 });
  a.focus.forEach((f, i) => {
    const lines = wrap(`${f.detail} ${f.tip}`, W - 34, 9.5);
    need(22 + lines.length * 13);
    d.rect(M, y - 12, 22, 22, { fill: C.head }); d.text(String(i + 1), M + 11, y + 4, { size: 11, bold: true, color: "#ffffff", align: "center" });
    d.text(f.title, M + 32, y + 2, { size: 11, bold: true });
    d.text(`about ${Math.abs(f.lost).toFixed(2)} strokes / round`, M + W, y + 2, { size: 9, bold: true, color: C.red, align: "right" });
    y += 16;
    for (const line of lines) { d.text(line, M + 32, y, { size: 9.5, color: "#333333" }); y += 13; }
    y += 8;
  });

  // ---- AI summary (when set up) ----
  if (aiSummary) { section("Coach's summary (written by AI from these numbers)"); y = d.para(aiSummary, M, y, W, { size: 10 }); y += 6; }

  // ---- trends ----
  section("Trends", 210);
  if (a.series.length >= 2) {
    need(200); const tc = trendChart(a.series);
    d.image(tc.toDataURL("image/jpeg", 0.9), M, y, W, W * tc.height / tc.width, tc.width, tc.height); y += W * tc.height / tc.width + 4;
    d.text("Each bar: one round's strokes gained   \u00b7   Gold line: average of the last 5 rounds", M, y + 8, { size: 8, color: C.muted }); y += 22;
  }
  if (a.slope != null) {
    const per10 = a.slope * 10;
    y = d.para(`Over these ${a.series.length} rounds the trend is ${Math.abs(per10) < 0.1 ? "flat" : per10 > 0 ? "improving" : "declining"}: about ${fmtSG(per10)} strokes gained per round every 10 rounds.`, M, y, W, { size: 10 }) + 4;
  }
  if (a.series.length >= 4) table([{ label: "Category", w: 170 }, { label: "Early in the period", w: 120, align: "right" }, { label: "Lately", w: 110, align: "right" }, { label: "Change", w: W - 400, align: "right" }],
    a.catTrend.map((t) => [t.name, fmtSG(t.early), fmtSG(t.late), { t: fmtSG(t.change), b: true, c: sgColor(t.change) }]));

  // ---- peaks and valleys ----
  section("Peaks and valleys");
  const pv = (s) => [fmtDate(s.date), `${s.event || ""}${s.roundNo ? ` R${s.roundNo}` : ""}`.slice(0, 34), { t: fmtSG(s.value), b: true, c: sgColor(s.value) }, `${CAT_NAME[s.best[0]] || ""} ${fmtSG(s.best[1])}`, `${CAT_NAME[s.worst[0]] || ""} ${fmtSG(s.worst[1])}`];
  const pvCols = [{ label: "Date", w: 82 }, { label: "Event", w: 170 }, { label: "SG", w: 60, align: "right" }, { label: "Best part", w: (W - 312) / 2, align: "right" }, { label: "Weakest part", w: (W - 312) / 2, align: "right" }];
  need(100); d.text("Best rounds", M, y, { size: 10, bold: true }); y += 16; table(pvCols, a.peaks.map(pv));
  need(100); d.text("Toughest rounds", M, y, { size: 10, bold: true }); y += 16; table(pvCols, a.valleys.map(pv));

  // ---- where the strokes come from (distance / lie) ----
  const strongest = [...a.groups].filter((g) => g.shots >= Math.max(5, a.overall.rounds * 0.5)).sort((p, q) => q.perRound - p.perRound);
  if (strongest.length) {
    section("Strengths and weaknesses by distance and lie");
    const row = (g) => [`${CAT_NAME[g.cat]} ${g.word} ${g.label}`, String(Math.round(g.shots)), { t: fmtSG(g.perRound), b: true, c: sgColor(g.perRound) }, fmtSG(g.fieldAvg)];
    const cols = [{ label: "Where", w: 250 }, { label: "Shots", w: 70, align: "right" }, { label: "SG / round", w: 90, align: "right" }, { label: "Other players", w: W - 410, align: "right" }];
    need(110); d.text("Strongest", M, y, { size: 10, bold: true }); y += 16; table(cols, strongest.slice(0, 4).map(row));
    need(110); d.text("Weakest", M, y, { size: 10, bold: true }); y += 16; table(cols, strongest.slice(-4).reverse().map(row));
  }

  // ---- by product ----
  if (a.products) {
    section("By product (club models)");
    if (!a.products.length) y = d.para("No club information on these shots: clubs come from Data Entry (with WITB) or a club column in an uploaded file.", M, y, W, { size: 10, color: C.muted });
    else table([{ label: "Club", w: 230 }, { label: "Shots", w: 60, align: "right" }, { label: "Rounds", w: 60, align: "right" }, { label: "SG / shot", w: 80, align: "right" }, { label: "SG total", w: W - 430, align: "right" }],
      a.products.slice(0, 18).map((p) => [p.club, String(Math.round(p.shots)), String(p.rounds), { t: fmtSG(p.perShot, 3), b: true, c: sgColor(p.perShot) }, fmtSG(p.total)]));
  }
  need(30);
  d.para(`Compared with ${a.players - 1} other player${a.players === 2 ? "" : "s"} over the same dates and categories. ${a.detail ? "" : "Ranks use per-category totals."} Insights are calculated from the numbers above.`, M, y + 4, W, { size: 8, color: C.muted });
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
