// (update 815) A player's profile and a course's "what wins", worked out once for the Player Dossier, Course Fit and
// Practice Week pages. Everything follows defs.js (form windows, units, the data's own distance ranges, minimum samples).
//
//   loadField()                    the latest stats file's field (every player's rounds by part of the game) and its id
//   loadShots(key, name)           one player's rounds with every shot (distance, lie, club)
//   profile(rounds, { year, tour, field })
//       { rs, n, ev, tot, cat, ranks, form, ranges, leaks, strengths, gear, tours }
//   courseProfile(meta, rows)      the course's top 10 against the rest, by the data's ranges (a shot), attempts per round
//   fitFor(prof, course, name)     a player's projected strokes gained per round there, and their gap to the top 10
import * as DEF from "./defs.js";
import { expectModel, shotSG } from "./courseExp.js";

export const CATS = ["OTT", "APP", "ARG", "PUTT"];
export const CATN = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
export const yrOf = (r) => String(r.year || String(r.date || "").slice(0, 4));
const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
const avg = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.roundNo).localeCompare(String(b.roundNo));
export const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z\s,]/g, "").split(/[\s,]+/).filter(Boolean).sort().join(" ");

export function eventsOf(rs) {
  const m = new Map(); for (const r of rs) { const k = `${r.event}|${yrOf(r)}`; const e = m.get(k) || m.set(k, { event: r.event, year: yrOf(r), end: r.date, rs: [] }).get(k); e.rs.push(r); if (String(r.date) > String(e.end)) e.end = r.date; }
  return [...m.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
}

/** the latest stats file the person can see: { ds, field: [{ key, name, rounds }] } */
export async function loadField(state) {
  const store = await import("./store.js"), { detectColumns, isShotData, summaryPlayers } = await import("./sg.js");
  const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; try { un = watch(fin); } catch { res([]); } });
  const via = state.profile?.clientKey || Object.keys(state.teamAccess || {})[0];
  const list = state.isAdmin ? await once((cb) => store.watchAdminDatasets(cb)) : via ? await once((cb) => store.watchClientDatasets(via, cb)) : [];
  const ds = (list || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
  const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null;
  return { ds, field: summaryPlayers(summary).filter((p) => p.rounds.length) };
}
const shotMemo = new Map();
/** one player's rounds with every shot (their own stats file), kept for the visit */
export function loadShots(key, name) {
  if (!shotMemo.has(key)) { shotMemo.set(key, import("./reportGen.js").then((m) => m.loadSource("tour", key, name || key, { detail: false, field: false })).then((d) => (d?.me?.rounds || []).filter((r) => r.shots?.length).sort(byDate)).catch(() => []));
    while (shotMemo.size > 14) shotMemo.delete(shotMemo.keys().next().value); }
  return shotMemo.get(key);
}

