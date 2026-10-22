// Comparisons (update 188): one player's rounds, cut into selections (seasons, time windows, tournaments,
// courses, round numbers, months, or any mix) and compared side by side. Everything here is plain numbers, so
// the page (views/comparisons.js) only draws.
//   A selection: { id, name, color, kind, value, f } where f is a filter (see roundsFor).
import { CATEGORIES, statRounds, statAgg, statsIn, statDef, distLead, STAT_DEFS } from "./sg.js";

export const COLORS = ["#d4b483", "#4fd1c5", "#a78bfa", "#ff7a6b", "#5ab0ff", "#a3e635", "#f472b6", "#fbbf24"];
export const MAX_SEL = 8;
export const SG_ROWS = [["TOTAL", "SG: Total"], ...CATEGORIES, ["T2G", "Tee to Green"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sum = (a) => a.reduce((t, x) => t + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const dk = (d) => String(d || "");
export const byDate = (a, b) => dk(a.date).localeCompare(dk(b.date)) || String(a.roundNo || "").localeCompare(String(b.roundNo || ""), undefined, { numeric: true });
export const sgOf = (rd, cat = null) => rd.shots.reduce((t, s) => t + (!cat || cat === "TOTAL" || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg : 0), 0);
export const perRound = (rs, cat = null) => (rs.length ? sum(rs.map((rd) => sgOf(rd, cat))) / rs.length : null);
const monthOf = (rd) => { const m = /^\d{4}-(\d{2})/.exec(dk(rd.date)); if (m) return Number(m[1]) - 1; const d = new Date(rd.date); return isNaN(d) ? null : d.getMonth(); };
const yearOf = (rd) => String(rd.year || dk(rd.date).slice(0, 4));
const evKey = (rd) => `${rd.event}|${yearOf(rd)}`;

/** The strokes-gained rounds, oldest first (event-level rows and rounds with no shots left out). */
// (update 195) worked out once per rounds list (everyone's rounds pooled is a lot to sort on every redraw)
const sgMemo = new WeakMap(), sortedMemo = new WeakMap();
export const sgRounds = (rounds) => { if (!rounds) return []; let r = sgMemo.get(rounds); if (!r) { r = statRounds(rounds, "sg").filter((rd) => rd.shots.length && !rd.eventLevel).sort(byDate); sgMemo.set(rounds, r); } return r; };
const sortedAll = (rounds) => { if (!rounds) return []; let r = sortedMemo.get(rounds); if (!r) { r = [...rounds].sort(byDate); sortedMemo.set(rounds, r); } return r; };

/* ------------------------------------------------ what can be picked ------------------------------------------------ */
/** The choices for each way of comparing, with how many rounds each has. */
export function options(rounds) {
  const rs = sgRounds(rounds);
  const count = (keyOf) => { const m = new Map(); for (const rd of rs) { const k = keyOf(rd); if (k == null || k === "") continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const years = [...count(yearOf)].sort((a, b) => b[0].localeCompare(a[0])).map(([v, n]) => ({ value: v, label: v, n }));
  const evs = new Map();
  for (const rd of rs) { if (!rd.event) continue; const k = evKey(rd); const e = evs.get(k) || { value: k, label: rd.event, year: yearOf(rd), n: 0, end: "" }; e.n++; if (dk(rd.date) > e.end) e.end = dk(rd.date); evs.set(k, e); }
  const tournaments = [...evs.values()].sort((a, b) => b.end.localeCompare(a.end)).map((e) => ({ ...e, label: `${e.label} ${e.year}` }));
  const courses = [...count((rd) => rd.course || null)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ value: v, label: v, n }));
  const rounds_ = [...count((rd) => (rd.roundNo ? String(rd.roundNo) : null))].sort((a, b) => Number(a[0]) - Number(b[0])).map(([v, n]) => ({ value: v, label: `Round ${v}`, n }));
  const months = [...count(monthOf)].sort((a, b) => a[0] - b[0]).map(([v, n]) => ({ value: String(v), label: MONTHS[v], n }));
  const tours = [...count((rd) => rd.tour || null)].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: v, n }));
  const total = rs.length, season = years[0]?.value;
  const evOrder = [...new Set(rs.map(evKey))]; // (oldest first)
  // time windows: the latest N rounds, and the season, last season and everything
  const windows = [
    ...[5, 10, 20].filter((n) => n < total).map((n) => ({ value: `last:${n}`, label: `Last ${n} rounds`, n })),
    ...[5, 10, 20].filter((n) => n * 2 <= total).map((n) => ({ value: `prev:${n}`, label: `The ${n} rounds before that`, n })),
    // (update 217) by tournaments too
    ...[3, 5, 10].filter((n) => n < evOrder.length).map((n) => ({ value: `lastev:${n}`, label: `Last ${n} events`, n: rs.filter((rd) => evOrder.slice(-n).includes(evKey(rd))).length })),
    ...[3, 5, 10].filter((n) => 2 * n <= evOrder.length).map((n) => ({ value: `prevev:${n}`, label: `The ${n} events before that`, n: rs.filter((rd) => evOrder.slice(-2 * n, -n).includes(evKey(rd))).length })),
    season ? { value: `year:${season}`, label: `This season (${season})`, n: years[0].n } : null,
    years[1] ? { value: `year:${years[1].value}`, label: `Last season (${years[1].value})`, n: years[1].n } : null,
    ...years.slice(2).map((y) => ({ value: `year:${y.value}`, label: `${y.value} season`, n: y.n })), // (update 233: every season, now the Seasons tab is gone)
    { value: "all", label: "Career (everything)", n: total },
  ].filter(Boolean);
  return { total, events: evOrder.length, years, tournaments, courses, rounds: rounds_, months, tours, windows };
}

