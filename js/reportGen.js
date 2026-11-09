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
import { watchClientDatasets, getDatasetRows, getFieldStats, uploadDocument, logReportRun } from "./store.js";
import { detectColumns, isShotData, prepare, summaryPlayers, sliceTotals, sgBy, CATEGORIES, shortDate, defaultMinRounds, statRounds, statAgg, statDef, fmtStat, statsIn, gearInfo, formWord } from "./sg.js";
import { watchPlayerRounds, getAllRounds } from "./rounds.js";
import { roundToPrepared, enteredPlayers, ENTERED_IDX } from "./roundCalc.js";
import { PdfDoc, wrap, textWidth } from "./pdfLite.js";
import { eventBarsOf, drawEventBars, eventBarsHeight } from "./pdfCharts.js";
// (update 666) no champagne / gold in the bars: that colour is the rolling-average line's
const PROD_COLORS = ["#2f9bff", "#30d158", "#ff9f0a", "#bf5af2", "#ff453a", "#64d2ff", "#ff375f", "#5e5ce6", "#00c7be", "#a2845e"];

const CAT_NAME = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));
const STEADY = 0.05; // a change smaller than ±0.05 strokes a round counts as steady
// always 2 decimals (the Detail list)
const fmt2 = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
// (tiny numbers get a third decimal, so nothing shows as "−0.00")
const fmtSG = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(v !== 0 && Math.abs(v) < 0.5 * 10 ** -dp ? dp + 1 : dp)}`);
const day = (d) => { const t = typeof d === "number" ? d : Date.parse(d); return Number.isFinite(t) ? t : null; }; // (a date, or a time in ms)
const fmtDate = (d) => { const t = day(d); return t == null ? String(d || "") : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* ============================== the numbers ============================== */
/**
 * me: { key, label, rounds }  field: [{ key, label, rounds, summaryOnly? }]  (prepared rounds, as on the stats page)
 * opts: { from, to (ms or null), cats: ["OTT", …], byProduct, idx }
 */
/** (update 252) What the AI summary is given: the headline numbers, each part of the game, the trend, the strengths
 *  and what's costing strokes, the best and toughest rounds. Not every round (that's what made each summary cost
 *  about 3 cents). */
export function aiDigest(a) {
  const pick = (o, ks) => (o ? Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, o[k]])) : null);
  const rd = (x) => ({ event: x.event, date: String(x.date || "").slice(0, 10), round: x.roundNo, sg: x.value });
  return {
    player: a.me?.label, from: a.from ? String(new Date(a.from).toISOString()).slice(0, 10) : null, to: a.to ? String(new Date(a.to).toISOString()).slice(0, 10) : null,
    tour: a.tour || null, comparedWith: a.compared, minRounds: a.minRounds,
    overall: pick(a.overall, ["value", "rounds", "rank", "of", "fieldAvg"]),
    byCategory: (a.byCat || []).map((c) => pick(c, ["name", "value", "rank", "of", "fieldAvg"])),
    trendByCategory: (a.catTrend || []).map((t) => ({ cat: t.cat, change: t.change })),
    form: a.form ? pick(a.form, ["first", "last"]) : null, halves: a.halves ? pick(a.halves, ["n", "early", "late"]) : null,
    strengths: (a.elite || []).map((e) => e.title), rising: (a.rising || []).map((r) => r.title),
    costingStrokes: (a.focus || []).slice(0, 4).map((f) => ({ title: f.title, detail: f.detail })),
    bestEvents: (a.peaks || []).slice(0, 3).map(rd), toughestEvents: (a.valleys || []).slice(0, 3).map(rd), // (update 547)
  };
}
// (update 556) a trend, the last stretch first: "Last 12 rounds gained +0.54 a round. 12 rounds before that gained +0.17 a round."
const gl = (v) => (v != null && v < 0 ? `lost ${Math.abs(v).toFixed(2)}` : `gained ${fmtSG(v)}`);
const trendWords = (n, w, t) => `Last ${n} ${w} ${gl(t.late)} a round. ${n} ${w} before that ${gl(t.early)} a round.`;
export function analyzePerformance(me, field, { from = null, to = null, cats: catsIn = CATEGORIES.map(([k]) => k), byProduct = false, idx = {}, minRounds = null, tour = null, years = null } = {}) {
  const cats = CATEGORIES.map(([k]) => k).filter((k) => catsIn.includes(k));
  // (update 550) years: seasons, as the Stats page counts them (the file's year, so December's events in next year's
  // season), in place of the dates
  const ySet = years?.length ? new Set(years.map(String)) : null;
  const inRange = ySet ? (rd) => ySet.has(String(rd.year || String(rd.date || "").slice(0, 4))) : (rd) => { const t = day(rd.date); return t == null || ((from == null || t >= from) && (to == null || t <= to)); };
  // Only rounds with strokes-gained data count (a file's other stats, such as Birdies / Round per tournament, make
  // rounds of their own that would otherwise count as rounds with no strokes gained), and only the Stats page's tour.
  const hasSG = (rd) => (rd.has ? rd.has.has("sg") : rd.shots.length > 0);
  const onTour = (rd) => tour == null || (rd.tour || "") === tour;
  const pick = (rounds) => rounds.filter((rd) => hasSG(rd) && onTour(rd) && inRange(rd)).map((rd) => ({ ...rd, shots: rd.shots.filter((s) => cats.includes(s.cat)) }))
    .sort((a, b) => (day(a.date) ?? 0) - (day(b.date) ?? 0));
  const mine = pick(me.rounds);
  const played = field.filter((p) => p.key !== me.key).map((p) => ({ ...p, rounds: pick(p.rounds) })).filter((p) => p.rounds.length);
  // Tour Avg, ranks and Elite use the same players as the Stats page: at least Min. rounds in this period
  // (the number set on the Stats page, or its default: 33% of the most rounds played, down to a 5)
  const minR = Number(minRounds) >= 1 ? Math.round(Number(minRounds)) : defaultMinRounds(Math.max(mine.length, ...played.map((p) => p.rounds.length)));
  const others = played.filter((p) => p.rounds.length >= minR);
  const everyone = [{ key: me.key, label: me.label, rounds: mine }, ...others];
  const detail = !field.some((p) => p.summaryOnly);
  const perRound = (rounds, cat) => sliceTotals(cat ? rounds.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => s.cat === cat) })) : rounds).sgPerRound;

  // overall and by category, with ranks
  const rankOf = (cat) => {
    const vals = everyone.map((p) => ({ key: p.key, v: perRound(p.rounds, cat) })).filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
    const i = vals.findIndex((x) => x.key === me.key);
    const fieldVals = vals.filter((x) => x.key !== me.key).map((x) => x.v);
    return { rank: i >= 0 && vals.length > 1 ? i + 1 : null, of: vals.length, fieldAvg: mean(fieldVals), best: vals[0] || null, low: vals[vals.length - 1] || null };
  };
  const overall = { value: perRound(mine), rounds: mine.length, ...rankOf(null) };
  const byCat = cats.map((k) => ({ cat: k, name: CAT_NAME[k], value: perRound(mine, k), ...rankOf(k) }));

  // (update 227) Weekly Rank History, as on the Stats page's hero card: their rank at the end of each tournament, on
  // the rounds so far in this period, among the players with enough rounds by then (Min. rounds, scaled)
  const rankHist = (() => {
    const pool = [{ key: me.key, rs: mine }, ...played.map((p) => ({ key: p.key, rs: p.rounds }))];
    if (pool.length < 2) return [];
    const dk = (d) => String(d || "");
    const ends = new Map(); for (const rd of mine) { const k = `${rd.event}|${String(rd.year || dk(rd.date).slice(0, 4))}`; if (dk(rd.date) > (ends.get(k) || "")) ends.set(k, dk(rd.date)); }
    let dates = [...new Set(ends.values())].sort();
    if (dates.length > 60) { const step = (dates.length - 1) / 59; dates = Array.from({ length: 60 }, (_, i) => dates[Math.round(i * step)]); }
    const sorted = pool.map((p) => ({ key: p.key, rs: [...p.rs].sort((a, b) => dk(a.date).localeCompare(dk(b.date))) }));
    const cum = sorted.map((p) => { let t = 0; return p.rs.map((rd) => { for (const x of rd.shots) t += x.sg; return t; }); });
    const mostNow = Math.max(1, ...sorted.map((p) => p.rs.length));
    const upTo = (rs, d) => { let lo = 0, hi = rs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dk(rs[m].date) <= d) lo = m + 1; else hi = m; } return lo; };
    const out = [];
    for (const d of dates) {
      const counts = sorted.map((p) => upTo(p.rs, d)), most = Math.max(1, ...counts), need = Math.max(1, Math.round((minR * most) / mostNow));
      const vals = [];
      sorted.forEach((p, i) => { const n = counts[i]; if (!n || (n < need && p.key !== me.key)) return; vals.push({ key: p.key, v: cum[i][n - 1] / n }); });
      vals.sort((a, b) => b.v - a.v);
      const i = vals.findIndex((x) => x.key === me.key);
      if (i >= 0 && vals.length > 1) out.push({ date: d, rank: i + 1, of: vals.length });
    }
    if (out.length && overall.rank) Object.assign(out[out.length - 1], { rank: overall.rank, of: overall.of }); // (update 664: ends at their current rank)
    return out;
  })();
  // each round, trend line, early vs late by category
  const series = mine.map((rd) => ({ date: rd.date, event: rd.event, roundNo: rd.roundNo, value: rd.shots.reduce((t, s) => t + s.sg, 0),
    byCat: Object.fromEntries(cats.map((k) => [k, rd.shots.filter((s) => s.cat === k).reduce((t, s) => t + s.sg, 0)])) }));
  let slope = null;
  if (series.length >= 3) {
    const xs = series.map((_, i) => i), mx = mean(xs), my = mean(series.map((s) => s.value));
    slope = xs.reduce((t, x, i) => t + (x - mx) * (series[i].value - my), 0) / xs.reduce((t, x) => t + (x - mx) ** 2, 0);
  }
  // (update 553, 554) every tour, the DP World Tour too: the last 12 rounds against the 12 before
  const isD = (t) => /^(dpwt|dp world tour)$/i.test(String(t || "").trim());
  const byEvent = isD(tour) || (mine.length > 0 && mine.every((rd) => isD(rd.tour)));
  // (update 581) the DP World Tour: trends by event, the last 3 events against the 3 before (each event's rounds pooled);
  // every other tour: the last 12 rounds against the 12 before
  const unitW = byEvent ? "events" : "rounds";
  const units = byEvent ? (() => { const m = new Map(); for (const q of series) { const k = `${q.event || q.date}|${String(q.date || "").slice(0, 4)}`; (m.get(k) || m.set(k, []).get(k)).push(q); } return [...m.values()]; })() : series.map((q) => [q]);
  const half = Math.min(byEvent ? 5 : 20, /* (update 663: 20 rounds) */ /* (update 606: the DP World Tour: 5 events) */ Math.floor(units.length / 2));
  const late = units.slice(units.length - half).flat(), early = units.slice(units.length - 2 * half, units.length - half).flat(); // the last 12 vs the 12 before them
  const span = (list) => (list.length ? `${fmtDate(list[0].date)} \u2013 ${fmtDate(list[list.length - 1].date)}` : "");
  const halves = half >= (byEvent ? 1 : 2) ? { n: half, unit: unitW, early: span(early), late: span(late) } : null;
  const netTrend = (() => { const a = mean(early.map((q) => q.value)), b = mean(late.map((q) => q.value)); return a != null && b != null ? b - a : null; })(); // (update 650)
  const catTrend = cats.map((k) => {
    const a = mean(early.map((s) => s.byCat[k])), b = mean(late.map((s) => s.byCat[k]));
    return { cat: k, name: CAT_NAME[k], early: a, late: b, change: a != null && b != null ? b - a : null };
  });
  // (update 556) Better / Worse in "Where the strokes come from": how far the last 12 rounds have moved the average: the
  // whole period against the whole period without them
  const shiftN = 20 /* (update 663) */, restS = series.slice(0, Math.max(0, series.length - shiftN));
  const catShift = series.length > shiftN && restS.length >= 3 ? cats.map((k) => { const a1 = mean(series.map((q) => q.byCat[k])), b1 = mean(restS.map((q) => q.byCat[k])); return { cat: k, all: a1, rest: b1, change: a1 != null && b1 != null ? a1 - b1 : null }; }) : null;
  const shiftSpan = catShift ? { n: shiftN, last: span(series.slice(-shiftN)), all: span(series) } : null;
  // (update 547) the best and toughest EVENTS (strokes gained a round in each tournament), not single rounds
  const evUnits = (() => { const m = new Map(); for (const q of series) { const k = `${q.event || q.date}|${String(q.date || "").slice(0, 4)}`; (m.get(k) || m.set(k, []).get(k)).push(q); }
    return [...m.values()].map((g) => ({ date: g.at(-1).date, event: g[0].event, roundNo: "", rounds: g.length, value: mean(g.map((q) => q.value)), byCat: Object.fromEntries(cats.map((k) => [k, mean(g.map((q) => q.byCat[k] ?? 0))])) })); })();
  const ranked = [...evUnits].sort((a, b) => b.value - a.value);
  const peaks = ranked.slice(0, Math.min(3, ranked.length));
  const valleys = ranked.slice(-Math.min(3, ranked.length)).reverse();
  const bestCat = (s) => cats.map((k) => [k, s.byCat[k]]).sort((a, b) => b[1] - a[1])[0];
  const worstCat = (s) => cats.map((k) => [k, s.byCat[k]]).sort((a, b) => a[1] - b[1])[0];

  // Skills: each category by distance, and by distance + lie (e.g. Approach, 150-175 yds, from the rough),
  // with the other players' average and this player's rank among everyone who has that skill.
  const skillsOf = (rounds, cat) => {
    const m = new Map();
    for (const rd of rounds) for (const sh of rd.shots) {
      if (sh.cat !== cat || !sh.dist) continue;
      for (const key of [String(sh.dist), sh.lie ? `${sh.dist}|${sh.lie}` : null]) {
        if (!key) continue;
        const g = m.get(key) || { sg: 0, shots: 0 };
        g.sg += sh.sg; g.shots += sh.w || 1; m.set(key, g);
      }
    }
    for (const g of m.values()) g.perRound = g.sg / Math.max(1, rounds.length);
    return m;
  };
  const skillLabel = (cat, key) => { const [dist, lie] = key.split("|"); return lie ? `${CAT_NAME[cat]}, ${dist}, from the ${String(lie).toLowerCase()}` : `${CAT_NAME[cat]}, ${dist}`; };
  const groups = [];
  for (const k of cats) {
    const mineSk = skillsOf(mine, k);
    const othersSk = detail ? others.map((p) => skillsOf(p.rounds, k)) : [];
    for (const [key, g] of mineSk) {
      // a distance + lie that's all the shots at that distance (every putt is from the green) repeats it:
      // marked, so the highlight cards skip it (Detail shows Approach / Around-the-Green combos in full)
      const repeat = key.includes("|") && mineSk.get(key.split("|")[0])?.shots === g.shots;
      const vals = othersSk.map((m) => m.get(key)).filter((x) => x && x.shots >= 3).map((x) => x.perRound);
      const all = [...vals, g.perRound].sort((p, q) => q - p);
      groups.push({ repeat, cat: k, key, word: "", label: key.includes("|") ? key.split("|").join(", from the ") : key, title: skillLabel(k, key), withLie: key.includes("|"),
        perRound: g.perRound, shots: g.shots, fieldAvg: mean(vals), rank: vals.length ? all.indexOf(g.perRound) + 1 : null, of: vals.length ? all.length : null,
        top10: vals.length >= 5 ? [...vals].sort((p, q) => q - p)[Math.floor(0.1 * (vals.length - 1))] : null }); // (update 650: the Tour's best 10% mark)
    }
  }

  // by product: club models (the club as recorded on each shot)
  let products = null;
  if (false) { // (update 274: replaced by the by-product page, which compares models of the same kind of club)
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
  // (update 274) by product, always: each kind of club (and the ball) the player has used more than one model of,
  // with strokes gained a round with each model (in the rounds it was used) and the stats recorded with it. A kind
  // with only one model (one driver all year, one ball) is shown too (update 551).
  let productTable = null;
  if (byProduct) {
    const STATS = { OTT: [["drive", "Driving Distance"], ["ballSpeed", "Ball Speed"], ["fwy", "Fairway %"]], APP: [["hitGreen", "Hit Green %"], ["prox", "Proximity"]], PUTT: [["make", "Made Putt %"], ["goodLag", "Good Lag %"]] };
    const KINDS = [["Driver", "Drivers", STATS.OTT], ["Non-Driver", "Non-Driver Woods", STATS.OTT], ["Fairway Wood", "Fairway Woods", STATS.APP], ["Hybrid", "Hybrids", STATS.APP], ["Iron", "Irons", STATS.APP],
      ["Wedge", "Wedges", STATS.APP], ["Putter", "Putters", STATS.PUTT], ["Ball", "Balls", []]]; // (update 522: a ball: strokes gained in each part of the game instead)
    // (update 522) the strokes gained shown for each kind: its own part of the game (a ball: the total, then each part)
    const SGC = { Driver: [["SG OTT / Rd", "OTT"]], "Non-Driver": [["SG OTT / Rd", "OTT"]], "Fairway Wood": [["SG APP / Rd", "APP"]], Hybrid: [["SG APP / Rd", "APP"]], Iron: [["SG APP / Rd", "APP"]],
      Wedge: [["SG ARG / Rd", "ARG"]], Putter: [["SG PUTT / Rd", "PUTT"]], Ball: [["SG Total / Rd", null], ["SG OTT / Rd", "OTT"], ["SG APP / Rd", "APP"], ["SG ARG / Rd", "ARG"], ["SG PUTT / Rd", "PUTT"]] };
    const ofShot = (s) => [s.gear, s.ball ? `Ball|${s.ball}` : null].filter(Boolean);
    const m = new Map();
    for (const rd of mine) {
      for (const s of rd.shots) for (const v of ofShot(s)) { const g = m.get(v) || m.set(v, { value: v, info: gearInfo(v), sg: 0, byCat: {}, shots: 0, rounds: new Set(), obs: {} }).get(v); g.sg += s.sg; g.byCat[s.cat] = (g.byCat[s.cat] || 0) + s.sg; g.shots += s.w || 1; g.rounds.add(rd.key); }
      for (const o of rd.obs || []) for (const v of ofShot(o)) { const g = m.get(v); if (!g) continue; const x = g.obs[o.k] ||= { s: 0, w: 0 }; x.s += o.v * o.w; x.w += o.w; }
    }
    const known = new Set(KINDS.map(([k]) => k));
    const kinds = [...KINDS, ...[...new Set([...m.values()].map((g) => g.info.kind))].filter((k) => !known.has(k)).map((k) => [k, k, []])];
    productTable = kinds.map(([kind, name, stats]) => {
      const sgCols = SGC[kind] || [["SG / Rd", null]];
      const rows = [...m.values()].filter((g) => g.info.kind === kind).map((g) => { const n = Math.max(1, g.rounds.size), sgs = sgCols.map(([, c]) => (c ? (g.byCat[c] || 0) : g.sg) / n);
        return { label: `${g.info.brand} ${g.info.model}`.trim(), kind, rounds: g.rounds.size, shots: g.shots, perRound: sgs[0], sgs,
          stats: stats.map(([k]) => (g.obs[k]?.w ? { v: g.obs[k].s / g.obs[k].w, def: statDef(k) } : null)) }; })
        .sort((a, b) => b.perRound - a.perRound || b.rounds - a.rounds); // (update 521: best strokes gained a round first; 522: in its own part of the game)
      // (update 515) every event, coloured by the model used most in it: strokes gained a round with this kind's shots
      const vals = [...m.values()].filter((g) => g.info.kind === kind).sort((a, b) => b.rounds.size - a.rounds.size || b.sg - a.sg).map((g) => g.value);
      const colorOf = new Map(vals.map((v, i) => [v, PROD_COLORS[i % PROD_COLORS.length]]));
      const items = vals.map((v) => ({ key: v, name: `${gearInfo(v).brand} ${gearInfo(v).model}`.trim(), color: colorOf.get(v),
        rounds: mine.map((rd) => { let sg = 0, n = 0; for (const x of rd.shots) if (ofShot(x).includes(v)) { sg += x.sg; n += x.w || 1; } return n ? { event: rd.event, year: rd.year, date: rd.date, sg, shots: n } : null; }).filter(Boolean) }));
      return { cat: kind, name, statNames: stats.map(([, l]) => l), sgNames: sgCols.map(([l]) => l), rows, events: eventBarsOf(items), legend: items.map((it) => ({ name: it.name, color: it.color })) };
    }).filter((sec) => sec.rows.length); // (update 551: every kind used, one model too)
    if (!productTable.length) productTable = null;
  }

  // the top 3-5 things to work on: where the most strokes go, per round
  const focus = [];
  for (const c of byCat) {
    if (c.value == null) continue;
    const gap = c.fieldAvg != null ? c.value - c.fieldAvg : c.value;
    if (gap < -0.05) focus.push({ cat: c.cat, kind: "category", lost: -gap, title: `${c.name}`,
      detail: `${c.value >= 0 ? `Gains ${c.value.toFixed(2)}` : `Loses ${Math.abs(c.value).toFixed(2)}`} strokes a round${c.fieldAvg != null ? `, against a Tour Avg of ${fmtSG(c.fieldAvg)}` : ""}.${c.rank ? `\nRanked ${c.rank} of ${c.of}.` : ""}` }); // (update 574: the rank on its own line)
  }
  const minShots = Math.max(5, mine.length * 0.5);
  for (const g of groups) {
    if (g.shots < minShots || g.repeat) continue;
    const gap = g.fieldAvg != null ? g.perRound - g.fieldAvg : g.perRound;
    if (gap < -0.05) focus.push({ cat: g.cat, kind: "skill", label: g.label, lost: -gap, title: g.title,
      detail: `${g.perRound >= 0 ? `Gains only ${g.perRound.toFixed(2)}` : `Loses ${Math.abs(g.perRound).toFixed(2)}`} strokes a round${g.fieldAvg != null ? `, against a Tour Avg of ${fmtSG(g.fieldAvg)}` : ""}.\n${g.rank ? `Ranked ${g.rank} of ${g.of} \u00b7 ` : ""}${Math.round(g.shots)} shots.` });
  }
  for (const t of catTrend) if (t.change != null && t.change < -0.2) focus.push({ cat: t.cat, kind: "trend", lost: -t.change / 2, title: `Slipping: ${t.name}`,
    detail: `${trendWords(half, unitW, t)} That's ${Math.abs(t.change).toFixed(2)} strokes a round worse.` });
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
  // Strengths. ELITE means ranked in the top 10% of the players compared for that skill (with 6 players,
  // that's 1st), with at least 10 shots of it in the period.
  const isElite = (rank, of) => rank && of >= 2 && rank <= Math.max(1, Math.floor(of * 0.1));
  const elite = [];
  for (const c of byCat) {
    if (c.value == null || c.value <= 0 || !isElite(c.rank, c.of)) continue;
    elite.push({ kind: "category", cat: c.cat, score: 1 + (c.value - (c.fieldAvg ?? 0)), title: c.name,
      text: `Gains ${c.value.toFixed(2)} strokes a round${c.fieldAvg != null ? `, against a Tour Avg of ${fmtSG(c.fieldAvg)}` : ""}.\nRanked ${c.rank} of ${c.of}.` }); // (update 574: as Costing strokes words it)
  }
  for (const g of groups) {
    if (g.repeat || g.shots < Math.max(10, minShots) || g.perRound <= 0 || !isElite(g.rank, g.of)) continue;
    elite.push({ cat: g.cat, score: g.perRound - (g.fieldAvg ?? 0), title: g.title,
      text: `Gains ${g.perRound.toFixed(2)} strokes a round${g.fieldAvg != null ? `, against a Tour Avg of ${fmtSG(g.fieldAvg)}` : ""}.\nRanked ${g.rank} of ${g.of} \u00b7 ${Math.round(g.shots)} shots.` });
  }
  elite.sort((p, q) => q.score - p.score);
  // (update 574) the rest of the strengths: the biggest gains on the Tour Avg (a part of the game or a distance), so there are
  // three whenever there are three to find
  const strong = [];
  for (const c of byCat) { if (c.value == null || c.fieldAvg == null || c.value - c.fieldAvg < 0.05) continue;
    strong.push({ kind: "category", cat: c.cat, score: c.value - c.fieldAvg, title: c.name, text: `Gains ${c.value.toFixed(2)} strokes a round, against a Tour Avg of ${fmtSG(c.fieldAvg)}.${c.rank ? `\nRanked ${c.rank} of ${c.of}.` : ""}` }); }
  for (const g of groups) { if (g.repeat || g.shots < minShots || g.fieldAvg == null || g.perRound - g.fieldAvg < 0.05) continue;
    strong.push({ cat: g.cat, score: g.perRound - g.fieldAvg, title: g.title, text: `Gains ${g.perRound.toFixed(2)} strokes a round, against a Tour Avg of ${fmtSG(g.fieldAvg)}.\n${g.rank ? `Ranked ${g.rank} of ${g.of} \u00b7 ` : ""}${Math.round(g.shots)} shots.` }); }
  strong.sort((p, q) => q.score - p.score);
  const rising = catTrend.filter((t) => t.change != null && t.change >= 0.2).sort((p, q) => q.change - p.change).map((t) => ({
    cat: t.cat, title: t.early < 0 && t.late >= 0 ? `Turned it around: ${t.name}` : `On the rise: ${t.name}`,
    text: `${trendWords(half, unitW, t)} That's ${t.change.toFixed(2)} strokes a round better.` }));
  // recent form, in plain terms: the last 10 rounds against the first 10 (or halves when there are fewer)
  const n10 = half, fA = units.slice(-2 * n10, -n10).flat(), fB = units.slice(-n10).flat(); // (update 581: as the trends)
  // (update 670) and the overall direction for the form word: the last 50 rounds against the 50 before (20 events against 20)
  const nL = Math.min(byEvent ? 20 : 50, Math.floor(units.length / 2)), longCh = nL > n10 ? mean(units.slice(-nL).flat().map((q) => q.value)) - mean(units.slice(-2 * nL, -nL).flat().map((q) => q.value)) : null;
  const form = n10 >= (byEvent ? 1 : 2) ? { n: n10, unit: byEvent ? "event" : "round", first: mean(fA.map((q) => q.value)), last: mean(fB.map((q) => q.value)), firstSpan: span(fA), lastSpan: span(fB), long: Number.isFinite(longCh) ? longCh : null } : null;
  // By the numbers: rounds gaining strokes, the longest run of them, the steadiest and swingiest parts of the
  // game (how much each swings round to round), and the biggest upside (matching the group's best where the
  // player is furthest behind).
  // (update 523) DP World Tour data (one value an event, repeated on each of its rounds): these by event, not round
  const evOf = (list) => { const m = new Map(); for (const q of list) { const k = `${q.event || q.date}|${String(q.date || "").slice(0, 4)}`; (m.get(k) || m.set(k, []).get(k)).push(q); }
    return [...m.values()].map((g) => ({ date: g.at(-1).date, event: g[0].event, roundNo: "", value: mean(g.map((q) => q.value)), byCat: Object.fromEntries(cats.map((k) => [k, mean(g.map((q) => q.byCat[k] ?? 0))])) })); };
  const ser = byEvent ? evOf(series) : series;
  const posRounds = ser.filter((q) => q.value > 0).length;
  let run = 0, best = { len: 0, from: null, to: null }, start = null;
  ser.forEach((q, i) => { if (q.value > 0) { if (!run) start = i; run++; if (run > best.len) best = { len: run, from: ser[start].date, to: q.date }; } else run = 0; });
  const sd = (vals) => { const m = mean(vals); return vals.length > 1 ? Math.sqrt(vals.reduce((t, v) => t + (v - m) ** 2, 0) / (vals.length - 1)) : null; };
  const swings = cats.map((k) => ({ cat: k, sd: sd(ser.map((q) => q.byCat[k])) })).filter((x) => x.sd != null).sort((p, q) => p.sd - q.sd);
  // Biggest upside: the player's own best stretch (their best average over a run of rounds) in each category,
  // against their average now; the category where getting back to that is worth the most.
  const win = Math.min(12, Math.max(3, Math.floor(ser.length / 3)));
  const upside = ser.length >= win ? byCat.filter((c) => c.value != null).map((c) => {
    let bestAvg = -Infinity, at = 0;
    for (let i = 0; i + win <= ser.length; i++) { const v = mean(ser.slice(i, i + win).map((q) => q.byCat[c.cat] ?? 0)); if (v > bestAvg) { bestAvg = v; at = i; } }
    return { cat: c.cat, gain: bestAvg - c.value, bestV: bestAvg, now: c.value, win, from: ser[at].date, to: ser[at + win - 1].date };
  }).sort((p, q) => q.gain - p.gain)[0] || null : null;
  // one category: the other players' typical swing in it (Tour Avg steadiness)
  let tourSd = null;
  if (cats.length === 1) {
    const k = cats[0];
    const one = (rd) => ({ date: rd.date, event: rd.event, value: 0, byCat: { [k]: rd.shots.filter((x) => x.cat === k).reduce((t, x) => t + x.sg, 0) } });
    const sds = others.map((p) => { const rs = p.rounds.map(one); return sd((byEvent ? evOf(rs) : rs).map((q) => q.byCat[k])); }).filter((v) => v != null && Number.isFinite(v));
    tourSd = sds.length ? mean(sds) : null;
  }
  // (update 564) this season against last season (the season before the newest one in the report, from all their rounds on
  // the same tour, whether or not the report's dates cover it): strokes gained a round, in total and each category
  const yoy = (() => {
    const yr = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
    const ys = mine.map(yr).filter((v) => /^\d{4}$/.test(v)).sort();
    if (!ys.length) return null;
    const thisY = ys.at(-1), lastY = String(Number(thisY) - 1);
    const all = me.rounds.filter((rd) => hasSG(rd) && onTour(rd)).map((rd) => ({ ...rd, shots: rd.shots.filter((x) => cats.includes(x.cat)) }));
    const now = all.filter((rd) => yr(rd) === thisY), prev = all.filter((rd) => yr(rd) === lastY);
    if (now.length < 5 || prev.length < 5) return null;
    const rows = [{ k: null, name: "Total", now: perRound(now), prev: perRound(prev) }, ...cats.map((k) => ({ k, name: CAT_NAME[k], now: perRound(now, k), prev: perRound(prev, k) }))]
      .map((r) => ({ ...r, ch: r.now != null && r.prev != null ? r.now - r.prev : null }));
    return { thisY, lastY, nNow: now.length, nPrev: prev.length, rows };
  })();
  const numbers = { yoy, unit: byEvent ? "event" : "round", posRounds, n: ser.length, streak: best, steady: swings[0] || null, swingy: swings.length > 1 ? swings[swings.length - 1] : null, upside, tourSd };

  // Basic stats (page 4): every other stat in the data (Scoring Avg, GIR %, Putts / Round …), in the same period and
  // tour, ranked among the same players as strokes gained (the same Min. rounds list).
  const pickAll = (rounds) => rounds.filter((rd) => onTour(rd) && inRange(rd)).sort((p, q) => (day(p.date) ?? 0) - (day(q.date) ?? 0));
  const myAll = pickAll(me.rounds);
  const fieldByKey = new Map(field.map((p) => [p.key, p]));
  const othersAll = others.map((p) => ({ key: p.key, rounds: pickAll(fieldByKey.get(p.key)?.rounds || []) }));
  // one stat (optionally only some of its values: a distance band, a lie) -> its card's numbers, or null
  const entryFor = (k, keep = null, label = null) => {
    const def = statDef(k);
    const only = (rounds) => (keep ? rounds.map((rd) => ({ ...rd, shots: rd.shots.filter(keep) })) : rounds).filter((rd) => rd.shots.length);
    const mineK = only(statRounds(myAll, k));
    const value = statAgg(mineK, !!keep).value;
    if (value == null) return null;
    const vals = othersAll.map((p) => statAgg(only(statRounds(p.rounds, k)), !!keep).value).filter((v) => v != null && Number.isFinite(v));
    const better = (x, y) => (def.higher === false ? x < y : x > y);
    const all = [...vals, value];
    // (nobody else has it, e.g. a player's own report has no one else's distances: no rank)
    const rank = def.higher == null || !vals.length ? null : 1 + vals.filter((v) => better(v, value)).length;
    // the last 10 rounds (or events) against the 10 before, pooled
    const n = Math.min(20, Math.floor(mineK.length / 2)); // (update 663)
    const last = n >= 2 ? statAgg(mineK.slice(-n), !!keep).value : null, prev = n >= 2 ? statAgg(mineK.slice(-2 * n, -n), !!keep).value : null;
    // its value in each category it has (Hit Green %: Approach and Around-the-Green)
    const byCat = keep ? [] : CATEGORIES.map(([c, name]) => { const rs = mineK.map((rd) => ({ ...rd, shots: rd.shots.filter((o) => o.cat === c) })); const v = statAgg(rs, true).value; return v == null ? null : { cat: c, name, value: v }; }).filter(Boolean);
    // (out of every player compared, the same number for every stat: someone with no value for it, say no
    // eagles, or never in that spot, counts below everyone who has one)
    return { key: k, def: label ? { ...def, label } : def, value, rounds: mineK.length, events: mineK.length > 0 && mineK.every((rd) => rd.eventLevel), rank, of: rank ? everyone.length : null,
      fieldAvg: mean(vals), lo: Math.min(...all), hi: Math.max(...all), trend: last != null && prev != null ? { n, last, prev } : null, byCat: byCat.length > 1 ? byCat : [] };
  };
  // A distance label ("100-120 yds", "250+ yds", "<10 ft", "20-30 ft") -> { mid, lo } in yards and feet.
  const distOf = (label) => {
    const t = String(label || ""), nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    const ft = /ft|feet|'/i.test(t), lo = /^\s*</.test(t) ? 0 : nums[0], hi = nums.length > 1 ? nums[1] : /\+/.test(t) ? nums[0] * 1.2 : /^\s*</.test(t) ? nums[0] : nums[0];
    const mid = (lo + hi) / 2;
    return { yds: ft ? mid / 3 : mid, ftMid: ft ? mid : mid * 3, ftLo: ft ? lo : lo * 3 };
  };
  const lieOf = (l) => { const q = String(l || "").toLowerCase(); return q.includes("fairway") ? "Fairway" : q.includes("rough") ? "Rough" : q.includes("bunker") || q.includes("sand") ? "Bunker" : null; };
  // (the bands follow the data's own buckets: 100-120 and 120-140 make 100-140 yds, and so on)
  const BANDS = [["50-100 yds", 50, 100], ["100-140 yds", 100, 140], ["140-180 yds", 140, 180], ["180-220 yds", 180, 220], [">220 yds", 220, Infinity]];
  const present = statsIn([myAll]).filter((k) => k !== "sg");
  // Approach by distance: Hit Green %, Proximity, Pin-High % and On-Line % in five distance bands
  // (a bucket in the data goes in the band its middle falls in: 200-225 yds -> 180-220 yds)
  // (all four rows whenever the data has any of them; one the data doesn't have says so)
  const gridOn = ["hitGreen", "prox", "pinHigh", "onLine"].some((k) => present.includes(k));
  const grid = !gridOn ? [] : ["hitGreen", "prox", "pinHigh", "onLine"].map((k) => {
    if (!present.includes(k)) return { key: k, def: statDef(k), cells: [], overall: null, missing: true };
    const cells = BANDS.map(([lab, lo, hi]) => entryFor(k, (o) => { const d = distOf(o.dist); return !!d && (o.cat === "APP" || o.cat === "ARG") && d.yds >= lo && d.yds < hi; }, `${statDef(k).label} \u00b7 ${lab}`));
    // (a stat with no distances in the data: its row shows its overall value instead)
    return { key: k, def: statDef(k), cells, overall: cells.some(Boolean) ? null : entryFor(k) };
  });
  const gridKeys = new Set(grid.map((g) => g.key));
  const basics = [];
  // (update 571) for the Basic Stats page's charts: Scoring Avg at each event, and everyone's Driving Distance and Hit Fairway %
  const extraCharts = (() => {
    const yOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
    const sc = statRounds(myAll, "scoring"), evs = new Map();
    for (const rd of sc) { const k = `${rd.event || rd.date}|${yOf(rd)}`; (evs.get(k) || evs.set(k, []).get(k)).push(rd); }
    const scoring = [...evs.values()].map((rs) => ({ event: rs[0].event, date: rs.map((r) => String(r.date || "")).sort().at(-1), v: statAgg(rs).value })).filter((e) => e.v != null).sort((p, q) => p.date.localeCompare(q.date));
    const scField = mean(othersAll.map((p) => statAgg(statRounds(p.rounds, "scoring")).value).filter((v) => v != null && Number.isFinite(v)));
    const dv = (rounds, k) => statAgg(statRounds(rounds, k)).value;
    const pts = othersAll.map((p) => ({ d: dv(p.rounds, "drive"), f: dv(p.rounds, "fwy") })).filter((q) => q.d != null && q.f != null && Number.isFinite(q.d) && Number.isFinite(q.f));
    const mePt = { d: dv(myAll, "drive"), f: dv(myAll, "fwy") };
    return { scoring: scoring.length >= 3 && scField != null ? { events: scoring, fieldAvg: scField } : null, drive: pts.length >= 5 && mePt.d != null && mePt.f != null ? { pts, me: mePt } : null };
  })();
  const UD_BANDS = [["<30 yds", 0, 30], ["30-50 yds", 30, 50]], UD_LIES = ["Fairway", "Rough", "Bunker"];
  let udGrid = null, puttGrid = null;
  // Off-the-Tee: Driving Distance and Hit Fairway %, Driver and Non-Driver (the data's tee-shot "distance")
  // ("Tee Shot (Driver)", "Driver" -> Driver; "Tee Shot (Non-Driver)", "Non-Driver" -> Non-Driver). Both in the data:
  // two columns; otherwise one, with no heading.
  const kindOf = (dist) => { const q = String(dist || "").toLowerCase().replace(/[^a-z]/g, ""); return q.includes("nondriver") ? "Non-Driver" : q.includes("driver") ? "Driver" : null; };
  const teeKinds = new Set(["drive", "fwy"].flatMap((k) => statRounds(myAll, k).flatMap((rd) => rd.shots.filter((o) => o.cat === "OTT").map((o) => kindOf(o.dist)))));
  const teeSplit = teeKinds.has("Driver") && teeKinds.has("Non-Driver");
  // (GIR % goes here too; a stat the data doesn't split by club shows on an "All" row, with everyone's overall value)
  const teeGrid = ["drive", "ballSpeed", "fwy", "gir"].filter((k) => present.includes(k)).map((k) => {
    // (update 633) GIR % by club: its rows aren't marked as tee shots in the data (the Stats page reads them by their
    // Driver / Non-Driver distance alone), so for GIR the club is enough
    const split = teeSplit ? ["Driver", "Non-Driver"].map((kind) => entryFor(k, (o) => (k === "gir" || o.cat === "OTT") && kindOf(o.dist) === kind, `${statDef(k).label} \u00b7 ${kind}`)) : [];
    // the "All" value: its tee shots (par 4s and 5s) when the data has them, so GIR % here is the par 4 / 5 GIR %
    // (a par 3's green in regulation comes from an approach, which belongs in Approach)
    const tee = entryFor(k, (o) => o.cat === "OTT");
    return { key: k, def: statDef(k), cells: split.some(Boolean) ? split : [null, null].slice(0, split.length), all: tee || entryFor(k) };
  });
  const teeAllRow = !teeSplit || teeGrid.some((g) => !g.cells.some(Boolean));
  // Scoring by par: "Par 3 Scoring Avg" … in the data, or Scoring Avg rows marked Par 3 / 4 / 5
  const parScoring = [3, 4, 5].map((n) => {
    const k = `par${n}`, label = `Par ${n} Scoring Avg`;
    if (present.includes(k)) return entryFor(k);
    if (!present.includes("scoring")) return null;
    const re = new RegExp(`par\\s*${n}\\b`, "i");
    const e = entryFor("scoring", (o) => re.test(String(o.dist || "")) || re.test(String(o.lie || "")), label);
    return e ? { ...e, key: k } : null;
  });
  for (const k of present) {
    if (k === "goodLag" || k === "drive" || k === "ballSpeed" || k === "fwy" || k === "par3" || k === "par4" || k === "par5") continue; // (Good Lag isn't shown; the tee stats are a grid)
    if (k === "make") {
      // Made Putt %: each putting distance in the data (0-3 ft, 3-5 ft …), in a grid on the page
      const labels = [...new Set(statRounds(myAll, k).flatMap((rd) => rd.shots.filter((o) => o.cat === "PUTT" && o.dist).map((o) => String(o.dist))))]
        .sort((p, q) => (distOf(p)?.ftMid ?? 0) - (distOf(q)?.ftMid ?? 0)).slice(0, 8);
      const cells = labels.map((lab) => entryFor(k, (o) => o.cat === "PUTT" && String(o.dist) === lab, `Made Putt % \u00b7 ${lab}`));
      if (cells.some(Boolean)) { puttGrid = { labels, cells }; continue; }
    }
    if (gridKeys.has(k)) continue;
    if (k === "ud") {
      // Up & Down %: inside 30 yds and 30-50 yds, from the fairway, the rough and a bunker (a grid on the page)
      const cells = UD_BANDS.map(([band, lo, hi]) => UD_LIES.map((lie) => entryFor(k, (o) => { const d = distOf(o.dist); return !!d && d.yds >= lo && d.yds < hi && lieOf(o.lie) === lie; }, `Up & Down % \u00b7 ${band} \u00b7 ${lie}`)));
      if (cells.flat().some(Boolean)) { udGrid = { bands: UD_BANDS.map(([b]) => b), lies: UD_LIES, cells }; continue; }
    }
    if (k === "goodLag") {
      // Good Lag %: only putts from over 25 feet
      const far = entryFor(k, (o) => { const d = distOf(o.dist); return !!d && (d.ftLo >= 25 || d.ftMid > 25); }, "Good Lag % \u00b7 25+ ft");
      if (far) { basics.push(far); continue; }
    }
    const e = entryFor(k);
    if (e) basics.push(e);
  }
  return { catShift, shiftSpan, me: { key: me.key, label: me.label }, cats, from: ySet && series.length ? day(series[0].date) : from, to: ySet && series.length ? day(series.at(-1).date) : to, overall, // (update 550: seasons: their first and last rounds)
    byCat, series, rankHist, slope, catTrend, netTrend, numbers, elite: elite.filter((e) => e.kind !== "category").slice(0, 4), eliteAll: elite, strong, rising, focusAll: focus, form, halves, peaks: peaks.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })),
    minShots, extraCharts, formSeries: ser, unit: byEvent ? "event" : "round", valleys: valleys.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })), groups, products, productTable, focus: top, players: everyone.length, detail, minRounds: minR, compared: others.length, tour, basics, grid, bands: BANDS.map(([l]) => l), udGrid, puttGrid, teeGrid, teeSplit, teeAllRow, parScoring: parScoring.some(Boolean) ? parScoring : null,
    shotlink: [...new Set(mine.concat(myAll).map((rd) => String(rd.tour || "")))].some((t) => /^(pga|korn)/i.test(t)) };
}

