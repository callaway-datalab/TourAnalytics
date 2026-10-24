// The Watchlist / Home page's numbers (update 164): for one player, against the field on their tour, for a period —
//   · strokes gained a round (Total, OTT, APP, ARG, PUTT) with ranks and the trend (last 10 rounds vs the 10 before)
//   · their 3 best and 3 worst distances (strokes gained a shot, ranked when the field's lie / distance detail is here)
//   · any other metrics picked, with ranks and trends
//   · badges and alerts: big moves, hot streaks and slumps, form landmarks, best rounds, wins and milestones
import { distLead, CATEGORIES, applyFilters, statRounds, statAgg, statDef, statsIn, fmtStat, fmtSG, defaultMinRounds, gearList, gearLabel, gearInfo } from "./sg.js";

export const SG_KEYS = [["TOTAL", "SG: Total", "Total"], ["OTT", "Off-the-Tee", "OTT"], ["APP", "Approach", "APP"], ["ARG", "Around-the-Green", "ARG"], ["PUTT", "Putting", "PUTT"]];
const CAT_SHORT = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
const sum = (a) => a.reduce((t, x) => t + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
const sgOf = (rd, cat = null) => rd.shots.reduce((t, s) => t + (!cat || cat === "TOTAL" || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg : 0), 0);
// (update 328) worked out once per list of rounds: all five at once (one pass over the shots), then reused
const prMemo = new WeakMap();
export const perRound = (rs, cat = null) => {
  if (!rs.length) return null;
  let m = prMemo.get(rs);
  if (!m) {
    const t = { TOTAL: 0, OTT: 0, APP: 0, ARG: 0, PUTT: 0, T2G: 0 };
    for (const rd of rs) { // (each round summed first, then the rounds: the same sums as before)
      const r = { TOTAL: 0, OTT: 0, APP: 0, ARG: 0, PUTT: 0, T2G: 0 };
      for (const x of rd.shots) { r.TOTAL += x.sg; if (x.cat === "OTT" || x.cat === "APP" || x.cat === "ARG" || x.cat === "PUTT") r[x.cat] += x.sg; if (x.cat !== "PUTT") r.T2G += x.sg; }
      for (const k in t) t[k] += r[k];
    }
    m = new Map(Object.entries(t).map(([k, v]) => [k, v / rs.length])); prMemo.set(rs, m);
  }
  const k = !cat ? "TOTAL" : cat;
  if (m.has(k)) return m.get(k);
  const v = sum(rs.map((rd) => sgOf(rd, cat))) / rs.length; m.set(k, v); return v;
};
// (update 328) a player's rounds for a period and tour, kept per field and filter (every card on the Watchlist asks
// for the same field, so it's sliced once, not once a card)
const sliceMemo = new WeakMap();
function sliced(field, p, f) {
  let byF = sliceMemo.get(field); if (!byF) { byF = new Map(); sliceMemo.set(field, byF); }
  const fk = JSON.stringify(f); let m = byF.get(fk); if (!m) { m = new Map(); byF.set(fk, m); }
  if (!m.has(p.key)) m.set(p.key, applyFilters(statRounds(p.rounds, "sg"), f));
  return m.get(p.key);
}
const bucketMemo = new WeakMap();

/** The period's filter: this season (the latest year in the data), the last 6 months, or everything. */
export function periodFilter(period, rounds) {
  if (period === "l3") return { months: 3 }; // (update 172)
  if (period === "l6" || period === "l12") return { months: 6 }; // (update 167: Last 6 months; an old "l12" pick lands here)
  if (period === "all") return {};
  const years = [...new Set(rounds.map((r) => r.year).filter(Boolean))].sort();
  return years.length ? { year: [years.at(-1)] } : {};
}
export const PERIODS = [["season", "Season"], ["l3", "Last 3 months"], ["l6", "Last 6 months"], ["all", "All"]];

/** (update 172) The stats that can be split by distance on the Watchlist. */
export const RANGE_STATS = ["hitGreen", "pinHigh", "onLine", "prox", "ud", "make", "fwy", "gir", "drive", "goodLag"]; // (update 214: + Good Lag %) // (update 187: + Hit Fairway %, GIR %, Driving Distance)
const ONE_CAT = { ud: "ARG", make: "PUTT", fwy: "OTT", drive: "OTT", goodLag: "PUTT" }; // (their distances need no category in the label)
/** A stat metric id: "stat:<key>" (all distances) or "stat:<key>@<cat>|<distance>". */
export const parseStatId = (id) => { const body = id.slice(5), at = body.indexOf("@"); if (at < 0) return { k: body, cat: null, dist: null }; const [cat, ...d] = body.slice(at + 1).split("|"); return { k: body.slice(0, at), cat, dist: d.join("|") }; };
const rangeLabel = (k, cat, dist) => `${ONE_CAT[k] === cat ? "" : `${CAT_SHORT[cat] || cat} `}${dist}`;

/** The tour a player plays most (their numbers are ranked against that tour). */
const mainTour = (rounds) => { const m = new Map(); for (const r of rounds) m.set(r.tour || "", (m.get(r.tour || "") || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

/** Rank of key among values (Map key → number); higher is better unless told otherwise. */
function rankOf(values, key, higher = true) {
  const list = [...values].filter(([, v]) => v != null && Number.isFinite(v)).sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1]));
  const i = list.findIndex(([k]) => k === key);
  if (i < 0) return { rank: null, of: list.length };
  const v = list[i][1];
  const tie = list.findIndex(([, x]) => Math.abs(x - v) < 1e-9); // (ties share the better rank)
  const sumAll = list.reduce((t, [, x]) => t + x, 0);
  // (update 226) avgO: everyone else's average (for "Relative to Tour Avg")
  return { rank: tie + 1, of: list.length, avg: mean(list.map(([, x]) => x)), avgO: list.length > 1 ? (sumAll - v) / (list.length - 1) : null };
}

/** Last n rounds against the n before (n up to 10, at least 3). */
function trendOf(ordered, value) {
  const n = Math.min(10, Math.floor(ordered.length / 2));
  if (n < 3) return null;
  const last = value(ordered.slice(-n)), prev = value(ordered.slice(-2 * n, -n));
  return last == null || prev == null ? null : { n, last, prev, ch: last - prev };
}

/** Each tournament: the players who played its most rounds, best strokes gained a round first. */
function eventsOf(players) {
  const ev = new Map();
  for (const p of players) for (const rd of p.rounds) {
    if (!rd.event) continue;
    const k = `${rd.event}|${rd.year}`;
    const e = ev.get(k) || ev.set(k, { event: rd.event, year: rd.year, end: rd.date, by: new Map() }).get(k);
    if (String(rd.date) > String(e.end)) e.end = rd.date;
    (e.by.get(p.key) || e.by.set(p.key, []).get(p.key)).push(rd);
  }
  return [...ev.values()].map((e) => {
    const most = Math.max(...[...e.by.values()].map((rs) => rs.length));
    const ranked = [...e.by].filter(([, rs]) => rs.length >= most).map(([key, rs]) => ({ key, v: perRound(rs) })).sort((a, b) => b.v - a.v);
    return { ...e, ranked };
  }).sort((a, b) => String(a.end).localeCompare(String(b.end)));
}

/** The metrics that can be added (beyond the five strokes gained), from what the data has. */
const rangeCache = new WeakMap();
function statRanges(players) {
  // the categories and distances each stat has values for: Map key → Map "cat|dist" → { cat, dist }
  if (rangeCache.has(players)) return rangeCache.get(players);
  const out = new Map();
  for (const p of players) for (const rd of p.rounds) for (const o of rd.obs || []) {
    if (!o.dist || !o.cat || !RANGE_STATS.includes(o.k)) continue;
    const m = out.get(o.k) || out.set(o.k, new Map()).get(o.k);
    const b = `${o.cat}|${o.dist}`; if (!m.has(b)) m.set(b, { cat: o.cat, dist: o.dist });
  }
  rangeCache.set(players, out);
  return out;
}
export function metricCatalog(field, own = [], detail = null, { noRanks = false } = {}) {
  const all = [...field.flatMap((p) => p.rounds), ...own.flatMap((p) => p.rounds)];
  const stats = statsIn([all]).filter((k) => k !== "sg");
  const dists = new Map();
  for (const p of own) for (const rd of p.rounds) for (const s of rd.shots) if (s.dist) dists.set(`${s.cat}|${s.dist}`, { cat: s.cat, dist: s.dist });
  const catOrder = (c) => CATEGORIES.findIndex(([k]) => k === c);
  // (update 172) the distances each of Hit Green %, Pin-High %, On-Line %, Proximity, Up & Down % and Made Putt % can be split by
  const ranges = new Map();
  for (const src of [own, detail || []]) for (const [k, m] of statRanges(src)) { const t = ranges.get(k) || ranges.set(k, new Map()).get(k); for (const [b, x] of m) t.set(b, x); }
  const rangeItems = (k) => [...(ranges.get(k)?.values() || [])].sort((a, b) => catOrder(a.cat) - catOrder(b.cat) || (distLead(a.dist) - distLead(b.dist) || String(a.dist).localeCompare(String(b.dist), undefined, { numeric: true })))
    .map((x) => ({ id: `stat:${k}@${x.cat}|${x.dist}`, cat: x.cat, catLabel: CAT_SHORT[x.cat] || x.cat, label: x.dist }));
  // (update 213) by part of the game: Scoring, then each category with its stats, strokes gained (by distance) and steadiness
  const has = new Set(stats);
  const sgRanges = (cat) => [...dists.values()].filter((d) => d.cat === cat).sort((a, b) => distLead(a.dist) - distLead(b.dist) || String(a.dist).localeCompare(String(b.dist), undefined, { numeric: true }))
    .map((d) => ({ id: `dist:${d.cat}|${d.dist}`, cat: d.cat, catLabel: CAT_SHORT[d.cat] || d.cat, label: d.dist }));
  const statItem = (k, cat) => {
    if (!has.has(k)) return null;
    const one = ONE_CAT[k] === cat || k === "gir"; // (a stat that only belongs to this category: the whole stat)
    const id = one ? `stat:${k}` : `stat:${k}@${cat}`;
    const rg = RANGE_STATS.includes(k) ? rangeItems(k).filter((x) => k === "gir" || x.cat === cat) : []; // (GIR: every distance it has)
    return [id, k === "gir" ? "GIR % (Par 4/5)" : statDef(k).label, rg.length ? rg : null];
  };
  const hasShots = all.some((rd) => rd.shots?.length);
  const catGroup = (cat, name, ks) => {
    const items = [...ks.map((k) => statItem(k, cat)), hasShots ? [`sgcat:${cat}`, "Strokes Gained", sgRanges(cat).length ? sgRanges(cat) : null] : null, hasShots ? [`sg:sd@${cat}`, "Steadiness", sgRanges(cat).length ? sgRanges(cat).map((x) => ({ ...x, id: `sg:sd@${cat}|${x.label}` })) : null] : null].filter(Boolean);
    return items.length ? { group: name, items } : null;
  };
  const scoring = [
    ...(noRanks ? [] : [["res:wins", "Wins"], ["res:top10", "Top 10s"]]),
    ...["scoring", "par3", "par4", "par5", "eagles", "birdiesRd", "parsRd", "bogeysRd", "dblBogeysRd"].filter((k) => has.has(k)).map((k) => [`stat:${k}`, statDef(k).label.replace(" / Round", "")]),
    ["sg:sd", "Steadiness"],
  ];
  // (update 211/213) a club breakdown: every model of one kind of club side by side
  const gl = gearList(own.flatMap((p) => p.rounds));
  const clubKinds = CLUB_KINDS.filter(([k, , , menu]) => menu && gl.some((g) => g.kind === k));
  return [
    { group: "Scoring", items: scoring },
    catGroup("OTT", "Off-the-Tee", ["gir", "fwy", "drive"]),
    catGroup("APP", "Approach", ["hitGreen", "pinHigh", "onLine", "prox"]),
    catGroup("ARG", "Around the Green", ["prox", "ud"]),
    catGroup("PUTT", "Putting", ["make", "goodLag"]),
    clubKinds.length ? { group: "Club breakdown", items: clubKinds.map(([k, , , menu]) => [`club:${k}`, menu]) } : null,
  ].filter(Boolean);
}
// (update 211) a kind of club, its name, and the part of the game its strokes gained is shown for
// (update 213) the 4th: its name in the Watchlist's menu (none: not offered there)
export const CLUB_KINDS = [["Driver", "Drivers", "OTT", "Drivers"], ["Non-Driver", "Non-driver tee shots", "OTT", "Non-Drivers"], ["Fairway Wood", "Fairway woods", null], ["Hybrid", "Hybrids", null], ["Iron", "Irons", "APP", "Irons"], ["Wedge", "Wedges", "ARG", "Wedges"], ["Putter", "Putters", "PUTT", "Putters"], ["Ball", "Golf balls", null, "Golf Balls"]];
export const metricLabel = (id) => {
  if (id.startsWith("club:")) { const [k, b] = id.slice(5).split("@"); const kd = CLUB_KINDS.find(([x]) => x === k); return `${kd?.[1] || k}${b ? `: ${b}` : ""}`; }
  if (id.startsWith("stat:")) { const { k, cat, dist } = parseStatId(id); const sl = k === "gir" ? "GIR % (Par 4/5)" : statDef(k).label; return cat && dist ? `${sl} · ${rangeLabel(k, cat, dist)}` : cat ? `${sl} · ${CAT_SHORT[cat] || cat}` : sl; }
  if (id.startsWith("sgcat:")) return `SG: ${(SG_KEYS.find(([k]) => k === id.slice(6)) || [])[1] || id.slice(6)}`;
  if (id.startsWith("sg:sd@")) { const [c, ...d] = id.slice(6).split("|"); return `Steadiness · ${CAT_SHORT[c] || c}${d.length ? ` ${d.join("|")}` : ""}`; }
  if (id.startsWith("dist:")) { const [c, ...d] = id.slice(5).split("|"); return `${CAT_SHORT[c] || c} · ${d.join("|")}`; }
  if (id.startsWith("gear:")) return gearLabel(id.slice(5));
  return { "sg:T2G": "SG: Tee to Green", "sg:sd": "Steadiness", "sg:best": "Best round", "res:wins": "Wins", "res:top10": "Top 10s", "res:rounds": "Rounds played" }[id] || id;
};

/**
 * One player's card. field: everyone's rounds (the shared summary, or full detail); detail: the field with lie /
 * distance detail (for distance ranks), or null; own: this player's full rounds (lie / distance), or null.
 */
export function playerCard(key, { field, detail = null, own = null, label = "", period = "season", metrics = [], tour: wantTour = null, nameOf = null, noRanks = false, lite = false }) {
  const me0 = field.find((p) => p.key === key);
  const srcAll = own?.length ? own : me0?.rounds || [];
  const mineAll = srcAll.filter((rd) => rd.shots.length);
  if (!mineAll.length) return { key, label, empty: true };
  const sgOnly = (rs) => statRounds(rs, "sg");
  // (update 171) the tours they played in this period, most rounds first; a player on more than one (PGA and Korn
  // Ferry, say) can be switched between them on the card. Ranked against the field on the tour shown.
  const pf = periodFilter(period, mineAll);
  const inPeriod = applyFilters(sgOnly(mineAll), pf);
  const tourN = new Map(); for (const r of inPeriod.length ? inPeriod : mineAll) tourN.set(r.tour || "", (tourN.get(r.tour || "") || 0) + 1);
  const tours = [...tourN].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tour: t, n }));
  // (update 172) shown first: the tour of most of their last 20 rounds (ties: the one played most recently)
  const last20 = [...sgOnly(mineAll)].sort(byDate).slice(-20), recentN = new Map();
  last20.forEach((r, i) => { const t = r.tour || "", o = recentN.get(t) || { n: 0, at: -1 }; recentN.set(t, { n: o.n + 1, at: i }); });
  const recentTour = [...recentN].filter(([t]) => tourN.has(t)).sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at)[0]?.[0];
  const tour = wantTour != null && tourN.has(wantTour) ? wantTour : recentTour ?? tours[0]?.tour ?? mainTour(mineAll);
  if (/^practice$/i.test(tour || "")) noRanks = true; // (update 226: Practice: no wins, top 10s or ranks; stat values, streaks and trends only)
  const f = { ...pf, tour: tour ? [tour] : [] };
  const mine = applyFilters(sgOnly(mineAll), f).sort(byDate);
  // the field on the same tour and period (this player with their full rounds)
  const fieldF = field.map((p) => ({ key: p.key, rounds: p.key === key ? mine : sliced(field, p, f) })).filter((p) => p.rounds.length);
  if (!fieldF.some((p) => p.key === key) && mine.length) fieldF.push({ key, rounds: mine });
  const most = Math.max(0, ...fieldF.map((p) => p.rounds.length));
  const minR = most >= 15 ? defaultMinRounds(most) : Math.max(1, Math.floor(most * 0.33));
  const ranked = fieldF.filter((p) => p.rounds.length >= minR || p.key === key);
  const card = { key, label, tour, tours: tours.filter((t) => t.tour), rounds: mine.length, minR, of: ranked.length, period, sg: [], dists: { best: [], worst: [] }, metrics: [], badges: [], alerts: [] };
  if (!mine.length) return { ...card, empty: true };

  // ---- the five strokes gained ----
  for (const [k, l, short] of SG_KEYS) {
    const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, k)]));
    const r = rankOf(vals, key);
    card.sg.push({ k, label: l, short, v: vals.get(key), rank: r.rank, of: r.of, avg: r.avg, avgO: r.avgO, trend: trendOf(mine, (rs) => perRound(rs, k)),
      // (update 182) its form; SG: Total's also says where the change came from
      info: () => formInfo(mine, (rs) => perRound(rs, k), { label: l, fmtFn: fmtSG, rows: k === "TOTAL" ? SG_KEYS.map(([kk, ll]) => ({ label: ll, val: (rs) => perRound(rs, kk) })) : null }) });
  }
  const total = card.sg[0];
  const sgVals = new Map(SG_KEYS.map(([k]) => [k, new Map(ranked.map((p) => [p.key, perRound(p.rounds, k)]))]));
  const nm = (k) => (k === key ? label : nameOf?.(k) || String(k).replace(/^c_/, ""));
  // (update 171: the SG Total rank trend chart is gone from the card)

  // (update 329) a folded card shows only the five ranks: the rest (distances, results, metrics, badges) is worked out
  // when it's opened
  if (lite) return { ...card, lite: true };

  // ---- distances: strokes gained a shot by category and distance (enough attempts to mean something) ----
  const MIN_ATT = 8;
  const bucketsOf = (rounds) => { if (bucketMemo.has(rounds)) return bucketMemo.get(rounds); const m = new Map(); bucketMemo.set(rounds, m); for (const rd of rounds) for (const s of rd.shots) if (s.dist) { const b = `${s.cat}|${s.dist}`; const o = m.get(b) || m.set(b, { sg: 0, w: 0 }).get(b); o.sg += s.sg; o.w += s.w; } return m; };
  const minePeriod = own?.length ? applyFilters(sgOnly(own), f) : mine;
  const myB = bucketsOf(minePeriod);
  const fieldB = detail?.length ? detail.map((p) => { const rs = p.key === key ? minePeriod : sliced(detail, p, f); return { key: p.key, n: rs.length, b: p.key === key ? myB : bucketsOf(rs) }; }) : null;
  // (update 173) strokes gained per round at each distance (all their rounds in the period count)
  const nMine = minePeriod.length;
  const dl = [...myB].filter(([, o]) => o.w >= MIN_ATT && nMine).map(([b, o]) => {
    const [cat, ...d] = b.split("|"), v = o.sg / nMine;
    let r = { rank: null, of: 0, avg: null };
    if (fieldB) r = rankOf(new Map(fieldB.map((p) => { const x = p.b.get(b); return [p.key, p.key === key ? v : x && x.w >= MIN_ATT && p.n ? x.sg / p.n : null]; })), key);
    return { id: b, cat, dist: d.join("|"), label: `${CAT_SHORT[cat] || cat} · ${d.join("|")}`, v, tot: o.sg, n: Math.round(o.w), rank: r.rank, of: r.of, avg: r.avg,
      avgO: r.avgO, info: () => distInfo(b, `${CAT_SHORT[cat] || cat} · ${d.join("|")}`) }; // (update 182)
  });
  // (update 182) a distance's form: strokes gained there each round (a round without a shot there counts as 0)
  const fmt3 = (y) => `${y >= 0 ? "+" : "\u2212"}${Math.abs(y).toFixed(3)}`;
  const distVal = (b) => (rs) => { if (!rs.length) return null; const x = bucketsOf(rs).get(b); return (x ? x.sg : 0) / rs.length; };
  const distInfo = (b, label) => formInfo([...minePeriod].sort(byDate), distVal(b), { label: `${label} (strokes gained a round)`, fmtFn: fmt3, chFn: (d) => Math.abs(d).toFixed(3) });
  // best and worst: by rank when the field's detail is here, else against the baseline
  const score = (x) => (!noRanks && x.rank && x.of > 1 ? 1 - (x.rank - 1) / (x.of - 1) : null); // (update 183: entered rounds: by value)
  void score;
  // (update 223) by total strokes gained there: every distance gaining (most first), every one losing (most first);
  // the card shows 3 of each and opens to the rest. Each with its trend (the last 10 rounds against the 10 before).
  const byDate0 = [...minePeriod].sort(byDate);
  for (const x of dl) x.trend = trendOf(byDate0, (rs) => { const y = bucketsOf(rs).get(x.id); return y && y.w >= 3 ? y.sg / rs.length : null; });
  card.dists.best = dl.filter((x) => x.tot > 0).sort((a, b) => b.tot - a.tot);
  card.dists.worst = dl.filter((x) => x.tot < 0).sort((a, b) => a.tot - b.tot);

  // ---- results: wins and top 10s (best strokes gained a round at a tournament, among those who played every round) ----
  const events = eventsOf(ranked.map((p) => ({ key: p.key, rounds: p.rounds })));
  const finishes = events.map((e) => ({ e, i: e.ranked.findIndex((x) => x.key === key) })).filter((x) => x.i >= 0);
  const wins = finishes.filter((x) => x.i === 0), top10 = finishes.filter((x) => x.i < 10);

  // ---- the metrics picked ----
  card.clubTables = [];
  for (const id of metrics) {
    // (update 211) a club breakdown: each model of that kind (or brand) side by side, strokes gained a round with it
    if (id.startsWith("club:")) {
      const [k, brand] = id.slice(5).split("@"), kd = CLUB_KINDS.find(([x]) => x === k), cat = kd?.[2] || null;
      const isIt = (v) => { const gi = gearInfo(v); return gi.kind === k && (!brand || gi.brand === brand); };
      const cols = new Map();
      for (const rd of minePeriod) {
        const seen = new Set();
        for (const s of rd.shots) {
          const v = k === "Ball" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear;
          if (!v || !isIt(v) || (cat && s.cat !== cat)) continue;
          const c = cols.get(v) || cols.set(v, { value: v, sg: 0, rounds: 0, shots: 0 }).get(v);
          c.sg += s.sg; c.shots += s.w || 1; if (!seen.has(v)) { seen.add(v); c.rounds++; }
        }
      }
      const list = [...cols.values()].map((c) => { const gi = gearInfo(c.value); return { label: `${gi.brand} ${gi.model}`.trim(), v: c.sg / Math.max(1, c.rounds), rounds: c.rounds, shots: c.shots }; }).sort((a, b) => b.rounds - a.rounds);
      card.clubTables.push({ id, title: metricLabel(id), what: cat ? `SG ${(CATEGORIES.find(([c]) => c === cat) || [])[1] || cat} a round` : "SG a round (all its shots)", cols: list });
      continue;
    }
    if (noRanks && (id === "res:wins" || id === "res:top10")) continue; // (update 183: entered rounds: no wins or top 10s)
    let v = null, r = { rank: null, of: 0 }, trend = null, fmt = (x) => (x == null ? "—" : fmtSG(x)), higher = true, info = null;
    if (id.startsWith("sgcat:")) { const ck = id.slice(6); const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, ck)])); v = vals.get(key); r = rankOf(vals, key); trend = trendOf(mine, (rs) => perRound(rs, ck));
      const lab = metricLabel(id); info = () => formInfo(mine, (rs) => perRound(rs, ck), { label: lab, fmtFn: fmtSG }); }
    else if (id === "sg:T2G") { const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, "T2G")])); v = vals.get(key); r = rankOf(vals, key); trend = trendOf(mine, (rs) => perRound(rs, "T2G"));
      info = () => formInfo(mine, (rs) => perRound(rs, "T2G"), { label: "SG: Tee to Green", fmtFn: fmtSG }); }
    else if (id === "sg:sd" || id.startsWith("sg:sd@")) {
      // (update 213: a category's steadiness too; update 214: and at one distance in it)
      const [ck0, ...dd] = id.startsWith("sg:sd@") ? id.slice(6).split("|") : [], ck = ck0 || undefined, cd = dd.length ? dd.join("|") : null;
      const rdVal = (rd) => (cd ? rd.shots.reduce((t, s) => t + (s.cat === ck && s.dist === cd ? s.sg : 0), 0) : sgOf(rd, ck));
      const swing = (rs) => sd(rs.map(rdVal));
      const pool = cd ? (detail?.length ? detail.map((p) => ({ key: p.key, rounds: p.key === key ? minePeriod : applyFilters(sgOnly(p.rounds), f) })) : [{ key, rounds: minePeriod }]) : ranked;
      const myRs = cd ? [...minePeriod].sort(byDate) : mine;
      const vals = new Map(pool.filter((p) => p.rounds.length >= 8 || p.key === key).map((p) => [p.key, swing(p.rounds)]));
      v = vals.get(key); r = cd && !detail?.length ? { rank: null, of: 0 } : rankOf(vals, key, false); higher = false; fmt = (x) => (x == null ? "—" : `±${x.toFixed(cd ? 3 : 2)}`);
      trend = trendOf(myRs, swing);
      // (a swing needs several rounds: the bars are each round's strokes gained, the table the swing either side)
      const perRd = (rs) => (rs.length ? rs.reduce((t, rd) => t + rdVal(rd), 0) / rs.length : null), sdLab = metricLabel(id).replace("Steadiness · ", "");
      info = () => { const fi = formInfo(myRs, perRd, { label: ck ? (cd ? `${sdLab} (strokes gained a round)` : metricLabel(`sgcat:${ck}`)) : "SG: Total", fmtFn: cd ? (y) => `${y >= 0 ? "+" : "\u2212"}${Math.abs(y).toFixed(3)}` : fmtSG }); const t = trendOf(myRs, swing);
        if (t) fi.blocks[1] = { kind: "table", title: "Steadiness (round-to-round swing; lower is steadier)", cols: [[""], [`Previous ${t.n}`, "num"], [`Last ${t.n}`, "num"], ["Change", "num"]],
          rows: [{ cells: ["Swing", { text: `\u00b1${t.prev.toFixed(2)}` }, { text: `\u00b1${t.last.toFixed(2)}` }, { text: `${t.ch > 0 ? "\u25B2 " : "\u25BC "}${Math.abs(t.ch).toFixed(2)}`, tone: t.ch < 0 ? "pos" : "neg" }] }] };
        fi.sub = "Strokes gained in each round (the last 10 highlighted), and how much they swing from round to round."; return fi; };
    } else if (id === "sg:best") { const vals = new Map(ranked.map((p) => [p.key, Math.max(...p.rounds.map((rd) => sgOf(rd)))])); v = vals.get(key); r = rankOf(vals, key);
      info = () => { const bestRd = mine.reduce((m, rd) => (sgOf(rd) > sgOf(m) ? rd : m), mine[0]);
        return { sub: `Every round this ${period === "season" ? "season" : "period"}, the best highlighted: ${fmtSG(sgOf(bestRd))} at ${bestRd.event || "a tournament"}, ${dateShort(bestRd.date)}.`,
          blocks: [{ kind: "bars", fmt: "sg", items: mine.map((rd) => ({ label: dateShort(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v: sgOf(rd), on: rd === bestRd })) },
            { kind: "table", cols: [["Category"], ["That round", "num"], ["Average Round", "num"]], rows: SG_KEYS.map(([kk, ll]) => ({ strong: kk === "TOTAL", cells: [ll, { sg: sgOf(bestRd, kk) }, { sg: perRound(mine, kk) }] })) }] }; }; }
    else if (id === "res:wins" || id === "res:top10") {
      const counts = new Map(ranked.map((p) => [p.key, 0]));
      for (const e of events) e.ranked.slice(0, id === "res:wins" ? 1 : 10).forEach((x) => counts.set(x.key, (counts.get(x.key) || 0) + 1));
      v = counts.get(key) || 0; r = v ? rankOf(new Map([...counts].filter(([, n]) => n > 0)), key) : { rank: null, of: 0 }; fmt = (x) => String(x ?? 0); // (no rank for none)
      const winsOnly = id === "res:wins";
      info = () => ({ sub: `Strokes gained a round at each tournament they finished (${winsOnly ? "wins" : "top 10s"} highlighted), among the players who played every round.`,
        blocks: [{ kind: "bars", fmt: "sg", items: finishes.map(({ e, i }) => ({ label: dateShort(e.end), sub: `${e.event} \u00b7 ${ordinal(i + 1)}`, v: e.ranked[i].v, on: winsOnly ? i === 0 : i < 10 })) },
          { kind: "table", cols: [["Date"], ["Tournament"], ["Finish", "num"], ["SG / round", "num"]], rows: [...(winsOnly ? wins : top10)].reverse().map(({ e, i }) => ({ cells: [dateShort(e.end), e.event, ordinal(i + 1), { sg: e.ranked[i].v }] })) }] });
    } else if (id === "res:rounds") { v = mine.length; r = rankOf(new Map(fieldF.map((p) => [p.key, p.rounds.length])), key); fmt = (x) => String(x ?? 0); }
    else if (id.startsWith("stat:") && parseStatId(id).cat) {
      // (update 172) a stat at one distance: ranked against the field's lie / distance detail (when it's here)
      const { k, cat, dist } = parseStatId(id), def = statDef(k); higher = def.higher !== false;
      const fr = { ...f, cats: [cat], ...(dist ? { dist: [`${cat}|${dist}`] } : {}) }; // (update 213: no distance = the whole category)
      const statAll = (rs) => applyFilters(statRounds(rs, k), fr).filter((rd) => rd.shots.length);
      const agg = (rs) => statAgg(rs, true);
      const myS = statAll(srcAll).sort(byDate);
      const vals = new Map((detail || []).filter((p) => p.key !== key).map((p) => { const a = agg(statAll(p.rounds)); return [p.key, a.w >= MIN_ATT ? a.value : null]; }));
      vals.set(key, agg(myS).value);
      v = vals.get(key); r = detail?.length ? rankOf(vals, key, higher) : { rank: null, of: 0 }; fmt = (x) => fmtStat(def, x);
      trend = trendOf(myS, (rs) => agg(rs).value);
      if (def.higher == null) higher = null;
      const hb = higher, lab = metricLabel(id);
      info = () => formInfo(myS, (rs) => agg(rs).value, { label: lab, fmtFn: (x) => fmtStat(def, x), chFn: statCh(def), higher: hb, signed: false });
    } else if (id.startsWith("stat:")) {
      const k = id.slice(5), def = statDef(k); higher = def.higher !== false;
      const val = (rs) => statAgg(statRounds(rs, k), false).value;
      const statAll = (rs) => applyFilters(statRounds(rs, k), f);
      const myS = statAll(srcAll).sort(byDate);
      const vals = new Map(field.map((p) => [p.key, p.key === key ? val(myS) : (() => { const rs = statAll(p.rounds); return rs.length >= Math.max(1, minR) ? val(rs) : null; })()]));
      v = vals.get(key); r = rankOf(vals, key, higher); fmt = (x) => fmtStat(def, x);
      trend = trendOf(myS, val);
      if (def.higher == null) higher = null;
      const hb = higher;
      info = () => formInfo(myS, val, { label: def.label, fmtFn: (x) => fmtStat(def, x), chFn: statCh(def), higher: hb, signed: false });
    } else if (id.startsWith("gear:")) {
      // (update 210) strokes gained a round with one club model or ball (a round without it counts as 0)
      const g = id.slice(5), withG = (s) => s.gear === g || (s.ball && `Ball|${s.ball}` === g);
      const gv = (rs) => (rs.length ? rs.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + (withG(s) ? s.sg : 0), 0), 0) / rs.length : null);
      const used = minePeriod.filter((rd) => rd.shots.some(withG)).length;
      v = used ? gv(minePeriod) : null;
      if (detail?.length && v != null) r = rankOf(new Map(detail.map((p) => { const rs = p.key === key ? minePeriod : applyFilters(sgOnly(p.rounds), f); return [p.key, p.key === key ? v : rs.some((rd) => rd.shots.some(withG)) ? gv(rs) : null]; })), key);
      fmt = (y) => (y == null ? "\u2014" : `${fmtSG(y)}${used && used < 10 ? ` (${used} rd${used === 1 ? "" : "s"})` : ""}`);
      trend = trendOf([...minePeriod].sort(byDate), gv);
      info = () => { const fi = formInfo([...minePeriod].sort(byDate), gv, { label: `${gearLabel(g)} (strokes gained a round)`, fmtFn: fmtSG }); if (!used) fi.sub = `Not used in this period. ${fi.sub}`; else if (used < 10) fi.sub = `Only ${used} round${used === 1 ? "" : "s"} with it this period, so read this with care. ${fi.sub}`; return fi; };
    } else if (id.startsWith("dist:")) {
      // (update 172) strokes gained per round at that distance (all their rounds in the period count)
      const b = id.slice(5), o = myB.get(b);
      v = o && nMine ? o.sg / nMine : null;
      if (fieldB && v != null) r = rankOf(new Map(fieldB.map((p) => { const x = p.b.get(b); return [p.key, p.key === key ? v : x && x.w >= MIN_ATT && p.n ? x.sg / p.n : null]; })), key);
      fmt = (y) => (y == null ? "—" : `${y >= 0 ? "+" : "−"}${Math.abs(y).toFixed(3)}`);
      trend = trendOf(minePeriod.sort(byDate), (rs) => { const x = bucketsOf(rs).get(b); return x && x.w >= 3 ? x.sg / rs.length : null; });
      info = () => distInfo(b, metricLabel(id));
    }
    card.metrics.push({ id, label: metricLabel(id), v, text: fmt(v), rank: r.rank, of: r.of, avgO: r.avgO ?? null, trend, higher, info, fmtCh: (ch) => (id.startsWith("stat:") ? (() => { const d = statDef(parseStatId(id).k); return fmtStat({ ...d, pct: false, unit: d.pct ? " pct" : d.unit }, Math.abs(ch)); })() : id.startsWith("dist:") || /^sg:sd@.*\|/.test(id) ? Math.abs(ch).toFixed(3) : Math.abs(ch).toFixed(2)) });
  }

  // ---- badges and alerts ----
  const badges = card.badges, alerts = card.alerts;
  // (update 183) entered rounds: no wins, top 10s or ranks, so none of their badges
  const add = (b, info = null) => { if (noRanks && (["win", "wins", "top10", "rank"].includes(b.kind) || /spots/.test(b.text))) return; if (info) b.info = info; badges.push(b); if (b.alert) alerts.push({ ...b, key, label }); };
  // (update 173) what each badge opens: a chart and / or a table (see badgePopup.js)
  const rdItem = (rd, on = false) => ({ label: dateShort(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" · "), v: sgOf(rd), on });
  const roundsTable = (rds) => ({ kind: "table", cols: [["Date"], ["Tournament"], ["SG", "num"]], rows: [...rds].reverse().map((rd) => ({ cells: [dateShort(rd.date), [rd.event || "\u2014", rd.roundNo ? ` R${rd.roundNo}` : ""].join(""), { sg: sgOf(rd) }] })) });
  const leaders = (vals, n = 10) => { const list = [...vals].filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]); const top = list.slice(0, n); const i = list.findIndex(([k]) => k === key);
    const rows = top.map(([k, v], j) => ({ me: k === key, cells: [ordinal(j + 1), nm(k), String(ranked.find((p) => p.key === k)?.rounds.length ?? ""), { sg: v }] }));
    if (i >= n) rows.push({ gap: true }, { me: true, cells: [ordinal(i + 1), nm(key), String(mine.length), { sg: list[i][1] }] });
    return rows; };
  const lastRound = mine.at(-1), last5 = mine.slice(-5), rs = mine.map((rd) => sgOf(rd));
  // streaks: straight rounds gaining (or losing) on the field, up to the latest
  let run = 0; const sign = Math.sign(rs.at(-1) || 0);
  for (let i = rs.length - 1; i >= 0 && Math.sign(rs[i]) === sign && sign !== 0; i--) run++;
  const avg5 = last5.length === 5 ? perRound(last5) : null;
  const streakInfo = (byRun) => () => {
    const n = byRun ? run : 5, show = mine.slice(-Math.min(mine.length, Math.max(20, n + 5)));
    return { sub: byRun ? `Strokes gained in each round. The ${n} in a row ${sign > 0 ? "gaining" : "losing"} on the field are highlighted.` : `Strokes gained in each round. The last 5 (highlighted) average ${fmtSG(avg5)} a round.`,
      blocks: [{ kind: "bars", fmt: "sg", items: show.map((rd, i) => rdItem(rd, i >= show.length - n)), ref: byRun ? [] : [{ v: avg5, label: "Last 5 avg" }] }, { ...roundsTable(mine.slice(-n)), title: byRun ? "The streak" : "The last 5" }] };
  };
  if ((sign > 0 && run >= 5) || (avg5 != null && avg5 >= 1.5)) add({ kind: "hot", icon: "🔥", tone: "up", text: run >= 5 && sign > 0 ? `Hot · ${run} rds gaining` : `Hot · ${fmtSG(avg5)}/rd, last 5`, alert: true, sev: 3 }, streakInfo(run >= 5 && sign > 0));
  if ((sign < 0 && run >= 5) || (avg5 != null && avg5 <= -1.5)) add({ kind: "cold", icon: "🧊", tone: "down", text: run >= 5 && sign < 0 ? `Slump · ${run} rds losing` : `Slump · ${fmtSG(avg5)}/rd, last 5`, alert: true, sev: 3 }, streakInfo(run >= 5 && sign < 0));
  // big moves: the last 10 against the 10 before
  if (total.trend && Math.abs(total.trend.ch) >= 0.75) add({ kind: total.trend.ch > 0 ? "up" : "down", icon: total.trend.ch > 0 ? "⬆" : "⬇", tone: total.trend.ch > 0 ? "up" : "down", text: `${total.trend.ch > 0 ? "Up" : "Down"} ${Math.abs(total.trend.ch).toFixed(2)}/rd · last ${total.trend.n}`, alert: true, sev: 2 }, () => {
    const n = total.trend.n, show = mine.slice(-2 * n);
    return { sub: `Strokes gained in each round: the last ${n} (highlighted) against the ${n} before, and where the change came from.`,
      blocks: [{ kind: "bars", fmt: "sg", items: show.map((rd, i) => rdItem(rd, i >= n)), ref: [{ v: total.trend.prev, label: `Previous ${n}`, from: 0, to: n }, { v: total.trend.last, label: `Last ${n}`, from: n, to: 2 * n }] },
        { kind: "table", title: "By category (a round)", cols: [["Category"], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]], rows: card.sg.map((x) => { const t = trendOf(mine, (rs) => perRound(rs, x.k)); return { strong: x.k === "TOTAL", cells: [x.label, { sg: t?.prev }, { sg: t?.last }, { sg: t?.ch, arrow: true }] }; }) }] };
  });
  // (update 168: no badge for a category moving up or down: its tile shows that)
  // form landmarks: the rolling 10-round average at its best (or worst) of the period
  const rolls = mine.length >= 20 ? mine.map((_, i) => (i >= 9 ? perRound(mine.slice(i - 9, i + 1)) : null)).filter((x) => x != null) : [];
  if (rolls.length >= 5) {
    const now = rolls.at(-1);
    const avgRoll = mean(rolls);
    const formInfo = (best) => () => ({ sub: `Their average over 10 rounds, after each round of the ${period === "season" ? "season" : "period"}. It's at its ${best ? "highest" : "lowest"} now.`,
      blocks: [{ kind: "line", fmt: "sg", items: mine.slice(9).map((rd, i) => ({ label: dateShort(rd.date), sub: rd.event, v: rolls[i], on: i === rolls.length - 1 })), ref: [{ v: avgRoll, label: "Average" }] }] });
    if (now >= Math.max(...rolls) - 1e-9 && now - avgRoll >= 0.3) add({ kind: "best", icon: "⛰", tone: "up", text: `${period === "season" ? "Season" : "Period"}-best form · ${fmtSG(now)}`, alert: true, sev: 2 }, formInfo(true));
    else if (now <= Math.min(...rolls) + 1e-9 && avgRoll - now >= 0.3) add({ kind: "low", icon: "⚠", tone: "down", text: `${period === "season" ? "Season" : "Period"}-low form · ${fmtSG(now)}`, alert: true, sev: 2 }, formInfo(false));
  }
  // best rounds: a career-best (everything in the data) or season-best round in their last 3
  const careerRs = sgOnly(mineAll).filter((rd) => !tour || rd.tour === tour || !rd.tour);
  const careerBest = Math.max(...careerRs.map((rd) => sgOf(rd)));
  const recent = mine.slice(-3);
  const top = recent.reduce((b, rd) => (sgOf(rd) > sgOf(b) ? rd : b), recent[0]);
  const bestInfo = (pool, what) => () => {
    const next = [...pool].sort((a, b) => sgOf(b) - sgOf(a)).slice(0, 6);
    return { sub: `${top.event || "A tournament"}${top.roundNo ? `, round ${top.roundNo}` : ""}, ${dateShort(top.date)}: the round by category, against the average round this ${period === "season" ? "season" : "period"}.`,
      blocks: [{ kind: "table", cols: [["Category"], ["That round", "num"], ["Average Round", "num"], ["Difference", "num"]], rows: SG_KEYS.map(([k, l]) => { const a = sgOf(top, k), m = perRound(mine, k); return { strong: k === "TOTAL", cells: [l, { sg: a }, { sg: m }, { sg: m == null ? null : a - m, arrow: true }] }; }) },
        { kind: "table", title: `Best Rounds (${what})`, cols: [["Date"], ["Tournament"], ["SG", "num"]], rows: next.map((rd) => ({ me: rd === top, cells: [dateShort(rd.date), [rd.event || "\u2014", rd.roundNo ? ` R${rd.roundNo}` : ""].join(""), { sg: sgOf(rd) }] })) }] };
  };
  if (top && careerRs.length >= 20 && sgOf(top) >= careerBest - 1e-9) add({ kind: "career", icon: "⭐", tone: "gold", text: `Career-best rd · ${fmtSG(sgOf(top))}`, alert: true, sev: 4 }, bestInfo(careerRs, "everything in the data"));
  else if (top && mine.length >= 10 && sgOf(top) >= Math.max(...rs) - 1e-9) add({ kind: "season", icon: "✨", tone: "gold", text: `${period === "season" ? "Season" : "Period"}-best rd · ${fmtSG(sgOf(top))}`, alert: true, sev: 2 }, bestInfo(mine, period === "season" ? "this season" : "this period"));
  // wins and milestones
  const lastEvent = events.at(-1);
  const evRounds = (e) => e.by.get(key)?.length ?? 0;
  const margin = (e) => (e.ranked.length > 1 ? e.ranked[0].v - e.ranked[1].v : null);
  if (wins.length && lastEvent && wins.at(-1).e === lastEvent) add({ kind: "win", icon: "🏆", tone: "gold", text: `Led ${lastEvent.event}`, alert: true, sev: 5 }, () => ({
    sub: `${lastEvent.event}, ${dateShort(lastEvent.end)}: strokes gained a round among the players who played ${evRounds(lastEvent) > 1 ? `all ${evRounds(lastEvent)} rounds` : "it"}.${margin(lastEvent) != null ? ` ${fmtSG(margin(lastEvent))} a round ahead of 2nd.` : ""}`,
    blocks: [{ kind: "table", cols: [["Pos"], ["Player"], ["SG / round", "num"]], rows: lastEvent.ranked.slice(0, 10).map((x, j) => ({ me: x.key === key, cells: [ordinal(j + 1), nm(x.key), { sg: x.v }] })) }] }));
  if (wins.length >= 2) add({ kind: "wins", icon: "🏆", tone: "gold", text: `${wins.length} wins` }, () => ({
    sub: "Strokes gained a round at each tournament they finished (wins highlighted): the best among the players who played every round.",
    blocks: [{ kind: "bars", fmt: "sg", items: finishes.map(({ e, i }) => ({ label: dateShort(e.end), sub: `${e.event} \u00b7 ${ordinal(i + 1)}`, v: e.ranked[i].v, on: i === 0 })) }, // (update 181: like the top 10s)
      { kind: "table", title: "The wins", cols: [["Date"], ["Tournament"], ["SG / round", "num"], ["Ahead of 2nd", "num"]], rows: [...wins].reverse().map(({ e }) => ({ cells: [dateShort(e.end), e.event, { sg: e.ranked[0].v }, { sg: margin(e) }] })) }] }));
  if (top10.length >= 5) add({ kind: "top10", icon: "🎯", tone: "gold", text: `${top10.length} top 10s` }, () => ({
    sub: "Finish: their place by strokes gained a round among the players who played every round.",
    blocks: [{ kind: "bars", fmt: "sg", items: finishes.map(({ e, i }) => ({ label: dateShort(e.end), sub: `${e.event} · ${ordinal(i + 1)}`, v: e.ranked[i].v, on: i < 10 })) },
      { kind: "table", title: "The top 10s", cols: [["Date"], ["Tournament"], ["Finish", "num"], ["SG / round", "num"]], rows: [...top10].reverse().map(({ e, i }) => ({ cells: [dateShort(e.end), e.event, ordinal(i + 1), { sg: e.ranked[i].v }] })) }] }));
  // (update 168: no badges for rounds played)
  // ranks: the top 10, number 1 in a category, and big climbs (against where they stood 10 rounds ago)
  const totalInfo = () => ({ sub: `SG: Total a round${tour ? ` on the ${tour}` : ""}, among players with ${minR} or more rounds in this period.`,
    blocks: [{ kind: "table", cols: [["Rank"], ["Player"], ["Rounds", "num"], ["SG / round", "num"]], rows: leaders(sgVals.get("TOTAL")) }] });
  if (total.rank === 1) add({ kind: "rank", icon: "🥇", tone: "gold", text: "No. 1 in SG: Total" }, totalInfo);
  else if (total.rank && total.rank <= 10) add({ kind: "rank", icon: "🔟", tone: "gold", text: `${ordinal(total.rank)} in SG: Total` }, totalInfo);
  const firstsS = card.sg.slice(1).filter((s) => s.rank === 1), firsts = firstsS.map((s) => (firstsS.length > 1 ? s.short : s.label));
  if (firsts.length) add({ kind: "rank", icon: "🥇", tone: "gold", text: `No. 1 in ${firsts.join(", ")}` }, () => ({
    sub: `Strokes gained a round${tour ? ` on the ${tour}` : ""}, among players with ${minR} or more rounds in this period: the top 10 in each category they lead.`,
    blocks: firstsS.map((x) => ({ kind: "table", title: x.label, cols: [["Rank"], ["Player"], ["Rounds", "num"], ["SG / round", "num"]], rows: leaders(sgVals.get(x.k)) })) })); // (update 175: the full top 10, like SG: Total)
  if (mine.length >= 20 && lastRound) {
    const cut = mine.at(-11)?.date;
    if (cut) {
      const before = new Map(ranked.map((p) => [p.key, perRound(p.rounds.filter((rd) => String(rd.date) <= String(cut)))]).filter(([, v]) => v != null));
      const was = rankOf(before, key).rank;
      if (was && total.rank && Math.abs(was - total.rank) >= 10) add({ kind: total.rank < was ? "up" : "down", icon: total.rank < was ? "⬆" : "⬇", tone: total.rank < was ? "up" : "down", text: `${total.rank < was ? "Up" : "Down"} ${Math.abs(was - total.rank)} spots, to ${ordinal(total.rank)}`, alert: true, sev: 3 }, () => {
        const trail = rankTrail(key, mine, ranked, minR, total.rank), dates = mine.map((rd) => rd.date);
        const pts = rankDates(mine).map((d, i) => ({ label: dateShort(d), v: trail[i], on: i === trail.length - 1 })).filter((x) => x.v != null);
        return { sub: `Their SG: Total rank after each round this ${period === "season" ? "season" : "period"}: ${ordinal(was)} 10 rounds ago, ${ordinal(total.rank)} now.`,
          blocks: [{ kind: "line", fmt: "rank", invert: true, items: pts }, { ...roundsTable(mine.slice(-10)), title: "The last 10 rounds" }] };
      });
    }
  }
  // (update 173) the latest tournament: strokes gained a round over its rounds
  const lastEv = lastRound ? mine.filter((rd) => rd.event === lastRound.event && String(rd.year) === String(lastRound.year)) : [];
  if (noRanks) { for (const x of [...card.sg, ...card.dists.best, ...card.dists.worst, ...card.metrics]) { x.rank = null; x.of = 0; } }
  card.latest = lastRound ? { date: lastRound.date, event: lastRound.event, sg: lastRound.event ? perRound(lastEv) : sgOf(lastRound), rounds: lastRound.event ? lastEv.length : 1 } : null;
  return card;
}
/**
 * (update 182) A measure's form pop-up: a bar a round (the last n coloured) with the two averages, and the
 * averages side by side. val(rounds) → the measure over those rounds; o: { label, fmtFn, chFn, higher, signed, rows, n0 }
 *   signed: strokes gained-like (bars from zero, coloured by sign); otherwise bars rise from just under the
 *   lowest, coloured by better / worse than the previous average.
 */
