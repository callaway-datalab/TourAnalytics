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
import { detectColumns, isShotData, prepare, summaryPlayers, sliceTotals, sgBy, CATEGORIES, shortDate, defaultMinRounds, statRounds, statAgg, statDef, fmtStat, statsIn } from "./sg.js";
import { watchPlayerRounds, getAllRounds } from "./rounds.js";
import { roundToPrepared, enteredPlayers, ENTERED_IDX } from "./roundCalc.js";
import { PdfDoc, wrap, textWidth } from "./pdfLite.js";

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
export function analyzePerformance(me, field, { from = null, to = null, cats: catsIn = CATEGORIES.map(([k]) => k), byProduct = false, idx = {}, minRounds = null, tour = null } = {}) {
  const cats = CATEGORIES.map(([k]) => k).filter((k) => catsIn.includes(k));
  const inRange = (rd) => { const t = day(rd.date); return t == null || ((from == null || t >= from) && (to == null || t <= to)); };
  // Only rounds with strokes-gained data count (a file's other stats, such as Birdies / Round per tournament, make
  // rounds of their own that would otherwise count as rounds with no strokes gained), and only the Stats page's tour.
  const hasSG = (rd) => (rd.has ? rd.has.has("sg") : rd.shots.length > 0);
  const onTour = (rd) => tour == null || (rd.tour || "") === tour;
  const pick = (rounds) => rounds.filter((rd) => hasSG(rd) && onTour(rd) && inRange(rd)).map((rd) => ({ ...rd, shots: rd.shots.filter((s) => cats.includes(s.cat)) }))
    .sort((a, b) => (day(a.date) ?? 0) - (day(b.date) ?? 0));
  const mine = pick(me.rounds);
  const played = field.filter((p) => p.key !== me.key).map((p) => ({ ...p, rounds: pick(p.rounds) })).filter((p) => p.rounds.length);
  // Tour Avg, ranks and Elite use the same players as the Stats page: at least Min. rounds in this period
  // (the number set on the Stats page, or its default: a quarter of the most rounds played, down to a 10)
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
    return { rank: i >= 0 ? i + 1 : null, of: vals.length, fieldAvg: mean(fieldVals), best: vals[0] || null, low: vals[vals.length - 1] || null };
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
  const half = Math.min(10, Math.floor(series.length / 2));
  const late = series.slice(series.length - half), early = series.slice(series.length - 2 * half, series.length - half); // the last 10 vs the 10 before them
  const span = (list) => (list.length ? `${fmtDate(list[0].date)} \u2013 ${fmtDate(list[list.length - 1].date)}` : "");
  const halves = half >= 2 ? { n: half, early: span(early), late: span(late) } : null;
  const catTrend = cats.map((k) => {
    const a = mean(early.map((s) => s.byCat[k])), b = mean(late.map((s) => s.byCat[k]));
    return { cat: k, name: CAT_NAME[k], early: a, late: b, change: a != null && b != null ? b - a : null };
  });
  const ranked = [...series].sort((a, b) => b.value - a.value);
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
        perRound: g.perRound, shots: g.shots, fieldAvg: mean(vals), rank: vals.length ? all.indexOf(g.perRound) + 1 : null, of: vals.length ? all.length : null });
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
      detail: `${c.value >= 0 ? `Gains ${c.value.toFixed(2)}` : `Loses ${Math.abs(c.value).toFixed(2)}`} strokes a round${c.fieldAvg != null ? `, against a Tour Avg of ${fmtSG(c.fieldAvg)}` : ""}${c.rank ? `. Ranked ${c.rank} of ${c.of}.` : "."}` });
  }
  const minShots = Math.max(5, mine.length * 0.5);
  for (const g of groups) {
    if (g.shots < minShots || g.repeat) continue;
    const gap = g.fieldAvg != null ? g.perRound - g.fieldAvg : g.perRound;
    if (gap < -0.05) focus.push({ cat: g.cat, kind: "skill", label: g.label, lost: -gap, title: g.title,
      detail: `${g.perRound >= 0 ? `Gains only ${g.perRound.toFixed(2)}` : `Loses ${Math.abs(g.perRound).toFixed(2)}`} strokes a round here${g.fieldAvg != null ? ` (Tour Avg ${fmtSG(g.fieldAvg)})` : ""}, over ${Math.round(g.shots)} shots.` });
  }
  for (const t of catTrend) if (t.change != null && t.change < -0.2) focus.push({ cat: t.cat, kind: "trend", lost: -t.change / 2, title: `Slipping: ${t.name}`,
    detail: `Previous ${half} rounds: ${fmtSG(t.early)} a round. Last ${half} rounds: ${fmtSG(t.late)} a round. That's ${Math.abs(t.change).toFixed(2)} strokes a round worse.` });
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
    elite.push({ cat: c.cat, score: 1 + (c.value - (c.fieldAvg ?? 0)), title: c.name,
      text: `Ranked ${c.rank} of ${c.of}. Gains ${c.value.toFixed(2)} strokes a round${c.fieldAvg != null ? `; Tour Avg ${fmtSG(c.fieldAvg)}` : ""}.` });
  }
  for (const g of groups) {
    if (g.repeat || g.shots < Math.max(10, minShots) || g.perRound <= 0 || !isElite(g.rank, g.of)) continue;
    elite.push({ cat: g.cat, score: g.perRound - (g.fieldAvg ?? 0), title: g.title,
      text: `Ranked ${g.rank} of ${g.of}. Gains ${g.perRound.toFixed(2)} strokes a round${g.fieldAvg != null ? `; Tour Avg ${fmtSG(g.fieldAvg)}` : ""}. ${Math.round(g.shots)} shots.` });
  }
  elite.sort((p, q) => q.score - p.score);
  const rising = catTrend.filter((t) => t.change != null && t.change >= 0.2).sort((p, q) => q.change - p.change).map((t) => ({
    cat: t.cat, title: t.early < 0 && t.late >= 0 ? `Turned it around: ${t.name}` : `On the rise: ${t.name}`,
    text: `Previous ${half} rounds: ${fmtSG(t.early)} a round. Last ${half} rounds: ${fmtSG(t.late)} a round. That's ${t.change.toFixed(2)} strokes a round better.` }));
  // recent form, in plain terms: the last 10 rounds against the first 10 (or halves when there are fewer)
  const n10 = Math.min(10, Math.floor(series.length / 2));
  const form = n10 >= 2 ? { n: n10, first: mean(series.slice(-2 * n10, -n10).map((q) => q.value)), last: mean(series.slice(-n10).map((q) => q.value)), firstSpan: span(series.slice(-2 * n10, -n10)), lastSpan: span(series.slice(-n10)) } : null;
  // By the numbers: rounds gaining strokes, the longest run of them, the steadiest and swingiest parts of the
  // game (how much each swings round to round), and the biggest upside (matching the group's best where the
  // player is furthest behind).
  const posRounds = series.filter((q) => q.value > 0).length;
  let run = 0, best = { len: 0, from: null, to: null }, start = null;
  series.forEach((q, i) => { if (q.value > 0) { if (!run) start = i; run++; if (run > best.len) best = { len: run, from: series[start].date, to: q.date }; } else run = 0; });
  const sd = (vals) => { const m = mean(vals); return vals.length > 1 ? Math.sqrt(vals.reduce((t, v) => t + (v - m) ** 2, 0) / (vals.length - 1)) : null; };
  const swings = cats.map((k) => ({ cat: k, sd: sd(series.map((q) => q.byCat[k])) })).filter((x) => x.sd != null).sort((p, q) => p.sd - q.sd);
  // Biggest upside: the player's own best stretch (their best average over a run of rounds) in each category,
  // against their average now; the category where getting back to that is worth the most.
  const win = Math.min(10, Math.max(3, Math.floor(series.length / 3)));
  const upside = series.length >= win ? byCat.filter((c) => c.value != null).map((c) => {
    let bestAvg = -Infinity, at = 0;
    for (let i = 0; i + win <= series.length; i++) { const v = mean(series.slice(i, i + win).map((q) => q.byCat[c.cat] ?? 0)); if (v > bestAvg) { bestAvg = v; at = i; } }
    return { cat: c.cat, gain: bestAvg - c.value, bestV: bestAvg, now: c.value, win, from: series[at].date, to: series[at + win - 1].date };
  }).sort((p, q) => q.gain - p.gain)[0] || null : null;
  // one category: the other players' typical swing in it (Tour Avg steadiness)
  let tourSd = null;
  if (cats.length === 1) {
    const k = cats[0];
    const sds = others.map((p) => sd(p.rounds.map((rd) => rd.shots.filter((x) => x.cat === k).reduce((t, x) => t + x.sg, 0)))).filter((v) => v != null && Number.isFinite(v));
    tourSd = sds.length ? mean(sds) : null;
  }
  const numbers = { posRounds, n: series.length, streak: best, steady: swings[0] || null, swingy: swings.length > 1 ? swings[swings.length - 1] : null, upside, tourSd };

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
    const rank = def.higher == null ? null : 1 + vals.filter((v) => better(v, value)).length;
    // the last 10 rounds (or events) against the 10 before, pooled
    const n = Math.min(10, Math.floor(mineK.length / 2));
    const last = n >= 2 ? statAgg(mineK.slice(-n), !!keep).value : null, prev = n >= 2 ? statAgg(mineK.slice(-2 * n, -n), !!keep).value : null;
    // its value in each category it has (Hit Green %: Approach and Around-the-Green)
    const byCat = keep ? [] : CATEGORIES.map(([c, name]) => { const rs = mineK.map((rd) => ({ ...rd, shots: rd.shots.filter((o) => o.cat === c) })); const v = statAgg(rs, true).value; return v == null ? null : { cat: c, name, value: v }; }).filter(Boolean);
    return { key: k, def: label ? { ...def, label } : def, value, rounds: mineK.length, events: mineK.length > 0 && mineK.every((rd) => rd.eventLevel), rank, of: rank ? all.length : null,
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
  const UD_BANDS = [["<30 yds", 0, 30], ["30-50 yds", 30, 50]], UD_LIES = ["Fairway", "Rough", "Bunker"];
  let udGrid = null;
  for (const k of present) {
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
  return { me: { key: me.key, label: me.label }, cats, from, to, overall, byCat, series, slope, catTrend, numbers, elite: elite.slice(0, 4), rising, form, halves, peaks: peaks.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })),
    valleys: valleys.map((s) => ({ ...s, best: bestCat(s), worst: worstCat(s) })), groups, products, focus: top, players: everyone.length, detail, minRounds: minR, compared: others.length, tour, basics, grid, bands: BANDS.map(([l]) => l), udGrid };
}