/* ============================== the PDF ============================== */
// Premium but lively: a dark gradient hero with a gold edge and one big number, badges, coloured insight cards
// (strengths in green, things to watch in red), gauge bars, and plain-English sentences under every number.
const P = {
  night: "#0a0a0b", night2: "#16201a", ink: "#1d1d1f", grey: "#5f6368", soft: "#86868b", faint: "#a1a1a6", hair: "#e3e3e8", mist: "#f5f5f7",
  gold: "#b08d57", goldLight: "#d4b483", up: "#1e8e4a", upDeep: "#14703a", upTint: "#e7f5ec", down: "#d0342c", downDeep: "#a8241e", downTint: "#fdecea",
  track: "#eceef1", note: "#faf6ee",
};
// Rank colours (the front page's rank badge, the categories' ranks and the Basic Stats page):
// top 10 bright green, 11-50 green, 51-100 yellow, 101-150 orange, past 150 red. [fill, text on it]
const rankColors = (rank) => (rank <= 10 ? ["#34c759", "#0a2a12"] : rank <= 50 ? ["#1e8e4a", "#ffffff"] : rank <= 100 ? ["#f5c400", "#2a2200"] : rank <= 150 ? ["#f08a24", "#ffffff"] : ["#d0342c", "#ffffff"]);
// the same colour for text on white (bright green and yellow darkened so they read)
const rankInk = (rank) => (rank <= 10 ? "#1f9d47" : rank <= 50 ? "#1e8e4a" : rank <= 100 ? "#b38a00" : rank <= 150 ? "#d9741a" : "#d0342c");
// This file's build (update 161): taken from its own URL when it's loaded with ?v= (as the Stats page does), so it
// can't fall behind the way a typed-in number did (it said 156 while the site moved on, so the report never ran).
// Loaded without a version, it's the page's own copy and there's nothing to check.
export const REPORT_BUILD = (() => { try { return new URL(import.meta.url).searchParams.get("v"); } catch { return null; } })();
export function buildReportPdf(a, { aiSummary = null, sourceLabel = "", logo = null, rangeLabel = null } = {}) {
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
    cap(a.shotlink ? "Tour Analytics  \u00b7  Powered by ShotLink" : "Tour Analytics", M, H - 20, P.faint); // (ShotLink: PGA TOUR / Korn Ferry data only)
    cap(`${a.me.label}  \u00b7  Page ${page}`, M + W, H - 20, P.faint, "right");
  };
  const newPage = () => { footer(); d.addPage(); page++; y = 46; };
  const need = (h) => { if (y + h > H - 50) newPage(); };
  const section = (kicker, title, room = 80) => {
    y += 12; // breathing room between sections
    need(40 + room);
    d.rect(M, y - 7, 3, 9, { fill: P.gold });
    cap(kicker, M + 9, y, P.gold); y += 23;
    d.text(title, M, y, { size: 17, bold: true, color: P.ink }); y += 14;
  };
  const badge = (text, x, yy, fill, color = "#ffffff") => {
    const T = text.toUpperCase(), w = textWidth(T, 7, true) + 1.1 * (T.length - 1) + 16;
    d.roundRect(x, yy - 10, w, 15, 7.5, { fill });
    d.text(text.toUpperCase(), x + 8, yy, { size: 7, bold: true, spacing: 1.1, color });
    return w;
  };
  const ma = (vals, n = 10) => vals.map((_, i) => mean(vals.slice(Math.max(0, i - n + 1), i + 1)));

  /* ---------- hero ---------- */
  const heroH = 236;
  d.gradient(0, 0, d.W, heroH, P.night, P.night2, { dir: "v", steps: 60 });
  d.gradient(0, heroH - 3, d.W, 3, P.gold, P.goldLight, { dir: "h", steps: 40 });
  cap("Performance Report", M, 40, P.goldLight, "left", 7.5);
  if (logo) { const lh = Math.min(26, (logo.h / logo.w) * 150), lw = (logo.w / logo.h) * lh; d.image(logo.dataUrl, M + W - lw, 24, lw, lh, logo.pw, logo.ph); }
  d.text(wrap(a.me.label, W * 0.6, 30, true)[0], M, 78, { size: 30, bold: true, color: "#ffffff" });
  // the period: the preset you picked ("Last 30 days", "All time" …) or your dates (2/14/26 – 4/20/26)
  const short = (t) => shortDate(new Date(t));
  const period = rangeLabel || (a.from != null || a.to != null ? `${a.from != null ? short(a.from) : "start"} \u2013 ${a.to != null ? short(a.to) : "today"}` : "All time");
  d.text(period, M, 96, { size: 8.5, color: "#8e8e93" });
  cap("Strokes gained per round", M, 122, "#8e8e93");
  d.text(a.overall.rounds ? fmtSG(a.overall.value) : "\u2014", M - 3, 172, { size: 62, bold: true, color: a.overall.value >= 0 ? "#7ee2a2" : "#ff8a80", spacing: -1.5 });
  const versus = a.overall.fieldAvg != null && a.overall.value != null ? a.overall.value - a.overall.fieldAvg : null;
  wrap(a.overall.rounds ? (versus != null ? `${Math.abs(versus).toFixed(2)} strokes a round ${versus >= 0 ? "better" : "worse"} than Tour Avg (${fmtSG(a.overall.fieldAvg)}).` : "") : "No rounds in this period.", W * 0.56, 9.5)
    .slice(0, 2).forEach((l, i) => d.text(l, M, 190 + i * 12, { size: 9.5, color: "#c7c7cc" }));
  // badges
  let bx = M;
  if (a.overall.rank) { const [f, t] = rankColors(a.overall.rank); bx += badge(`Rank ${a.overall.rank} of ${a.overall.of}`, bx, 220, f, t) + 6; }
  bx += badge(plural(a.overall.rounds, "round"), bx, 220, "#3a3a3c") + 6;
  if (a.form) { const w = formWord(a.form.last - a.form.first, a.form.long); void STEADY; // (update 670: the form word)
    if (w) bx += badge(`Form: ${w[0]}`, bx, 220, w[2], "#0b0b0d") + 6; } // (update 671: the word's own colour, yellow to green or red)
  // form sparkline (right side)
  if (a.rankHist?.length >= 2) {
    // (update 227) Weekly Rank History: 1st at the top, a gold line, the latest rank marked
    // (update 595) the last 6 months only (back from their latest tournament; at least the last two points)
    const lastMs = Date.parse(String(a.rankHist.at(-1).date).slice(0, 10)), from6 = Number.isFinite(lastMs) ? lastMs - 182.6 * 864e5 : null;
    const h6 = from6 == null ? a.rankHist : a.rankHist.filter((q) => (Date.parse(String(q.date).slice(0, 10)) || 0) >= from6);
    const h = h6.length >= 2 ? h6 : a.rankHist.slice(-2), x0 = M + W * 0.62, w = W * 0.38, top = 104, ht = 74;
    const worst = Math.max(...h.map((q) => q.rank)), best = Math.min(...h.map((q) => q.rank));
    const lo = Math.max(1, best - Math.ceil((worst - best) * 0.1) - 1), hi = worst + Math.ceil((worst - best) * 0.1) + 1;
    const Y = (rk) => top + ((rk - lo) / (hi - lo || 1)) * ht;
    d.roundRect(x0 - 12, top - 22, w + 12, ht + 52, 12, { fill: "#141815" });
    cap("Season Rank Trend - Past 6 Months", x0, top - 6, "#8e8e93", "left", 6.5); // (update 669) // (update 663: rolling, as the Trend)
    const pts = h.map((q, i) => [x0 + (i / (h.length - 1)) * (w - 12), Y(q.rank)]);
    d.polyline(pts, { color: P.goldLight, width: 1.8 });
    d.dot(...pts[pts.length - 1], 3, P.goldLight);
    const lastQ = h[h.length - 1], ord = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
    d.text(`${ord(lastQ.rank)} of ${lastQ.of}`, Math.min(pts[pts.length - 1][0] + 6, x0 + w - 40), pts[pts.length - 1][1] + (pts[pts.length - 1][1] < top + 10 ? 12 : -5), { size: 7.5, bold: true, color: P.goldLight });
    d.text(`Best ${ord(best)} \u00b7 higher on the chart = better rank`, x0, top + ht + 18, { size: 6.5, color: "#8e8e93" });
  } else if (a.series.length >= 3) {
    const vals = ma(a.series.map((q) => q.value)), x0 = M + W * 0.62, w = W * 0.38, top = 104, ht = 74;
    const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0), Y = (v) => top + ht - ((v - lo) / (hi - lo || 1)) * ht;
    d.roundRect(x0 - 12, top - 22, w + 12, ht + 52, 12, { fill: "#141815" });
    cap("SG Trend - Rolling 10-round average", x0, top - 6, "#8e8e93", "left", 6.5);
    d.line(x0, Y(0), x0 + w - 12, Y(0), { color: "#3a3a3c", width: 0.5, dash: [2, 2] });
    const pts = vals.map((v, i) => [x0 + (i / (vals.length - 1)) * (w - 12), Y(v)]);
    d.polyline(pts, { color: P.goldLight, width: 1.8 });
    d.dot(...pts[pts.length - 1], 3, P.goldLight);
    d.text("Above the dotted line = gaining strokes", x0, top + ht + 18, { size: 6.5, color: "#8e8e93" });
  }
  y = heroH + 22;
  if (!a.overall.rounds) { footer(); return d.output(); }

  /* ---------- how to read ---------- */
  d.roundRect(M, y - 4, W, 46, 8, { fill: P.note });
  d.text("How to read this:", M + 12, y + 9, { size: 8.5, bold: true, color: P.gold });
  d.text("Strokes gained compares every shot with what a typical tour player would do from the same spot.", M + 92, y + 9, { size: 8.5, color: P.ink });
  d.text("Plus (green) = better than that; minus (red) = worse. +1.00 means one stroke a round better.", M + 92, y + 21, { size: 8.5, color: P.ink });
  d.text(`Tour Avg and ranks: the ${a.compared ?? 0} other ${a.compared === 1 ? "player" : "players"} with at least ${a.minRounds ?? 1} ${a.minRounds === 1 ? "round" : "rounds"} in this period${a.tour ? ` (${a.tour || "No tour"} only)` : ""}.`, M + 92, y + 33, { size: 8.5, color: P.ink });
  y += 58;

  // (update 573) page 1: Where the strokes come from first, then What stands out; Best and toughest opens page 2
  /* ---------- by category: gauges ---------- */
  section("By category", "Where the strokes come from", 40 + a.byCat.length * 32);
  y += 4; // (update 576: no "The black line is zero; the gold line is Tour Avg." and no Tour Avg line)
  // (update 556) the values and the Better / Worse badges in two columns, each lined up on its left, just past the bars
  // (update 570) the bars as long as they can be: the value column, then the badge column, its widest badge ("Better by
  // 0.00") ending at the page's right edge; the same size in every report
  const bW = (t) => { const T = t.toUpperCase(); return textWidth(T, 7, true) + 1.1 * (T.length - 1) + 16; };
  const valW = Math.max(textWidth("\u22120.00", 18, true), ...a.byCat.map((c) => textWidth(fmtSG(c.value), 18, true))), badgeW = bW("Trend: +0.00"); // (update 580: the trend pill)
  // (update 571) the bars start just past the longest name (or rank line) on the left, not a fixed 150 in
  const labW = Math.max(...a.byCat.map((c) => Math.max(textWidth(c.name, 11.5, true), c.rank ? textWidth(`Rank ${c.rank} of ${c.of}`, 8, true) : 0)));
  const lw = Math.min(150, labW + 16), gx = M + lw, gw = W - lw - (14 + valW + 12 + badgeW), zx = gx + gw / 2, half = gw / 2, vx = gx + gw + 14, bx0 = vx + valW + 12;
  const gaugeMax = Math.max(0.1, ...a.byCat.flatMap((c) => [c.value, c.fieldAvg]).filter((v) => v != null && Number.isFinite(v)).map(Math.abs)) * 1.12;
  for (const c of a.byCat) {
    need(32);
    const t = (a.catTrend || []).find((q) => q.cat === c.cat); // (update 580: the last 12 rounds against the 12 before)
    d.text(c.name, M, y + 15, { size: 11.5, bold: true, color: P.ink });
    d.text(c.rank ? `Rank ${c.rank} of ${c.of}` : "", M, y + 27, { size: 8, bold: !!c.rank, color: c.rank ? rankInk(c.rank) : P.grey });
    d.roundRect(gx, y + 8, gw, 15, 7.5, { fill: P.track }); // (update 574: as tall as the Better / Worse pills)
    // (update 575) one scale for every row, so the bars compare: the biggest value or Tour Avg among the categories (a little
    // short of the end); it was each category's own field, and a smaller bar could look bigger
    const off = (v) => Math.max(-1, Math.min(1, v / gaugeMax)) * half;
    if (c.value != null) {
      const w = Math.max(10, Math.abs(off(c.value))), x0 = c.value >= 0 ? zx : zx - w, fill = c.value >= 0 ? P.up : P.down, light = c.value >= 0 ? "#4fb97a" : "#e8665e";
      // rounded at the far end, square where it meets the middle line
      d.roundRect(x0, y + 8, w, 15, 7.5, { fill });
      d.rect(c.value >= 0 ? zx : zx - Math.min(7.5, w), y + 8, Math.min(7.5, w), 15, { fill });
      d.roundRect(c.value >= 0 ? zx : x0 + 3.5, y + 10, Math.max(3, w - 3.5), 4.2, 2.1, { fill: light });
      d.rect(c.value >= 0 ? zx : zx - 2, y + 10, 2, 4.2, { fill: light });
    }
    d.line(zx, y + 4, zx, y + 27, { color: "#000000", width: 1.1 }); // zero
    // (update 576: no Tour Avg line)
    // (update 182: "Better by" / "Worse by", right-aligned in the card, the value just left of it)
    // (update 580) "Trend: +0.10" (green), "Trend: -0.09" (red), "Trend: 0.00" (grey)
    const r2 = t && t.change != null ? Math.round(t.change * 100) / 100 : null;
    const chLabel = r2 != null && r2 !== 0 ? `Trend: ${r2 > 0 ? "+" : "-"}${Math.abs(r2).toFixed(2)}` : null;
    d.text(fmtSG(c.value), vx, y + 19, { size: 18, bold: true, color: tone(c.value) });
    if (chLabel) badge(chLabel, bx0, y + 18, t.change > 0 ? P.up : P.down);
    else if (r2 != null) badge("Trend: 0.00", bx0, y + 18, "#8e8e93");
    y += 32; // (update 573: a little closer, so What stands out fits under it on page 1)
  }
  y += 6; // (update 574: a little room under Putting's rank)
  d.text(a.halves ? `Trend: the last ${a.halves.n} ${a.halves.unit || "rounds"} (${a.halves.late}) against the ${a.halves.n} before them (${a.halves.early}), in strokes a round` : "Trend: needs more rounds to compare.", M, y + 4, { size: 7.5, color: P.faint }); // (update 580)
  y += 18;

  /* ---------- highlights: strengths and things to watch ---------- */
  // (update 576) the DP World Tour (event-level data): no What stands out (Best and toughest takes its place on page 1);
  // otherwise distances only: each against the Tour Avg, with its rank
  const isDP = a.unit === "event", colW = (W - 14) / 2;
  if (!isDP) {
  // (at most two strengths from the same category, so they don't repeat each other)
  // (update 583) What stands out (PGA / Korn Ferry): each distance's average this period against the Tour Avg, with its rank
  // (a lie only for Around-the-Green inside 30 yds): the 3 furthest above it and the 3 furthest below it (at most two of a
  // part of the game, unless that's all there is)
  const nearU = (g) => { const t = String(g.key || "").split("|")[0], nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number); return nums.length > 0 && !/^\s*>/.test(t) && Math.max(...nums) <= 30; };
  // (inside 30 yds a lie that's every shot of its distance only repeats it: then the distance itself stands for it)
  const lieSplit = (g) => (a.groups || []).some((h) => h.cat === g.cat && h.withLie && !h.repeat && String(h.key).startsWith(`${g.key}|`));
  const okG = (g) => g.fieldAvg != null && Number.isFinite(g.perRound) && g.shots >= (a.minShots || 5) && (g.cat === "ARG" && nearU(g) ? (g.withLie ? !g.repeat : !lieSplit(g)) : !g.withLie && !g.repeat);
  const pool = (a.groups || []).filter(okG).map((g) => ({ g, gap: g.perRound - g.fieldAvg }));
  const shortT = (g) => { const [dist, lie] = String(g.key).split("|"); return lie ? `Around green ${dist} · ${lie}` : `${CAT_NAME[g.cat] || g.cat}, ${dist}`; };
  const topR = (g) => g.rank && g.of >= 2 && g.rank <= Math.max(1, Math.floor(g.of * 0.1));
  const pick3 = (list) => { const out = []; for (const x of list) { if (out.length >= 3) break; if (out.filter((o) => o.g.cat === x.g.cat).length >= 2) continue; out.push(x); } for (const x of list) { if (out.length >= 3) break; if (!out.includes(x)) out.push(x); } return out; };
  const cardOf = (x, up) => ({ cat: x.g.cat, title: shortT(x.g), tag: up ? (topR(x.g) ? "Elite" : x.gap >= 0.05 ? "Strong" : "Above avg") : (x.gap <= -0.05 ? "Costing strokes" : "Below avg"),
    text: `${x.g.perRound >= 0 ? `Gains ${x.g.perRound.toFixed(2)}` : `Loses ${Math.abs(x.g.perRound).toFixed(2)}`} strokes a round${x.g.rank ? ` · Ranked ${x.g.rank} of ${x.g.of}` : ""} · ${Math.round(x.g.shots)} shots.` });
  const strengths = pick3(pool.filter((x) => x.gap > 0).sort((p, q) => q.gap - p.gap)).map((x) => cardOf(x, true));
  const watch = pick3(pool.filter((x) => x.gap < 0).sort((p, q) => p.gap - q.gap)).map((x) => cardOf(x, false));
  // (update 578, 583) every card the same: one title size and one height; the largest sizes at which the rows fit page 1
  const TL = [{ P: 10, fs: 9.5, lh: 12, gap: 6, tz: 11 }, { P: 9.5, fs: 9, lh: 11, gap: 5.5, tz: 10.5 }, { P: 9, fs: 8.5, lh: 10.5, gap: 5, tz: 10 }, { P: 8, fs: 8, lh: 10, gap: 4.5, tz: 9.5 }, { P: 7, fs: 7.6, lh: 9.4, gap: 4, tz: 9 }, { P: 6, fs: 7.2, lh: 8.8, gap: 3.5, tz: 8.5 }, { P: 5, fs: 6.8, lh: 8.2, gap: 3, tz: 8 }]
    .map((t) => ({ ...t, ty: t.P + 10, tx: t.P + 15 + 5 + t.fs * 0.75, pad: 2 * t.P + 15 + 5 - (t.lh - t.fs) + 1 }));
  let L = TL[0];
  const linesOf = (it) => wrap(String(it.text || ""), colW - 4 - 2 * L.P, L.fs);
  const tagW = (it) => textWidth(String(it.tag || "").toUpperCase(), 7, true) + 1.1 * (String(it.tag || "").length - 1) + 16;
  const titleRoom = (it) => colW - 4 - 2 * L.P - tagW(it) - 6;
  let TZ = 11;
  const titleOf = (it) => { if (textWidth(it.title, TZ, true) <= titleRoom(it)) return { z: TZ, lines: [it.title], extra: 0 };
    const ls = wrap(it.title, titleRoom(it), TZ, true).slice(0, 2); return { z: TZ, lines: ls, extra: ls.length > 1 ? TZ + 1 : 0 }; };
  let HC = 0;
  const fitAll = () => {
    const all = [...strengths, ...watch];
    TZ = L.tz; for (const it of all) { let z = L.tz; while (z > 7 && textWidth(it.title, z, true) > titleRoom(it)) z -= 0.5; TZ = Math.min(TZ, z); }
    HC = Math.max(0, ...all.map((it) => L.pad + titleOf(it).extra + linesOf(it).length * L.lh));
  };
  const cardsH = (list) => list.length * (HC + L.gap) + 26;
  const roomHL = H - 50 - (y + 12 + 40);
  const pickTier = () => { for (const t of TL) { L = t; fitAll(); if (Math.max(cardsH(strengths), cardsH(watch)) <= roomHL) return true; } return false; };
  while (!pickTier() && strengths.length + watch.length > 1) { if (strengths.length >= watch.length) strengths.pop(); else watch.pop(); }
  section("Highlights", "What stands out", Math.max(cardsH(strengths), cardsH(watch)));
  const cards = (x, title, list, accent, tint, empty) => {
    let yy = y + 4;
    cap(title, x, yy + 6, accent); yy += 14;
    if (!list.length) { d.text(empty, x, yy + 10, { size: 9, color: P.grey }); return yy + 20; }
    for (const it of list) {
      const lines = linesOf(it), T = titleOf(it), h = HC; // (update 578: every card as tall as the tallest)
      d.roundRect(x, yy, colW, h, 8, { fill: tint });
      d.roundRect(x, yy, 4, h, 2, { fill: accent });
      const ty = L.ty, tw = badge(it.tag, x + 4 + L.P, yy + ty, accent);
      T.lines.forEach((l, i) => d.text(l, x + 4 + L.P + tw + 6, yy + ty - 0.5 + i * (T.z + 1), { size: T.z, bold: true, color: P.ink }));
      lines.forEach((l, i) => d.text(l, x + 4 + L.P, yy + L.tx + T.extra + i * L.lh, { size: L.fs, color: "#3a3a3c" }));
      yy += h + L.gap;
    }
    return yy;
  };
  const yl0 = cards(M, "Strengths", strengths, P.up, P.upTint, "No clear standouts against Tour Avg in this period.");
  const yl = yl0 + 2;
  const yr = cards(M + colW + 14, "Watch", watch, P.down, P.downTint, "Nothing is costing strokes against Tour Avg in this period.");
  y = Math.max(yl, yr) + 10;
  newPage();
  } // (update 576: What stands out, not for the DP World Tour)
  /* ---------- best and toughest rounds ---------- */
  // (update 570) a third line each, for the best / hardest part; (update 571) the rows as tall as fits what's left of the
  // first page (34 down to 26), so the section stays on it
  const nEv = Math.max(1, a.peaks.length, a.valleys.length), roomEv = H - 50 - (y + 12 + 37) - 4;
  // (update 576) 12 inside the card on every side: its title, then each event; the card as tall as that
  const PE = 12, rowEv = Math.max(26, Math.min(34, (roomEv - 6 - 2 * PE - 28 - 21.5) / Math.max(1, nEv - 1))), smallEv = rowEv < 30;
  const cardEv = PE + 5 + 16 + 7 + (nEv - 1) * rowEv + (smallEv ? 19 : 21.5) + PE, rowsH = cardEv + 6;
  section("Events", "Best and toughest", rowsH); // (update 547: tournaments, not rounds)
  const roundsCol = (x, title, list, c, tint) => {
    d.roundRect(x, y, colW, cardEv, 10, { fill: tint });
    cap(title, x + PE, y + PE + 5, c);
    list.forEach((q, i) => {
      const yy = y + PE + 5 + 16 + 7 + i * rowEv, part = c === P.up ? q.best : q.worst;
      // (update 564) the name and the line under it stop short of the value on the right (cut with … when they'd run into it)
      const room = colW - 2 * PE - textWidth(fmtSG(q.value), 15, true) - 10;
      const fit = (t, size, bold = false) => { if (textWidth(t, size, bold) <= room) return t; let u = t; while (u.length > 3 && textWidth(`${u}\u2026`, size, bold) > room) u = u.slice(0, -1); return `${u.trimEnd()}\u2026`; };
      d.text(fit(q.event || "Event", 9.5, true), x + PE, yy, { size: 9.5, bold: true, color: P.ink });
      // (update 570) the date and rounds on the second line, the best / hardest part on a third of its own
      d.text(fit(`${fmtDate(q.date)}${q.rounds ? `  \u00b7  ${q.rounds} rd${q.rounds === 1 ? "" : "s"}` : ""}`, 7.5), x + PE, yy + (smallEv ? 9 : 10.5), { size: smallEv ? 7 : 7.5, color: P.grey });
      d.text(fit(`${c === P.up ? "Best part" : "Hardest part"}: ${CAT_NAME[part[0]] || ""} ${fmtSG(part[1])}`, 7.5), x + PE, yy + (smallEv ? 17 : 19.5), { size: smallEv ? 7 : 7.5, color: P.grey });
      d.text(fmtSG(q.value), x + colW - PE, yy + 9, { size: 15, bold: true, color: c, align: "right" });
    });
  };
  roundsCol(M, "Best events", a.peaks, P.up, P.upTint);
  roundsCol(M + colW + 14, "Toughest events", a.valleys, P.down, P.downTint);
  y += rowsH + 6;
  if (isDP) newPage(); // (update 576: the DP World Tour's page 2 starts with Event by event)

  /* ---------- SG form: total and each category ---------- */
  const formChart = (title, vals, src = a.series) => {
    // (update 553) the DP World Tour's chart is event by event, but its form is the last 12 rounds against the 12 before
    const byRd = a.unit === "event" && a.form;
    const n = byRd ? a.form.n : Math.min(20, Math.floor(vals.length / 2)); // (update 663)
    const first = byRd ? a.form.first : n >= 2 ? mean(vals.slice(-2 * n, -n)) : null, last = byRd ? a.form.last : n >= 2 ? mean(vals.slice(-n)) : null; // the 12 before, the last 12
    const top = y + 22, ht = isDP ? 175 : 70, left = M + 22, wd = W - 22; // (update 576: the DP World Tour's 2.5 times as tall)
    need(ht + 52);
    d.text(title, M, y + 10, { size: 11, bold: true, color: P.ink });
    if (first != null) {
      const ch = last - first;
      // (update 675) each part in its own colour: each average by its sign (green gaining, red losing), the change by its direction
      { const U = byRd && a.form.unit === "event" ? "events" : "rounds", sep = "   \u00b7   ";
        const parts = [[`Last ${n} ${U}: ${fmtSG(last)}`, tone(last)], [sep, P.grey], [`${n} before that: ${fmtSG(first)}`, tone(first)], [sep, P.grey],
          [`${ch >= 0 ? "Up" : "Down"} ${Math.abs(ch).toFixed(2)}`, Math.abs(ch) < STEADY ? P.grey : tone(ch)]];
        let xr = M + W;
        for (const [t, c] of [...parts].reverse()) { d.text(t, xr, y + 10, { size: 8, bold: true, color: c, align: "right" }); xr -= textWidth(t, 8, true); } }
    }
    const lo = Math.min(-0.5, Math.min(...vals)), hi = Math.max(0.5, Math.max(...vals));
    const Y = (v) => top + ht - ((v - lo) / (hi - lo)) * ht;
    d.roundRect(M - 6, top - 6, W + 12, ht + 22, 8, { fill: P.mist });
    d.line(left, Y(0), M + W, Y(0), { color: "#000000", width: 0.6 });
    d.text("0", M, Y(0) + 3, { size: 6.5, color: P.faint });
    // (update 584) the top and bottom of the scale too
    d.text(fmtSG(hi), M, Y(hi) + 5, { size: 6.5, color: P.faint }); d.text(fmtSG(lo), M, Y(lo), { size: 6.5, color: P.faint });
    const bw = wd / vals.length;
    vals.forEach((v, i) => { const x = left + i * bw + bw * 0.18, w = Math.max(1, bw * 0.64), y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); d.rect(x, y0, w, Math.max(0.6, y1 - y0), { fill: v >= 0 ? "#8fd4a8" : "#f2a39d" }); });
    d.polyline(ma(vals, isDP ? 5 : 20 /* (update 663) */).map((v, i) => /* (update 582: the DP World Tour: the last 3 events) */ [left + i * bw + bw / 2, Y(v)]), { color: P.gold, width: 1.8 });
    // (no best / worst dots: bars and the rolling average only)
    const every = Math.max(1, Math.ceil(vals.length / 8));
    src.forEach((q, i) => { if (i % every === 0) { const t = day(q.date); d.text(t == null ? "" : shortDate(new Date(t)), left + i * bw + bw / 2, top + ht + 11, { size: 6.5, color: P.faint, align: "center" }); } });
    y = top + ht + 26;
  };
  /* ---------- SG form: the total (of the categories in this report) ---------- */
  const fs = a.formSeries || a.series, U = a.unit === "event" ? "event" : "round"; // (update 523: event by event for the DP World Tour)
  if (fs.length >= 2) {
    section("SG Form", U === "event" ? "Event by event" : "Round by round", 150);
    // (update 577) wrapped to the page's width (it ran off the right edge)
    for (const l of wrap(`Each bar is one ${U}${U === "event" ? " (strokes gained a round there)" : ""} (green = gained strokes, red = lost). The gold line is the rolling average of the last ${isDP ? 5 : 12} ${U}s: when it rises, the player is playing better.`, W, 8)) { d.text(l, M, y + 6, { size: 8, color: P.grey }); y += 10; }
    y -= 10;
    y += 14;
    formChart(a.cats.length === CATEGORIES.length ? "SG: Total" : `SG: Total \u00b7 ${a.cats.map((k) => CAT_NAME[k]).join(", ")}`, fs.map((q) => q.value), fs); // (no best / worst dots)
  }

  /* (update 571, 572) the Basic Stats page's lower half (a short page): on the left, the Off-the-Tee stats as two cards stacked
     (Driving Distance, Hit Fairway %), each with its rank, the field's average and where they sit in the field; on the right,
     Driving Distance against Hit Fairway % for everyone compared (this player in gold) */
  function drawBasicCharts(ch, hh, { tee = null, pillAt = null } = {}) {
    y += 40; // (update 573: more room between the Scoring grids and Off-the-Tee)
    const gap = 18, lw = tee ? (W - gap) * 0.42 : 0, x2 = tee ? M + lw + gap : M, w2 = tee ? W - lw - gap : W;
    const y0 = y;
    if (tee) {
      cap("Off-the-Tee", M, y0, P.gold, "left", 7);
      const n = tee.length, cg = 10, top = y0 + 14 - 6, ch0 = (hh - 14 - cg * (n - 1)) / n;
      tee.forEach((b, i) => {
        const cy = top + i * (ch0 + cg);
        d.roundRect(M, cy, lw, ch0, 10, { fill: P.mist });
        // (update 572) the contents (about 112 pt: name, value, field average, the field bar) in the card's middle
        // (update 573) a short card (the half-height Off-the-Tee): everything a little smaller and closer
        const sm = ch0 < 112, L = sm ? { h: 84, cap: 13, val: 35, vz: 19, pill: 31, avg: 48, bar: 64 } : { h: 112, cap: 18, val: 48, vz: 24, pill: 44, avg: 64, bar: 90 };
        const off = Math.max(0, (ch0 - L.h) / 2), ct = cy + off;
        cap(b.def.label, M + 14, ct + L.cap, P.soft, "left", 6.6);
        d.text(fmtStat(b.def, b.value), M + 14, ct + L.val, { size: L.vz, bold: true, color: P.ink });
        if (pillAt) pillAt(b, M + lw - 14, ct + L.pill, sm ? 6.4 : 7.2);
        if (b.fieldAvg != null) d.text(`Field average ${fmtStat(b.def, b.fieldAvg)}`, M + 14, ct + L.avg, { size: sm ? 7.4 : 8, color: P.grey });
        if (b.def.higher != null && b.lo != null && b.hi != null && b.hi > b.lo) {
          const x0 = M + 14, x1 = M + lw - 14, by = ct + L.bar, pos = (v) => { const t = (v - b.lo) / (b.hi - b.lo); return x0 + (x1 - x0) * (b.def.higher === false ? 1 - t : t); };
          d.roundRect(x0, by - 2, x1 - x0, 4, 2, { fill: "#dcdce1" });
          if (b.fieldAvg != null) d.line(pos(b.fieldAvg), by - 5, pos(b.fieldAvg), by + 5, { color: P.grey, width: 0.9 });
          d.dot(pos(b.value), by, 4.2, rankInk(b.rank || 999));
          d.text("Worst in the field", x0, by + (sm ? 11 : 13), { size: 6, color: P.faint }); d.text("Best", x1, by + (sm ? 11 : 13), { size: 6, color: P.faint, align: "right" });
        }
      });
    }
    if (ch.drive) {
      const x = x2, w = w2, top = y0 + 10, h = hh - 38; // (update 576: its top and bottom level with the Off-the-Tee cards)
      d.text("Every player compared: Driving Distance across, Hit Fairway % up", x, top + h + 34, { size: 7, color: P.grey }); // (update 574: under the chart)
      const all = [...ch.drive.pts, ch.drive.me], ds = all.map((q) => q.d), fs = all.map((q) => q.f);
      const dLo = Math.min(...ds), dHi = Math.max(...ds), fLo = Math.min(...fs), fHi = Math.max(...fs);
      const px0 = x + 30, px1 = x + w - 10, py0 = top + 8, py1 = top + h;
      const X = (v) => px0 + ((v - dLo) / ((dHi - dLo) || 1)) * (px1 - px0), Y = (v) => py1 - ((v - fLo) / ((fHi - fLo) || 1)) * (py1 - py0);
      d.roundRect(x, top - 2, w, h + 24, 10, { fill: P.mist });
      const mD = mean(ds), mF = mean(fs);
      d.line(X(mD), py0, X(mD), py1, { color: "#c7c7cc", width: 0.6, dash: [3, 2] });
      d.line(px0, Y(mF), px1, Y(mF), { color: "#c7c7cc", width: 0.6, dash: [3, 2] });
      d.text("Longer and straighter", px1 - 2, py0 + 7, { size: 6, color: P.faint, align: "right" });
      for (const q of ch.drive.pts) d.dot(X(q.d), Y(q.f), 2, "#b8b8bf");
      const me0 = ch.drive.me; d.dot(X(me0.d), Y(me0.f), 4.5, "#ffffff"); d.dot(X(me0.d), Y(me0.f), 3.6, P.gold);
      const fD = (v) => fmtStat(statDef("drive"), v), fF = (v) => fmtStat(statDef("fwy"), v);
      d.text(`${fD(me0.d)} \u00b7 ${fF(me0.f)}`, Math.min(px1 - 2, X(me0.d) + 6), Y(me0.f) - 5, { size: 6.5, bold: true, color: P.ink, align: X(me0.d) > px1 - 60 ? "right" : "left" });
      // (update 574) the axes in whole numbers
      const iD = (v) => fmtStat({ ...statDef("drive"), dp: 0 }, v), iF = (v) => `${Math.round(v)}%`;
      d.text(iD(dLo), px0, py1 + 12, { size: 6, color: P.grey }); d.text(iD(dHi), px1, py1 + 12, { size: 6, color: P.grey, align: "right" });
      d.text(iF(fHi), x + 4, py0 + 4, { size: 6, color: P.grey }); d.text(iF(fLo), x + 4, py1, { size: 6, color: P.grey });
    }
    y = y0 + hh + 12; // (and the caption under the chart)
  }
  /* (update 564) This season vs Last season: a bar for each season in each category (strokes gained a round), and the
     differences in a few plain lines on the right */
  function drawYoY(yo, x, ty, w, h, bigH = false) {
    d.roundRect(x, ty, 24, h, 10, { fill: P.night });
    d.roundRect(x + w - 24, ty, 24, h, 10, { fill: P.night2 });
    d.gradient(x + 12, ty, w - 24, h, P.night, P.night2, { dir: "h", steps: 40 });
    cap("This season vs Last season", x + 16, ty + 16 + (bigH ? 2 : 0), P.goldLight, "left", bigH ? 8.6 : 6.6);
    const cNow = P.goldLight, cPrev = "#8e8e93";
    // the key
    // (update 565) the key just after the title (never over it)
    const T0 = "THIS SEASON VS LAST SEASON", tz0 = bigH ? 8.6 : 6.6;
    let kx = x + 16 + textWidth(T0, tz0, true) + 1.4 * (T0.length - 1) + 18;
    // (update 583) the key beside the title, or on a line of its own under it when it would run into The differences
    const keyW = [`${yo.lastY} (${yo.nPrev} rds)`, `${yo.thisY} (${yo.nNow} rds)`].reduce((t, l) => t + textWidth(l, 7, true) + 22, 0);
    const keyDown = kx + keyW > x + w * 0.57 - 4, kyo = keyDown ? 16 : 0;
    if (keyDown) kx = x + 16;
    for (const [lab, col] of [[`${yo.lastY} (${yo.nPrev} rds)`, cPrev], [`${yo.thisY} (${yo.nNow} rds)`, cNow]]) { d.rect(kx, ty + 9 + kyo, 8, 8, { fill: col }); d.text(lab, kx + 11, ty + 16 + kyo, { size: 7, bold: true, color: "#d1d1d6" }); kx += textWidth(lab, 7, true) + 22; }
    // the chart
    // (update 567) no y-axis numbers; "SG / rd" up the side; under the lowest bar, room for its number before the category names
    const vals = yo.rows.flatMap((r) => [r.now, r.prev]).filter((v) => v != null), hasNeg = vals.some((v) => v < -0.005);
    const cx = x + 34, cw = w * 0.55 - 44, top = ty + 32 + kyo, catY = ty + h - 9, ph = catY - (hasNeg ? 24 : 12) - top;
    const hi = Math.max(0.25, ...vals), lo = Math.min(-0.25, ...vals), Y = (v) => top + ((hi - v) / (hi - lo)) * ph, zy = Y(0);
    d.line(cx, zy, cx + cw, zy, { color: "#8e8e93", width: 0.7, dash: [3, 2] });
    d.text("SG / rd", x + 22, top + ph / 2, { size: 6.5, color: "#8e8e93", align: "center", rotate: 90 });
    const slot = cw / yo.rows.length, bw = Math.min(22, slot * 0.3);
    yo.rows.forEach((r, i) => {
      const mid = cx + slot * (i + 0.5);
      for (const [v, col, off] of [[r.prev, cPrev, -bw - 1.5], [r.now, cNow, 1.5]]) {
        if (v == null) continue;
        const yv = Y(v), hh = Math.max(0.6, Math.abs(yv - zy));
        d.rect(mid + off, Math.min(yv, zy), bw, hh, { fill: col });
        d.text(fmtSG(v), mid + off + bw / 2, v >= 0 ? yv - 3 : yv + 8, { size: 6, bold: true, color: col === cNow ? cNow : "#c7c7cc", align: "center" });
      }
      d.text(r.name === "Total" ? "Total" : r.name.replace("Around-the-Green", "Around Green"), mid, catY, { size: 7, bold: r.name === "Total", color: "#d1d1d6", align: "center" });
    });
    // the differences
    const ix = x + w * 0.57 + 6, iw = w * 0.43 - 22;
    cap("The differences", ix, ty + 16 + (bigH ? 2 : 0), P.goldLight, "left", bigH ? 8.6 : 6.3);
    const tot = yo.rows[0], parts = yo.rows.slice(1).filter((r) => r.ch != null).sort((p, q) => q.ch - p.ch);
    const lines = [];
    if (tot.ch != null) lines.push([tot.ch, Math.abs(tot.ch) < 0.005 ? `Overall: the same as ${yo.lastY}, ${fmtSG(tot.now)} a round.` : `Overall: ${Math.abs(tot.ch).toFixed(2)} a round ${tot.ch > 0 ? "better" : "worse"} than ${yo.lastY} (${fmtSG(tot.prev)} \u2192 ${fmtSG(tot.now)}).`]);
    const best = parts[0], worst = parts.at(-1);
    if (best && best.ch > 0.005) lines.push([best.ch, `Biggest gain: ${best.name}, up ${best.ch.toFixed(2)} a round${best.prev < 0 && best.now >= 0 ? ", from losing strokes to gaining them" : ""}.`]);
    if (worst && worst !== best && worst.ch < -0.005) lines.push([worst.ch, `Biggest drop: ${worst.name}, down ${Math.abs(worst.ch).toFixed(2)} a round${worst.prev >= 0 && worst.now < 0 ? ", from gaining strokes to losing them" : ""}.`]);
    const flips = parts.filter((r) => r !== best && r !== worst && Math.sign(r.now) !== Math.sign(r.prev) && Math.abs(r.ch) >= 0.05);
    for (const r of flips.slice(0, 1)) lines.push([r.ch, `${r.name} has ${r.now >= 0 ? "turned into a strength" : "turned into a weakness"} (${fmtSG(r.prev)} \u2192 ${fmtSG(r.now)}).`]);
    const steady = parts.filter((r) => Math.abs(r.ch) < 0.05);
    if (steady.length && lines.length < 4) lines.push([0, `About the same: ${steady.map((r) => r.name).join(", ")}.`]);
    // (update 565) each line beside a bar as tall as its text, the text centred on it; a line that won't fit is left off
    let top0 = ty + 24;
    const fs = 7.3, lh = 8.8;
    for (const [v, t] of lines.slice(0, 4)) {
      const ls = wrap(t, iw - 12, fs).slice(0, 2), bh = ls.length * lh + 3;
      if (top0 + bh > ty + h - 8) break;
      const col = Math.abs(v) < 0.005 ? "#8e8e93" : v > 0 ? "#4cd17e" : "#ff6b5e";
      d.roundRect(ix, top0, 3.5, bh, 1.75, { fill: col });
      const mid = top0 + bh / 2, first = mid - ((ls.length - 1) * lh) / 2 + fs * 0.35;
      ls.forEach((l, j) => d.text(l, ix + 10, first + j * lh, { size: fs, color: "#e5e5ea" }));
      top0 += bh + 5;
    }
  }
  /* ---------- by the numbers: four premium tiles ---------- */
  {
    const nb = a.numbers, tiles = [];
    const pct = nb.n ? nb.posRounds / nb.n : 0;
    const u = nb.unit === "event" ? "event" : "round", Uc = u === "event" ? "Events" : "Rounds"; // (update 523)
    if (nb.n) tiles.push({ label: `${Uc} in the green`, big: `${nb.posRounds} of ${nb.n}`, text: `Gained strokes overall in ${Math.round(pct * 100)}% of ${u}s.`, viz: "bar", v: pct });
    if (nb.streak.len) tiles.push({ label: "Best run", big: `${nb.streak.len} ${nb.streak.len === 1 ? u : `${u}s`}`, text: `In a row gaining strokes, ${shortDate(new Date(day(nb.streak.from)))} \u2013 ${shortDate(new Date(day(nb.streak.to)))}.`, viz: "dots", v: nb.streak.len });
    if (nb.upside && nb.upside.gain > 0.01) tiles.push({ label: `Biggest upside \u00b7 ${CAT_NAME[nb.upside.cat]}`, big: `+${nb.upside.gain.toFixed(2)}`, // (update 587: the category in the heading, as Steadiest)
      text: `By getting back to your best ${nb.upside.win}-${u} stretch\n(${fmtSG(nb.upside.bestV)}, ${shortDate(new Date(day(nb.upside.from)))} \u2013 ${shortDate(new Date(day(nb.upside.to)))}).`,
      textShort: `By getting back to your best ${nb.upside.win}-${u} stretch\n(${fmtSG(nb.upside.bestV)}, ${shortDate(new Date(day(nb.upside.from)))} \u2013 ${shortDate(new Date(day(nb.upside.to)))}).`, /* (update 565: the shorter card) */ viz: "pair", v: nb.upside });
    else if (a.byCat.length) tiles.push({ label: "Biggest upside", big: "At peak", text: "Playing at their best stretch in every category in this report.", viz: null });
    if (nb.steady && a.cats.length === 1) {
      const v = nb.steady.sd, tv = nb.tourSd;
      tiles.push({ label: `${CAT_NAME[nb.steady.cat]} steadiness`, big: `\u00b1${v.toFixed(2)}`,
        text: `Typical swing ${u} to ${u}.${tv != null ? ` Tour Avg: \u00b1${tv.toFixed(2)}, so ${Math.abs(v - tv) < 0.05 ? "about as steady as the others" : v < tv ? "steadier than the others" : "less steady than the others"}.` : ""}`, viz: "steadyVsTour", v: { mine: v, tour: tv } });
    } else if (nb.steady) tiles.push({ label: `Steadiest \u00b7 ${CAT_NAME[nb.steady.cat]}`, big: `\u00b1${nb.steady.sd.toFixed(2)}`, text: `Typical swing ${u} to ${u}.${nb.swingy ? ` ${CAT_NAME[nb.swingy.cat]} swings the most (\u00b1${nb.swingy.sd.toFixed(2)}).` : ""}`, viz: "swing", v: nb });
    if (tiles.length) {
      // (update 564) with last season to compare: the cards a little smaller and shorter, and a third row across the page,
      // This season vs Last season
      const yo = nb.yoy, cols = 2, gap = yo ? 7 : 12, tw = (W - gap) / cols, th0 = yo ? 56 : 92, rows = Math.ceil(Math.min(4, tiles.length) / cols), yoH0 = yo ? 104 : 0; // (update 565: shorter, so it all fits on one page)
      // (update 582) the DP World Tour's page 2 (Event by event, then this): the cards and This season vs Last season stretched
      // to fill the rest of the page, each card's contents in its middle
      let th = th0, yoH = yoH0;
      if (isDP) { const base = rows * (th0 + gap) + (yo ? yoH0 + gap : 0), avail = H - 50 - (y + 12 + 40) - 6, f = Math.min(2.2, avail / base); if (f > 1) { th = th0 * f; yoH = yoH0 * f; } }
      const cOff = (th - th0) / 2;
      section("By the numbers", "At a glance", rows * (th + gap) + (yo ? yoH + gap : 0));
      tiles.slice(0, 4).forEach((t, i) => {
        const x = M + (i % cols) * (tw + gap), ty0 = y + Math.floor(i / cols) * (th + gap), ty = ty0 + cOff;
        // a dark tile with rounded corners and a soft left-to-right blend
        d.roundRect(x, ty0, 24, th, 10, { fill: P.night });
        d.roundRect(x + tw - 24, ty0, 24, th, 10, { fill: P.night2 });
        d.gradient(x + 12, ty0, tw - 24, th, P.night, P.night2, { dir: "h", steps: 30 });
        const sq = yo ? 1 : 0; // (update 564: the shorter cards)
        const bigH = isDP && th > th0 * 1.2; // (update 583: the DP World Tour's stretched cards: bigger headings)
        cap(t.label, x + 16, ty + (sq ? 13 : 20) - (bigH ? 4 : 0), P.goldLight, "left", bigH ? 8.6 : 6.4);
        // the big number, as large as fits
        let size = sq ? 16 : 24; while (size > 12 && textWidth(t.big, size, true) > tw * 0.5) size -= 1;
        d.text(t.big, x + 16, ty + (sq ? 31 : 50), { size, bold: true, color: "#ffffff" });
        String(sq && t.textShort ? t.textShort : t.text).split("\n").flatMap((p0) => wrap(p0, tw * 0.54, sq ? 6.8 : 7.8)).slice(0, sq ? 2 : 3) /* (update 584: a line break where it says so) */.forEach((l, j) => d.text(l, x + 16, ty + (sq ? 41 : 64) + j * (sq ? 8 : 9.5), { size: sq ? 6.8 : 7.8, color: "#a1a1a6" }));
        // a small picture on the right
        const vx = x + tw * 0.6, vw = tw * 0.4 - 18, vy = ty + (sq ? 11 : 30) + (bigH ? 9 : 0); // (update 584: under the bigger heading)
        if (t.viz === "bar") {
          d.roundRect(vx, vy + 12, vw, 7, 3.5, { fill: "#2c2c2e" });
          d.roundRect(vx, vy + 12, Math.max(7, vw * t.v), 7, 3.5, { fill: P.goldLight });
          d.text(`${Math.round(t.v * 100)}%`, vx + vw, vy + 36, { size: 15, bold: true, color: P.goldLight, align: "right" });
        } else if (t.viz === "dots") {
          const n = Math.min(nb.n, 12), r = Math.min(4.5, vw / (n * 2.6)), stepX = vw / n;
          for (let k = 0; k < n; k++) d.dot(vx + stepX * (k + 0.5), vy + 16, r, k < Math.min(t.v, n) ? P.goldLight : "#3a3a3c");
        } else if (t.viz === "pair") {
          // (update 552) from a zero line in the middle: a gain to the right, a loss to the left
          const mine = t.v.now ?? 0, best = t.v.bestV, mx = Math.max(Math.abs(mine), Math.abs(best), 0.01);
          const tx = vx + 24, tw = vw - 58, mid = tx + tw / 2;
          d.line(mid, vy + 2, mid, vy + 31, { color: "#5f6368", width: 0.6, dash: [2, 1.5] });
          for (const [j, v, lab, col] of [[0, mine, "Now", "#8e8e93"], [1, best, "Peak", P.goldLight]]) {
            const yy = vy + 6 + j * 16, len = Math.max(3, (tw / 2) * Math.abs(v) / mx);
            d.text(lab, vx, yy + 6, { size: 7, bold: true, color: col });
            d.roundRect(v >= 0 ? mid : mid - len, yy, len, 7, 3.5, { fill: col });
            d.rect(v >= 0 ? mid : mid - Math.min(4, len), yy, Math.min(4, len), 7, { fill: col }); // (update 560: square where it meets zero)
            d.text(fmtSG(v), vx + vw, yy + 6.5, { size: 7.5, bold: true, color: col, align: "right" });
          }
        } else if (t.viz === "steadyVsTour") {
          const { mine: m1, tour: m2 } = t.v, mx = Math.max(m1, m2 ?? 0, 0.01), mid = vx + vw / 2;
          for (const [j, v, col, lab] of [[0, m1, P.goldLight, "Player"], [1, m2, "#8e8e93", "Tour Avg"]]) {
            if (v == null) continue;
            const yy = vy + 6 + j * 16, half = (vw / 2 - 4) * (v / mx);
            d.roundRect(mid - half, yy, half * 2, 7, 3.5, { fill: col });
            d.text(lab, vx, yy - 2, { size: 6, bold: true, color: col });
          }
        } else if (t.viz === "swing") {
          const s1 = t.v.steady.sd, s2 = t.v.swingy ? t.v.swingy.sd : s1, mx = Math.max(s1, s2, 0.01), mid = vx + vw / 2;
          for (const [j, v, col, lab] of [[0, s1, P.goldLight, "Steadiest"], [1, s2, "#8e8e93", "Swingiest"]]) {
            const yy = vy + 6 + j * 16, half = (vw / 2 - 4) * (v / mx);
            d.roundRect(mid - half, yy, half * 2, 7, 3.5, { fill: col });
            d.text(lab, vx, yy - 2, { size: 6, bold: true, color: col });
          }
        }
      });
      y += rows * (th + gap) + 4;
      if (yo) { drawYoY(yo, M, y - 4, W, yoH, isDP && th > th0 * 1.2); y += yoH + gap; }
    }
  }

  /* ---------- AI summary (when set up) ---------- */
  if (aiSummary) {
    const lines = wrap(aiSummary, W - 28, 10.5);
    section("Summary", "In a few words", lines.length * 15 + 20);
    d.roundRect(M, y, W, lines.length * 15 + 22, 10, { fill: P.mist });
    lines.forEach((l, i) => d.text(l, M + 14, y + 18 + i * 15, { size: 10.5, color: P.ink }));
    y += lines.length * 15 + 30;
    cap("Written by AI from the numbers in this report", M, y, P.faint); y += 14;
  }

  // ---------- appendix ----------
  // (update 518) distance alone for every category, except Around-the-Green inside 30 yds: distance + lie
  const upTo = (k) => { const t = String(k || "").split("|")[0], nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number); if (!nums.length) return null; return /^\s*>/.test(t) ? Infinity : Math.max(...nums); };
  const argNear = (g) => g.cat === "ARG" && upTo(g.key) != null && upTo(g.key) <= 30;
  const byDist = a.groups.filter((g) => (argNear(g) ? g.withLie : !g.withLie));
  // (update 650) "Skill by Skill": four headline tiles (net a round, biggest weapon, biggest leak, quickest win); every
  // skill as a bar from a centre line (gains right, losses left) grouped by area of the game with each area's total,
  // a dashed mark at the Tour's best 10% and a rank pill; then up to four plain-English insights written from the
  // numbers. Sized to fit one page whatever the number of skills.
  if (byDist.length) {
    newPage(); // Detail starts at the top of the last page
    section("Detail", "Skill by Skill", 52);
    d.text("Strokes gained a round in each skill, against the Tour.", M, y + 1, { size: 9.6, color: P.grey });
    y += 14;
    const sg = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
    const rows = byDist.filter((g) => g.perRound != null && Number.isFinite(g.perRound));
    const nameOf = (g) => { const [dist, lie] = String(g.key).split("|"); return { dist, lie: lie ? String(lie).toLowerCase() : "" }; };
    const LIE_ORDER = ["fairway", "rough", "bunker", "sand", "recovery"];
    const order = (p, q) => (upTo(p.key) ?? 999) - (upTo(q.key) ?? 999) || LIE_ORDER.indexOf(nameOf(p).lie) - LIE_ORDER.indexOf(nameOf(q).lie);
    const areas = CATEGORIES.map(([c, nm]) => ({ cat: c, name: nm, list: rows.filter((g) => g.cat === c).sort(order) })).filter((x) => x.list.length)
      .map((x) => ({ ...x, total: a.byCat?.find((b) => b.cat === x.cat)?.value ?? x.list.reduce((t, g) => t + g.perRound, 0), rank: a.byCat?.find((b) => b.cat === x.cat) }));
    const label = (g) => { const { dist, lie } = nameOf(g); return lie ? `${dist}, ${lie}` : dist; };
    const full = (g) => `${CAT_NAME[g.cat]} ${label(g)}`;
    const best = [...rows].sort((p, q) => q.perRound - p.perRound)[0], worst = [...rows].sort((p, q) => p.perRound - q.perRound)[0];
    const gapOf = (g) => (g.fieldAvg != null ? g.fieldAvg - g.perRound : -g.perRound);
    const win = [...rows].filter((g) => gapOf(g) > 0.005).sort((p, q) => gapOf(q) - gapOf(p))[0] || null;

    // ---- the four tiles ----
    const tw = (W - 2 * 8) / 3, th = 74, ty = y; // (update 651: three tiles, no Quickest win)
    const tile = (i, kicker, value, vcol, line, dark = false) => {
      const x = M + i * (tw + 8);
      d.roundRect(x, ty, tw, th, 9, { fill: dark ? "#141414" : P.mist });
      cap(kicker, x + 10, ty + 15, dark ? P.goldLight : P.soft, "left", 6.4);
      d.text(value, x + 10, ty + 40, { size: 21, bold: true, color: vcol });
      const ls = wrap(line, tw - 20, 7.6, false).slice(0, 2);
      ls.forEach((t, k) => d.text(t, x + 10, ty + 54 + k * 9.2, { size: 7.6, color: dark ? "#c7c7cc" : P.grey }));
    };
    const net = a.overall?.value;
    tile(0, "Net a round", net != null ? sg(net) : "—", net == null ? "#ffffff" : net >= 0 ? "#34c759" : "#ff6b5e",
      [a.overall?.rank ? `Rank ${a.overall.rank} of ${a.overall.of}` : "", a.netTrend != null && Math.abs(a.netTrend) >= 0.01 ? `${a.netTrend >= 0 ? "up" : "down"} ${Math.abs(a.netTrend).toFixed(2)} on the ${a.halves?.n || ""} ${a.halves?.unit || "rounds"} before`.replace(/\s+/g, " ") : ""].filter(Boolean).join(" · "), true);
    if (best && best.perRound > 0) tile(1, "Biggest weapon", sg(best.perRound), P.up, `${full(best)}${best.rank ? ` · rank ${best.rank}` : ""}`);
    else tile(1, "Biggest weapon", "—", P.soft, "No skill gaining yet");
    if (worst && worst.perRound < 0) tile(2, "Biggest leak", sg(worst.perRound), P.down, `${full(worst)}${worst.rank ? ` · rank ${worst.rank}` : ""}`);
    else tile(2, "Biggest leak", "—", P.soft, "Nothing losing strokes");
    y = ty + th + 6;

    // ---- the insights (written now, drawn at the bottom; their height is known before the bars are sized) ----
    const ins = [];
    const byArea = [...areas].sort((p, q) => q.total - p.total);
    const top = byArea[0], low = byArea.at(-1);
    if (top && top.total > 0.02) {
      const inside = top.list.filter((g) => g.perRound > 0).sort((p, q) => q.perRound - p.perRound);
      ins.push([`${top.name} is the engine.`, `Gains ${sg(top.total)} a round there${top.rank?.rank ? `, rank ${top.rank.rank} of ${top.rank.of}` : ""}${inside[0] ? `; the most from ${label(inside[0])} (${sg(inside[0].perRound)})` : ""}.`]);
    }
    if (low && low !== top && low.total < -0.02) {
      const w2 = [...low.list].sort((p, q) => p.perRound - q.perRound)[0];
      let why = "";
      if (low.cat === "APP" && w2) { // the proximity behind it, from the Basic Stats grid, when the bands line up
        const mid = (() => { const ns = (String(w2.key).match(/\d+/g) || []).map(Number); return ns.length ? (ns[0] + (ns[1] ?? ns[0] * 1.2)) / 2 : null; })();
        const prox = (a.grid || []).find((r) => r.key === "prox"), bi = mid == null ? -1 : (a.bands || []).findIndex((b) => { const ns = (b.match(/\d+/g) || []).map(Number); return /^>/.test(b) ? mid >= ns[0] : mid >= ns[0] && mid < ns[1]; });
        const c = prox?.cells?.[bi];
        if (c?.value != null && c.fieldAvg != null && c.value > c.fieldAvg) why = `: ${Math.round(c.value)} ft from the hole from ${a.bands[bi]}, ${Math.round(c.value - c.fieldAvg)} ft more than Tour`;
      }
      ins.push([`${low.name} costs strokes.`, `Loses ${sg(low.total).replace("−", "")} a round${low.rank?.rank ? `, rank ${low.rank.rank} of ${low.rank.of}` : ""}${w2 ? `; the most from ${label(w2)} (${sg(w2.perRound)})` : ""}${why}.`]);
    }
    { // off the tee: distance against accuracy (Basic Stats), when both are there
      const tg = (k) => (a.teeGrid || []).find((g) => g.key === k), cell = (g) => (g ? (a.teeSplit ? g.cells?.[0] : null) || g.all : null);
      const dv = cell(tg("drive")), fw = cell(tg("fwy"));
      if (dv?.rank && fw?.rank && dv.of) {
        const third = (r, n) => (r <= n / 3 ? "top" : r > (2 * n) / 3 ? "bottom" : "mid");
        const dt = third(dv.rank, dv.of), ft = third(fw.rank, fw.of), ott = areas.find((x) => x.cat === "OTT");
        const lead = dt === "top" && ft === "bottom" ? "Length over accuracy." : dt === "top" && ft === "top" ? "Long and straight." : dt === "bottom" && ft === "top" ? "Accuracy over length." : dt === "bottom" && ft === "bottom" ? "Short and offline." : null;
        if (lead) ins.push([lead, `Rank ${dv.rank} in driving distance (${fmtStat(dv.def, dv.value)}), rank ${fw.rank} in fairways (${fmtStat(fw.def, fw.value)})${ott ? `; ${sg(ott.total)} a round off the tee` : ""}.`]);
      }
    }
    if (win) ins.push(["Practice focus:", `${full(win)}. Getting to Tour average there is worth ${"+" + gapOf(win).toFixed(2)} a round${rows.filter((g) => gapOf(g) > 0.005).length > 1 ? ", more than any other single skill" : ""}.`]);
    { const t = [...(a.catTrend || [])].filter((x) => x.change != null && Math.abs(x.change) >= 0.15).sort((p, q) => Math.abs(q.change) - Math.abs(p.change))[0];
      if (t && ins.length < 4) ins.push([`${t.name} is ${t.change > 0 ? "trending up" : "slipping"}.`, `${sg(t.change)} a round over the last ${a.halves?.n || 20} ${a.halves?.unit || "rounds"} against the ${a.halves?.n || 20} before.`]); }
    const insShow = ins.slice(0, 4), iw = (W - 8) / 2, insLines = insShow.map(([h, t]) => wrap(`${h} ${t}`, iw - 22, 9, false).length);
    const insRowH = (k) => Math.max(insLines[2 * k] || 0, insLines[2 * k + 1] || 0) * 11.6 + 15;
    const insH = insShow.length ? insRowH(0) + (insShow.length > 2 ? insRowH(1) + 6 : 0) + 10 : 0;

    // ---- the bars, sized to the room left ----
    const keyH = 16, avail = H - 50 - y - insH - keyH;
    const units = rows.length + areas.length * 1.7;
    const rh = Math.max(7.5, Math.min(30, avail / units)), fz = Math.max(6.4, Math.min(11, rh * 0.46));
    const labW = W * 0.24, valW = 40, pillW = 50, bx0 = M + labW, bw = W - labW - valW - pillW - 10, mid = bx0 + bw / 2;
    const span = Math.max(0.1, ...rows.map((g) => Math.abs(g.perRound)), ...rows.map((g) => Math.abs(g.top10 ?? 0))) * 1.05;
    const X = (v) => mid + (v / span) * (bw / 2);
    for (const ar of areas) {
      y += rh * 1.05;
      d.text(ar.name, M, y, { size: fz + 2.2, bold: true, color: P.ink });
      d.text(`${plural(ar.list.length, "skill")}`, M + textWidth(ar.name, fz + 2.2, true) + 6, y, { size: fz - 0.6, color: P.soft });
      d.text(sg(ar.total), M + W, y, { size: fz + 2.2, bold: true, color: tone(ar.total), align: "right" });
      d.line(M, y + 3.2, M + W, y + 3.2, { color: P.ink, width: 0.9 });
      y += rh * 0.65;
      for (const g of ar.list) {
        const cy = y + rh / 2, { dist, lie } = nameOf(g);
        d.text(dist, M, cy + fz * 0.35, { size: fz, color: "#3a3a3c" });
        if (lie) d.text(lie, M + textWidth(dist, fz, false) + 4, cy + fz * 0.35, { size: fz - 1.4, color: P.soft });
        d.line(mid, y + 1.5, mid, y + rh - 1.5, { color: "#c7c7cc", width: 0.5 });
        const bh = Math.max(4, rh * 0.48), x1 = X(g.perRound);
        // (update 651) square at zero, rounded only at the far end
        if (Math.abs(x1 - mid) >= 0.6) { const len = Math.abs(x1 - mid), rr = Math.min(2, bh / 3, len / 2), fill = g.perRound >= 0 ? P.up : P.down;
          d.roundRect(Math.min(mid, x1), cy - bh / 2, len, bh, rr, { fill }); d.rect(g.perRound >= 0 ? mid : x1 + len - Math.min(len, rr + 0.5), cy - bh / 2, Math.min(len, rr + 0.5), bh, { fill }); }
        if (g.top10 != null) { const xt = X(g.top10); d.line(xt, y + 1, xt, y + rh - 1, { color: "#8e8e93", width: 0.9, dash: [1.6, 1.2] }); }
        d.text(sg(g.perRound), bx0 + bw + 6 + valW, cy + fz * 0.38, { size: fz + 0.8, bold: true, color: tone(g.perRound), align: "right" });
        if (g.rank) { const T = `${g.rank} / ${g.of}`, ps = Math.max(5.2, fz - 1.8), pw = textWidth(T, ps, true) + ps * 1.8, ph = ps * 1.85, [fill, inkC] = rankColors(g.rank);
          d.roundRect(M + W - pw, cy - ph / 2, pw, ph, ph / 2, { fill }); d.text(T, M + W - pw / 2, cy + ps * 0.36, { size: ps, bold: true, color: inkC, align: "center" }); }
        y += rh;
      }
    }
    // the key
    y += 11;
    { let kx = M; const k = (draw, t) => { draw(kx); d.text(t, kx + 14, y, { size: 7, color: P.grey }); kx += 14 + textWidth(t, 7, false) + 14; };
      k((x) => d.roundRect(x, y - 5.5, 10, 6, 1.5, { fill: P.up }), "gaining");
      k((x) => d.roundRect(x, y - 5.5, 10, 6, 1.5, { fill: P.down }), "losing");
      k((x) => d.line(x + 5, y - 7, x + 5, y + 1, { color: "#8e8e93", width: 0.9, dash: [1.6, 1.2] }), "the Tour's best 10%");
      d.text("bar length = strokes a round", kx, y, { size: 7, color: P.grey }); }
    y += 10;
    // the insights, two a row
    for (let r = 0; r * 2 < insShow.length; r++) {
      const hh = insRowH(r);
      for (let c = 0; c < 2; c++) {
        const it = insShow[r * 2 + c]; if (!it) continue;
        const x = M + c * (iw + 8);
        d.roundRect(x, y, iw, hh, 6, { fill: P.note }); d.rect(x, y, 2.6, hh, { fill: P.goldLight });
        const lines = wrap(`${it[0]} ${it[1]}`, iw - 22, 9, false);
        lines.forEach((ln, k) => {
          const yy = y + 13 + k * 11.6;
          if (k === 0 && ln.startsWith(it[0])) { d.text(it[0], x + 12, yy, { size: 9, bold: true, color: "#7a5c2e" }); d.text(ln.slice(it[0].length), x + 12 + textWidth(it[0], 9, true), yy, { size: 9, color: P.ink }); }
          else d.text(ln, x + 12, yy, { size: 9, color: P.ink });
        });
      }
      y += hh + 6;
    }
  }
  /* ---------- by product ---------- */
  if (a.products && !a.productTable && false) { // (update 274: off; see the by-product page)
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

  /* ---------- page 4: basic stats ---------- */
  // A page of its own: a dark band like the cover, then every section as the same kind of grid (row names down
  // the side, column headings across; each cell the value, its rank among the same players as the
  // strokes-gained ranks, and Tour Avg): Scoring, Off-the-Tee (Driver / Non-Driver), Approach by distance,
  // Short game (Up & Down by distance and lie) and Putting (Made Putt % by distance).
  if (a.basics?.length || a.grid?.length || a.udGrid || a.puttGrid || a.teeGrid?.length) {
    newPage();
    // (the same heading as the other pages' sections)
    y -= 12;
    d.rect(M, y - 7, 3, 9, { fill: P.gold });
    cap("Detail", M + 9, y, P.gold); y += 23;
    d.text("Additional Stats", M, y, { size: 17, bold: true, color: P.ink }); y += 14; // (update 651: was Basic Stats)
    d.text(`Ranks are out of the ${a.players ?? 1} ${a.players === 1 ? "player" : "players"} compared (at least ${a.minRounds ?? 1} ${a.minRounds === 1 ? "round" : "rounds"} of strokes gained${a.tour ? `, ${a.tour}` : ""}); someone with no value for a stat counts below everyone who has one.`, M, y + 4, { size: 7.5, color: P.grey });
    y += 6;
    const better = (b, x, ref) => (b.def.higher == null || ref == null || Math.abs(x - ref) < 1e-9 ? null : b.def.higher ? x > ref : x < ref);
    const tint = (b) => { const g = better(b, b.value, b.fieldAvg); return g == null ? P.ink : g ? P.up : P.down; };
    const head = (title) => { y += 13; d.rect(M, y - 6.5, 3, 8, { fill: P.gold }); cap(title, M + 9, y, P.gold, "left", 6.6); y += 6; };
    const pillAt = (b, xr, yy, size = 5.6) => {
      if (!b.rank) return 0;
      // by rank: top 10 bright green, 11-50 green, 51-100 yellow, 101-150 orange, past 150 red
      const T = `${b.rank} / ${b.of}`, w = textWidth(T, size, true) + size * 1.8, h = size * 1.85;
      const [fill, ink] = rankColors(b.rank);
      d.roundRect(xr - w, yy - h * 0.76, w, h, h / 2, { fill });
      d.text(T, xr - w / 2, yy - 0.6, { size, bold: true, color: ink, align: "center" });
      return w;
    };
    // what's under a row's name
    const SUB = { prox: "lower is better", pinHigh: "+/- 10 ft Short or Long", onLine: "+/- 10 ft Left or Right" };
    const NAME_W = 92, ROW_H = 24;
    // a grid across the page: rows [{ name, sub, cells | note }], one heading per column
    // how a grid is laid out: no name column when its rows have no names (Scoring); as wide as its columns need,
    // up to the page (Off-the-Tee stays narrow); bigger numbers where the cells have room
    let VS = null; // one text size for every grid on the page: Approach by distance's (set below)
    let WIDE = false; // (update 571) a short page (DP World Tour data): every grid the page's width, rows taller, a field bar under each value
    const valueW = (b, z) => { const k = (z - 9) / 5, ps = 5.6 + 1.6 * k; return 4 + 2 * k + textWidth(fmtStat(b.def, b.value), z, true) + 6 + (b.rank ? textWidth(`${b.rank} / ${b.of}`, ps, true) + ps * 1.8 : 0) + 8; };
    const layout = (colHeads, rows) => {
      const z0 = VS ?? 14;
      const nameW = rows.some((r) => r.name) ? Math.max(NAME_W, ...rows.map((r) => (r.name ? textWidth(r.name, z0 * 0.88, true) + 16 : 0))) : 0;
      // each column as wide as its widest value and heading need (with some air), up to the page
      const need = colHeads.map((h, c) => Math.max(70, textWidth(String(h).toUpperCase(), 5.6, true) + 1.1 * String(h).length + 14,
        ...rows.map((r) => (r.cells?.[c] ? valueW(r.cells[c], z0) + 14 : 0))));
      // (no name column: a margin inside the box's left and right edges, so values aren't against them)
      const pad = nameW ? 0 : 10;
      const w = W, cellW = (w - nameW - 2 * pad) / colHeads.length; // (update 627: every tour the page's width, as the DP World Tour's)
      // the biggest size (9 to 14 pt) at which every value and its rank bubble fit side by side in their cell
      const fitsAt = (z) => { const k = (z - 9) / 5, ps = 5.6 + 1.6 * k;
        return rows.every((r) => (r.cells || []).every((b) => !b || 4 + 2 * k + textWidth(fmtStat(b.def, b.value), z, true) + 6 + (b.rank ? textWidth(`${b.rank} / ${b.of}`, ps, true) + ps * 1.8 : 0) + 8 <= cellW)); };
      let vs = VS ?? 14; while (vs > 8 && !fitsAt(vs)) vs -= 0.5; // (the page's size; smaller only if this grid can't fit it)
      const rowH = Math.round(Math.max(9, vs) + 16 + 14), top = colHeads.every((h) => !h) ? 3 : 16; // (update 627: room for the field bar, every tour)
      return { nameW, pad, w, cellW, vs, rowH, top, gh: top + rows.length * rowH + 3 };
    };
    const gridBox = (colHeads, rows) => {
      const { nameW: NW, pad, w, cellW, vs, rowH: RH, top, gh } = layout(colHeads, rows), x = M;
      const NAME_W = NW + pad, ROW_H = RH, k = (vs - 9) / 5; // (k: 0 for the smallest cells, 1 for the roomiest)
      d.roundRect(x, y, w, gh, 8, { fill: P.mist });
      colHeads.forEach((lab, c) => {
        if (!lab) return;
        let t = lab.toUpperCase(), z = 5.6;
        while (z > 4.4 && textWidth(t, z, true) + 1.1 * t.length > cellW - 6) z -= 0.2;
        cap(t, x + NAME_W + cellW * (c + 0.5) - 3, y + 11, P.soft, "center", z);
      });
      for (let c = NW ? 0 : 1; c < colHeads.length; c++) { const lx = x + NAME_W + cellW * c - 3; d.line(lx, y + 4, lx, y + gh - 4, { color: "#d9d9de", width: 0.6 }); }
      rows.forEach((r, i) => {
        const ry = y + top + i * ROW_H;
        if (i) d.line(x + 8, ry, x + w - 8, ry, { color: P.hair, width: 0.5 });
        if (r.name) d.text(r.name, x + 9, ry + (r.sub ? ROW_H / 2 - 1 : ROW_H / 2 + 3), { size: vs * 0.88, bold: true, color: P.ink }); // (a touch smaller than the values)
        if (r.sub) d.text(r.sub, x + 9, ry + ROW_H / 2 + 8, { size: 5.8 + 0.6 * k, color: P.faint });
        if (r.note) { d.text(r.note, x + NAME_W + 4, ry + ROW_H / 2 + 3, { size: 7, color: P.faint }); return; }
        r.cells.forEach((b, c) => {
          const cx = x + NAME_W + cellW * c;
          if (!b) { d.text("\u2014", cx + cellW / 2 - 3, ry + ROW_H / 2 + 3, { size: 8.5, color: P.faint, align: "center" }); return; }
          d.text(fmtStat(b.def, b.value), cx + 4 + 2 * k, ry + 4 + vs * 0.85, { size: vs, bold: true, color: P.ink }); // (colour is for the ranks)
          pillAt(b, cx + cellW - 8, ry + 4 + vs * 0.8, 5.6 + 1.6 * k);
          if (b.fieldAvg != null) d.text(`Avg ${fmtStat(b.def, b.fieldAvg)}`, cx + 4 + 2 * k, ry + ROW_H - 4, { size: 5.6 + 1.6 * k, color: P.grey });
          // (update 571) where they sit in the field: worst on the left, best on the right; the tick is the field's average
          if (b.def.higher != null && b.lo != null && b.hi != null && b.hi > b.lo) { // (update 627: every tour, not only a short page)
            const x0 = cx + 4 + 2 * k, x1 = cx + cellW - 12, by = ry + ROW_H - 16, pos = (v) => { const t = (v - b.lo) / (b.hi - b.lo); return x0 + (x1 - x0) * (b.def.higher === false ? 1 - t : t); };
            d.roundRect(x0, by - 1.5, x1 - x0, 3, 1.5, { fill: "#dcdce1" });
            if (b.fieldAvg != null) d.line(pos(b.fieldAvg), by - 3.5, pos(b.fieldAvg), by + 3.5, { color: P.grey, width: 0.8 });
            d.dot(pos(b.value), by, 3.2, rankInk(b.rank || 999));
          }
        });
      });
      y += gh;
    };
    // (sections are gathered first, then spaced out to fill the page: a bigger gap when there's room)
    const queued = [];
    // (title null: a second grid of the section above, right under it)
    const section = (title, colHeads, rows) => { if (rows.length && colHeads.length) queued.push([title, colHeads, rows]); };
    const pick = (keys) => keys.flatMap((k) => a.basics.filter((b) => b.key === k));
    const noteFor = (g) => (g.missing ? `No ${g.def.label} in this data file.` : g.overall ? `${fmtStat(g.def, g.overall.value)} overall (the data doesn't split this stat this way)` : "");
    // Scoring: one row, a column per stat
    const SHORT = { scoring: "Scoring Avg", eagles: "Eagles/Round", birdiesRd: "Birdies/Round", parsRd: "Pars/Round", bogeysRd: "Bogeys/Round", dblBogeysRd: "Dbl Bogeys/Round",
      birdie: "Birdie %", parOrBetter: "Par or Better %", bogey: "Bogey Avoidance", owgr: "OWGR" };
    const scoring = pick(Object.keys(SHORT));
    section("Scoring", scoring.map((b) => SHORT[b.key]), scoring.length ? [{ name: "", cells: scoring }] : []);
    // a second row of Scoring: by par (its own grid, right under the first, no heading)
    if (a.parScoring) section(scoring.length ? null : "Scoring", ["Par 3 Scoring Avg", "Par 4 Scoring Avg", "Par 5 Scoring Avg"], [{ name: "", cells: a.parScoring }]);
    // Off-the-Tee: Driving Distance and Hit Fairway %, Driver and Non-Driver
    // Off-the-Tee: a column per stat (Driving Distance, Hit Fairway %), a row for Driver and Non-Driver when the
    // data splits them (otherwise one row)
    if (a.teeGrid?.length) {
      // (update 631) split by club: the Driver and Non-Driver rows only (no "All" row); (632) every column kept (GIR %
      // shows a dash until the data has it by club)
      const cols = a.teeGrid;
      const rows = a.teeSplit ? ["Driver", "Non-Driver"].map((kind, r) => ({ name: kind, cells: cols.map((g) => g.cells[r] || null) }))
        : [{ name: "", cells: cols.map((g) => g.all) }];
      if (cols.length) section("Off-the-Tee", cols.map((g) => (g.key === "gir" ? "GIR % (Par 4/5)" : g.def.label)), rows);
    }
    // (update 627) the PGA and Korn Ferry: an Off-the-Tee section always (a line saying so when the file has no driving
    // distance or fairway stats)
    else if (a.unit !== "event") section("Off-the-Tee", ["Driving Distance", "Hit Fairway %"], [{ name: "", note: "No driving distance or fairway stats in this data file." }]);
    // Approach by distance (GIR % isn't shown)
    section("Approach by distance", a.bands || [], (a.grid || []).map((g) => ({ name: g.def.label, sub: SUB[g.key] || (g.def.higher === false ? "lower is better" : ""), cells: g.cells, note: noteFor(g) })));
    // Short game: Up & Down by distance and lie
    if (a.udGrid) section("Short game \u00b7 Up & Down %", a.udGrid.lies, a.udGrid.bands.map((band, r) => ({ name: band, cells: a.udGrid.cells[r] })));
    // Putting: Made Putt % at each distance
    if (a.puttGrid) section("Putting - Make %", a.puttGrid.labels, [{ name: "", cells: a.puttGrid.cells }]);
    // anything else (Scrambling, Putts / Round …): one row, a column per stat
    const shown = new Set([...Object.keys(SHORT), "drive", "ballSpeed", "fwy", "gir", "hitGreen", "prox", "pinHigh", "onLine", "goodLag"]);
    const other = a.basics.filter((b) => !shown.has(b.key) && !(a.udGrid && b.key === "ud") && !(a.puttGrid && b.key === "make"));
    section("Other", other.map((b) => b.def.label), other.length ? [{ name: "", cells: other }] : []);
    const appr = queued.find(([t]) => t === "Approach by distance");
    VS = appr ? layout(appr[1], appr[2]).vs : null;
    const heightOf = ([title, heads, rows]) => (title === null ? 6 : 19) + layout(heads, rows).gh;
    // (update 571) under half the page: the wide layout, and the charts below
    WIDE = queued.reduce((t, q) => t + heightOf(q), 0) < (H - 60 - y) * 0.45;
    // (update 572) no Scoring Avg chart (the SG Form chart shows the same); the Off-the-Tee row (one row: not split Driver /
    // Non-Driver) moves into the lower half as two stacked cards beside the scatter
    const charts = WIDE ? a.extraCharts : null, chartRoom = charts?.drive ? 230 : 0;
    let teeCards = null;
    if (chartRoom) { const qi = queued.findIndex((q) => q[0] === "Off-the-Tee"); const tq = qi >= 0 ? queued[qi] : null;
      if (tq && tq[2].length === 1 && tq[2][0].cells.filter(Boolean).length >= 1) { teeCards = tq[2][0].cells.filter(Boolean); queued.splice(qi, 1); } }
    const total = queued.reduce((t, q) => t + heightOf(q), 0) + chartRoom, room = H - 60 - y - total;
    // (the first section sits close under the title: a fifth of the usual gap)
    const gaps = queued.filter((q) => q[0] !== null).length;
    const extra = 0.8 * (gaps ? Math.max(0, Math.min(40, room / Math.max(1, gaps - 0.8))) : 0); // (20% less than filling the page)
    queued.forEach((q, i) => {
      need(heightOf(q));
      if (q[0] === null) y += 6; // (the section's second grid)
      else { y += i === 0 ? extra * 0.2 : extra; head(q[0]); }
      gridBox(q[1], q[2]);
    });
    if (chartRoom) drawBasicCharts(charts, Math.max(170, Math.min(440, H - 60 - y - 40) * 0.5), { tee: teeCards, pillAt }); // (update 573: half as tall as the room left)
  }
  /* ---------- (update 210) page 5: by product ---------- */
  if (a.productTable) {
    newPage();
    y -= 12;
    d.rect(M, y - 7, 3, 9, { fill: P.gold });
    cap("Equipment", M + 9, y, P.gold); y += 23;
    d.text("By Product", M, y, { size: 17, bold: true, color: P.ink }); y += 14;
    // (update 517: wrapped, so it never runs off the page)
    for (const l of wrap("Each kind of club (and ball) you've used, with every model of it: strokes gained a round in the rounds each was used, and the stats recorded with it. Each model is shown by its colour in the key. * Fewer than 10 rounds: read with care.", W, 7.5)) { d.text(l, M, y + 4, { size: 7.5, color: P.grey }); y += 10; }
    y += 6;
    const FEW = 10;
    // (update 517) each kind: its name, the event chart (the key names the models), then the table, each model shown by its
    // colour; sized so two kinds fit a page, the columns spread over the page's width so nothing runs off it
    const CH = { plotH: 117, /* (update 563: half as tall again, 78 → 117) */ dates: true, gap: 8, pad: 12,
      roll: a.unit === "event" ? { by: "event", n: 5 } : { by: "round", n: 20 } }; // (update 666: the rolling-average line, as long as the Trend)
    // (update 567) two kinds a page at most (one when two don't fit at the smallest chart): the page split into equal halves,
    // the dividing line in the middle, each kind's chart grown so its chart and table fill its half (one alone: the page)
    const CHmin = { ...CH, plotH: 78 };
    const hAt = (sec, ch) => { const rows = Math.min(10, sec.rows.length), chH = sec.events?.length ? eventBarsHeight(W, sec.events, sec.legend, ch) : 0; return 10 + chH + 14 + rows * 14 + 8; };
    const plan = []; { let yy = y, pg = 0;
      a.productTable.forEach((sec, i) => { const h = hAt(sec, CHmin), onPg = plan.filter((q) => q.pg === pg).length; if (i && (onPg >= 2 || yy + h > H - 50)) { pg++; yy = 46; } plan.push({ pg }); yy += h + 20; }); }
    let pageTop = y;
    a.productTable.forEach((sec, si0) => {
      const keepS = sec.statNames.map((_, i) => i).filter((i) => sec.rows.some((r) => r.stats[i]));
      const rows = sec.rows.slice(0, 10);
      if (si0 && plan[si0].pg !== plan[si0 - 1].pg) { newPage(); pageTop = y; }
      const onPage = plan.filter((q) => q.pg === plan[si0].pg).length, idxOn = plan.slice(0, si0).filter((q) => q.pg === plan[si0].pg).length;
      // (update 567) always halves: a kind on its own (an odd one out) fills the top half, the line in the middle under it
      const slot = (H - 50 - pageTop) / 2, slotTop = pageTop + idxOn * slot;
      if (idxOn || onPage === 1) d.rect(M, pageTop + slot - 0.6, W, 1.2, { fill: P.goldLight }); // (the thin champagne line, in the middle)
      y = slotTop + (idxOn ? 16 : 0);
      const CHs = { ...CH, plotH: Math.max(60, CH.plotH + (slot * 0.9 - (idxOn ? 16 : 0) - 14 - hAt(sec, CH))) }; // (update 570: 90% of its half)
      y += 8; cap(sec.name, M, y, P.gold, "left", 8); y += 2;
      if (sec.events?.length) y += drawEventBars(d, M, y, W, sec.events, sec.legend, { ink: P.ink, grey: P.grey, hair: P.hair, ...CHs, yTitle: (sec.sgNames || ["SG / Rd"])[0] }); // (update 586: the y axis named)
      // the table: a colour square for each model, then its numbers in columns spread evenly across the page
      const colorOf = new Map((sec.legend || []).map((L) => [L.name, L.color]));
      const sgN = sec.sgNames || ["SG / Rd"], nS = sgN.length; // (update 522: named for its part of the game)
      const heads = ["Rounds", ...sgN, ...keepS.map((i) => sec.statNames[i])];
      const sw = 22, colW = (W - sw) / heads.length, xr = (i) => M + sw + colW * (i + 1) - 4; // (right edge of each column)
      // a column's values, best to worst: SG higher is better; a stat by its own definition (lower better for proximity)
      const colVals = [...sgN.map((_, j) => rows.map((r) => (r.sgs ? r.sgs[j] : r.perRound))), ...keepS.map((si) => rows.map((r) => r.stats[si]?.v ?? null))];
      const higher = [...sgN.map(() => true), ...keepS.map((si) => rows.map((r) => r.stats[si]?.def).find(Boolean)?.higher ?? null)];
      const mix = (a0, b0, t) => { const A = [1, 3, 5].map((k) => parseInt(a0.slice(k, k + 2), 16)), B = [1, 3, 5].map((k) => parseInt(b0.slice(k, k + 2), 16)); return `#${A.map((v, k) => Math.round(v + (B[k] - v) * t).toString(16).padStart(2, "0")).join("")}`; };
      const shade = (i, k) => {
        const ci = i - 1, vs = colVals[ci], v = vs?.[k], hi = higher[ci];
        if (v == null || hi == null) return null;
        // (update 519) strokes gained splits at zero: gains in greens (the biggest gain the deepest), losses in reds
        if (ci < nS) {
          if (Math.abs(v) < 0.005) return null;
          const big = Math.max(...vs.filter((x) => x != null && (v > 0 ? x > 0 : x < 0)).map(Math.abs)), t = 0.25 + 0.75 * (Math.abs(v) / (big || 1));
          return v > 0 ? mix("#f4f4f6", "#9fdcb4", t) : mix("#f4f4f6", "#f1aaa4", t);
        }
        const xs = vs.filter((x) => x != null); if (xs.length < 2) return null;
        const lo = Math.min(...xs), up = Math.max(...xs); if (up - lo < 1e-9) return null;
        let t = (v - lo) / (up - lo); if (!hi) t = 1 - t; // (t: 0 worst, 1 best)
        return t >= 0.5 ? mix("#f4f4f6", "#bfe8cc", (t - 0.5) * 2) : mix("#f4c7c3", "#f4f4f6", t * 2);
      };
      y += 10;
      heads.forEach((h, i) => { let t = h; while (textWidth(t.toUpperCase(), 6.5, true) + 1.4 * t.length > colW - 8 && t.length > 4) t = `${t.slice(0, -2)}\u2026`; cap(t, xr(i), y, P.soft, "right", 6.5); });
      y += 4;
      for (const r of rows) {
        y += 14;
        const few = r.rounds < FEW, col = few ? P.grey : P.ink;
        d.rect(M + 2, y - 8, 9, 9, { fill: colorOf.get(r.label) || P.grey });
        d.text(`${r.rounds}${few ? " *" : ""}`, xr(0), y, { size: 9, color: few ? P.down : P.grey, align: "right" });
        // (update 518) each number on a colour from best (green) to worst (red) down its column
        const cell = (t, i, k, bold) => { const c = shade(i, k); if (c) d.roundRect(xr(i) - colW + 10, y - 9.5, colW - 6, 13, 3, { fill: c }); d.text(t, xr(i) - 3, y, { size: 9, bold, color: c ? P.ink : col, align: "right" }); };
        sgN.forEach((_, j) => cell(fmt2(r.sgs ? r.sgs[j] : r.perRound), 1 + j, rows.indexOf(r), true));
        keepS.forEach((si, i) => { const x = r.stats[si]; cell(x ? fmtStat(x.def, x.v) : "\u2014", 1 + nS + i, rows.indexOf(r), false); });
        d.line(M, y + 4.5, M + W, y + 4.5, { color: P.hair, width: 0.4 });
      }
      y += 20; // (update 567: the next kind starts at its own half of the page)
    });
  }
  footer();
  return d.output();
}