export function formInfo(ordered, val, { label, fmtFn, chFn = (d) => Math.abs(d).toFixed(2), higher = true, signed = true, rows = null, what = "round" }) {
  const fmt = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : fmtFn(v));
  const roundSub = (rd) => [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 ");
  const n = Math.min(10, Math.floor(ordered.length / 2));
  if (n < 2) return { sub: `${label} in each ${what}. Not enough ${what}s yet to compare the last 10 with the 10 before.`, blocks: [{ kind: "bars", fmtFn, zero: signed, items: ordered.map((rd) => ({ label: dateShort(rd.date), sub: roundSub(rd), v: val([rd]), on: true, tone: signed ? null : "gold" })) }] };
  const prevR = ordered.slice(-2 * n, -n), lastR = ordered.slice(-n), pv = val(prevR), lv = val(lastR);
  const better = (a, b) => (higher == null || a == null || b == null ? null : higher ? a > b : a < b);
  const toneOf = (v) => (signed ? null : better(v, pv) == null ? "gold" : better(v, pv) || Math.abs(v - pv) < 1e-9 ? "pos" : "neg");
  const cell = (v) => ({ text: fmt(v), tone: signed && v != null ? (Math.round(v * 1000) === 0 ? "zero" : v > 0 ? "pos" : "neg") : "" });
  const change = (a, b) => (a == null || b == null ? { text: "\u2014" } : { text: `${Math.abs(a - b) < 1e-9 ? "" : a > b ? "\u25B2 " : "\u25BC "}${chFn(a - b)}`, tone: better(a, b) == null || Math.abs(a - b) < 1e-9 ? "" : better(a, b) ? "pos" : "neg" });
  const tableRows = (rows || [{ label, val }]).map((r, i) => { const a = r.val(lastR), b = r.val(prevR); return { strong: i === 0 && (rows?.length || 0) > 1, cells: [r.label, cell(b), cell(a), change(a, b)] }; });
  return {
    sub: `${label} in each ${what}: the last ${n} (highlighted) against the ${n} before.`,
    blocks: [
      { kind: "bars", fmtFn, zero: signed, items: [...prevR, ...lastR].map((rd, i) => { const v = val([rd]); return { label: dateShort(rd.date), sub: roundSub(rd), v, on: i >= prevR.length, tone: toneOf(v) }; }),
        ref: [{ v: pv, label: `Previous ${n}`, from: 0, to: prevR.length }, { v: lv, label: `Last ${n}`, from: prevR.length, to: prevR.length + lastR.length }] },
      { kind: "table", title: rows?.length > 1 ? `By category (a ${what})` : null, cols: [[rows?.length > 1 ? "Category" : ""], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]], rows: tableRows },
    ],
  };
}
/** SG Total rank after each of the player's rounds (at most 40 points, spread evenly; always the latest). */
const rankDates = (mine) => { let d = [...new Set(mine.map((rd) => String(rd.date || "")))]; if (d.length > 40) { const step = (d.length - 1) / 39; d = Array.from({ length: 40 }, (_, i) => d[Math.round(i * step)]); } return d; };
function rankTrail(key, mine, ranked, minR, nowRank) {
  const dk = (d) => String(d || "");
  const sorted = ranked.map((p) => ({ key: p.key, rs: (p.key === key ? mine : [...p.rounds]).sort((a, b) => dk(a.date).localeCompare(dk(b.date))) }));
  const cum = sorted.map((p) => { let t = 0; return p.rs.map((rd) => (t += sgOf(rd))); });
  const mostNow = Math.max(1, ...sorted.map((p) => p.rs.length));
  const upTo = (rs, d) => { let lo = 0, hi = rs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dk(rs[m].date) <= d) lo = m + 1; else hi = m; } return lo; };
  const out = rankDates(mine).map((d) => {
    const counts = sorted.map((p) => upTo(p.rs, d));
    const need = Math.max(1, Math.round((minR * Math.max(1, ...counts)) / mostNow));
    const vals = [];
    sorted.forEach((p, i) => { const n = counts[i]; if (n && (n >= need || p.key === key)) vals.push({ key: p.key, v: cum[i][n - 1] / n }); });
    vals.sort((a, b) => b.v - a.v);
    const i = vals.findIndex((x) => x.key === key);
    return i >= 0 ? i + 1 : null;
  });
  if (out.length && nowRank) out[out.length - 1] = nowRank;
  return out;
}
const statCh = (def) => (d) => fmtStat({ ...def, pct: false, unit: def.pct ? " pct" : def.unit }, Math.abs(d));
const dateShort = (d) => { const s = String(d || ""), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); const t = m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(s); return isNaN(t) ? s : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); };
export const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
