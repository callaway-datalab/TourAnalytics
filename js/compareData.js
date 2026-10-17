// Comparisons (update 188): one player's rounds, cut into selections (seasons, time windows, tournaments,
// courses, round numbers, months, or any mix) and compared side by side. Everything here is plain numbers, so
// the page (views/comparisons.js) only draws.
//   A selection: { id, name, color, kind, value, f } where f is a filter (see roundsFor).
import { CATEGORIES, statRounds, statAgg, statsIn, statDef, distLead, STAT_DEFS } from "./sg.js";

export const COLORS = ["#d4b483", "#4fd1c5", "#a78bfa", "#ff7a6b", "#5ab0ff", "#a3e635", "#f472b6", "#fbbf24"];
export const MAX_SEL = 8;
export const SG_ROWS = [["TOTAL", "Overall"], ...CATEGORIES, ["T2G", "Tee to Green"]];
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
  // time windows: the latest N rounds, and the season, last season and everything
  const windows = [
    ...[5, 10, 20, 40, 80].filter((n) => n < total).map((n) => ({ value: `last:${n}`, label: `Last ${n} rounds`, n })),
    ...[5, 10, 20, 40].filter((n) => n * 2 <= total).map((n) => ({ value: `prev:${n}`, label: `The ${n} before that`, n })),
    season ? { value: `year:${season}`, label: `This season (${season})`, n: years[0].n } : null,
    years[1] ? { value: `year:${years[1].value}`, label: `Last season (${years[1].value})`, n: years[1].n } : null,
    { value: "all", label: "Career (everything)", n: total },
  ].filter(Boolean);
  return { total, years, tournaments, courses, rounds: rounds_, months, tours, windows };
}

