// (update 890) Scouting model: what other sports' best scouting tools do, on the stats file's seasons.
//  • Comps (Baseball Prospectus' PECOTA, FiveThirtyEight's CARMELO): every player-season is a profile (strokes gained per
//    round and in each part of the game, the change from the season before, age when known, seasons on the tour, rounds);
//    each part standardised across every player-season, and the nearest past profiles found by weighted distance.
//    Similarity as CARMELO shows it: 100 the same, 0 as different as a typical pair, below 0 less alike than that.
//  • Tier odds, two ways, then blended:
//    – the comps' cohort (hockey's Prospect Cohort Success): of the 25 most similar past player-seasons, weighted by
//      similarity, the share whose next season reached each tier (year-end rank in the top 10, 25, 50, 125);
//    – a projection (regression to the mean as Data Golf and the projection systems do it): next season's strokes gained per
//      round from this season's (shrunk toward average by the rounds behind it) and the change from the season before,
//      fitted on every past season-to-season pair in the file, with the spread of what actually happened around it; the odds
//      are the chance that spread puts the player above each tier's usual strokes-gained line.
//    The cohort counts for more when its comps are close and many (up to half).
//  • Ratings 0-100 (update 899): the percentile, the share of the tour's ranked players the number beats (50 the middle player, 99 the best).
//    Now: this season, shrunk by its rounds. Ceiling: the projection's 80th percentile (a good outcome, not a dream).
//    Tool grades for each part of the game, the same way.
//  • Fast risers: the rolling 24-round strokes gained now against a year ago; "clear" when the rise is bigger than the
//    round-to-round noise allows (about 95% one-sided).
//  • Before the breakout: the past seasons most like this one that came the year before a top-10 season (not already top 10).
import * as PI from "./playerInsights.js";

const CATS = PI.CATS, SHRINK = 20; // (rounds of average a season is pulled toward: a 20-round season counts for half)
export const TIERS = [10, 25, 50, 125];
const W = { sg: 3, OTT: 1, APP: 1, ARG: 1, PUTT: 1, d: 1.2, age: 1.5, yrs: 0.6, n: 0.3 };
const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) || 1; };
export const grade = (z) => Math.max(20, Math.min(80, Math.round((50 + 10 * z) / 5) * 5)); // (the old 20-80 scale; no longer used)
export const rating = (p) => Math.max(1, Math.min(99, Math.round(p * 100))); // (update 899) 0-100: the percentile