/** The rounds in a selection, oldest first. f: { years, events, courses, roundNos, months, tours, from, to, last, prev, all } */
/** (update 190) "This season" / "Last season" for whoever's rounds these are (players have different latest seasons). */
const withSeason = (rounds, f) => { if (!f?.season) return f; const ys = [...new Set(sgRounds(rounds).map(yearOf))].sort().reverse(); const y = ys[f.season === "last" ? 1 : 0]; return { ...f, season: null, years: [y || "none"] }; };
export function roundsFor(rounds, f = {}) {
  f = withSeason(rounds, f);
  // (update 254) every round of the rest of the filter except the ones in f.except ("the rest", "his other rounds")
  if (f.except) {
    const id = (rd) => rd.key || `${dk(rd.date)}|${evKey(rd)}|${rd.roundNo || ""}`; // (a club's rounds are copies)
    const drop = new Set(roundsFor(rounds, f.except).map(id));
    return roundsFor(rounds, { ...f, except: null }).filter((rd) => !drop.has(id(rd)));
  }
  // (update 254) the best (or worst) run of N rounds in a row, within the rest of the filter: "his best 12-round stretch"
  if (f.stretch) return stretchOf(roundsFor(rounds, { ...f, stretch: null }), f.stretch);
  // (update 250) the best (or worst) rounds of the rest of the filter: the top 25%, the best 10 …
  if (f.top || f.topPct || f.bottom || f.bottomPct) {
    const base = roundsFor(rounds, { ...f, top: null, topPct: null, bottom: null, bottomPct: null });
    const byTot = [...base].sort((a, b) => sgOf(b) - sgOf(a));
    const n = f.top || f.bottom || Math.max(1, Math.round(base.length * (f.topPct || f.bottomPct) / 100));
    const pick = f.top || f.topPct ? byTot.slice(0, n) : byTot.slice(-n);
    return pick.sort(byDate);
  }
  // (update 190) a product: the rounds it was used in, and only its shots (so the numbers are that club's)
  // (update 191) a pick is a club model ("Iron|Callaway Apex") or a ball ("Ball|Callaway Chrome Tour")
  // (update 217) f.balls: a club with one ball (a driver and a ball combined): only shots hit with both
  if (f.clubs || f.balls) { const cs = f.clubs?.length ? new Set(f.clubs) : null, bs = f.balls?.length ? new Set(f.balls) : null; return roundsFor(rounds, { ...f, clubs: null, balls: null }).map((rd) => ({ ...rd, shots: rd.shots.filter((x) => comboMatch(x, cs, bs)) })).filter((rd) => rd.shots.length); }
  // (update 189) several picks together: every round in any of them, once each, oldest first
  if (f.any) { const seen = new Set(), out = []; for (const g of f.any) for (const rd of roundsFor(rounds, g)) if (!seen.has(rd.key || rd)) { seen.add(rd.key || rd); out.push(rd); } return out.sort(byDate); }
  let rs = sgRounds(rounds);
  if (f.last) return rs.slice(-f.last);
  if (f.prev) return rs.slice(-2 * f.prev, -f.prev);
  // (update 217) the latest N tournaments (every round in them), or the N before those
  if (f.lastEv || f.prevEv) { const order = [...new Set(rs.map(evKey))]; const keep = new Set(f.lastEv ? order.slice(-f.lastEv) : order.slice(-2 * f.prevEv, -f.prevEv)); return rs.filter((rd) => keep.has(evKey(rd))); }
  const set = (v) => (v && v.length ? new Set(v.map(String)) : null);
  const years = set(f.years), events = set(f.events), courses = set(f.courses), rnds = set(f.roundNos), months = set(f.months), tours = set(f.tours);
  rs = rs.filter((rd) => (!years || years.has(yearOf(rd))) && (!events || events.has(evKey(rd))) && (!courses || courses.has(rd.course || ""))
    && (!rnds || rnds.has(String(rd.roundNo || ""))) && (!months || months.has(String(monthOf(rd)))) && (!tours || tours.has(rd.tour || ""))
    && (!f.from || dk(rd.date) >= f.from) && (!f.to || dk(rd.date) <= f.to));
  return rs;
}
/** (update 254) The N rounds in a row (oldest first) with the highest (best) or lowest (worst) strokes gained a round.
 * s: { n, worst?, cat? } (cat: a part of the game, e.g. "PUTT"; default the total). Fewer than N rounds: all of them. */