/* ============================== the PDF ============================== */
// Premium but lively: a dark gradient hero with a gold edge and one big number, badges, coloured insight cards
// (strengths in green, things to watch in red), gauge bars, and plain-English sentences under every number.
const P = {
  night: "#0a0a0b", night2: "#16201a", ink: "#1d1d1f", grey: "#5f6368", soft: "#86868b", faint: "#a1a1a6", hair: "#e3e3e8", mist: "#f5f5f7",
  gold: "#b08d57", goldLight: "#d4b483", up: "#1e8e4a", upDeep: "#14703a", upTint: "#e7f5ec", down: "#d0342c", downDeep: "#a8241e", downTint: "#fdecea",
  track: "#eceef1", note: "#faf6ee",
};
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
    cap("Tour Analytics  \u00b7  Powered by ShotLink", M, H - 20, P.faint);
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
  const ma = (vals, n = 5) => vals.map((_, i) => mean(vals.slice(Math.max(0, i - n + 1), i + 1)));

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
  wrap(a.overall.rounds ? `${a.overall.value >= 0 ? "Better" : "Worse"} than the baseline by ${Math.abs(a.overall.value).toFixed(2)} strokes a round${versus != null ? `, and ${Math.abs(versus).toFixed(2)} ${versus >= 0 ? "better" : "worse"} than Tour Avg (${fmtSG(a.overall.fieldAvg)}).` : "."}` : "No rounds in this period.", W * 0.56, 9.5)
    .slice(0, 2).forEach((l, i) => d.text(l, M, 190 + i * 12, { size: 9.5, color: "#c7c7cc" }));
  // badges
  let bx = M;
  if (a.overall.rank) bx += badge(`Rank ${a.overall.rank} of ${a.overall.of}`, bx, 220, a.overall.rank === 1 ? P.gold : "#3a3a3c", a.overall.rank === 1 ? P.night : "#ffffff") + 6;
  bx += badge(plural(a.overall.rounds, "round"), bx, 220, "#3a3a3c") + 6;
  if (a.form) { const ch = a.form.last - a.form.first; bx += badge(Math.abs(ch) < STEADY ? "Form: steady" : ch > 0 ? "Form: improving" : "Form: cooling down", bx, 220, Math.abs(ch) < STEADY ? "#3a3a3c" : ch > 0 ? P.up : P.down) + 6; }
  // form sparkline (right side)
  if (a.series.length >= 3) {
    const vals = ma(a.series.map((q) => q.value)), x0 = M + W * 0.62, w = W * 0.38, top = 104, ht = 74;
    const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0), Y = (v) => top + ht - ((v - lo) / (hi - lo || 1)) * ht;
    d.roundRect(x0 - 12, top - 22, w + 12, ht + 52, 12, { fill: "#141815" });
    cap("SG Trend", x0, top - 6, "#8e8e93", "left", 6.5);
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

  /* ---------- highlights: strengths and things to watch ---------- */
  // (at most two strengths from the same category, so they don't repeat each other)
  const strengths = [];
  for (const it of [...a.elite.map((e) => ({ ...e, tag: "Elite", title: e.title.replace(/^Best in the group: (.*)$/, "$1: best in the group") })),
    ...a.rising.map((r) => ({ ...r, tag: r.title.startsWith("Turned") ? "Turnaround" : "Rising", title: r.title.replace(/^(Turned it around|On the rise): /, "") }))]) {
    if (strengths.length >= 3) break;
    if (strengths.filter((x) => x.cat === it.cat).length >= 2) continue;
    strengths.push(it);
  }
  const watch = a.focus.slice(0, 3).map((f) => ({ title: f.title.replace(/^Slipping: /, ""), text: f.detail, tag: f.kind === "trend" ? "Slipping" : "Costing strokes", lost: f.lost }));
  const colW = (W - 14) / 2;
  const cardsH = (list) => list.reduce((t, it) => t + 35 + wrap(it.text, colW - 30, 8.5).length * 11, 0) + 26;
  section("Highlights", "What stands out", Math.max(cardsH(strengths), cardsH(watch)));
  const cards = (x, title, list, accent, tint, empty) => {
    let yy = y + 4;
    cap(title, x, yy + 6, accent); yy += 14;
    if (!list.length) { d.text(empty, x, yy + 10, { size: 9, color: P.grey }); return yy + 20; }
    for (const it of list) {
      const lines = wrap(it.text, colW - 30, 8.5), h = 29 + lines.length * 11;
      d.roundRect(x, yy, colW, h, 8, { fill: tint });
      d.roundRect(x, yy, 4, h, 2, { fill: accent });
      const tw = badge(it.tag, x + 14, yy + 14, accent);
      d.text(wrap(it.title, colW - 30 - tw - 8, 9.5, true)[0], x + 14 + tw + 6, yy + 14, { size: 9.5, bold: true, color: P.ink });
      lines.forEach((l, i) => d.text(l, x + 14, yy + 32 + i * 11, { size: 8.5, color: "#3a3a3c" }));
      yy += h + 6;
    }
    return yy;
  };
  const yl0 = cards(M, "Strengths", strengths, P.up, P.upTint, "No clear standouts against Tour Avg in this period.");
  const yl = yl0 + 2;
  const yr = cards(M + colW + 14, "Watch", watch, P.down, P.downTint, "Nothing is costing strokes against Tour Avg in this period.");
  y = Math.max(yl, yr) + 10;

  /* ---------- best and toughest rounds ---------- */
  const rowsH = 28 + Math.max(a.peaks.length, a.valleys.length) * 28;
  section("Rounds", "Best and toughest", rowsH);
  const roundsCol = (x, title, list, c, tint) => {
    d.roundRect(x, y, colW, rowsH - 6, 10, { fill: tint });
    cap(title, x + 12, y + 16, c);
    list.forEach((q, i) => {
      const yy = y + 32 + i * 28, part = c === P.up ? q.best : q.worst;
      d.text(wrap(q.event || "Round", colW - 90, 9.5, true)[0], x + 12, yy, { size: 9.5, bold: true, color: P.ink });
      d.text(`${q.roundNo ? `R${q.roundNo}  \u00b7  ` : ""}${fmtDate(q.date)}  \u00b7  ${c === P.up ? "best part" : "hardest part"}: ${CAT_NAME[part[0]] || ""} ${fmtSG(part[1])}`, x + 12, yy + 11, { size: 7.5, color: P.grey });
      d.text(fmtSG(q.value), x + colW - 12, yy + 6, { size: 15, bold: true, color: c, align: "right" });
    });
  };
  roundsCol(M, "Best rounds", a.peaks, P.up, P.upTint);
  roundsCol(M + colW + 14, "Toughest rounds", a.valleys, P.down, P.downTint);
  y += rowsH + 6;


  newPage();
  /* ---------- by category: gauges ---------- */
  section("By category", "Where the strokes come from", 40 + a.byCat.length * 36);
  d.text("The black line is zero; the gold line is Tour Avg.", M, y + 6, { size: 8, color: P.grey });
  y += 18;
  const gx = M + 150, gw = W - 150 - 150, zx = gx + gw / 2, half = gw / 2;
  for (const c of a.byCat) {
    need(36);
    const t = a.catTrend.find((q) => q.cat === c.cat);
    d.text(c.name, M, y + 15, { size: 11.5, bold: true, color: P.ink });
    d.text(c.rank ? `Rank ${c.rank} of ${c.of}` : "", M, y + 27, { size: 8, color: P.grey });
    d.roundRect(gx, y + 8, gw, 12, 6, { fill: P.track });
    // each side's scale: the group's best gain (right) and biggest loss (left)
    const hi = c.best?.v ?? 0, lo = c.low?.v ?? 0;
    const posMax = hi > 0 ? hi : Math.max(Math.abs(lo), 0.01), negMax = lo < 0 ? Math.abs(lo) : Math.max(hi, 0.01);
    const off = (v) => (v >= 0 ? Math.min(1, v / posMax) : -Math.min(1, Math.abs(v) / negMax)) * half;
    if (c.value != null) {
      const w = Math.max(10, Math.abs(off(c.value))), x0 = c.value >= 0 ? zx : zx - w, fill = c.value >= 0 ? P.up : P.down, light = c.value >= 0 ? "#4fb97a" : "#e8665e";
      // rounded at the far end, square where it meets the middle line
      d.roundRect(x0, y + 8, w, 12, 6, { fill });
      d.rect(c.value >= 0 ? zx : zx - Math.min(6, w), y + 8, Math.min(6, w), 12, { fill });
      d.roundRect(c.value >= 0 ? zx : x0 + 3, y + 9.5, Math.max(3, w - 3), 3.5, 1.75, { fill: light });
      d.rect(c.value >= 0 ? zx : zx - 2, y + 9.5, 2, 3.5, { fill: light });
    }
    d.line(zx, y + 4, zx, y + 24, { color: "#000000", width: 1.1 }); // zero
    if (c.fieldAvg != null) { const fx = zx + off(c.fieldAvg); d.line(fx, y + 2, fx, y + 26, { color: "#ffffff", width: 3.6 }); d.line(fx, y + 2, fx, y + 26, { color: P.gold, width: 2 }); } // Tour Avg
    d.text(fmtSG(c.value), M + W - 66, y + 19, { size: 18, bold: true, color: tone(c.value), align: "right" });
    if (t && t.change != null && Math.abs(t.change) >= STEADY) badge(t.change > 0 ? `Up ${t.change.toFixed(2)}` : `Down ${Math.abs(t.change).toFixed(2)}`, M + W - 58, y + 18, t.change > 0 ? P.up : P.down);
    else if (t && t.change != null) badge("Steady", M + W - 58, y + 18, "#8e8e93");
    y += 36;
  }
  d.text(a.halves ? `Up / Down: the last ${a.halves.n} rounds (${a.halves.late}) compared with the ${a.halves.n} before them (${a.halves.early}), in strokes a round.` : "Up / Down: the last rounds compared with the ones before them, in strokes a round.", M, y + 4, { size: 7.5, color: P.faint });
  y += 18;

  /* ---------- SG form: total and each category ---------- */
  const formChart = (title, vals, { marks = false } = {}) => {
    const n = Math.min(10, Math.floor(vals.length / 2));
    const first = n >= 2 ? mean(vals.slice(-2 * n, -n)) : null, last = n >= 2 ? mean(vals.slice(-n)) : null; // the 10 before, the last 10
    const top = y + 22, ht = 70, left = M + 22, wd = W - 22;
    need(ht + 52);
    d.text(title, M, y + 10, { size: 11, bold: true, color: P.ink });
    if (first != null) {
      const ch = last - first;
      d.text(`Previous ${n} rounds: ${fmtSG(first)}   \u00b7   Last ${n}: ${fmtSG(last)}   \u00b7   ${Math.abs(ch) < STEADY ? "about the same" : `${ch > 0 ? "better" : "worse"} lately by ${Math.abs(ch).toFixed(2)}`}`, M + W, y + 10, { size: 8, bold: true, color: Math.abs(ch) < STEADY ? P.grey : tone(ch), align: "right" });
    }
    const lo = Math.min(-0.5, Math.min(...vals)), hi = Math.max(0.5, Math.max(...vals));
    const Y = (v) => top + ht - ((v - lo) / (hi - lo)) * ht;
    d.roundRect(M - 6, top - 6, W + 12, ht + 22, 8, { fill: P.mist });
    d.line(left, Y(0), M + W, Y(0), { color: "#000000", width: 0.6 });
    d.text("0", M, Y(0) + 3, { size: 6.5, color: P.faint });
    const bw = wd / vals.length;
    vals.forEach((v, i) => { const x = left + i * bw + bw * 0.18, w = Math.max(1, bw * 0.64), y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); d.rect(x, y0, w, Math.max(0.6, y1 - y0), { fill: v >= 0 ? "#8fd4a8" : "#f2a39d" }); });
    d.polyline(ma(vals).map((v, i) => [left + i * bw + bw / 2, Y(v)]), { color: P.gold, width: 1.8 });
    if (marks) {
      const iB = vals.indexOf(Math.max(...vals)), iW = vals.indexOf(Math.min(...vals));
      for (const [i, c] of [[iB, P.up], [iW, P.down]]) d.dot(left + i * bw + bw / 2, Y(vals[i]), 2.4, c);
    }
    const every = Math.max(1, Math.ceil(vals.length / 8));
    a.series.forEach((q, i) => { if (i % every === 0) { const t = day(q.date); d.text(t == null ? "" : shortDate(new Date(t)), left + i * bw + bw / 2, top + ht + 11, { size: 6.5, color: P.faint, align: "center" }); } });
    y = top + ht + 26;
  };
  /* ---------- SG form: the total (of the categories in this report) ---------- */
  if (a.series.length >= 2) {
    section("SG Form", "Round by round", 150);
    d.text("Each bar is one round (green = gained strokes, red = lost). The gold line is the rolling average of the last 5 rounds: when it rises, the player is playing better.", M, y + 6, { size: 8, color: P.grey });
    y += 14;
    formChart(a.cats.length === CATEGORIES.length ? "Total" : `Total \u00b7 ${a.cats.map((k) => CAT_NAME[k]).join(", ")}`, a.series.map((q) => q.value), { marks: true });
  }

  /* ---------- by the numbers: four premium tiles ---------- */
  {
    const nb = a.numbers, tiles = [];
    const pct = nb.n ? nb.posRounds / nb.n : 0;
    if (nb.n) tiles.push({ label: "Rounds in the green", big: `${nb.posRounds} of ${nb.n}`, text: `Gained strokes overall in ${Math.round(pct * 100)}% of rounds.`, viz: "bar", v: pct });
    if (nb.streak.len) tiles.push({ label: "Best run", big: `${nb.streak.len} ${nb.streak.len === 1 ? "round" : "rounds"}`, text: `In a row gaining strokes, ${shortDate(new Date(day(nb.streak.from)))} \u2013 ${shortDate(new Date(day(nb.streak.to)))}.`, viz: "dots", v: nb.streak.len });
    if (nb.upside && nb.upside.gain > 0.01) tiles.push({ label: "Biggest upside", big: `+${nb.upside.gain.toFixed(2)}`,
      text: `A round more if ${CAT_NAME[nb.upside.cat]} got back to its best ${nb.upside.win}-round stretch (${fmtSG(nb.upside.bestV)}, ${shortDate(new Date(day(nb.upside.from)))} \u2013 ${shortDate(new Date(day(nb.upside.to)))}).`, viz: "pair", v: nb.upside });
    else if (a.byCat.length) tiles.push({ label: "Biggest upside", big: "At peak", text: "Playing at their best stretch in every category in this report.", viz: null });
    if (nb.steady && a.cats.length === 1) {
      const v = nb.steady.sd, tv = nb.tourSd;
      tiles.push({ label: `${CAT_NAME[nb.steady.cat]} steadiness`, big: `\u00b1${v.toFixed(2)}`,
        text: `Typical swing round to round.${tv != null ? ` Tour Avg: \u00b1${tv.toFixed(2)}, so ${Math.abs(v - tv) < 0.05 ? "about as steady as the others" : v < tv ? "steadier than the others" : "less steady than the others"}.` : ""}`, viz: "steadyVsTour", v: { mine: v, tour: tv } });
    } else if (nb.steady) tiles.push({ label: `Steadiest \u00b7 ${CAT_NAME[nb.steady.cat]}`, big: `\u00b1${nb.steady.sd.toFixed(2)}`, text: `Typical swing round to round.${nb.swingy ? ` ${CAT_NAME[nb.swingy.cat]} swings the most (\u00b1${nb.swingy.sd.toFixed(2)}).` : ""}`, viz: "swing", v: nb });
    if (tiles.length) {
      const cols = 2, gap = 12, tw = (W - gap) / cols, th = 92, rows = Math.ceil(tiles.length / cols);
      section("By the numbers", "At a glance", rows * (th + gap));
      tiles.slice(0, 4).forEach((t, i) => {
        const x = M + (i % cols) * (tw + gap), ty = y + Math.floor(i / cols) * (th + gap);
        // a dark tile with rounded corners and a soft left-to-right blend
        d.roundRect(x, ty, 24, th, 10, { fill: P.night });
        d.roundRect(x + tw - 24, ty, 24, th, 10, { fill: P.night2 });
        d.gradient(x + 12, ty, tw - 24, th, P.night, P.night2, { dir: "h", steps: 30 });
        cap(t.label, x + 16, ty + 20, P.goldLight, "left", 6.8);
        // the big number, as large as fits
        let size = 24; while (size > 12 && textWidth(t.big, size, true) > tw * 0.5) size -= 1;
        d.text(t.big, x + 16, ty + 50, { size, bold: true, color: "#ffffff" });
        wrap(t.text, tw * 0.52, 7.8).slice(0, 3).forEach((l, j) => d.text(l, x + 16, ty + 64 + j * 9.5, { size: 7.8, color: "#a1a1a6" }));
        // a small picture on the right
        const vx = x + tw * 0.6, vw = tw * 0.4 - 18, vy = ty + 30;
        if (t.viz === "bar") {
          d.roundRect(vx, vy + 12, vw, 7, 3.5, { fill: "#2c2c2e" });
          d.roundRect(vx, vy + 12, Math.max(7, vw * t.v), 7, 3.5, { fill: P.goldLight });
          d.text(`${Math.round(t.v * 100)}%`, vx + vw, vy + 36, { size: 15, bold: true, color: P.goldLight, align: "right" });
        } else if (t.viz === "dots") {
          const n = Math.min(nb.n, 12), r = Math.min(4.5, vw / (n * 2.6)), stepX = vw / n;
          for (let k = 0; k < n; k++) d.dot(vx + stepX * (k + 0.5), vy + 16, r, k < Math.min(t.v, n) ? P.goldLight : "#3a3a3c");
          d.text(`longest of ${nb.n}`, vx + vw, vy + 36, { size: 7.5, color: "#8e8e93", align: "right" });
        } else if (t.viz === "pair") {
          const mine = t.v.now ?? 0, best = t.v.bestV, mx = Math.max(Math.abs(mine), Math.abs(best), 0.01);
          for (const [j, v, lab, col] of [[0, mine, "Now", "#8e8e93"], [1, best, "Peak", P.goldLight]]) {
            const yy = vy + 6 + j * 16;
            d.text(lab, vx, yy + 6, { size: 7, bold: true, color: col });
            d.roundRect(vx + 24, yy, Math.max(4, (vw - 54) * Math.abs(v) / mx), 7, 3.5, { fill: col });
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
  // Approach and Around-the-Green: distance + lie; Off-the-Tee and Putting: distance
  const byDist = a.groups.filter((g) => (g.cat === "APP" || g.cat === "ARG" ? g.withLie : !g.withLie));
  if (byDist.length) {
    newPage(); // Detail starts at the top of the last page
    section("Detail", "Every skill by distance and lie", 52);
    d.text("Strokes gained a round. Gains on the left (best first), losses on the right (worst first).", M, y + 6, { size: 8, color: P.grey });
    y += 20;
    // (rounded to 2 decimals; only ±0.01 or more; at most 25 each side)
    const r2 = (v) => Math.round(v * 100) / 100;
    const gains = byDist.filter((g) => r2(g.perRound) >= 0.01).sort((p, q) => q.perRound - p.perRound).slice(0, 25);
    const losses = byDist.filter((g) => r2(g.perRound) <= -0.01).sort((p, q) => p.perRound - q.perRound).slice(0, 25);
    const rounds = Math.max(1, a.overall.rounds);
    const rowH = 22;
    const heads = () => { cap("Gaining", M, y, P.up); cap("Losing", M + colW + 14, y, P.down); y += 10; };
    heads();
    const row = (g, x, yy) => {
      d.text(wrap(g.title, colW - 56, 9, true)[0], x, yy, { size: 9, bold: true, color: P.ink });
      const per = g.shots / rounds;
      d.text(`${per >= 10 ? Math.round(per) : per.toFixed(1)} shots/round${g.fieldAvg != null ? `  \u00b7  Tour Avg ${fmt2(g.fieldAvg)}` : ""}${g.rank ? `  \u00b7  rank ${g.rank} of ${g.of}` : ""}`, x, yy + 9.5, { size: 7, color: P.grey });
      d.text(fmt2(g.perRound), x + colW, yy + 5, { size: 12, bold: true, color: tone(g.perRound), align: "right" });
      d.line(x, yy + 14, x + colW, yy + 14, { color: P.hair, width: 0.4 });
    };
    for (let i = 0; i < Math.max(gains.length, losses.length); i++) {
      if (y + rowH > H - 50) { newPage(); heads(); }
      y += rowH - 8;
      if (gains[i]) row(gains[i], M, y);
      if (losses[i]) row(losses[i], M + colW + 14, y);
      y += 8;
    }
    y += 10;
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

  /* ---------- page 4: basic stats ---------- */
  // A page of its own: a dark band like the cover, then a card per stat in three groups. Each card: the value,
  // its rank among the same players as the strokes-gained ranks, a bar from the group's lowest to highest with
  // Tour Avg (gold) and this player (dot), then Tour Avg and how it's going lately.
  if (a.basics?.length) {
    newPage();
    const bandH = 108;
    d.gradient(0, 0, d.W, bandH, P.night, P.night2, { dir: "v", steps: 40 });
    d.gradient(0, bandH - 3, d.W, 3, P.gold, P.goldLight, { dir: "h", steps: 40 });
    cap("Basic Stats", M, 36, P.goldLight, "left", 7.5);
    d.text(wrap(a.me.label, W * 0.75, 22, true)[0], M, 64, { size: 22, bold: true, color: "#ffffff" });
    d.text(`${period}${a.tour ? `  \u00b7  ${a.tour}` : ""}  \u00b7  ranked among the same ${a.compared ?? 0} ${a.compared === 1 ? "player" : "players"} as strokes gained (at least ${a.minRounds ?? 1} ${a.minRounds === 1 ? "round" : "rounds"})`,
      M, 86, { size: 8, color: "#8e8e93" });
    y = bandH + 24;
    d.text("Each bar runs from the group's lowest to highest. Gold line: Tour Avg. Dot: this player (green = better than Tour Avg, red = worse).", M, y, { size: 7.5, color: P.grey });
    y += 10;
    const GROUPS = [
      ["Scoring", ["scoring", "eagles", "birdiesRd", "parsRd", "bogeysRd", "dblBogeysRd", "birdie", "parOrBetter", "bogey", "owgr"]],
      ["Off-the-Tee", ["drive", "fwy"]],
      ["Approach", ["gir", "hitGreen", "prox", "pinHigh", "onLine"]], // (the grid, then any other approach stat)
      ["Short game", ["ud", "scramble", "putts", "make", "goodLag", "threePutt"]],
    ];
    const known = new Set(GROUPS.flatMap(([, ks]) => ks));
    const groups = [...GROUPS.map(([t, ks]) => [t, ks.flatMap((k) => a.basics.filter((b) => b.key === k))]), ["Other", a.basics.filter((b) => !known.has(b.key))]]
      .filter(([t, list]) => list.length || (t === "Approach" && a.grid?.length) || (t === "Short game" && a.udGrid));
    const cols = 4, gap = 8, cw = (W - gap * (cols - 1)) / cols, ch = 70;
    const better = (b, x, ref) => (b.def.higher == null || ref == null || Math.abs(x - ref) < 1e-9 ? null : b.def.higher ? x > ref : x < ref);
    const band = (b) => (b.def.pct ? 0.5 : Math.max(0.01, Math.abs(b.trend.prev) * 0.005)); // ("steady", as on the Stats page)
    const amount = (b, v) => (b.def.pct ? `${Math.abs(v).toFixed(1)} pts` : fmtStat({ ...b.def, key: "" }, Math.abs(v)));
    const head = (title) => { y += 14; d.rect(M, y - 7, 3, 9, { fill: P.gold }); cap(title, M + 9, y, P.gold); y += 9; };
    const pillAt = (b, xr, yy) => {
      if (!b.rank) return 0;
      const T = `${b.rank} / ${b.of}`, top = b.rank <= Math.max(1, Math.floor(b.of * 0.1)), w = textWidth(T, 6.5, true) + 12;
      d.roundRect(xr - w, yy - 9, w, 12, 6, { fill: top ? P.gold : "#3a3a3c" });
      d.text(T, xr - w / 2, yy - 0.5, { size: 6.5, bold: true, color: "#ffffff", align: "center" });
      return w;
    };
    for (const [title, list] of groups) {
      if (title === "Approach" && a.grid?.length) {
        // a grid: a row per stat, a column per distance band; each cell its value, rank and Tour Avg
        const rowH = 30, nameW = 84, cellW = (W - nameW) / a.bands.length;
        need(28 + 18 + a.grid.length * rowH);
        head("Approach by distance");
        d.roundRect(M, y, W, 18 + a.grid.length * rowH + 4, 10, { fill: P.mist });
        a.bands.forEach((lab, c) => cap(lab, M + nameW + cellW * (c + 0.5), y + 13, P.soft, "center", 6.3));
        // thin vertical lines between the names and each distance band
        for (let c = 0; c < a.bands.length; c++) { const lx = M + nameW + cellW * c - 3; d.line(lx, y + 5, lx, y + 18 + a.grid.length * rowH - 4, { color: "#d9d9de", width: 0.6 }); }
        a.grid.forEach((g, r) => {
          const ry = y + 18 + r * rowH;
          if (r) d.line(M + 10, ry, M + W - 10, ry, { color: P.hair, width: 0.5 });
          d.text(g.def.label, M + 12, ry + 13, { size: 8.5, bold: true, color: P.ink });
          if (g.def.higher === false) d.text("lower is better", M + 12, ry + 23, { size: 6.3, color: P.faint });
          if (g.missing) { d.text(`No ${g.def.label} in this data file.`, M + nameW + 6, ry + 14, { size: 7.5, color: P.faint }); return; }
          if (g.overall) {
            const b = g.overall, good = better(b, b.value, b.fieldAvg);
            const t1 = fmtStat(b.def, b.value);
            d.text(t1, M + nameW + 6, ry + 14, { size: 10.5, bold: true, color: good == null ? P.ink : good ? P.up : P.down });
            d.text(`all distances (the data has no distances for this stat)${b.fieldAvg != null ? `  \u00b7  Avg ${fmtStat(b.def, b.fieldAvg)}` : ""}`, M + nameW + 12 + textWidth(t1, 10.5, true), ry + 14, { size: 7, color: P.grey });
            pillAt(b, M + W - 10, ry + 13);
            return;
          }
          g.cells.forEach((b, c) => {
            const cx = M + nameW + cellW * c;
            if (!b) { d.text("\u2014", cx + cellW / 2, ry + 17, { size: 9, color: P.faint, align: "center" }); return; }
            const good = better(b, b.value, b.fieldAvg);
            d.text(fmtStat(b.def, b.value), cx + 6, ry + 14, { size: 10.5, bold: true, color: good == null ? P.ink : good ? P.up : P.down });
            const pw = pillAt(b, cx + cellW - 9, ry + 13);
            d.text(b.fieldAvg != null ? `Avg ${fmtStat(b.def, b.fieldAvg)}` : "", cx + 6, ry + 24, { size: 6.2, color: P.grey });
            void pw;
          });
        });
        y += 18 + a.grid.length * rowH + 8;
        if (!list.length) continue;
      }
      // Short game: the Up & Down grid fills the first three spots of the first row; cards follow
      const ud = title === "Short game" && a.udGrid ? a.udGrid : null, skip = ud ? cols - 1 : 0;
      const rows = Math.ceil((list.length + skip) / cols);
      need(24 + rows * (ch + gap) + (ud ? 12 : 0));
      if (title === "Approach" && a.grid?.length) y += 2; // (other approach stats: cards right under the grid)
      else head(title);
      if (ud) {
        // a row per distance, a column per lie; each cell its value, rank and Tour Avg
        const gw = skip * cw + (skip - 1) * gap, gh = ch + 12, nameW = 78, cellW = (gw - nameW) / ud.lies.length, rowH = (gh - 18) / ud.bands.length;
        d.roundRect(M, y, gw, gh, 9, { fill: P.mist });
        cap("Up & Down %", M + 10, y + 13, P.soft, "left", 6.2);
        ud.lies.forEach((lie, c) => cap(lie, M + nameW + cellW * (c + 0.5), y + 13, P.soft, "center", 6.2));
        for (let c = 0; c < ud.lies.length; c++) { const lx = M + nameW + cellW * c - 3; d.line(lx, y + 5, lx, y + gh - 5, { color: "#d9d9de", width: 0.6 }); }
        ud.bands.forEach((band, r) => {
          const ry = y + 18 + r * rowH;
          if (r) d.line(M + 10, ry, M + gw - 10, ry, { color: P.hair, width: 0.5 });
          d.text(band, M + 10, ry + rowH / 2 + 3, { size: 8.5, bold: true, color: P.ink });
          ud.cells[r].forEach((b, c) => {
            const cx = M + nameW + cellW * c;
            if (!b) { d.text("\u2014", cx + cellW / 2, ry + rowH / 2 + 3, { size: 9, color: P.faint, align: "center" }); return; }
            const good = better(b, b.value, b.fieldAvg);
            d.text(fmtStat(b.def, b.value), cx + 6, ry + 13, { size: 10.5, bold: true, color: good == null ? P.ink : good ? P.up : P.down });
            pillAt(b, cx + cellW - 9, ry + 12);
            d.text(b.fieldAvg != null ? `Avg ${fmtStat(b.def, b.fieldAvg)}` : "", cx + 6, ry + 23, { size: 6.2, color: P.grey });
          });
        });
      }
      list.forEach((b, i0) => {
        const i = i0 + skip;
        const x = M + (i % cols) * (cw + gap), ty = y + Math.floor(i / cols) * (ch + gap) + (ud && i >= cols ? 12 : 0);
        d.roundRect(x, ty, cw, ch, 9, { fill: P.mist });
        // the name, and the rank (gold in the top 10%)
        const pill = pillAt(b, x + cw - 8, ty + 16);
        let lab = b.def.label.toUpperCase();
        const fits = (t, z) => textWidth(t, z, true) + 1 * t.length <= cw - 22 - pill;
        if (!fits(lab, 5.4)) lab = lab.replace("DOUBLE ", "DBL ").replace(" / ROUND", "/RD").replace("UP & DOWN %", "U&D %"); // (long names, shortened)
        let ls = 6.2; while (ls > 4.8 && !fits(lab, ls)) ls -= 0.2;
        d.text(lab, x + 10, ty + 16, { size: ls, bold: true, color: P.soft, spacing: 1 });
        // the value
        const good = better(b, b.value, b.fieldAvg);
        d.text(fmtStat(b.def, b.value), x + 10, ty + 36, { size: 15, bold: true, color: good == null ? P.ink : good ? P.up : P.down });
        // the bar: lowest to highest, Tour Avg, this player
        const bx = x + 10, bw = cw - 20, by = ty + 42, span = b.hi - b.lo;
        const X = (v) => bx + (span > 1e-9 ? ((v - b.lo) / span) * bw : bw / 2);
        d.roundRect(bx, by, bw, 4.5, 2.25, { fill: P.track });
        if (b.fieldAvg != null) { const fx = X(b.fieldAvg); d.line(fx, by - 3, fx, by + 7.5, { color: P.gold, width: 1.5 }); }
        d.dot(X(b.value), by + 2.25, 3.4, "#ffffff");
        d.dot(X(b.value), by + 2.25, 2.6, good == null ? P.ink : good ? P.up : P.down);
        // Tour Avg, then lately (or, for a stat with categories, each category)
        const l1 = b.fieldAvg != null ? `Avg ${fmtStat(b.def, b.fieldAvg)}${b.def.higher === false ? " \u00b7 lower is better" : ""}` : `${b.rounds} ${b.events ? "events" : "rounds"}`;
        let l2 = "";
        if (b.trend) {
          const ch2 = b.trend.last - b.trend.prev, steady = Math.abs(ch2) < band(b), g = better(b, b.trend.last, b.trend.prev);
          l2 = steady ? `Last ${b.trend.n}: steady` : `Last ${b.trend.n}: ${g == null ? (ch2 > 0 ? "up" : "down") : g ? "better" : "worse"} ${amount(b, ch2)}`;
        }
        if (b.byCat.length) l2 = b.byCat.map((c) => `${{ OTT: "Tee", APP: "App", ARG: "ATG", PUTT: "Putt" }[c.cat] || c.name} ${fmtStat(b.def, c.value)}`).join(" \u00b7 ");
        d.text(wrap(l1, cw - 20, 6.4)[0], x + 10, ty + 56, { size: 6.4, color: P.grey });
        if (l2) {
          const col = /better/.test(l2) ? P.up : /worse/.test(l2) ? P.down : P.grey;
          d.text(wrap(l2, cw - 20, 6.4)[0], x + 10, ty + 65, { size: 6.4, bold: col !== P.grey, color: col });
        }
      });
      y += rows * (ch + gap) - gap + 4 + (ud ? 12 : 0);
    }
    d.para(`Approach by distance: each band holds the data's distance buckets whose middle falls in it. Up & Down: inside 50 yds, by distance and lie. Good Lag: putts over 25 ft. Last 10: the last 10 ${a.basics.some((b) => b.events) ? "rounds or events" : "rounds"} against the 10 before.`, M, Math.max(y + 12, H - 66), W, { size: 6.5, color: P.faint });
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
export async function loadSource(source, playerKey, label) {
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
  return { me, field: field.length ? field.map((p) => (p.key === playerKey ? { ...me } : p)) : [me], idx, datasetId: shot.id };
}

/** The admin: every player's full shots in that file (so ranks can go down to each distance). */
export async function loadFullField(datasetId, field, me, idx) {
  const st = getState();
  if (!st.isAdmin || !datasetId) return null;
  const { loadDatasetPlayers } = await import("./fieldCache.js");
  const { players } = await loadDatasetPlayers(datasetId).catch(() => ({ players: new Map() }));
  const full = field.map((p) => {
    if (p.key === me.key) return me;
    const got = players.get(p.key);
    return got ? { key: p.key, label: p.label || p.key, rounds: prepare(got.rows, idx) } : null; // that player's file isn't there
  }).filter(Boolean);
  return full.length > 1 ? full : null;
}

/* ============================== the panel ============================== */
/** "Auto-generate report" for one player. canSave: the admin can also put it in the player's reports. */
export function reportBuilder({ playerKey, playerLabel, canSave = false, flash = () => {}, source: startSource = "tour", minRounds = null, tour = null }) {
  const wrapEl = el("div", { class: "report-gen" });
  const openBtn = el("button", { type: "button", class: "btn ghost report-gen-open" }, "\u2728 Generate AI Insights");
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
  const source = el("select", { "aria-label": "Data" }, [el("option", { value: "tour", selected: startSource === "tour" }, "Tour Events"), el("option", { value: "entered", selected: startSource === "entered" }, "Entered Rounds")]);
  const product = el("input", { type: "checkbox", "aria-label": "Differentiate by product" });
  // Min. rounds for Tour Avg and ranks: the Stats page's number when it opened this; empty = the default
  const minIn = el("input", { type: "number", min: 1, max: 999, inputmode: "numeric", class: "report-min-in", placeholder: "Auto", value: minRounds ?? "", "aria-label": "Minimum rounds for Tour Avg and ranks" });
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
      const a = analyzePerformance(data.me, data.field, { from, to, cats, byProduct: product.checked, idx: data.idx, minRounds: minIn.value ? Number(minIn.value) : null, tour: source.value === startSource ? tour : null });
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
      const rangeLabel = preset ? presets.find(([v]) => v === preset)?.[1] : null; // a preset's name; your own dates are shown as dates
      const bytes = buildReportPdf(a, { aiSummary, sourceLabel: source.value === "tour" ? "Tour Events" : "Entered Rounds", logo: await loadLogo(), rangeLabel });
      const name = `${playerLabel.replace(/[^\w -]/g, "")} performance report ${new Date().toISOString().slice(0, 10)}.pdf`;
      window.__lastReportPdf = bytes; // (for tests)
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
      mount(result, [
        el("p", {}, [el("strong", {}, `Report ready: ${a.overall.rounds} rounds, ${a.focus.length} focus area${a.focus.length === 1 ? "" : "s"}.`)]),
        // Open PDF (in a new tab; save it from there) and, for the admin, Save to Reports, side by side
        el("div", { class: "report-gen-actions report-gen-done" }, [el("a", { class: "btn", href, target: "_blank", rel: "noopener", title: name }, "Open PDF"), save]),
      ]);
      status.textContent = "";
    } catch (err) {
      console.error(err);
      status.textContent = "Couldn't make the report. Try again.";
    } finally { go.disabled = false; }
  });

  mount(panel, [
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Dates"), presetBox, el("div", { class: "report-dates" }, [el("label", { class: "date-field" }, ["Start Date", fromIn]), el("label", { class: "date-field" }, ["End Date", toIn])])]),
    el("div", { class: "report-field" }, [el("span", { class: "field-label" }, "Categories"), catBox]),
    el("div", { class: "report-row" }, [el("label", {}, ["Data", source]), el("label", { class: "report-min", title: "Tour Avg, ranks and Elite only count players with at least this many rounds in the dates picked. Empty: a quarter of the most rounds played, rounded down to a 10." }, ["Min. rounds", minIn]), el("label", { class: "report-check" }, [product, "Differentiate by product (club models)"])]),
    el("div", { class: "report-gen-actions" }, [go]), status, result,
  ]);
  mount(wrapEl, [openBtn, panel]);
  return wrapEl;
}