/** B: the Scouting page's build for a tour ({ P, years, season, rows, lastY }) */
export function scoutModel(B) {
  const { P, years, season } = B, lastY = years.at(-1);
  // every player-season's profile
  const ps = []; const byKey = new Map();
  for (const p of P) { let seen = 0, prev = null; const birth = p.birth ? Date.parse(p.birth) : null;
    for (const y of years) { const o = season[y]?.by.get(p.k); if (!o) { prev = null; continue; } seen++;
      const age = birth ? (Date.parse(`${y}-07-01`) - birth) / (365.25 * 864e5) : null;
      const x = { k: p.k, nm: p.nm, y, n: o.n, sg: o.sg, rank: o.rank, of: season[y].of, ...Object.fromEntries(CATS.map((c) => [c, o.cat[c]])), d: prev ? o.sg - prev.sg : null, age: Number.isFinite(age) ? age : null, yrs: seen, partial: y === lastY };
      ps.push(x); (byKey.get(p.k) || byKey.set(p.k, []).get(p.k)).push(x); prev = o; } }
  // each one's next season (what happened), and the tiers' usual strokes-gained lines (the k-th best, averaged over full seasons)
  for (const list of byKey.values()) list.forEach((x, i) => { const nx = list[i + 1]; x.next = nx && Number(nx.y) === Number(x.y) + 1 ? nx : null; });
  const full = years.filter((y) => y !== lastY || years.length === 1), tierLine = {};
  for (const t of TIERS) { const vs = full.map((y) => { const l = [...season[y].by.values()].sort((a, b) => b.sg - a.sg); return l.length >= t ? l[t - 1].sg : null; }).filter((v) => v != null); tierLine[t] = vs.length ? mean(vs) : null; }
  const fieldN = Math.round(mean(full.map((y) => season[y].of))) || 0, tiers = TIERS.filter((t) => t < fieldN * 0.8);
  // standardise each part across every player-season
  const keys = ["sg", ...CATS, "d", "age", "yrs", "n"], st = {};
  for (const k of keys) { const vs = ps.map((x) => x[k]).filter((v) => v != null && Number.isFinite(v)); st[k] = { m: mean(vs), s: sd(vs) }; }
  const z = (x, k) => (x[k] == null ? null : (x[k] - st[k].m) / st[k].s);
  for (const x of ps) x.z = Object.fromEntries(keys.map((k) => [k, z(x, k)]));
  const dist = (a, b) => { let s = 0, w = 0; for (const k of keys) { const u = a.z[k], v = b.z[k]; if (u == null || v == null) continue; s += W[k] * (u - v) ** 2; w += W[k]; } return w ? Math.sqrt(s / w) : 9; };
  // a typical pair's distance: similarity 0
  const pool = ps.filter((x) => x.next); let dRef = 1; { const ds = []; for (let i = 0; i < Math.min(400, ps.length); i++) { const a = ps[(i * 7919) % ps.length], b = ps[(i * 104729 + 13) % ps.length]; if (a !== b) ds.push(dist(a, b)); } ds.sort((a, b) => a - b); dRef = ds[Math.floor(ds.length / 2)] || 1; }
  const simOf = (d) => Math.round(100 * (1 - d / dRef));
  // the projection: next season's strokes gained from this season's (shrunk) and its change, fitted on every past pair
  const shr = (x) => x.sg * x.n / (x.n + SHRINK);
  const pairs = pool.filter((x) => !x.next.partial || x.next.n >= 12);
  let fit = { a: 0, b: 0.65, c: 0.05, s: 0.55, n: pairs.length, fallback: true };
  if (pairs.length >= 30) { // least squares on [1, shrunk sg, change (0 when none)]
    const X = pairs.map((x) => [1, shr(x), x.d ?? 0]), Y = pairs.map((x) => x.next.sg), A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    X.forEach((r, i) => { for (let a = 0; a < 3; a++) { v[a] += r[a] * Y[i]; for (let b = 0; b < 3; b++) A[a][b] += r[a] * r[b]; } });
    A[1][1] += 1e-3 * pairs.length; A[2][2] += 1e-3 * pairs.length; // (a touch of ridge: a column with nothing in it (no change from a season before yet) still solves)
    const sol = solve3(A, v); if (sol) { const res = X.map((r, i) => Y[i] - (sol[0] + sol[1] * r[1] + sol[2] * r[2])); fit = { a: sol[0], b: sol[1], c: sol[2], s: Math.max(0.2, sd(res)), n: pairs.length, fallback: false }; } }
  const project = (x) => fit.a + fit.b * shr(x) + fit.c * (x.d ?? 0);
  // grades: each part's spread over every player-season
  // (update 894) grades from where the number would rank: its percentile among the latest full season's ranked players
  // (that season's every player with the minimum rounds), turned into the 20-80 scale (50 the middle player; 60 about
  // the top 16%, 70 the top 2%, 80 the very top), so a grade and a rank always agree
  const refY = full.at(-1) || lastY, ref = [...season[refY].by.values()], refOf = { sg: ref.map((o) => o.sg).sort((a, b) => a - b), ...Object.fromEntries(CATS.map((c) => [c, ref.map((o) => o.cat[c]).sort((a, b) => a - b)])) };
  const pctOf = (v, k) => { const a = refOf[k]; if (!a.length) return 0.5; let lo = 0; while (lo < a.length && a[lo] < v) lo++; let hi = lo; while (hi < a.length && a[hi] === v) hi++; return Math.min(0.995, Math.max(0.005, (lo + (hi - lo) / 2) / a.length)); };
  const gradeOf = (v, k) => rating(pctOf(v, k)); // (update 899: 0-100, the percentile; was the 20-80 scale)
  const rankLike = (v, k = "sg") => Math.max(1, Math.round((1 - pctOf(v, k)) * refOf[k].length) + 1); // (the rank that number would have had in the latest full season)
  const memo = new Map();
  function scout(k) {
    if (memo.has(k)) return memo.get(k);
    const mine = byKey.get(k) || [], cur = mine.at(-1); if (!cur) { memo.set(k, null); return null; }
    const cands = pool.filter((x) => x.k !== k).map((x) => ({ x, d: dist(cur, x) })).sort((a, b) => a.d - b.d);
    const comps = cands.slice(0, 25).map((c) => ({ ...c, sim: simOf(c.d), w: Math.max(0.05, 1 - c.d / (dRef * 1.25)) }));
    const wSum = comps.reduce((t, c) => t + c.w, 0), effN = wSum ? wSum ** 2 / comps.reduce((t, c) => t + c.w ** 2, 0) : 0;
    const proj = project(cur), wC = Math.min(0.5, effN / 40) * (comps.length ? 1 : 0);
    const odds = Object.fromEntries(tiers.map((t) => { const line = tierLine[t];
      const model = line == null ? null : 1 - Phi((line - proj) / fit.s), cohort = wSum ? comps.reduce((s, c) => s + (c.x.next.rank <= t ? c.w : 0), 0) / wSum : null;
      const p = model == null ? cohort : cohort == null ? model : wC * cohort + (1 - wC) * model; return [t, { p, model, cohort }]; }));
    const grades = { now: gradeOf(cur.sg, "sg"), ceil: gradeOf(proj + 0.84 * fit.s, "sg"), proj: gradeOf(proj, "sg"),
      tools: Object.fromEntries(CATS.map((c) => [c, gradeOf(cur[c], c)])), projRank: rankLike(proj), ceilRank: rankLike(proj + 0.84 * fit.s), refY, refN: refOf.sg.length };
    // before the breakout: past seasons most like this one that came the year before a top-10 season (not already top 10)
    const pre = pool.filter((x) => x.k !== k && x.next.rank <= 10 && x.rank > 10).map((x) => ({ x, d: dist(cur, x) })).sort((a, b) => a.d - b.d).slice(0, 3).map((c) => ({ ...c, sim: simOf(c.d) }));
    const out = { cur, mine, comps, effN, proj, lo: proj - 1.2816 * fit.s, hi: proj + 1.2816 * fit.s, odds, grades, pre, wC };
    memo.set(k, out); return out; }
  // fast risers: rolling 24-round strokes gained now against a year ago, against the round-to-round noise
  const rdSd = sd(P.flatMap((p) => p.rs.map((r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0))).slice(0, 50000));
  const noise = rdSd * Math.sqrt(2 / 24);
  const risers = (B.rows || []).filter((r) => r.now && r.ago).map((r) => { const dv = r.now.v - r.ago.v; return { r, dv, z: dv / noise, dr: r.ago.r - r.now.r }; }).sort((a, b) => b.dv - a.dv);
  return { refY, ps, byKey, st, fit, tiers, tierLine, fieldN, dRef, scout, risers, noise, rdSd, pool };
}

// the inverse of the normal curve (Acklam's approximation): a percentile → standard deviations from the middle
function invPhi(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
    c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, t = q * q; return (((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * q / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
}
function solve3(A, v) { // Gaussian elimination, 3×3
  const M = A.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) { let p = i; for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j; [M[i], M[p]] = [M[p], M[i]]; if (Math.abs(M[i][i]) < 1e-9) return null;
    for (let j = 0; j < 3; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let k = i; k < 4; k++) M[j][k] -= f * M[i][k]; } }
  return M.map((r, i) => r[3] / r[i]);
}