export function stretchOf(rs, s) {
  const n = Math.max(1, Math.round(Number(s?.n) || 0));
  if (rs.length <= n) return rs;
  const v = rs.map((rd) => sgOf(rd, s.cat || null));
  let t = 0;
  for (let i = 0; i < n; i++) t += v[i];
  let at = 0, bestT = t;
  for (let i = n; i < v.length; i++) {
    t += v[i] - v[i - n];
    if (s.worst ? t < bestT - 1e-9 : t > bestT + 1e-9) { bestT = t; at = i - n + 1; }
  }
  return rs.slice(at, at + n);
}
const gearMatch = (x, cs) => cs.has(x.gear) || (x.ball && cs.has(`Ball|${x.ball}`));
const comboMatch = (x, cs, bs) => (!cs || gearMatch(x, cs)) && (!bs || (x.ball && bs.has(`Ball|${x.ball}`)));

/* (update 194) which shots count: some categories, and some distances within them ("APP|100-150 yds"). null = all. */
export function includeShots(rs, inc) {
  if (!inc || (!inc.cats && !inc.dists)) return rs;
  return rs.map((rd) => ({ ...rd, shots: rd.shots.filter((x) => shotIn(x, inc)) }));
}
const shotIn = (x, inc) => (!inc.cats || inc.cats.has(x.cat)) && (!inc.dists || !inc.dists.has(`${x.cat}|*`) || inc.dists.has(`${x.cat}|${x.dist}`));
/** The categories and distances in some rounds' shots, for the Include choices: [{ cat, label, dists: [..] }] */
export function shotScope(sets) {
  const m = new Map();
  for (const rs of sets) for (const rd of rs) for (const x of rd.shots) {
    if (!x.cat) continue;
    const d = m.get(x.cat) || m.set(x.cat, new Set()).get(x.cat);
    if (x.dist && !/^(none|null|na)$/i.test(x.dist)) d.add(x.dist);
  }
  return CATEGORIES.filter(([k]) => m.has(k)).map(([cat, label]) => ({ cat, label, dists: [...m.get(cat)].sort((a, b) => distLead(a) - distLead(b) || a.localeCompare(b)) }));
}

/** A window choice ("last:10", "prev:10", "year:2025", "all") as a filter. */
export const windowFilter = (v) => (v === "all" ? {} : v.startsWith("lastev:") ? { lastEv: Number(v.slice(7)) } : v.startsWith("prevev:") ? { prevEv: Number(v.slice(7)) } : v.startsWith("last:") ? { last: Number(v.slice(5)) } : v.startsWith("prev:") ? { prev: Number(v.slice(5)) } : v.startsWith("year:") ? { years: [v.slice(5)] } : {});

/* ------------------------------------------------ the numbers ------------------------------------------------ */
/** Everything the page shows for one selection. */
export function summarize(rs) {
  const tot = rs.map((rd) => sgOf(rd));
  const sorted = [...tot].sort((a, b) => a - b);
  const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : null);
  const events = new Set(rs.map(evKey)).size;
  return {
    n: rs.length, events,
    sg: Object.fromEntries(SG_ROWS.map(([k]) => [k, perRound(rs, k)])),
    rounds: tot, sd: sd(tot), best: sorted.at(-1) ?? null, worst: sorted[0] ?? null, median: q(0.5), q1: q(0.25), q3: q(0.75),
    gaining: tot.length ? tot.filter((x) => x > 0).length / tot.length : null,
    from: rs[0]?.date || null, to: rs.at(-1)?.date || null,
  };
}