/** a player's season: totals, tour ranks, form, every distance range, leaks, strengths and the clubs in the bag */
export function profile(rounds, { year, tour = null, field = [], key = null } = {}) {
  const onTour = (r) => !tour || tour === "__all" || (r.tour || "") === tour;
  const all = rounds.filter((r) => onTour(r)).sort(byDate), rs = all.filter((r) => yrOf(r) === String(year) && !r.eventLevel);
  const evs = eventsOf(rs), cat = Object.fromEntries(CATS.map((c) => [c, avg(rs, (r) => inCat(r, c))]));
  // tour ranks: every player with the season's minimum rounds on the tour picked
  const ranks = {}; if (field.length) { const F = field.map((p) => ({ k: p.key, rs: p.rounds.filter((r) => onTour(r) && yrOf(r) === String(year)) })).filter((p) => p.rs.length >= DEF.MIN.seasonRounds);
    for (const c of ["TOTAL", ...CATS]) { const f = c === "TOTAL" ? tot : (r) => inCat(r, c), vs = F.map((p) => [p.k, avg(p.rs, f)]).sort((a, b) => b[1] - a[1]), i = vs.findIndex((x) => x[0] === key); ranks[c] = i < 0 ? null : { r: i + 1, n: vs.length }; } }
  const fs = DEF.formSplit(all.filter((r) => !r.eventLevel || DEF.isDP(r.tour)), tour, eventsOf);
  const form = fs ? { ...fs, a: avg(fs.last, tot), b: avg(fs.prev, tot), cat: Object.fromEntries(CATS.map((c) => [c, { a: avg(fs.last, (r) => inCat(r, c)), b: avg(fs.prev, (r) => inCat(r, c)) }])) } : null;
  // every distance range in the data's own labels: strokes gained per round and a shot, with its shots
  const g = new Map(); for (const r of rs) for (const s of r.shots || []) { if (!s.dist) continue; const k = `${s.cat}|${s.dist}`, o = g.get(k) || g.set(k, { c: s.cat, d: s.dist, sg: 0, n: 0 }).get(k); o.sg += s.sg || 0; o.n += s.w || 1; }
  const ranges = [...g.values()].map((o) => ({ ...o, rd: rs.length ? o.sg / rs.length : 0, shot: o.n ? o.sg / o.n : 0 }));
  const solid = ranges.filter((o) => o.n >= DEF.MIN.rangeShotsSeason && o.c !== "OTT");
  const leaks = [...solid].sort((a, b) => a.rd - b.rd).filter((o) => o.rd < 0), strengths = [...solid].sort((a, b) => b.rd - a.rd).filter((o) => o.rd > 0);
  // the bag: each kind of club's model used most at the latest event, its strokes gained in its part of the game per round
  // (the rounds it was used in), and whether it came in during the last 9 events
  // (update 817) Non-Driver tee shots (a fairway wood or iron off the tee) and the ball too: the ball is judged on every shot
  const KIND_CAT = { Driver: "OTT", "Non-Driver": "OTT", "Fairway Wood": "OTT", Hybrid: "APP", Iron: "APP", Wedge: "ARG", Putter: "PUTT", Ball: null };
  const kindOf = (gr) => String(gr || "").split("|")[0], modelOf = (gr) => String(gr || "").split("|").slice(1).join("|") || String(gr || "");
  const valOf = (s, kind) => (kind === "Ball" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && kindOf(s.gear) === kind ? s.gear : null);
  const gear = []; for (const kind of Object.keys(KIND_CAT)) { const top = evs.map((e) => { const m = new Map(); for (const r of e.rs) for (const s of r.shots || []) { const v = valOf(s, kind); if (v) m.set(v, (m.get(v) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null; });
    let i = top.length - 1; while (i >= 0 && !top[i]) i--; if (i < 0) continue; const cur = top[i]; let j = i; while (j > 0 && (top[j - 1] === cur || !top[j - 1])) j--;
    const uses = (s) => valOf(s, kind) === cur, rds = rs.filter((r) => (r.shots || []).some(uses)), c = KIND_CAT[kind];
    // (update 825) every model of that kind on record (all their rounds on this tour), each by strokes gained per round in its
    // part with it (8+ rounds to be ranked): how many they've tried, and where the one in the bag now ranks among them
    const tried = new Map(); for (const r of rs) { /* (update 826: the season on the page, as everything else here) */ const per = new Map(); for (const sh of r.shots || []) { const v = valOf(sh, kind); if (v) per.set(v, (per.get(v) || 0) + (!c || sh.cat === c ? sh.sg || 0 : 0)); } for (const [v, x] of per) { const o = tried.get(v) || tried.set(v, { sg: 0, n: 0 }).get(v); o.sg += x; o.n++; } }
    const rankable = [...tried].filter(([, o]) => o.n >= 4).map(([v, o]) => [v, o.sg / o.n]).sort((a, b) => b[1] - a[1]), rk = rankable.findIndex(([v]) => v === cur);
    gear.push({ kind, model: modelOf(cur), tried: tried.size, rank: rk >= 0 ? rk + 1 : null, ranked: rankable.length, cat: c || "TOTAL", rd: rds.length ? rds.reduce((t, r) => t + (r.shots || []).reduce((u, s) => u + (uses(s) && (!c || s.cat === c) ? s.sg || 0 : 0), 0), 0) / rds.length : null, n: rds.length, isNew: j > 0 && i - j <= 8, was: j > 0 ? modelOf(top[j - 1]) : null }); }
  const tours = [...new Set(rounds.map((r) => r.tour).filter(Boolean))];
  return { rs, all, n: rs.length, ev: evs.length, evs, tot: avg(rs, tot), cat, ranks, form, ranges, leaks, strengths, gear, tours };
}

/** the course's shots: the top 10 each year against the rest, in the data's own ranges (strokes gained a shot), attempts a
 *  round there, and each player's own (by key and by name); labels: { APP: [[label, [lo, hi]]], … } from the data */
export function courseProfile(meta, rows, labels, clientKey) {
  const num = (v) => (v == null || v === "" ? null : Number(v)), lie = (s) => { s = String(s || "").toLowerCase(); return /green/.test(s) ? "green" : /tee/.test(s) ? "tee" : /fair/.test(s) ? "fairway" : /bunker|sand/.test(s) ? "bunker" : /rough/.test(s) ? "rough" : "other"; };
  const trails = new Map();
  for (const r of rows) { const h = num(r[6]), st = num(r[10]); if (!h || st == null) continue; const idv = r[4] != null && r[4] !== "" ? (Number.isFinite(num(r[4])) ? String(num(r[4])) : String(r[4])) : String(r[3] ?? "");
    const k = `${r[0]}|${idv}|${r[5]}|${h}`; let t = trails.get(k); if (!t) { t = { yr: String(r[0]), who: idv, nm: String(r[3] ?? ""), rd: String(r[5]), h, par: num(r[7]), s: null, qs: [] }; trails.set(k, t); }
    t.qs.push({ st, lie: lie(r[9]), d: num(r[21]) ?? num(r[18]) }); if (num(r[12]) === 1) { const sf = num(r[11]); t.s = sf != null ? Math.round(sf) : t.par ? st - t.par : null; } }
  const T = [...trails.values()].filter((t) => t.s != null); for (const t of T) t.qs.sort((a, b) => a.st - b.st);
  const E = expectModel(T);
  // the top 10 each year: those who played every round, by score
  const tot0 = new Map(); for (const t of T) { const k = `${t.who}|${t.yr}`, o = tot0.get(k) || tot0.set(k, { who: t.who, yr: t.yr, s: 0, rds: new Set(), holes: 0 }).get(k); o.s += t.s; o.rds.add(t.rd); o.holes++; }
  const top = new Set(), byYr = new Map(); for (const o of tot0.values()) (byYr.get(o.yr) || byYr.set(o.yr, []).get(o.yr)).push(o);
  for (const l of byYr.values()) { const mx = Math.max(...l.map((o) => o.rds.size)); l.filter((o) => o.rds.size === mx).sort((a, b) => a.s - b.s).slice(0, 10).forEach((o) => top.add(`${o.who}|${o.yr}`)); }
  const catOf = (q, par) => (q.lie === "green" ? "PUTT" : q.st === 1 && (par || 4) >= 4 ? "OTT" : q.d != null && q.d <= 30 ? "ARG" : "APP");
  const rangeOf = (c, d) => (labels[c] ? DEF.rangeFor(labels[c], d) : null);
  const acc = new Map(), rdAll = new Set(), per = new Map(), cat = { top: {}, rest: {} }, rdT = { top: new Set(), rest: new Set() };
  const get = (k) => acc.get(k) || acc.set(k, { t: [0, 0], r: [0, 0], n: 0 }).get(k);
  for (const t of T) { const isTop = top.has(`${t.who}|${t.yr}`), grp = isTop ? "top" : "rest", rk = `${t.who}|${t.yr}|${t.rd}`; rdAll.add(rk); rdT[grp].add(rk);
    const pk = clientKey ? clientKey(t.who) : t.who, P = per.get(pk) || per.set(pk, { nm: t.nm, rds: new Set(), r: new Map(), cat: {} }).get(pk); P.rds.add(`${t.yr}|${t.rd}`);
    const sg = shotSG(t, E); t.qs.forEach((q, i) => { if (sg[i] == null) return; const c = catOf(q, t.par), o2 = cat[grp][c] || (cat[grp][c] = [0, 0]); o2[0] += sg[i]; o2[1]++; const pc = P.cat[c] || (P.cat[c] = [0, 0]); pc[0] += sg[i]; pc[1]++;
      if (c === "OTT" || q.d == null) return; const l = rangeOf(c, q.d); if (!l) return; const k = `${c}|${l}`, o = get(k); o.n++; o[isTop ? "t" : "r"][0] += sg[i]; o[isTop ? "t" : "r"][1]++; const pr = P.r.get(k) || P.r.set(k, [0, 0]).get(k); pr[0] += sg[i]; pr[1]++; }); }
  const ranges = [...acc].filter(([, o]) => o.n >= DEF.MIN.courseRangeShots).map(([k, o]) => { const [c, l] = k.split("|"); const tS = o.t[1] >= DEF.MIN.courseTopShots ? o.t[0] / o.t[1] : null, rS = o.r[1] ? o.r[0] / o.r[1] : null, att = o.n / Math.max(1, rdAll.size);
    return { k, c, l, top: tS, rest: rS, att, edge: tS != null && rS != null ? (tS - rS) * att : null }; });
  const edgeSum = ranges.reduce((t, x) => t + Math.max(0, x.edge || 0), 0);
  for (const x of ranges) x.share = edgeSum > 0 ? Math.max(0, x.edge || 0) / edgeSum : 0;
  const catShot = (g) => Object.fromEntries(CATS.map((c) => [c, cat[g][c] ? cat[g][c][0] / cat[g][c][1] : null]));
  const byName = new Map([...per.values()].map((P) => [nameKey(P.nm), P]));
  const yrs = [...new Set(T.map((t) => t.yr))].sort();
  return { meta, ranges: ranges.sort((a, b) => (b.edge || 0) - (a.edge || 0)), shotTop: catShot("top"), shotRest: catShot("rest"), per, byName, nRds: rdAll.size, yrs, ott: { top: cat.top.OTT ? cat.top.OTT[0] / Math.max(1, rdT.top.size) : null } };
}

/** a player's fit at the course: projected strokes gained per round against the field there (their season a shot in each of
 *  the course's ranges × how often that range comes up there, plus their driving), the key ranges against the top 10, and
 *  their own rounds there */
export function fitFor(prof, course, key, name) {
  const mine = new Map(prof.ranges.map((o) => [`${o.c}|${o.d}`, o]));
  // (each part of the game keeps the player's own shots per round; only the mix of distances is the course's: their season,
  //  reweighted to how often each range comes up here, so a course whose data counts shots differently can't inflate it)
  let proj = 0, covered = 0, wSum = 0;
  for (const c of ["APP", "ARG", "PUTT"]) { const cr = course.ranges.filter((x) => x.c === c), mineC = prof.ranges.filter((o) => o.c === c), perRd = mineC.reduce((t, o) => t + o.n, 0) / Math.max(1, prof.n);
    const ok = cr.filter((x) => (mine.get(x.k)?.n || 0) >= DEF.MIN.rangeShotsForm), all = cr.reduce((t, x) => t + x.att, 0), okA = ok.reduce((t, x) => t + x.att, 0); wSum += all; covered += okA;
    if (okA > 0) proj += perRd * ok.reduce((t, x) => t + (x.att / okA) * mine.get(x.k).shot, 0); else proj += prof.cat[c] ?? 0; }
  const ott = prof.cat.OTT ?? 0; proj += ott;
  const key3 = course.ranges.filter((x) => x.share > 0).slice(0, 3).map((x) => { const m = mine.get(x.k); return { ...x, me: m && m.n >= DEF.MIN.rangeShotsForm ? m.shot : null, meN: m?.n || 0 }; });
  const here = course.per.get(key) || course.byName.get(nameKey(name));
  return { proj, vsSeason: prof.tot != null ? proj - prof.tot : null, coverage: wSum ? covered / wSum : 0, key3, hereRds: here ? here.rds.size : 0, hereShot: here ? Object.fromEntries(CATS.map((c) => [c, here.cat[c] ? here.cat[c][0] / here.cat[c][1] : null])) : null };
}

/** the data's own ranges for each part of the game, from any players' rounds with shots */
export const labelsFrom = (roundLists) => Object.fromEntries(["APP", "ARG", "PUTT"].map((c) => [c, DEF.dataRanges(c, roundLists)]));

/** the next event's course (for now the one Home names; the schedule will come later): a course with shots on record */
export const NEXT = { name: "The American Express", re: /american express|amex\b/i, course: /pete dye stadium|pga west|la quinta/i, not: /sawgrass|tpc/i };
export const nextCourse = (list) => (list || []).filter((c) => c.rawChunks).find((c) => (c.events || []).some((e) => NEXT.re.test(e.name)) && !NEXT.not.test(c.name)) || (list || []).filter((c) => c.rawChunks).find((c) => NEXT.course.test(c.name)) || null;
const courseMemo = new Map();
/** a course's profile in the data's ranges (kept for the visit) */
export async function loadCourse(meta, labelRounds) {
  const k = `${meta.id}|${meta.rawAt?.toMillis?.() ?? meta.rawAt ?? ""}`; if (courseMemo.has(k)) return courseMemo.get(k);
  const p = (async () => { const [{ loadRaw }, { clientKey }] = await Promise.all([import("./courseRaw.js"), import("./data.js")]); const rows = await loadRaw(meta); if (!rows?.length) return null;
    return courseProfile(meta, rows, labelsFrom(labelRounds), clientKey); })();
  courseMemo.set(k, p); p.catch(() => courseMemo.delete(k)); return p;
}

// (update 819) Course Fit's room to gain, (update 820) shared with Recommended Practice
export const evName = (e) => String(e || "").replace(/\s+\d{4}$/, "").trim();

/** every tournament on a tour: { name, yrs, n (player-weeks), perYr, small, sd {cat}, room {cat: × usual, shrunk} } */
const SHRINK = 60; // player-weeks at which a tournament's own spread counts half (and the tour's usual, half)
export function eventRoom(field, tour) {
  const by = new Map(); // event → year|player → rounds
  for (const p of field) for (const r of p.rounds) { if (tour && r.tour !== tour) continue; const e = evName(r.event); if (!e) continue;
    const m = by.get(e) || by.set(e, new Map()).get(e), k = `${yrOf(r)}|${p.key}`; (m.get(k) || m.set(k, []).get(k)).push(r); }
  const evs = [];
  for (const [name, m] of by) {
    const weeks = [...m].map(([k, rs]) => ({ yr: k.split("|")[0], v: Object.fromEntries(CATS.map((c) => [c, rs.reduce((t, r) => t + inCat(r, c), 0) / rs.length])) }));
    if (weeks.length < 20) continue; // too few on record
    const yrs = [...new Set(weeks.map((w) => w.yr))].sort();
    // the spread within each year (a year's conditions shift everyone alike), pooled over the years
    const sd = Object.fromEntries(CATS.map((c) => { let ss = 0, df = 0; for (const y of yrs) { const xs = weeks.filter((w) => w.yr === y).map((w) => w.v[c]); if (xs.length < 3) continue; const mu = xs.reduce((t, x) => t + x, 0) / xs.length; ss += xs.reduce((t, x) => t + (x - mu) ** 2, 0); df += xs.length - 1; } return [c, df > 0 ? Math.sqrt(ss / df) : null]; }));
    if (CATS.some((c) => sd[c] == null)) continue;
    evs.push({ name, yrs, n: weeks.length, perYr: weeks.length / yrs.length, sd });
  }
  // the tour's usual spread in each part: every tournament's, weighted by its player-weeks
  const usual = Object.fromEntries(CATS.map((c) => { const w = evs.reduce((t, e) => t + e.n, 0); return [c, w ? Math.sqrt(evs.reduce((t, e) => t + e.n * e.sd[c] ** 2, 0) / w) : null]; }));
  const mid = [...evs.map((e) => e.perYr)].sort((a, b) => a - b)[Math.floor(evs.length / 2)] || 0; // (a small field: well under the tour's usual field in the file)
  for (const e of evs) { const k = e.n / (e.n + SHRINK); e.small = e.perYr < 0.6 * mid;
    e.raw = Object.fromEntries(CATS.map((c) => [c, usual[c] ? e.sd[c] / usual[c] : 1]));
    e.room = Object.fromEntries(CATS.map((c) => [c, Math.min(1.8, Math.max(0.5, 1 + (e.raw[c] - 1) * k))])); }
  return { evs, usual, mid };
}


/** (update 820) a player's weeks at one tournament, every year in the stats file: { yr, course, rounds, sg (per round), cat {c: per round},
 *  pos (their place in that week's field by strokes gained, ties shared), of (the field in the file), cut (2 rounds or fewer while others played 4) } */
export function eventHistory(field, key, name, tour) {
  const weeks = new Map(); // year → [{ key, rs }]
  for (const p of field) for (const r of p.rounds) { if (tour && r.tour !== tour) continue; if (evName(r.event) !== name) continue;
    const y = yrOf(r), m = weeks.get(y) || weeks.set(y, new Map()).get(y); (m.get(p.key) || m.set(p.key, []).get(p.key)).push(r); }
  const out = [];
  for (const [yr, m] of weeks) { const mine = m.get(key); if (!mine) continue;
    const all = [...m].map(([k, rs]) => ({ k, sum: rs.reduce((t, r) => t + tot(r), 0), n: rs.length })), most = Math.max(...all.map((x) => x.n));
    // full weeks first (everyone who played every round), by strokes gained; then the rest
    all.sort((a, b) => (b.n === most) - (a.n === most) || b.sum - a.sum); const i = all.findIndex((x) => x.k === key), me = all[i];
    const pos = me.n === most ? 1 + all.filter((x) => x.n === most && x.sum > me.sum + 1e-9).length : null;
    const tied = me.n === most && all.filter((x) => x.n === most && Math.abs(x.sum - me.sum) < 1e-9).length > 1;
    out.push({ yr, course: mine.find((r) => r.course)?.course || null, rounds: mine.length, sg: me.sum / mine.length, cat: Object.fromEntries(CATS.map((c) => [c, mine.reduce((t, r) => t + inCat(r, c), 0) / mine.length])),
      pos, tied, of: all.length, cut: me.n < most && most >= 3, eventLevel: mine.some((r) => r.eventLevel),
      // (update 834) everyone that week by strokes gained per round, for a player with fewer rounds (no official place)
      sgPos: 1 + all.filter((x) => x.sum / x.n > me.sum / me.n + 1e-9).length, sgTied: all.filter((x) => Math.abs(x.sum / x.n - me.sum / me.n) < 1e-9).length > 1 }); }
  return out.sort((a, b) => b.yr.localeCompare(a.yr));
}


// (update 823) The next event: the schedule (the live feed saves it: PGA Tour R and Korn Ferry H, this year and next; the
// DP World Tour has none yet), the next one not finished on the player's tour unless another was picked (kept for the player
// on this device, shared by Overview's Next Event Fit and Recommended Practice). A schedule name matched to the stats file's.
const normEv = (n) => String(n || "").toLowerCase().replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/, "").replace(/^the\s+/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function matchEventName(name, names) {
  const a = normEv(name); if (!a) return null; if (/masters/.test(a)) return names.find((n) => /masters/i.test(n)) || null;
  const exact = names.find((n) => normEv(n) === a); if (exact) return exact;
  const toks = (s) => new Set(s.split(" ").filter((w) => w.length > 2)), A = toks(a);
  let best = null, bs = 0; for (const n of names) { const B = toks(normEv(n)); const inter = [...A].filter((w) => B.has(w)).length, j = inter / Math.max(1, new Set([...A, ...B]).size); if (j > bs) { bs = j; best = n; } }
  return bs >= 0.5 ? best : null;
}
const tourCode = (tour) => (/korn|kft|^h$/i.test(String(tour || "")) ? "H" : /dp|euro|dpwt/i.test(String(tour || "")) ? null : "R");
let schedP = null;
export function loadSchedule() { return (schedP ||= import("./liveData.js").then((m) => m.liveFile("schedule.json")).catch(() => null)); }
/** { list: upcoming events on the player's tour [{ name, start, end, course }], fromSchedule } */
export async function upcomingFor(tour) {
  const code = tourCode(tour), S = code ? await loadSchedule() : null, today = new Date().toISOString().slice(0, 10);
  const list = (S?.tours?.[code] || []).filter((e) => !e.end || e.end >= today);
  return { list, fromSchedule: !!list.length };
}
export const nextKey = (key) => `ta.nextEvent|${key}`;
export function pickedNext(key) { try { return localStorage.getItem(nextKey(key)); } catch { return null; } }
export function setPickedNext(key, name) { try { if (name) localStorage.setItem(nextKey(key), name); else localStorage.removeItem(nextKey(key)); } catch { /* */ } }
/** the event a player is preparing for: { name, start, course, upcoming[] } (the picked one, else the next on the schedule) */
export async function nextEventFor(key, tour, fallbackNames = [], playerName = null) {
  const { list } = await upcomingFor(tour), picked = pickedNext(key);
  const fromList = (n) => list.find((e) => e.name === n);
  if (picked) return { name: picked, start: fromList(picked)?.start || null, course: fromList(picked)?.course || null, upcoming: list };
  // (update 824) the next event they're entered in, when the fields know
  if (playerName && tourCode(tour)) { await ensureFields(); const mine = fieldEventsSync(playerName, tourCode(tour)) || []; const e = mine[0]; if (e) return { name: e.name, start: e.start, course: e.course, upcoming: list, entered: true }; }
  if (list[0]) return { name: list[0].name, start: list[0].start, course: list[0].course, upcoming: list };
  const n = fallbackNames.find((x) => NEXT.re.test(x)) || fallbackNames[0] || null; // (no schedule: the old default)
  return { name: n, start: null, course: null, upcoming: list };
}
/** a Strategy Maps course for an event (by the event's name, or its course's), with shots on record */
export function heatCourseFor(list, ev) {
  const raw = (list || []).filter((c) => c.rawChunks); if (!ev?.name) return null;
  const n = normEv(ev.name);
  return raw.find((c) => (c.events || []).some((e) => normEv(e.name) === n || (/masters/.test(n) && /masters/i.test(e.name)))) || (ev.course ? raw.find((c) => normEv(c.name).includes(normEv(ev.course).split(" ").slice(0, 2).join(" "))) : null) || null;
}

// (update 824) What the live feed also saves from the PGA Tour API: official results (results/{R|H}-{year}.json), who's
// entered in the coming events (fields.json) and player bios (bios.json). Players are matched by name (the API's ids
// aren't the portal's keys). Read once a visit; the sync getters answer null until a file is in.
const liveJson = new Map();
const live = (rel) => liveJson.get(rel) || liveJson.set(rel, import("./liveData.js").then((m) => m.liveFile(rel)).catch(() => null)).get(rel);
const done = new Map(); const got = (rel) => done.get(rel);
const loadInto = (rel) => live(rel).then((v) => { done.set(rel, v || null); return v; });
export const tourCodeOf = (tour) => tourCode(tour);
export function ensureResults(code, years) { return Promise.all([...new Set(years)].map((y) => loadInto(`results/${code}-${y}.json`))); }
export const ensureFields = () => loadInto("fields.json");
export const ensureBios = () => loadInto("bios.json");
/** official { pos, total, name } for a player at an event in a year, or null (not loaded, not in the file, not found) */
export function officialSync(eventName, year, playerName, code) {
  const R = got(`results/${code}-${year}.json`); if (!R?.events) return null;
  const evs = Object.values(R.events), nm = matchEventName(eventName, evs.map((e) => e.name)); if (!nm) return null;
  // (update 825) by the PGA Tour id when the player's label carries one ("Name (12345)"), else by name
  const pid = (/\((\d+)\)\s*$/.exec(String(playerName || "")) || [])[1], e = evs.find((x) => x.name === nm), k = nameKey(String(playerName || "").replace(/\s*\([^)]*\)\s*$/, ""));
  const row = (pid && e?.rows?.find((r) => String(r.pid) === pid)) || e?.rows?.find((r) => nameKey(r.name) === k);
  return row ? { pos: row.pos, total: row.total, event: e.name, of: e.rows.length } : { pos: null, event: e.name, missing: true };
}
/** the coming events a player is entered in: [{ name, start, end, course }] (sorted), or null when the fields aren't in */
export function fieldEventsSync(playerName, code) {
  const F = got("fields.json"); if (!F?.tours) return null; const k = nameKey(playerName);
  return Object.values(F.tours[code] || {}).filter((e) => (e.players || []).some((p) => nameKey(p.name) === k)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
export function fieldListedSync(eventName, code) { const F = got("fields.json"); if (!F?.tours) return null; const evs = Object.values(F.tours[code] || {}); const nm = matchEventName(eventName, evs.map((e) => e.name)); return nm ? evs.find((e) => e.name === nm) : null; }
export function bioSync(playerName) { const B = got("bios.json"); if (!B?.players) return null; const k = nameKey(playerName); return Object.values(B.players).find((b) => nameKey(b.name) === k) || null; }
/** the position for show: "T5", "1" → "Won", "CUT"/"MC" → "Missed cut", "WD" … */
export function posText(pos) { const p = String(pos || "").toUpperCase().trim(); if (!p) return null; if (p === "1") return "Won"; if (/^(CUT|MC)$/.test(p)) return "Missed cut"; if (/^W\/?D$/.test(p)) return "Withdrew"; if (/^DQ$/.test(p)) return "DQ"; return p; }
/** (update 834) is this the signed-in person themself (a player's own pages, or "Me" picked)? Then pages say "you" and "your" */
export function isSelfKey(key) { const st = (typeof window !== "undefined" && window.__authState) || {}; if (!key) return false; const own = st.profile?.clientKey, me = st.isAdmin && !own ? `a_${st.user?.uid}` : own; return key === me; }