/** The rounds in a selection, oldest first. f: { years, events, courses, roundNos, months, tours, from, to, last, prev, all } */
/** (update 190) "This season" / "Last season" for whoever's rounds these are (players have different latest seasons). */
const withSeason = (rounds, f) => { if (!f?.season) return f; const ys = [...new Set(sgRounds(rounds).map(yearOf))].sort().reverse(); const y = ys[f.season === "last" ? 1 : 0]; return { ...f, season: null, years: [y || "none"] }; };
export function roundsFor(rounds, f = {}) {
  f = withSeason(rounds, f);
  // (update 190) a product: the rounds it was used in, and only its shots (so the numbers are that club's)
  // (update 191) a pick is a club model ("Iron|Callaway Apex") or a ball ("Ball|Callaway Chrome Tour")
  if (f.clubs) { const cs = new Set(f.clubs); return roundsFor(rounds, { ...f, clubs: null }).map((rd) => ({ ...rd, shots: rd.shots.filter((x) => gearMatch(x, cs)) })).filter((rd) => rd.shots.length); }
  // (update 189) several picks together: every round in any of them, once each, oldest first
  if (f.any) { const seen = new Set(), out = []; for (const g of f.any) for (const rd of roundsFor(rounds, g)) if (!seen.has(rd.key || rd)) { seen.add(rd.key || rd); out.push(rd); } return out.sort(byDate); }
  let rs = sgRounds(rounds);
  if (f.last) return rs.slice(-f.last);
  if (f.prev) return rs.slice(-2 * f.prev, -f.prev);
  const set = (v) => (v && v.length ? new Set(v.map(String)) : null);
  const years = set(f.years), events = set(f.events), courses = set(f.courses), rnds = set(f.roundNos), months = set(f.months), tours = set(f.tours);
  rs = rs.filter((rd) => (!years || years.has(yearOf(rd))) && (!events || events.has(evKey(rd))) && (!courses || courses.has(rd.course || ""))
    && (!rnds || rnds.has(String(rd.roundNo || ""))) && (!months || months.has(String(monthOf(rd)))) && (!tours || tours.has(rd.tour || ""))
    && (!f.from || dk(rd.date) >= f.from) && (!f.to || dk(rd.date) <= f.to));
  return rs;
}
const gearMatch = (x, cs) => cs.has(x.gear) || (x.ball && cs.has(`Ball|${x.ball}`));

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
export const windowFilter = (v) => (v === "all" ? {} : v.startsWith("last:") ? { last: Number(v.slice(5)) } : v.startsWith("prev:") ? { prev: Number(v.slice(5)) } : v.startsWith("year:") ? { years: [v.slice(5)] } : {});

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
    if (f.clubs) { // (update 194) a product: only the stats recorded with it
      const cs = new Set(f.clubs);
      return one({ ...f, clubs: null }).map((rd) => { const obs = (rd.obs || []).filter((o) => gearMatch(o, cs)); return { ...rd, obs, has: new Set(obs.map((o) => o.k)), shots: [] }; }).filter((rd) => rd.obs.length);
    }
    if (f.any) { const seen = new Set(); return f.any.flatMap((g) => one(g)).filter((rd) => (seen.has(rd) ? false : (seen.add(rd), true))); } // (update 189)
    if (f.last || f.prev) { const sg = roundsFor(rounds, f); const keys = new Set(sg.map(evKey)); const dates = new Set(sg.map((rd) => dk(rd.date))); return all.filter((rd) => keys.has(evKey(rd)) && (dates.has(dk(rd.date)) || rd.eventLevel)); }
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
const HOME = { drive: ["OTT"], fwy: ["OTT"], gir: ["OTT", "APP"], hitGreen: ["APP"], prox: ["APP"], pinHigh: ["APP"], onLine: ["APP"], ud: ["ARG"], scramble: ["ARG"], putts: ["PUTT"], make: ["PUTT"], goodLag: ["PUTT"], threePutt: ["PUTT"] };
export function statBlocks(obsSets, inc = null) {
  const SECTIONS = [...CATEGORIES, ["ROUND", "Scoring"]];
  const cell = (list) => { let s = 0, w = 0; for (const o of list) { s += o.v * o.w; w += o.w; } return w ? { v: s / w, w } : null; };
  const homeOf = (o) => (o.cat ? [o.cat] : HOME[o.k] || ["ROUND"]);
  const by = new Map(); // section → key → [obs per selection]
  obsSets.forEach((rs, i) => {
    for (const rd of rs) for (const o of rd.obs || []) {
      if (o.k === "sg" || o.v == null || !Number.isFinite(o.v)) continue;
      for (const sec of homeOf(o)) {
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
      const def = statDef(k);
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
  // (update 199) plain words: who's best, by how much, and whether to trust it
  const gap = best.s.sg.TOTAL - worst.s.sg.TOTAL;
  const sure = { clear: "That\u2019s a clear difference.", likely: "Probably a real difference.", possible: "It could be chance.", "too close to call": "Too close to call.", "too few rounds": "Too few rounds to be sure." }[c.word] || "";
  out.push({ tone: "gold", text: gap < 0.05 ? `${best.name} and ${worst.name} are about the same.` : `${best.name} is best: ${words(gap)} better than ${worst.name}. ${sure}` });
  // (update 194) with three or more: every one in order
  if (byTot.length >= 3) out.push({ tone: "", text: `In order: ${byTot.map((x, i) => `${i + 1}. ${x.name} (${fmt(x.s.sg.TOTAL)})`).join(", ")}.` });
  // where the gap comes from (best vs worst)
  const usedCats = CATEGORIES.filter(([k]) => ok.some((x) => Math.abs(x.s.sg[k] || 0) >= 0.005));
  const parts = usedCats.map(([k, l]) => ({ l, d: best.s.sg[k] - worst.s.sg[k] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (usedCats.length > 1 && parts[0] && Math.abs(parts[0].d) >= 0.1) out.push({ tone: "", text: `Most of the difference is ${parts[0].l} (${words(Math.abs(parts[0].d))})${parts[1] && Math.abs(parts[1].d) >= 0.1 ? `, then ${parts[1].l}` : ""}.` });
  // each category's leader
  for (const [k, l] of usedCats.length > 1 ? usedCats : []) {
    const lead = [...ok].sort((a, b) => b.s.sg[k] - a.s.sg[k]);
    if (lead.length > 2 && lead[0] !== best && lead[0].s.sg[k] - lead[1].s.sg[k] >= 0.2) out.push({ tone: "", text: `${l} was best in ${lead[0].name}.` });
  }
  // steadiness
  const st = ok.filter((x) => x.s.sd != null).sort((a, b) => a.s.sd - b.s.sd);
  if (st.length >= 2 && st.at(-1).s.sd - st[0].s.sd >= 0.4) out.push({ tone: "", text: `Most consistent: ${st[0].name}. Most up and down: ${st.at(-1).name}.` });
  // small samples
  const small = ok.filter((x) => x.s.n < 8);
  if (small.length) out.push({ tone: "muted", text: `${small.map((x) => x.name).join(", ")} ${small.length === 1 ? "has" : "have"} fewer than 8 rounds, so treat ${small.length === 1 ? "it" : "them"} as a hint, not a verdict.` });
  return out;
}
const words = (v) => { const a = Math.abs(v).toFixed(1); return `${a} stroke${a === "1.0" ? "" : "s"} a round`; };
export { fmt as fmtSigned, MONTHS };