/** How sure a gap between two selections is (SG: Total a round): Welch's t, in words. */
export function confidence(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return { word: "too few rounds", z: 0 };
  const se = Math.sqrt((sd(a) ** 2) / a.length + (sd(b) ** 2) / b.length);
  const z = se ? (mean(a) - mean(b)) / se : 0;
  const az = Math.abs(z);
  return { z, word: az >= 2.5 ? "clear" : az >= 1.6 ? "likely" : az >= 1 ? "possible" : "too close to call" };
}

/** (update 222) how sure the gap between two sets of rounds is, in plain words
 */
export function sureWords(a, b) {
  // (update 240) no labels on the gap ("clear", "very likely real", "probably real"): only a warning when there are
  // too few rounds to read anything into it
  const na = a?.length || 0, nb = b?.length || 0;
  if (na < 3 || nb < 3) return `There are too few rounds (${na} and ${nb}) to say whether that\u2019s real yet.`;
  return "";
}
/** Strokes gained by distance (per category), a round or a shot: { cat: [{ dist, values: [per selection], w: [...] }] } */
export function distanceProfile(sets, per = "round") {
  const out = {};
  for (const [cat] of CATEGORIES) {
    const dists = new Map();
    sets.forEach((rs, i) => { for (const rd of rs) for (const s of rd.shots) { if (s.cat !== cat || !s.dist) continue; const d = dists.get(s.dist) || dists.set(s.dist, sets.map(() => ({ sg: 0, w: 0 }))).get(s.dist); d[i].sg += s.sg; d[i].w += s.w; } });
    const rows = [...dists].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]))
      .map(([dist, cells]) => ({ dist, values: cells.map((c, i) => (per === "shot" ? (c.w >= 3 ? c.sg / c.w : null) : sets[i].length && c.w ? c.sg / sets[i].length : null)), w: cells.map((c) => Math.round(c.w)) }))
      .filter((r) => r.w.some((w) => w >= 3));
    if (rows.length) out[cat] = rows;
  }
  return out;
}

/** The other stats (Fairways, GIR, Proximity …) for each selection: [{ key, label, def, values }] */
export function statRows(allRounds, sets) {
  const keys = statsIn([allRounds || []]).filter((k) => k !== "sg");
  return keys.map((k) => {
    const def = statDef(k);
    const values = sets.map((f) => { const r = statRounds(f, k); return r.length ? statAgg(r, false).value : null; });
    return { key: k, label: def.label, def, values };
  }).filter((r) => r.values.filter((v) => v != null).length >= 1);
}
/** statRows needs each selection's rounds WITH their stats: the same filter on every round (not only SG rounds). */
export function statSets(rounds, filters) {
  const all = sortedAll(rounds);
  return filters.map(function one(f) {
    f = withSeason(rounds, f);
    if (f.clubs || f.balls) { // (update 194) a product: only the stats recorded with it (update 217: or a club with a ball)
      const cs = f.clubs?.length ? new Set(f.clubs) : null, bs = f.balls?.length ? new Set(f.balls) : null;
      return one({ ...f, clubs: null, balls: null }).map((rd) => { const obs = (rd.obs || []).filter((o) => comboMatch(o, cs, bs)); return { ...rd, obs, has: new Set(obs.map((o) => o.k)), shots: [] }; }).filter((rd) => rd.obs.length);
    }
    if (f.any) { const seen = new Set(); return f.any.flatMap((g) => one(g)).filter((rd) => (seen.has(rd) ? false : (seen.add(rd), true))); } // (update 189)
    if (f.last || f.prev || f.lastEv || f.prevEv || f.top || f.topPct || f.bottom || f.bottomPct || f.stretch || f.except) { /* (update 254: stretch, except) */ const sg = roundsFor(rounds, f); const keys = new Set(sg.map(evKey)); const dates = new Set(sg.map((rd) => dk(rd.date))); return all.filter((rd) => keys.has(evKey(rd)) && (dates.has(dk(rd.date)) || rd.eventLevel)); }
    const g = { ...f };
    const set = (v) => (v && v.length ? new Set(v.map(String)) : null);
    const years = set(g.years), events = set(g.events), courses = set(g.courses), rnds = set(g.roundNos), months = set(g.months), tours = set(g.tours);
    return all.filter((rd) => (!years || years.has(yearOf(rd))) && (!events || events.has(evKey(rd))) && (!courses || courses.has(rd.course || ""))
      && (!rnds || rnds.has(String(rd.roundNo || ""))) && (!months || months.has(String(monthOf(rd)))) && (!tours || tours.has(rd.tour || ""))
      && (!g.from || dk(rd.date) >= g.from) && (!g.to || dk(rd.date) <= g.to));
  });
}