/* ============================== the logo ============================== */
// The report shows your logo from the site: media/report-logo.png (e.g. a white version for the dark cover),
// or else media/logo.png. It's drawn onto the cover's colour (PDFs here take JPEG pictures). None: no logo.
async function loadLogo() {
  for (const src of ["media/report-logo.png", "media/logo.png"]) {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (!img.naturalWidth) continue;
      const k = Math.min(1, 600 / img.naturalWidth);
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
      const x = c.getContext("2d");
      x.fillStyle = "#0b0c0c"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      return { dataUrl: c.toDataURL("image/jpeg", 0.92), w: img.naturalWidth, h: img.naturalHeight, pw: c.width, ph: c.height };
    } catch { /* not there: try the next */ }
  }
  return null;
}

/* ============================== loading the player's data ============================== */
const once = (watchFn, ...args) => new Promise((res) => { let un = null; un = watchFn(...args, (v) => { res(v); setTimeout(() => un?.(), 0); }); });
// detail: the field's per-round lie / distance detail (Cloud Storage) in place of the round totals, so ranks go
// down to each distance and lie. Off when the caller has the field already, or doesn't need ranks that deep.
const enteredFor = async (playerKey) => { try { return ((await once(watchPlayerRounds, playerKey)) || []).map(roundToPrepared); } catch { return []; } };
export async function loadSource(source, playerKey, label, { detail = true } = {}) {
  if (source === "entered") {
    const state = getState();
    const rounds = await once(watchPlayerRounds, playerKey);
    const me = { key: playerKey, label, rounds: rounds.map(roundToPrepared) };
    // (update 183) entered rounds aren't ranked: the report is the player against the Tour baseline alone
    void state;
    return { me, field: [me], idx: ENTERED_IDX };
  }
  // (update 223) one set of rounds: the tour data uploaded for the player AND the rounds entered for them (each
  // entered round on its own tour: Practice, or the tour picked when it was set up)
  const [datasets, entered] = await Promise.all([once(watchClientDatasets, playerKey), enteredFor(playerKey)]);
  const shot = (datasets || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
  if (!shot) { if (!entered.length) return null; const me0 = { key: playerKey, label, rounds: entered }; return { me: me0, field: [me0], idx: ENTERED_IDX }; }
  const idx = detectColumns(shot.columns || []);
  const [rows, summary] = await Promise.all([getDatasetRows(playerKey, shot.id, shot.chunkCount), getFieldStats(shot.id).catch(() => null)]);
  const me = { key: playerKey, label, rounds: [...prepare(rows, idx), ...entered].sort((a, b) => String(a.date).localeCompare(String(b.date))) };
  let field = summaryPlayers(summary);
  if (detail && field.length) {
    const { getFieldDetail } = await import("./fieldStore.js");
    const det = await getFieldDetail(shot.id, shot.uploadedAt?.toMillis?.() ?? 0);
    if (det.players?.length > 1) field = det.players.map((p) => ({ key: p.key, name: p.name, label: p.name, rounds: p.rounds }));
  }
  return { me, field: field.length ? field.map((p) => (p.key === playerKey ? { ...me } : p)) : [me], idx, datasetId: shot.id };
}

/** The admin: every player's full shots in that file (so ranks can go down to each distance). */
export async function loadFullField(datasetId, field, me, idx) {
  const st = getState();
  if (!st.isAdmin || !datasetId) return null;
  const { loadDatasetPlayers, isLiteDevice } = await import("./fieldCache.js");
  if (isLiteDevice()) return null; // (update 403: a phone, or a file too big to hold every player's rows: the detail does)
  const { players } = await loadDatasetPlayers(datasetId).catch(() => ({ players: new Map() }));
  const full = field.map((p) => {
    if (p.key === me.key) return me;
    const got = players.get(p.key);
    return got ? { key: p.key, label: p.label || p.key, rounds: prepare(got.rows, idx) } : null; // that player's file isn't there
  }).filter(Boolean);
  return full.length > 1 ? full : null;
}

/* ============================== (update 668) bulk reports ============================== */
/** A player's tours and seasons, and what the Stats page would start them on: the latest season, and in it the tour with
 *  the most rounds. → { tours: [{ tour, rounds }], year, tour } */
export function reportDefaults(rounds) {
  const yr = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const years = [...new Set(rounds.map(yr).filter((y) => /^\d{4}$/.test(y)))].sort();
  const year = years.at(-1) || null;
  const all = new Map(), inYr = new Map();
  for (const rd of rounds) { const t = rd.tour || ""; all.set(t, (all.get(t) || 0) + 1); if (yr(rd) === year) inYr.set(t, (inYr.get(t) || 0) + 1); }
  const tours = [...all].sort((a, b) => (inYr.get(b[0]) || 0) - (inYr.get(a[0]) || 0) || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([tour, n]) => ({ tour, rounds: n, inYear: inYr.get(tour) || 0 }));
  // (as the Stats page: the tour they've played the most rounds on)
  return { tours, year, tour: [...all].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
}
/** One player's report, the way the Stats page's Generate PDF Report makes it (their season, every category, by
 *  product): → { bytes, name, rounds }. cache: shared between players (the everyone-file and the logo, loaded once). */
export async function makePlayerReport({ key, label, tour = null, year = null, cache = {}, onStep = () => {} }) {
  onStep("Loading the rounds\u2026");
  const data = await loadSource("tour", key, label, { detail: true });
  if (!data || !data.me.rounds.length) return null;
  let field = data.field;
  if (data.datasetId && getState().isAdmin && data.field.some((p) => p.summaryOnly) && !(await import("./fieldCache.js")).isLiteDevice()) {
    onStep("Loading every player\u2019s rounds\u2026");
    cache.full ||= new Map();
    if (!cache.full.has(data.datasetId)) cache.full.set(data.datasetId, (await loadFullField(data.datasetId, data.field, data.me, data.idx).catch(() => null)) || null);
    const full = cache.full.get(data.datasetId);
    if (full) field = full.some((p) => p.key === key) ? full.map((p) => (p.key === key ? data.me : p)) : [data.me, ...full];
  }
  onStep("Working out the insights\u2026");
  const from = year ? Date.parse(`${year}-01-01T00:00:00`) : null, to = year ? Date.parse(`${year}-12-31T23:59:59`) : null;
  const a = analyzePerformance(data.me, field, { from, to, cats: CATEGORIES.map(([k]) => k), byProduct: true, idx: data.idx, minRounds: null, tour, years: year ? [String(year)] : null });
  if (!a.overall.rounds) return { empty: true };
  onStep("Making the PDF\u2026");
  cache.logo ??= await loadLogo();
  const bytes = buildReportPdf(a, { aiSummary: null, sourceLabel: "All rounds", logo: cache.logo, rangeLabel: year ? `${year} season` : `All time - As of ${new Date().toLocaleDateString("en-US")}` });
  logReportRun({ uid: getState().user?.uid, playerKey: key, source: "tour" }).catch(() => {});
  const name = `${String(label).replace(/[^\w -]/g, "")} ${tour ? `${String(tour).replace(/[^\w -]/g, "")} ` : ""}${year || ""} performance report.pdf`.replace(/\s+/g, " ");
  return { bytes, name, rounds: a.overall.rounds };
}

/* ============================== the panel ============================== */
/** "Auto-generate report" for one player. canSave: the admin can also put it in the player's reports. */
export function reportBuilder({ playerKey, playerLabel, canSave = false, flash = () => {}, source: startSource0 = "tour", // eslint-disable-line no-unused-vars
   minRounds = null, tour = null, fullField = null, auto = null }) {
  // (update 545) auto: { from, to (YYYY-MM-DD or null), cats, rangeLabel, onReady(href, name), onDone(msg) }: no options shown, the
  // report made straight away from the Stats page's filters
  const wrapEl = el("div", { class: "report-gen" });
  const openBtn = el("button", { type: "button", class: "btn ghost report-gen-open" }, "\u2728 Generate PDF Report");
  const panel = el("div", { class: "report-gen-panel", hidden: true });
  openBtn.addEventListener("click", () => { panel.hidden = !panel.hidden; openBtn.setAttribute("aria-expanded", panel.hidden ? "false" : "true"); if (!panel.hidden) loadSeasons(); });

  // dates
  const fromIn = el("input", { type: "date", "aria-label": "From" }), toIn = el("input", { type: "date", "aria-label": "To" });
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const presets = [["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"], ["all", "All time"]]; // (update 274: no "This year"; the seasons below cover it)
  // (update 227) and each season in the player's data (added once their rounds are looked up)
  let seasonsLoaded = false;
  const loadSeasons = async () => {
    if (seasonsLoaded) return; seasonsLoaded = true;
    try {
      const d0 = await loadSource("tour", playerKey, playerLabel, { detail: false });
      const ys = [...new Set((d0?.me?.rounds || []).map((rd) => String(rd.year || String(rd.date || "").slice(0, 4))).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
      for (const y of ys) if (!presets.some(([v]) => v === `y:${y}`)) presets.push([`y:${y}`, `${y} season`]);
      // (update 274) start on the latest season (unless dates were already picked)
      if (ys.length && preset === "all" && !fromIn.value && !toIn.value) { preset = `y:${ys[0]}`; fromIn.value = `${ys[0]}-01-01`; toIn.value = `${ys[0]}-12-31`; }
      drawPresets();
    } catch { /* the usual presets only */ }
  };
  let preset = "all";
  const presetBox = el("div", { class: "subnav small report-presets" });
  const drawPresets = () => mount(presetBox, presets.map(([v, l]) => {
    const a = el("a", { href: "#", "aria-current": preset === v ? "page" : null }, l);
    a.addEventListener("click", (e) => {
      e.preventDefault(); preset = v;
      const now = Date.now();
      if (v === "all") { fromIn.value = ""; toIn.value = ""; }
      else if (v.startsWith("y:")) { fromIn.value = `${v.slice(2)}-01-01`; toIn.value = `${v.slice(2)}-12-31`; }
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
  // (update 223) no Tour Events / Entered Rounds choice: the player's rounds are both together
  const source = { value: "tour" }, startSource = "tour"; void startSource0;
  // Min. rounds for Tour Avg and ranks: the Stats page's number when it opened this; empty = the default
  const minIn = el("input", { type: "number", min: 1, max: 999, inputmode: "numeric", class: "report-min-in", placeholder: "Auto", value: minRounds ?? "", "aria-label": "Minimum rounds for Tour Avg and ranks" });
  const go = el("button", { type: "button", class: "btn" }, "Generate report");
  const status = el("p", { class: "muted small", role: "status" });
  const result = el("div", { class: "report-gen-result" });
  go.addEventListener("click", async () => {
    go.disabled = true; mount(result, null);
    const pageBuild = window.__taBuild;
    if (pageBuild && REPORT_BUILD && pageBuild !== REPORT_BUILD) {
      status.textContent = `This page is still running an older copy of the report (build ${REPORT_BUILD}, the site is on ${pageBuild}). Reload the page and try again.`;
      go.disabled = false; return;
    }
    status.textContent = "Loading the rounds\u2026";
    try {
      const useStats = source.value === startSource && fullField?.length > 1;
      if (source.value === "tour" && !useStats) status.textContent = "Loading every player\u2019s rounds\u2026";
      const data = await loadSource(source.value, playerKey, playerLabel, { detail: !useStats });
      if (!data || !data.me.rounds.length) { status.textContent = "No rounds for this player yet (no tour data and no entered rounds)."; return; }
      // Every player's own rows (the admin), so ranks and Tour Avg can go down to each distance and lie:
      // the Stats page's players when it opened this, or loaded now. (Others only have the shared summary.)
      let field = data.field;
      if (useStats) field = fullField.map((p) => (p.key === playerKey ? data.me : p));
      else if (data.datasetId && getState().isAdmin && data.field.some((p) => p.summaryOnly) && !(await import("./fieldCache.js")).isLiteDevice()) {
        status.textContent = "Loading every player\u2019s rounds\u2026";
        field = (await loadFullField(data.datasetId, data.field, data.me, data.idx).catch(() => null)) || data.field;
      }
      status.textContent = "Working out the insights\u2026";
      const from = fromIn.value ? Date.parse(`${fromIn.value}T00:00:00`) : null, to = toIn.value ? Date.parse(`${toIn.value}T23:59:59`) : null;
      // (update 550) a season (the Stats page's years, or a season picked here): by the file's year, as the Stats page
      const years = auto?.years?.length ? auto.years : preset?.startsWith?.("y:") && fromIn.value === `${preset.slice(2)}-01-01` && toIn.value === `${preset.slice(2)}-12-31` ? [preset.slice(2)] : null;
      const a = analyzePerformance(data.me, field, { from, to, cats, byProduct: true, idx: data.idx, minRounds: minIn.value ? Number(minIn.value) : null, tour: source.value === startSource ? tour : null, years });
      let aiSummary = null;
      const url = null; // (update 253: the report's own written summary; the AI service is for Compare's Ask AI only)
      if (url && a.overall.rounds) {
        status.textContent = "Writing the summary\u2026";
        try {
          const token = await getState().user?.getIdToken?.();
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ analysis: aiDigest(a) }, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)) }); // (update 252: just what the summary needs, numbers to 2 places: a few hundred words, not every round)
          if (res.ok) aiSummary = (await res.json()).summary || null;
        } catch { /* the report still works without it */ }
      }
      status.textContent = "Making the PDF\u2026";
      // a preset's name ("This year" is shown as the year itself, e.g. 2026); your own dates are shown as dates
      // ("This year" and "All time" also say how current they are: "2026 - As of 10/9/2026")
      const asOf = ` - As of ${new Date().toLocaleDateString("en-US")}`;
      const rangeLabel = auto?.rangeLabel ? auto.rangeLabel : preset === "year" ? `${new Date().getFullYear()}${asOf}` : preset === "all" ? `All time${asOf}` : preset?.startsWith?.("y:") ? `${preset.slice(2)} season` : preset ? presets.find(([v]) => v === preset)?.[1] : null;
      const bytes = buildReportPdf(a, { aiSummary, sourceLabel: "All rounds", logo: await loadLogo(), rangeLabel });
      const name = `${playerLabel.replace(/[^\w -]/g, "")} performance report ${new Date().toISOString().slice(0, 10)}.pdf`;
      window.__lastReportPdf = bytes; // (for tests)
      logReportRun({ uid: getState().user?.uid, playerKey, source: source.value }).catch(() => {}); // (update 169: At a glance → Reports generated)
      const blob = new Blob([bytes], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const save = canSave ? el("button", { type: "button", class: "btn ghost" }, "Save to Reports") : null;
      save?.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const range = fromIn.value || toIn.value ? `${fromIn.value || "start"} to ${toIn.value || "today"}` : "all rounds";
          await uploadDocument({ title: `Performance report (${range})`, description: `${cats.length === 4 ? "All categories" : cats.map((k) => CAT_NAME[k]).join(", ")} \u00b7 auto-generated`, audienceClientKey: playerKey, category: "performance", file: new File([blob], name, { type: "application/pdf" }) });
          flash(`Saved to ${playerLabel}'s Performance Reports.`, "ok");
        } catch { flash("Couldn't save the report.", "error"); save.disabled = false; }
      });
      auto?.onReady?.(href, name, a);
      mount(result, [
        el("p", {}, [el("strong", {}, `Report ready: ${a.overall.rounds} rounds, ${a.focus.length} focus area${a.focus.length === 1 ? "" : "s"}.`)]),
        // Open PDF (in a new tab; save it from there) and, for the admin, Save to Reports, side by side
        el("div", { class: "report-gen-actions report-gen-done" }, [el("a", { class: "btn", href, target: "_blank", rel: "noopener", title: name }, "Open PDF"), save]),
      ]);
      status.textContent = "";
    } catch (err) {
      console.error(err);
      status.textContent = "Couldn't make the report. Try again.";
      auto?.onFail?.();
    } finally { go.disabled = false; }
  });

  mount(panel, [
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Dates"), presetBox, el("div", { class: "report-dates" }, [el("label", { class: "date-field" }, ["Start Date", fromIn]), el("label", { class: "date-field" }, ["End Date", toIn])])]),
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Categories"), catBox]),
    el("div", { class: "report-row" }, [el("label", { class: "report-min", title: "Tour Avg, ranks and Elite only count players with at least this many rounds in the dates picked. Empty: 33% of the most rounds played, rounded down to a 5." }, ["Min. rounds", minIn])]),
    el("div", { class: "report-gen-actions" }, [go]), status, result,
  ]);
  if (auto) {
    // (update 545) straight to it: the Stats page's dates and categories, no options
    fromIn.value = auto.from || ""; toIn.value = auto.to || ""; preset = null;
    if (auto.cats?.length) cats = auto.cats.filter((k) => CATEGORIES.some(([c]) => c === k));
    if (!cats.length) cats = CATEGORIES.map(([k]) => k);
    mount(wrapEl, el("div", { class: "report-gen-auto" }, [status, result]));
    setTimeout(() => go.click(), 0);
    return wrapEl;
  }
  mount(wrapEl, [openBtn, panel]);
  return wrapEl;
}
