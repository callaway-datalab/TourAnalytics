// The Watchlist / Home page's numbers (update 164): for one player, against the field on their tour, for a period —
//   · strokes gained a round (Total, OTT, APP, ARG, PUTT) with ranks and the trend (last 10 rounds vs the 10 before)
//   · their 3 best and 3 worst distances (strokes gained a shot, ranked when the field's lie / distance detail is here)
//   · any other metrics picked, with ranks and trends
//   · badges and alerts: big moves, hot streaks and slumps, form landmarks, best rounds, wins and milestones
import { CATEGORIES, applyFilters, statRounds, statAgg, statDef, statsIn, fmtStat, fmtSG, defaultMinRounds } from "./sg.js";

export const SG_KEYS = [["TOTAL", "SG: Total", "Total"], ["OTT", "Off-the-Tee", "OTT"], ["APP", "Approach", "APP"], ["ARG", "Around-the-Green", "ARG"], ["PUTT", "Putting", "PUTT"]];
const CAT_SHORT = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
const sum = (a) => a.reduce((t, x) => t + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
const sgOf = (rd, cat = null) => rd.shots.reduce((t, s) => t + (!cat || cat === "TOTAL" || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg : 0), 0);
export const perRound = (rs, cat = null) => (rs.length ? sum(rs.map((rd) => sgOf(rd, cat))) / rs.length : null);

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
export const RANGE_STATS = ["hitGreen", "pinHigh", "onLine", "prox", "ud", "make"];
const ONE_CAT = { ud: "ARG", make: "PUTT" }; // (their distances need no category in the label)
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
  return { rank: tie + 1, of: list.length, avg: mean(list.map(([, x]) => x)) };
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
export function metricCatalog(field, own = [], detail = null) {
  const all = [...field.flatMap((p) => p.rounds), ...own.flatMap((p) => p.rounds)];
  const stats = statsIn([all]).filter((k) => k !== "sg");
  const dists = new Map();
  for (const p of own) for (const rd of p.rounds) for (const s of rd.shots) if (s.dist) dists.set(`${s.cat}|${s.dist}`, { cat: s.cat, dist: s.dist });
  const catOrder = (c) => CATEGORIES.findIndex(([k]) => k === c);
  // (update 172) the distances each of Hit Green %, Pin-High %, On-Line %, Proximity, Up & Down % and Made Putt % can be split by
  const ranges = new Map();
  for (const src of [own, detail || []]) for (const [k, m] of statRanges(src)) { const t = ranges.get(k) || ranges.set(k, new Map()).get(k); for (const [b, x] of m) t.set(b, x); }
  const rangeItems = (k) => [...(ranges.get(k)?.values() || [])].sort((a, b) => catOrder(a.cat) - catOrder(b.cat) || String(a.dist).localeCompare(String(b.dist), undefined, { numeric: true }))
    .map((x) => ({ id: `stat:${k}@${x.cat}|${x.dist}`, cat: x.cat, catLabel: CAT_SHORT[x.cat] || x.cat, label: x.dist }));
  return [
    { group: "Strokes gained", items: [["sg:T2G", "SG: Tee to Green"], ["sg:sd", "Steadiness (round-to-round swing)"], ["sg:best", "Best round"]] },
    { group: "Results", items: [["res:wins", "Wins"], ["res:top10", "Top 10s"], ["res:rounds", "Rounds played"]] },
    stats.length ? { group: "Stats", items: stats.map((k) => [`stat:${k}`, statDef(k).label, RANGE_STATS.includes(k) ? rangeItems(k) : null]) } : null,
    dists.size ? { group: "Distances (strokes gained per round)", items: [...dists.values()].sort((a, b) => catOrder(a.cat) - catOrder(b.cat) || String(a.dist).localeCompare(String(b.dist), undefined, { numeric: true })).map((d) => [`dist:${d.cat}|${d.dist}`, `${CAT_SHORT[d.cat] || d.cat} · ${d.dist}`]) } : null,
  ].filter(Boolean);
}
export const metricLabel = (id) => {
  if (id.startsWith("stat:")) { const { k, cat, dist } = parseStatId(id); return cat ? `${statDef(k).label} · ${rangeLabel(k, cat, dist)}` : statDef(k).label; }
  if (id.startsWith("dist:")) { const [c, ...d] = id.slice(5).split("|"); return `${CAT_SHORT[c] || c} · ${d.join("|")}`; }
  return { "sg:T2G": "SG: Tee to Green", "sg:sd": "Steadiness", "sg:best": "Best round", "res:wins": "Wins", "res:top10": "Top 10s", "res:rounds": "Rounds played" }[id] || id;
};

/**
 * One player's card. field: everyone's rounds (the shared summary, or full detail); detail: the field with lie /
 * distance detail (for distance ranks), or null; own: this player's full rounds (lie / distance), or null.
 */
export function playerCard(key, { field, detail = null, own = null, label = "", period = "season", metrics = [], tour: wantTour = null, nameOf = null }) {
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
  const f = { ...pf, tour: tour ? [tour] : [] };
  const mine = applyFilters(sgOnly(mineAll), f).sort(byDate);
  // the field on the same tour and period (this player with their full rounds)
  const fieldF = field.map((p) => ({ key: p.key, rounds: p.key === key ? mine : applyFilters(sgOnly(p.rounds), f) })).filter((p) => p.rounds.length);
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
    card.sg.push({ k, label: l, short, v: vals.get(key), rank: r.rank, of: r.of, avg: r.avg, trend: trendOf(mine, (rs) => perRound(rs, k)) });
  }
  const total = card.sg[0];
  const sgVals = new Map(SG_KEYS.map(([k]) => [k, new Map(ranked.map((p) => [p.key, perRound(p.rounds, k)]))]));
  const nm = (k) => (k === key ? label : nameOf?.(k) || String(k).replace(/^c_/, ""));
  // (update 171: the SG Total rank trend chart is gone from the card)

  // ---- distances: strokes gained a shot by category and distance (enough attempts to mean something) ----
  const MIN_ATT = 8;
  const bucketsOf = (rounds) => { const m = new Map(); for (const rd of rounds) for (const s of rd.shots) if (s.dist) { const b = `${s.cat}|${s.dist}`; const o = m.get(b) || m.set(b, { sg: 0, w: 0 }).get(b); o.sg += s.sg; o.w += s.w; } return m; };
  const minePeriod = own?.length ? applyFilters(sgOnly(own), f) : mine;
  const myB = bucketsOf(minePeriod);
  const fieldB = detail?.length ? detail.map((p) => { const rs = p.key === key ? minePeriod : applyFilters(sgOnly(p.rounds), f); return { key: p.key, n: rs.length, b: p.key === key ? myB : bucketsOf(rs) }; }) : null;
  // (update 173) strokes gained per round at each distance (all their rounds in the period count)
  const nMine = minePeriod.length;
  const dl = [...myB].filter(([, o]) => o.w >= MIN_ATT && nMine).map(([b, o]) => {
    const [cat, ...d] = b.split("|"), v = o.sg / nMine;
    let r = { rank: null, of: 0, avg: null };
    if (fieldB) r = rankOf(new Map(fieldB.map((p) => { const x = p.b.get(b); return [p.key, p.key === key ? v : x && x.w >= MIN_ATT && p.n ? x.sg / p.n : null]; })), key);
    return { id: b, cat, dist: d.join("|"), label: `${CAT_SHORT[cat] || cat} · ${d.join("|")}`, v, n: Math.round(o.w), rank: r.rank, of: r.of, avg: r.avg };
  });
  // best and worst: by rank when the field's detail is here, else against the baseline
  const score = (x) => (x.rank && x.of > 1 ? 1 - (x.rank - 1) / (x.of - 1) : null);
  const sorted = [...dl].sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0) || b.v - a.v);
  card.dists.best = sorted.slice(0, 3);
  card.dists.worst = sorted.slice(Math.max(3, sorted.length - 3)).reverse(); // (never the same as the best)

  // ---- results: wins and top 10s (best strokes gained a round at a tournament, among those who played every round) ----
  const events = eventsOf(ranked.map((p) => ({ key: p.key, rounds: p.rounds })));
  const finishes = events.map((e) => ({ e, i: e.ranked.findIndex((x) => x.key === key) })).filter((x) => x.i >= 0);
  const wins = finishes.filter((x) => x.i === 0), top10 = finishes.filter((x) => x.i < 10);

  // ---- the metrics picked ----
  for (const id of metrics) {
    let v = null, r = { rank: null, of: 0 }, trend = null, fmt = (x) => (x == null ? "—" : fmtSG(x)), higher = true;
    if (id === "sg:T2G") { const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, "T2G")])); v = vals.get(key); r = rankOf(vals, key); trend = trendOf(mine, (rs) => perRound(rs, "T2G")); }
    else if (id === "sg:sd") {
      const swing = (rs) => sd(rs.map((rd) => sgOf(rd)));
      const vals = new Map(ranked.filter((p) => p.rounds.length >= 8 || p.key === key).map((p) => [p.key, swing(p.rounds)]));
      v = vals.get(key); r = rankOf(vals, key, false); higher = false; fmt = (x) => (x == null ? "—" : `±${x.toFixed(2)}`);
      trend = trendOf(mine, swing);
    } else if (id === "sg:best") { const vals = new Map(ranked.map((p) => [p.key, Math.max(...p.rounds.map((rd) => sgOf(rd)))])); v = vals.get(key); r = rankOf(vals, key); }
    else if (id === "res:wins" || id === "res:top10") {
      const counts = new Map(ranked.map((p) => [p.key, 0]));
      for (const e of events) e.ranked.slice(0, id === "res:wins" ? 1 : 10).forEach((x) => counts.set(x.key, (counts.get(x.key) || 0) + 1));
      v = counts.get(key) || 0; r = v ? rankOf(new Map([...counts].filter(([, n]) => n > 0)), key) : { rank: null, of: 0 }; fmt = (x) => String(x ?? 0); // (no rank for none)
    } else if (id === "res:rounds") { v = mine.length; r = rankOf(new Map(fieldF.map((p) => [p.key, p.rounds.length])), key); fmt = (x) => String(x ?? 0); }
    else if (id.startsWith("stat:") && parseStatId(id).cat) {
      // (update 172) a stat at one distance: ranked against the field's lie / distance detail (when it's here)
      const { k, cat, dist } = parseStatId(id), def = statDef(k); higher = def.higher !== false;
      const fr = { ...f, cats: [cat], dist: [`${cat}|${dist}`] };
      const statAll = (rs) => applyFilters(statRounds(rs, k), fr).filter((rd) => rd.shots.length);
      const agg = (rs) => statAgg(rs, true);
      const myS = statAll(srcAll).sort(byDate);
      const vals = new Map((detail || []).filter((p) => p.key !== key).map((p) => { const a = agg(statAll(p.rounds)); return [p.key, a.w >= MIN_ATT ? a.value : null]; }));
      vals.set(key, agg(myS).value);
      v = vals.get(key); r = detail?.length ? rankOf(vals, key, higher) : { rank: null, of: 0 }; fmt = (x) => fmtStat(def, x);
      trend = trendOf(myS, (rs) => agg(rs).value);
      if (def.higher == null) higher = null;
    } else if (id.startsWith("stat:")) {
      const k = id.slice(5), def = statDef(k); higher = def.higher !== false;
      const val = (rs) => statAgg(statRounds(rs, k), false).value;
      const statAll = (rs) => applyFilters(statRounds(rs, k), f);
      const myS = statAll(srcAll).sort(byDate);
      const vals = new Map(field.map((p) => [p.key, p.key === key ? val(myS) : (() => { const rs = statAll(p.rounds); return rs.length >= Math.max(1, minR) ? val(rs) : null; })()]));
      v = vals.get(key); r = rankOf(vals, key, higher); fmt = (x) => fmtStat(def, x);
      trend = trendOf(myS, val);
      if (def.higher == null) higher = null;
    } else if (id.startsWith("dist:")) {
      // (update 172) strokes gained per round at that distance (all their rounds in the period count)
      const b = id.slice(5), o = myB.get(b);
      v = o && nMine ? o.sg / nMine : null;
      if (fieldB && v != null) r = rankOf(new Map(fieldB.map((p) => { const x = p.b.get(b); return [p.key, p.key === key ? v : x && x.w >= MIN_ATT && p.n ? x.sg / p.n : null]; })), key);
      fmt = (y) => (y == null ? "—" : `${y >= 0 ? "+" : "−"}${Math.abs(y).toFixed(3)}`);
      trend = trendOf(minePeriod.sort(byDate), (rs) => { const x = bucketsOf(rs).get(b); return x && x.w >= 3 ? x.sg / rs.length : null; });
    }
    card.metrics.push({ id, label: metricLabel(id), v, text: fmt(v), rank: r.rank, of: r.of, trend, higher, fmtCh: (ch) => (id.startsWith("stat:") ? (() => { const d = statDef(parseStatId(id).k); return fmtStat({ ...d, pct: false, unit: d.pct ? " pts" : d.unit }, Math.abs(ch)); })() : id.startsWith("dist:") ? Math.abs(ch).toFixed(3) : Math.abs(ch).toFixed(2)) });
  }

  // ---- badges and alerts ----
  const badges = card.badges, alerts = card.alerts;
  const add = (b, info = null) => { if (info) b.info = info; badges.push(b); if (b.alert) alerts.push({ ...b, key, label }); };
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
  if ((sign > 0 && run >= 5) || (avg5 != null && avg5 >= 1.5)) add({ kind: "hot", icon: "🔥", tone: "up", text: run >= 5 && sign > 0 ? `Hot streak · ${run} straight rounds gaining` : `Hot streak · ${fmtSG(avg5)} a round, last 5`, alert: true, sev: 3 }, streakInfo(run >= 5 && sign > 0));
  if ((sign < 0 && run >= 5) || (avg5 != null && avg5 <= -1.5)) add({ kind: "cold", icon: "🧊", tone: "down", text: run >= 5 && sign < 0 ? `Slump · ${run} straight rounds losing` : `Slump · ${fmtSG(avg5)} a round, last 5`, alert: true, sev: 3 }, streakInfo(run >= 5 && sign < 0));
  // big moves: the last 10 against the 10 before
  if (total.trend && Math.abs(total.trend.ch) >= 0.75) add({ kind: total.trend.ch > 0 ? "up" : "down", icon: total.trend.ch > 0 ? "⬆" : "⬇", tone: total.trend.ch > 0 ? "up" : "down", text: `Big move · ${total.trend.ch > 0 ? "up" : "down"} ${Math.abs(total.trend.ch).toFixed(2)} a round, last ${total.trend.n} vs previous ${total.trend.n}`, alert: true, sev: 2 }, () => {
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
    if (now >= Math.max(...rolls) - 1e-9 && now - avgRoll >= 0.3) add({ kind: "best", icon: "⛰", tone: "up", text: `Best form of the ${period === "season" ? "season" : "period"} · ${fmtSG(now)} over the last 10`, alert: true, sev: 2 }, formInfo(true));
    else if (now <= Math.min(...rolls) + 1e-9 && avgRoll - now >= 0.3) add({ kind: "low", icon: "⚠", tone: "down", text: `Lowest form of the ${period === "season" ? "season" : "period"} · ${fmtSG(now)} over the last 10`, alert: true, sev: 2 }, formInfo(false));
  }
  // best rounds: a career-best (everything in the data) or season-best round in their last 3
  const careerRs = sgOnly(mineAll).filter((rd) => !tour || rd.tour === tour || !rd.tour);
  const careerBest = Math.max(...careerRs.map((rd) => sgOf(rd)));
  const recent = mine.slice(-3);
  const top = recent.reduce((b, rd) => (sgOf(rd) > sgOf(b) ? rd : b), recent[0]);
  const bestInfo = (pool, what) => () => {
    const next = [...pool].sort((a, b) => sgOf(b) - sgOf(a)).slice(0, 6);
    return { sub: `${top.event || "A tournament"}${top.roundNo ? `, round ${top.roundNo}` : ""}, ${dateShort(top.date)}: the round by category, against their average this ${period === "season" ? "season" : "period"}.`,
      blocks: [{ kind: "table", cols: [["Category"], ["That round", "num"], ["Their average", "num"], ["Difference", "num"]], rows: SG_KEYS.map(([k, l]) => { const a = sgOf(top, k), m = perRound(mine, k); return { strong: k === "TOTAL", cells: [l, { sg: a }, { sg: m }, { sg: m == null ? null : a - m, arrow: true }] }; }) },
        { kind: "table", title: `Their best rounds (${what})`, cols: [["Date"], ["Tournament"], ["SG", "num"]], rows: next.map((rd) => ({ me: rd === top, cells: [dateShort(rd.date), [rd.event || "\u2014", rd.roundNo ? ` R${rd.roundNo}` : ""].join(""), { sg: sgOf(rd) }] })) }] };
  };
  if (top && careerRs.length >= 20 && sgOf(top) >= careerBest - 1e-9) add({ kind: "career", icon: "⭐", tone: "gold", text: `Career-best round · ${fmtSG(sgOf(top))} at ${top.event || "a tournament"}`, alert: true, sev: 4 }, bestInfo(careerRs, "everything in the data"));
  else if (top && mine.length >= 10 && sgOf(top) >= Math.max(...rs) - 1e-9) add({ kind: "season", icon: "✨", tone: "gold", text: `${period === "season" ? "Season" : "Period"}-best round · ${fmtSG(sgOf(top))} at ${top.event || "a tournament"}`, alert: true, sev: 2 }, bestInfo(mine, period === "season" ? "this season" : "this period"));
  // wins and milestones
  const lastEvent = events.at(-1);
  const evRounds = (e) => e.by.get(key)?.length ?? 0;
  const margin = (e) => (e.ranked.length > 1 ? e.ranked[0].v - e.ranked[1].v : null);
  if (wins.length && lastEvent && wins.at(-1).e === lastEvent) add({ kind: "win", icon: "🏆", tone: "gold", text: `Led the field at ${lastEvent.event}`, alert: true, sev: 5 }, () => ({
    sub: `${lastEvent.event}, ${dateShort(lastEvent.end)}: strokes gained a round among the players who played ${evRounds(lastEvent) > 1 ? `all ${evRounds(lastEvent)} rounds` : "it"}.${margin(lastEvent) != null ? ` ${fmtSG(margin(lastEvent))} a round ahead of 2nd.` : ""}`,
    blocks: [{ kind: "table", cols: [["Pos"], ["Player"], ["SG / round", "num"]], rows: lastEvent.ranked.slice(0, 10).map((x, j) => ({ me: x.key === key, cells: [ordinal(j + 1), nm(x.key), { sg: x.v }] })) }] }));
  if (wins.length >= 2) add({ kind: "wins", icon: "🏆", tone: "gold", text: `${wins.length} wins ${period === "season" ? "this season" : "in this period"}` }, () => ({
    sub: "Tournaments where they had the best strokes gained a round among the players who played every round.",
    blocks: [{ kind: "table", cols: [["Date"], ["Tournament"], ["SG / round", "num"], ["Ahead of 2nd", "num"]], rows: [...wins].reverse().map(({ e }) => ({ cells: [dateShort(e.end), e.event, { sg: e.ranked[0].v }, { sg: margin(e) }] })) }] }));
  if (top10.length >= 5) add({ kind: "top10", icon: "🎯", tone: "gold", text: `${top10.length} top 10s` }, () => ({
    sub: "Finish: their place by strokes gained a round among the players who played every round.",
    blocks: [{ kind: "bars", fmt: "sg", items: finishes.map(({ e, i }) => ({ label: dateShort(e.end), sub: `${e.event} · ${ordinal(i + 1)}`, v: e.ranked[i].v, on: i < 10 })) },
      { kind: "table", title: "The top 10s", cols: [["Date"], ["Tournament"], ["Finish", "num"], ["SG / round", "num"]], rows: [...top10].reverse().map(({ e, i }) => ({ cells: [dateShort(e.end), e.event, ordinal(i + 1), { sg: e.ranked[i].v }] })) }] }));
  // (update 168: no badges for rounds played)
  // ranks: the top 10, number 1 in a category, and big climbs (against where they stood 10 rounds ago)
  const totalInfo = () => ({ sub: `SG: Total a round${tour ? ` on the ${tour}` : ""}, among players with ${minR} or more rounds in this period.`,
    blocks: [{ kind: "table", cols: [["Rank"], ["Player"], ["Rounds", "num"], ["SG / round", "num"]], rows: leaders(sgVals.get("TOTAL")) }] });
  if (total.rank === 1) add({ kind: "rank", icon: "🥇", tone: "gold", text: "No. 1 in SG: Total" }, totalInfo);
  else if (total.rank && total.rank <= 10) add({ kind: "rank", icon: "🔟", tone: "gold", text: `Top 10 in SG: Total (${ordinal(total.rank)})` }, totalInfo);
  const firstsS = card.sg.slice(1).filter((s) => s.rank === 1), firsts = firstsS.map((s) => s.label);
  if (firsts.length) add({ kind: "rank", icon: "🥇", tone: "gold", text: `No. 1 in ${firsts.length > 2 ? `${firsts.slice(0, -1).join(", ")} and ${firsts.at(-1)}` : firsts.join(" and ")}` }, () => ({
    sub: `Strokes gained a round${tour ? ` on the ${tour}` : ""}, among players with ${minR} or more rounds in this period: the top 10 in each category they lead.`,
    blocks: firstsS.map((x) => ({ kind: "table", title: x.label, cols: [["Rank"], ["Player"], ["Rounds", "num"], ["SG / round", "num"]], rows: leaders(sgVals.get(x.k)) })) })); // (update 175: the full top 10, like SG: Total)
  if (mine.length >= 20 && lastRound) {
    const cut = mine.at(-11)?.date;
    if (cut) {
      const before = new Map(ranked.map((p) => [p.key, perRound(p.rounds.filter((rd) => String(rd.date) <= String(cut)))]).filter(([, v]) => v != null));
      const was = rankOf(before, key).rank;
      if (was && total.rank && Math.abs(was - total.rank) >= 10) add({ kind: total.rank < was ? "up" : "down", icon: total.rank < was ? "⬆" : "⬇", tone: total.rank < was ? "up" : "down", text: `${total.rank < was ? "Up" : "Down"} ${Math.abs(was - total.rank)} spots to ${ordinal(total.rank)} in SG: Total`, alert: true, sev: 3 }, () => {
        const trail = rankTrail(key, mine, ranked, minR, total.rank), dates = mine.map((rd) => rd.date);
        const pts = rankDates(mine).map((d, i) => ({ label: dateShort(d), v: trail[i], on: i === trail.length - 1 })).filter((x) => x.v != null);
        return { sub: `Their SG: Total rank after each round this ${period === "season" ? "season" : "period"}: ${ordinal(was)} 10 rounds ago, ${ordinal(total.rank)} now.`,
          blocks: [{ kind: "line", fmt: "rank", invert: true, items: pts }, { ...roundsTable(mine.slice(-10)), title: "The last 10 rounds" }] };
      });
    }
  }
  // (update 173) the latest tournament: strokes gained a round over its rounds
  const lastEv = lastRound ? mine.filter((rd) => rd.event === lastRound.event && String(rd.year) === String(lastRound.year)) : [];
  card.latest = lastRound ? { date: lastRound.date, event: lastRound.event, sg: lastRound.event ? perRound(lastEv) : sgOf(lastRound), rounds: lastRound.event ? lastEv.length : 1 } : null;
  return card;
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
const dateShort = (d) => { const s = String(d || ""), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); const t = m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(s); return isNaN(t) ? s : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); };
export const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