/* (update 194) The stats for each category of shot, and at each distance: [{ cat, label, rows: [{ key, label, def, dist, values, w }] }]
 * obsSets: each selection's rounds with their stats (statSets). A stat recorded for the whole round (no category)
 * goes with the category it belongs to (Driving Distance and Fairways off the tee, Make % with putting …). */
const HOME = { drive: ["OTT"], fwy: ["OTT"], gir: ["OTT"], // (update 209: GIR off the tee only, as "GIR % (Par 4/5)")
  hitGreen: ["APP"], prox: ["APP"], pinHigh: ["APP"], onLine: ["APP"], ud: ["ARG"], scramble: ["ARG"], putts: ["PUTT"], make: ["PUTT"], goodLag: ["PUTT"], threePutt: ["PUTT"] };
export function statBlocks(obsSets, inc = null) {
  const SECTIONS = [...CATEGORIES, ["ROUND", "Scoring"]];
  const cell = (list) => { let s = 0, w = 0; for (const o of list) { s += o.v * o.w; w += o.w; } return w ? { v: s / w, w } : null; };
  const homeOf = (o) => (o.cat ? [o.cat] : HOME[o.k] || ["ROUND"]);
  const by = new Map(); // section → key → [obs per selection]
  obsSets.forEach((rs, i) => {
    for (const rd of rs) for (const o of rd.obs || []) {
      if (o.k === "sg" || o.v == null || !Number.isFinite(o.v)) continue;
      for (const sec of o.k === "gir" ? ["OTT"] : homeOf(o)) {
        if (inc?.cats && !inc.cats.has(sec) && sec !== "ROUND") continue;
        if (inc?.cats && sec === "ROUND") continue; // (only some shots counted: whole-round scoring doesn't fit)
        if (o.cat && o.dist && inc?.dists?.has(`${o.cat}|*`) && !inc.dists.has(`${o.cat}|${o.dist}`)) continue;
        const ks = by.get(sec) || by.set(sec, new Map()).get(sec);
        const per = ks.get(o.k) || ks.set(o.k, obsSets.map(() => [])).get(o.k);
        per[i].push(o);
      }
    }
  });
  const order = Object.keys(STAT_DEFS);
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
  return SECTIONS.filter(([sec]) => by.has(sec)).map(([sec, label]) => {
    const rows = [];
    for (const [k, per] of [...by.get(sec)].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))) {
      const def = k === "gir" ? { ...statDef(k), label: "GIR % (Par 4/5)" } : statDef(k);
      // all distances: the file's own all-distance rows when it has them, otherwise every row pooled
      const overall = per.map((list) => { const whole = list.filter((o) => !o.dist); return cell(whole.length ? whole : list); });
      if (overall.every((c) => !c)) continue;
      rows.push({ key: k, label: def.label, def, dist: null, values: overall.map((c) => c?.v ?? null), w: overall.map((c) => c?.w ?? 0) });
      const dists = [...new Set(per.flatMap((list) => list.filter((o) => o.dist).map((o) => o.dist)))].sort((a, b) => distLead(a) - distLead(b) || a.localeCompare(b));
      if (dists.length > 1 || (dists.length === 1 && per.some((l) => l.some((o) => !o.dist)))) for (const d of dists) {
        const cs = per.map((list) => cell(list.filter((o) => o.dist === d)));
        if (cs.some(Boolean)) rows.push({ key: k, label: def.label, def, dist: d, values: cs.map((c) => c?.v ?? null), w: cs.map((c) => c?.w ?? 0) });
      }
    }
    return { cat: sec, label, rows };
  }).filter((b) => b.rows.length);
}

/** (update 190) The products in the shots, grouped by club type; (update 191) each club model (brand + model) and each ball. */
export const CLUB_TYPES = ["Driver", "Non-Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Other", "Ball"];
export function products(rounds) {
  const by = new Map();
  const add = (g, value, label, rd, s, seen) => {
    const m = by.get(g) || by.set(g, new Map()).get(g);
    const SHORT = { Driver: "driver", "Non-Driver": "(non-driver)", "Fairway Wood": "fairway woods", Hybrid: "hybrids", Iron: "irons", Wedge: "wedges", Putter: "putter", Ball: "ball", Other: "" };
    const o = m.get(value) || m.set(value, { value, label, long: SHORT[g] ? `${label} ${SHORT[g]}` : label, n: 0, shots: 0 }).get(value);
    o.shots += s.w || 1; if (!seen.has(value)) { seen.add(value); o.n++; }
  };
  for (const rd of sgRounds(rounds)) {
    const seen = new Set();
    for (const s of rd.shots) {
      if (s.gear) { const g = CLUB_TYPES.includes(s.clubCat) && s.clubCat !== "Ball" ? s.clubCat : "Other"; add(g, s.gear, s.gear.slice(s.gear.indexOf("|") + 1), rd, s, seen); }
      if (s.ball) add("Ball", `Ball|${s.ball}`, s.ball, rd, s, seen);
    }
  }
  return CLUB_TYPES.filter((g) => by.has(g)).map((g) => ({ group: g, items: [...by.get(g).values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)) }));
}
/** Rolling average (k rounds) through a selection, for "how it unfolded". */
export const rolling = (vals, k = 5) => vals.map((_, i) => (i + 1 >= Math.min(k, vals.length) ? mean(vals.slice(Math.max(0, i + 1 - k), i + 1)) : null));

/* ------------------------------------------------ getting better or worse ------------------------------------------------ */
/** The latest n rounds against the n before, for several n: [{ n, last, prev, ch: { TOTAL, OTT, … }, conf }] */
export function trajectory(rounds) {
  const rs = sgRounds(rounds);
  return [5, 10, 20, 40, 80].filter((n) => rs.length >= 2 * n).map((n) => {
    const last = rs.slice(-n), prev = rs.slice(-2 * n, -n);
    const ch = Object.fromEntries(SG_ROWS.map(([k]) => [k, perRound(last, k) - perRound(prev, k)]));
    return { n, last: perRound(last), prev: perRound(prev), ch, conf: confidence(last.map((rd) => sgOf(rd)), prev.map((rd) => sgOf(rd))), from: prev[0]?.date, to: last.at(-1)?.date };
  });
}
/** One sentence on the direction across time scales. */
export function trajectoryWords(tr) {
  if (!tr.length) return "Not enough rounds yet to compare time scales (at least 10).";
  const dir = (x) => (x.ch.TOTAL > 0.15 ? "up" : x.ch.TOTAL < -0.15 ? "down" : "flat");
  const w = { up: "better", down: "worse", flat: "about the same" };
  if (tr.length === 1) return `Over the last ${tr[0].n} rounds against the ${tr[0].n} before: ${w[dir(tr[0])]} (${fmt(tr[0].ch.TOTAL)} a round).`;
  const groups = { up: [], down: [], flat: [] };
  for (const x of tr) groups[dir(x)].push(x.n);
  const list = (ns) => (ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`);
  const only = Object.entries(groups).filter(([, ns]) => ns.length);
  if (only.length === 1) {
    const d = only[0][0];
    return d === "flat" ? `About the same on every time scale (last ${list(groups.flat)} rounds).`
      : `Getting ${w[d]} on every time scale: ${fmt(tr[0].ch.TOTAL)} a round over the last ${tr[0].n}, ${fmt(tr.at(-1).ch.TOTAL)} over the last ${tr.at(-1).n}.`;
  }
  // mixed: say which way each time scale went
  const t = only.map(([d, ns]) => `${w[d]} over the last ${list(ns)} rounds`).join("; ");
  return `${t[0].toUpperCase()}${t.slice(1)}.`;
}
const fmt = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);

/* ------------------------------------------------ the best conditions ------------------------------------------------ */
/** Every round grouped by one condition (round number, course, month, …), best first: [{ label, n, v, cats }] */
export const DIMENSIONS = [["round", "Round"], ["course", "Course"], ["event", "Tournament"], ["month", "Month"], ["year", "Season"], ["tour", "Tour"], ["field", "Event week"]];
export function conditions(rounds, dim, minN = 3) {
  const rs = sgRounds(rounds);
  const keyOf = {
    round: (rd) => (rd.roundNo ? `Round ${rd.roundNo}` : null),
    course: (rd) => rd.course || null,
    event: (rd) => (rd.event ? rd.event : null),
    month: (rd) => { const m = monthOf(rd); return m == null ? null : MONTHS[m]; },
    year: (rd) => yearOf(rd),
    tour: (rd) => rd.tour || null,
    // where in a run of tournaments: the first event back after a break (3+ weeks), or 2nd / 3rd+ in a row
    field: null,
  }[dim];
  let groups = new Map();
  if (dim === "field") {
    const evs = [...new Map(rs.map((rd) => [evKey(rd), rd.date])).entries()].sort((a, b) => dk(a[1]).localeCompare(dk(b[1])));
    const tag = new Map(); let run = 0, prev = null;
    for (const [k, d] of evs) { const t = Date.parse(d); run = prev != null && t - prev < 17 * 864e5 ? run + 1 : 1; prev = t; tag.set(k, run === 1 ? "First event back" : run === 2 ? "2nd week in a row" : "3rd+ week in a row"); }
    for (const rd of rs) { const g = tag.get(evKey(rd)); (groups.get(g) || groups.set(g, []).get(g)).push(rd); }
  } else for (const rd of rs) { const g = keyOf(rd); if (g == null) continue; (groups.get(g) || groups.set(g, []).get(g)).push(rd); }
  const all = perRound(rs);
  return [...groups].filter(([, g]) => g.length >= minN).map(([label, g]) => ({ label, n: g.length, v: perRound(g), vsAll: perRound(g) - all, cats: Object.fromEntries(CATEGORIES.map(([k]) => [k, perRound(g, k)])) }))
    .sort((a, b) => b.v - a.v);
}

/* ------------------------------------------------ what stands out ------------------------------------------------ */
/** A few plain sentences about the selections. sels: [{ name, s: summarize(), rs }] */
export function insights(sels) {
  const out = [];
  const ok = sels.filter((x) => x.s.n > 0);
  if (ok.length < 2) return out;
  const byTot = [...ok].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL);
  const best = byTot[0], worst = byTot.at(-1);
  const c = confidence(best.s.rounds, worst.s.rounds);
  out.push({ tone: "gold", text: `${best.name} is the best of these: ${fmt(best.s.sg.TOTAL)} a round, ${Math.abs(best.s.sg.TOTAL - worst.s.sg.TOTAL).toFixed(2)} better than ${worst.name}. ${sureWords(best.s.rounds, worst.s.rounds)}` }); void c;
  // (update 194) with three or more: every one in order, and the gap to the one above
  if (byTot.length >= 3) out.push({ tone: "", text: `In order: ${byTot.map((x, i) => `${i + 1}. ${x.name} ${fmt(x.s.sg.TOTAL)}${i ? ` (${(byTot[i - 1].s.sg.TOTAL - x.s.sg.TOTAL).toFixed(2)} behind)` : ""}`).join("; ")}.` });
  // where the gap comes from (best vs worst)
  const usedCats = CATEGORIES.filter(([k]) => ok.some((x) => Math.abs(x.s.sg[k] || 0) >= 0.005));
  const parts = usedCats.map(([k, l]) => ({ l, d: best.s.sg[k] - worst.s.sg[k] })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d); // (update 239: only the parts that helped)
  if (usedCats.length > 1 && parts[0] && Math.abs(parts[0].d) >= 0.1) out.push({ tone: "", text: `Most of that is ${parts[0].l} (${fmt(parts[0].d)} a round)${parts[1] && Math.abs(parts[1].d) >= 0.1 ? `, then ${parts[1].l} (${fmt(parts[1].d)})` : ""}.` });
  // each category's leader
  for (const [k, l] of usedCats.length > 1 ? usedCats : []) {
    const lead = [...ok].sort((a, b) => b.s.sg[k] - a.s.sg[k]);
    if (lead.length > 2 && lead[0] !== best && lead[0].s.sg[k] - lead[1].s.sg[k] >= 0.2) out.push({ tone: "", text: `${l} was best in ${lead[0].name} (${fmt(lead[0].s.sg[k])} a round, ${(lead[0].s.sg[k] - lead[1].s.sg[k]).toFixed(2)} clear of the next).` });
  }
  // steadiness
  const st = ok.filter((x) => x.s.sd != null).sort((a, b) => a.s.sd - b.s.sd);
  if (st.length >= 2 && st.at(-1).s.sd - st[0].s.sd >= 0.4) out.push({ tone: "", text: `Steadiest: ${st[0].name} (rounds within ±${st[0].s.sd.toFixed(2)} of the average); the most up and down: ${st.at(-1).name} (±${st.at(-1).s.sd.toFixed(2)}).` });
  // small samples
  const small = ok.filter((x) => x.s.n < 10); // (update 210: the same 10 as the warnings on the page)
  if (small.length) out.push({ tone: "muted", text: `${small.map((x) => x.name).join(", ")} ${small.length === 1 ? "has" : "have"} fewer than 10 rounds, so treat ${small.length === 1 ? "it" : "them"} as a hint, not a verdict.` });
  return out;
}
export { fmt as fmtSigned, MONTHS };

/* ------------------------------------------------ (update 209) product usage ------------------------------------------------ */
/**
 * How each product (or group of products) is used across the players in the rounds (every round must carry
 * whose it is, rd.pk: everyone's rounds pooled). sels: [{ clubs: ["Driver|Callaway Elyte", …] }].
 * A player's model at a tournament is the one they hit the most shots with there (of that kind of club).
 * Returns null when fewer than 3 players are in the rounds.
 */
export function productUsage(rounds, sels) {
  const rs = sgRounds(rounds).filter((rd) => rd.pk);
  if (new Set(rs.map((rd) => rd.pk)).size < 3) return null;
  const kindOf = (v) => (v.startsWith("Ball|") ? "Ball" : v.split("|")[0]);
  const valOf = (s, kind) => (kind === "Ball" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && s.gear.startsWith(`${kind}|`) ? s.gear : null);
  const cache = new Map();
  const byKind = (kind) => {
    if (cache.has(kind)) return cache.get(kind);
    // player → event → { counts: Map(value → shots), date }
    const pe = new Map(), evDate = new Map(), roundsWith = new Map(), prs = new Map(); // prs: player → each round's set of values (update 213)
    for (const rd of rs) {
      const ek = evKey(rd);
      if (!evDate.has(ek) || dk(rd.date) > evDate.get(ek)) evDate.set(ek, dk(rd.date));
      const seen = new Set();
      (prs.get(rd.pk) || prs.set(rd.pk, []).get(rd.pk)).push(seen);
      for (const s of rd.shots) {
        const v = valOf(s, kind); if (!v) continue;
        const p = pe.get(rd.pk) || pe.set(rd.pk, new Map()).get(rd.pk);
        const e = p.get(ek) || p.set(ek, new Map()).get(ek);
        e.set(v, (e.get(v) || 0) + (s.w || 1));
        if (!seen.has(v)) { seen.add(v); roundsWith.set(v, (roundsWith.get(v) || 0) + 1); }
      }
    }
    const main = (counts) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const events = [...new Set([...pe.values()].flatMap((m) => [...m.keys()]))];
    const out = { pe, evDate, events, roundsWith, main, prs };
    cache.set(kind, out);
    return out;
  };
  const pct = (a, b) => (b ? (100 * a) / b : null);
  return sels.map((sel) => {
    const S = new Set(sel.clubs || []);
    if (!S.size) return null;
    const kind = kindOf([...S][0]);
    const { pe, evDate, events, roundsWith, main, prs } = byKind(kind);
    const who = []; // (update 213) each player who used it: { pk, rounds, events, last, still, top }
    let playerEvents = 0, inEvents = 0, users = new Set(), switchIn = 0, switchOut = 0, kept = 0;
    const perEvent = new Map(events.map((e) => [e, 0]));
    const runs = [];
    for (const [pk, evs] of pe) {
      const seq = [...evs].sort((a, b) => (evDate.get(a[0]) || "").localeCompare(evDate.get(b[0]) || ""));
      let run = 0, startedBySwitch = false, prevIn = null, used = false;
      for (const [ek, counts] of seq) {
        const any = [...counts.keys()].some((v) => S.has(v));
        if (any) { used = true; perEvent.set(ek, perEvent.get(ek) + 1); }
        const isIn = S.has(main(counts));
        playerEvents++; if (isIn) inEvents++;
        if (isIn) { if (prevIn === false) { switchIn++; startedBySwitch = true; } run++; }
        else { if (prevIn === true) { switchOut++; runs.push({ n: run, switched: startedBySwitch }); run = 0; startedBySwitch = false; } }
        prevIn = isIn;
      }
      if (run) runs.push({ n: run, switched: startedBySwitch, ongoing: true });
      if (used) {
        users.add(pk);
        const evIn = seq.filter(([, counts]) => [...counts.keys()].some((v) => S.has(v)));
        const tally = new Map(); for (const [, counts] of evIn) for (const [v, n] of counts) if (S.has(v)) tally.set(v, (tally.get(v) || 0) + n);
        who.push({ pk, rounds: (prs.get(pk) || []).filter((set) => [...set].some((v) => S.has(v))).length, events: evIn.length, last: evDate.get(evIn[evIn.length - 1][0]) || "", still: !!prevIn, top: [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || null });
      }
      if (used && prevIn) kept++;
    }
    const sw = runs.filter((r) => r.switched);
    const avg = (xs) => (xs.length ? xs.reduce((a, r) => a + r.n, 0) / xs.length : null);
    return {
      players: users.size,
      perEvent: events.length ? [...perEvent.values()].reduce((a, b) => a + b, 0) / events.length : null,
      share: pct(inEvents, playerEvents),
      rounds: [...S].reduce((a, v) => a + (roundsWith.get(v) || 0), 0),
      switchIn, switchOut,
      stay: avg(sw.length ? sw : runs), staySwitched: sw.length,
      kept: users.size ? pct(kept, users.size) : null,
      events: events.length,
      who: who.sort((a, b) => b.rounds - a.rounds || b.events - a.events),
    };
  });
}
