// standard normal CDF (Abramowitz–Stegun 7.1.26)
const ncdf = (z) => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); };
/*
 * The forecaster (update 410: rebuilt). Next season's strokes gained for a player, and the two after, from the data on
 * this site alone. Every number in it is learned from the data; nothing is picked by hand.
 *
 *   1. Field strength. Strokes gained is against the field each week, so +1 in a weak field isn't +1 in a strong one.
 *      Each event's strength (per part of the game) is the average level of the players in it, worked out back and
 *      forth with the players' levels until they settle. Every round is then credited for its field, which also puts
 *      every tour on one scale (a Korn Ferry field is simply a weaker field). 0 = an average field on the tour picked.
 *   2. A Kalman filter per player and part of the game, event by event. A player's true level drifts over time and is
 *      only seen through noisy rounds; after each event the estimate moves toward what was seen, by as much as that
 *      event deserves (more rounds, and a part of the game that's less noisy, move it more). Between events it drifts
 *      back toward the average a little, the longer the gap the more. Its four settings per part of the game (how noisy
 *      a round is, how far apart players' levels are, how fast a level drifts back, and where back is) are the ones
 *      that make the data most likely (maximum likelihood).
 *   3. Age. How players' levels change with age, per part of the game, read from where the filter kept being
 *      surprised in the same direction at the same age; pooled over nearby ages by as much as cross-validation says.
 *   4. Ranges. The spread of a season's result (the player's level is uncertain, and a season is a limited number of
 *      rounds), scaled so that 8 in 10 past seasons it hadn't seen landed inside.
 *   5. Checked: each season from the fourth on forecast from a model learned only on the seasons before it, against
 *      two simple guesses on the same seasons (the latest season as it was, and the tour average).
 *
 *   forecastInput(field)            → the compact form the worker learns from
 *   forecastModel(field | input, { tour })  → model
 *   forecastPlayer(model, key)      → { name, age, now, hist, years: [{ year, total, cats, lo, hi, rank, of, top10, top50 }], flags }
 *   forecastStory(model, fcs)       → paragraphs
 */
const CATS = ["OTT", "APP", "ARG", "PUTT"];
const NC = 4;
const sq = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const minRoundsOf = (most) => Math.max(1, Math.floor((Math.max(0, Number(most) || 0) * 0.33) / 5) * 5); // (the site's rankings rule)
/** A date as a year with a fraction ("2026-07-01" → about 2026.5). */
const tOf = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); if (!m) return NaN; return +m[1] + (Date.UTC(+m[1], m[2] - 1, +m[3]) - Date.UTC(+m[1], 0, 1)) / (365.25 * 864e5); };
const ageAt = (birth, year) => { const b = tOf(birth); return Number.isFinite(b) ? Number(year) + 0.5 - b : null; }; // (at the middle of the season)
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// the best value on a scale (a coarse scan, then a golden-section search around the best), optionally on a log scale
function bestOn(f, lo, hi, { log = false, steps = 30, scan = 12 } = {}) {
  const T = (x) => (log ? Math.exp(x) : x), a0 = log ? Math.log(lo) : lo, b0 = log ? Math.log(hi) : hi;
  let best = a0, be = Infinity;
  for (let i = 0; i <= scan; i++) { const x = a0 + ((b0 - a0) * i) / scan, e = f(T(x)); if (e < be) { be = e; best = x; } }
  let a = Math.max(a0, best - (b0 - a0) / scan), b = Math.min(b0, best + (b0 - a0) / scan);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(T(c)), fd = f(T(d));
  for (let i = 0; i < steps; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(T(c)); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(T(d)); } }
  const x = (a + b) / 2, e = f(T(x));
  return e <= be ? { x: T(x), e } : { x: T(best), e: be };
}

/** The field in the compact form the model learns from (small enough to hand to a worker): one entry per round. */
export function forecastInput(field) {
  if (field?.kind === "rounds") return field;
  const yearsM = new Map(), toursM = new Map(), eventsM = new Map();
  const id = (m, k) => { let i = m.get(k); if (i === undefined) { i = m.size; m.set(k, i); } return i; };
  let N = 0;
  for (const p of field) for (const rd of p.rounds || []) if (rd.shots?.length && !rd.eventLevel) N++;
  const T = new Float64Array(N), V = new Float32Array(N * NC), M = new Uint8Array(N), Y = new Int16Array(N), TO = new Int16Array(N), E = new Int32Array(N), P = new Int32Array(N);
  const players = [];
  let k = 0;
  field.forEach((p) => {
    const a = k;
    const rs = [];
    for (const rd of p.rounds || []) { if (!rd.shots?.length || rd.eventLevel) continue; const t = tOf(rd.date); const y = String(rd.year || String(rd.date || "").slice(0, 4)); if (Number.isFinite(t) && /^\d{4}$/.test(y)) rs.push({ rd, t, y }); }
    rs.sort((x, z) => x.t - z.t);
    for (const { rd, t, y } of rs) {
      T[k] = t; Y[k] = id(yearsM, y); TO[k] = id(toursM, rd.tour || ""); E[k] = id(eventsM, `${y}|${rd.tour || ""}|${rd.event || rd.date}`); P[k] = players.length;
      for (const x of rd.shots) { const ci = CATS.indexOf(x.cat); if (ci >= 0) { V[k * NC + ci] += x.sg || 0; M[k] |= 1 << ci; } }
      k++;
    }
    players.push({ key: p.key, name: p.name || p.key, birth: p.birth || null, a, b: k });
  });
  return { kind: "rounds", players, n: k, T: T.slice(0, k), V: V.slice(0, k * NC), M: M.slice(0, k), Y: Y.slice(0, k), TO: TO.slice(0, k), E: E.slice(0, k), P: P.slice(0, k), years: [...yearsM.keys()], tours: [...toursM.keys()], nEvents: eventsM.size };
}

// (learning takes a few seconds on a full field: kept per field and tour, so Compare and Cal share it)
const modelMemo = new WeakMap();
export function forecastModel(field, { tour = null } = {}) {
  const byTour = modelMemo.get(field) || (modelMemo.set(field, new Map()), modelMemo.get(field));
  const k = sq(tour || "");
  if (!byTour.has(k)) byTour.set(k, learn(forecastInput(field), { tour }));
  return byTour.get(k);
}

function learn(D, { tour = null } = {}) {
  const NP = D.players.length, N = D.n;
  // seasons in order; each round's season as its place in that order
  const yrs = [...D.years].sort(), yRank = D.years.map((y) => yrs.indexOf(y)), NY = yrs.length;
  const YS = new Int16Array(N); for (let i = 0; i < N; i++) YS[i] = yRank[D.Y[i]];
  // the tour: the one asked for, else the one with most rounds
  const tourN = new Map(); for (let i = 0; i < N; i++) tourN.set(D.TO[i], (tourN.get(D.TO[i]) || 0) + 1);
  const tName = (i) => D.tours[i];
  let TT = tour != null ? D.tours.findIndex((t) => sq(t) === sq(tour)) : -1;
  if (TT < 0 && tour) TT = D.tours.findIndex((t) => sq(t).includes(sq(tour)) || sq(tour).includes(sq(t)));
  if (TT < 0) TT = [...tourN].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const target = tName(TT) ?? "";
  const birthT = D.players.map((p) => tOf(p.birth));

  /* ---------------- 1. field strength (rounds up to season `cut`) ---------------- */
  const adjust = (cut) => {
    const NE = D.nEvents;
    const skill = new Float64Array(NP * NY * NC), cnt = new Float64Array(NP * NY * NC);
    const str = new Float64Array(NE * NC), scnt = new Float64Array(NE * NC);
    const adj = new Float32Array(N * NC);
    for (let i = 0; i < N * NC; i++) adj[i] = D.V[i];
    for (let it = 0; it < 4; it++) {
      skill.fill(0); cnt.fill(0);
      for (let i = 0; i < N; i++) { if (YS[i] > cut) continue; const base = (D.P[i] * NY + YS[i]) * NC; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { skill[base + c] += adj[i * NC + c]; cnt[base + c]++; } }
      for (let j = 0; j < skill.length; j++) if (cnt[j]) skill[j] /= cnt[j];
      str.fill(0); scnt.fill(0);
      for (let i = 0; i < N; i++) { if (YS[i] > cut) continue; const base = (D.P[i] * NY + YS[i]) * NC; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { str[D.E[i] * NC + c] += skill[base + c]; scnt[D.E[i] * NC + c]++; } }
      for (let j = 0; j < str.length; j++) if (scnt[j]) str[j] /= scnt[j];
      for (let i = 0; i < N; i++) for (let c = 0; c < NC; c++) adj[i * NC + c] = D.V[i * NC + c] + str[D.E[i] * NC + c];
    }
    // 0 = an average field on the tour picked (its events in the last two seasons in), so adjusted ≈ raw there
    const S0 = new Float64Array(NC), w0 = new Float64Array(NC);
    for (let i = 0; i < N; i++) { if (YS[i] > cut || YS[i] < cut - 1 || D.TO[i] !== TT) continue; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { S0[c] += str[D.E[i] * NC + c]; w0[c]++; } }
    for (let c = 0; c < NC; c++) S0[c] = w0[c] ? S0[c] / w0[c] : 0;
    for (let i = 0; i < N; i++) for (let c = 0; c < NC; c++) adj[i * NC + c] -= S0[c];
    // how much field strength moves a round: the middle 80% of events on the tour picked
    const sTot = []; const seen = new Set();
    for (let i = 0; i < N; i++) { if (YS[i] > cut || YS[i] < cut - 1 || D.TO[i] !== TT || seen.has(D.E[i])) continue; seen.add(D.E[i]); let s = 0; for (let c = 0; c < NC; c++) s += str[D.E[i] * NC + c] - S0[c]; sTot.push(s); }
    sTot.sort((a, b) => a - b);
    return { adj, spread: sTot.length ? [sTot[Math.floor(sTot.length * 0.1)], sTot[Math.floor(sTot.length * 0.9)]] : [0, 0], events: seen.size };
  };

  /* ---------------- the events each player played (the filter's observations) ---------------- */
  const observe = (A, cut) => {
    const oP = [], oT = [], oN = [], oY = [];
    const pStart = new Int32Array(NP + 1);
    for (let p = 0; p < NP; p++) {
      pStart[p] = oP.length;
      const { a, b } = D.players[p];
      let i = a;
      while (i < b) {
        if (YS[i] > cut) { i++; continue; }
        const e = D.E[i]; let j = i, t = 0, n = 0; const ns = [0, 0, 0, 0], ys = [0, 0, 0, 0];
        while (j < b && D.E[j] === e) { if (YS[j] <= cut) { t += D.T[j]; n++; for (let c = 0; c < NC; c++) if (D.M[j] & (1 << c)) { ns[c]++; ys[c] += A[j * NC + c]; } } j++; }
        if (n) { oP.push(p); oT.push(t / n); oN.push(...ns); oY.push(...ys.map((v, c) => (ns[c] ? v / ns[c] : 0))); }
        i = j;
      }
    }
    pStart[NP] = oP.length;
    return { n: oP.length, P: Int32Array.from(oP), T: Float64Array.from(oT), Nn: Float32Array.from(oN), Yv: Float64Array.from(oY), pStart };
  };

  /* ---------------- 2. the Kalman filter ---------------- */
  // age drift per part of the game: a curve on a grid of ages (per year of age, strokes a round)
  const A0 = 15, AS = 0.25, AN = 200;
  const ageIdx = (age) => Math.max(0, Math.min(AN - 1, Math.round((age - A0) / AS)));
  // one part of the game, every player: the negative log-likelihood (and, if asked, each surprise and each end state)
  const run = (O, c, th, drift, collect = null) => {
    const { sig2, s2, lam, mu } = th;
    let nll = 0;
    for (let p = 0; p < NP; p++) {
      const a = O.pStart[p], b = O.pStart[p + 1];
      if (a === b) { if (collect?.ends) collect.ends[p] = null; continue; }
      let x = mu, P = s2, tp = O.T[a];
      const bt = birthT[p], hasAge = Number.isFinite(bt) && drift;
      for (let k = a; k < b; k++) {
        const n = O.Nn[k * NC + c];
        const dt = O.T[k] - tp;
        if (dt > 0) {
          const f = Math.exp(-lam * dt);
          let dr = 0;
          if (hasAge) dr = drift[ageIdx((tp + O.T[k]) / 2 - bt)] * dt;
          x = mu + (x - mu) * f + dr; P = P * f * f + s2 * (1 - f * f);
          tp = O.T[k];
        }
        if (!n) continue;
        const R = sig2 / n, S = P + R, v = O.Yv[k * NC + c] - x;
        nll += 0.5 * (Math.log(S) + (v * v) / S);
        if (collect?.inn && dt > 0 && Number.isFinite(bt)) collect.inn.push({ p, age: (O.T[k] + tp - dt) / 2 - bt, dt, v, S });
        const K = P / S; x += K * v; P *= 1 - K;
      }
      if (collect?.ends) collect.ends[p] = { x, P, t: tp };
    }
    return nll;
  };
  // (a wide search from plain averages; from a fit already made (warm), a narrow one around it)
  const fitTheta = (O, c, drift, start, sweeps = 2, warm = false) => {
    let th = { ...start }; const o = { log: true, steps: warm ? 8 : 11, scan: warm ? 4 : 8 };
    for (let s = 0; s < sweeps; s++) {
      th.sig2 = bestOn((v) => run(O, c, { ...th, sig2: v }, drift), th.sig2 / (warm ? 1.5 : 3), th.sig2 * (warm ? 1.5 : 3), o).x;
      th.s2 = bestOn((v) => run(O, c, { ...th, s2: v }, drift), Math.max(1e-5, th.s2 / (warm ? 2 : 10)), th.s2 * (warm ? 2 : 10), o).x;
      th.lam = bestOn((v) => run(O, c, { ...th, lam: v }, drift), warm ? th.lam / 3 : 0.005, warm ? th.lam * 3 : 5, o).x;
      th.mu = bestOn((v) => run(O, c, { ...th, mu: v }, drift), th.mu - (warm ? 0.3 : 1), th.mu + (warm ? 0.3 : 1), { ...o, log: false }).x;
    }
    return th;
  };
  const startOf = (O, c) => {
    // starting points from plain averages: a round's spread around the player's own average, and the players' spread
    let sw = 0, sx = 0, sxx = 0;
    const pm = [];
    for (let p = 0; p < NP; p++) { let t = 0, n = 0; for (let k = O.pStart[p]; k < O.pStart[p + 1]; k++) { const m = O.Nn[k * NC + c]; t += O.Yv[k * NC + c] * m; n += m; } if (n >= 10) pm.push([t / n, n]); }
    for (let k = 0; k < O.n; k++) { const m = O.Nn[k * NC + c]; if (m) { sw += m; sx += O.Yv[k * NC + c] * m; sxx += O.Yv[k * NC + c] ** 2 * m; } }
    const mean = sw ? sx / sw : 0, varR = sw ? Math.max(1e-4, sxx / sw - mean * mean) : 1;
    const pmMean = pm.length ? pm.reduce((t, [v]) => t + v, 0) / pm.length : mean;
    const varP = pm.length ? pm.reduce((t, [v]) => t + (v - pmMean) ** 2, 0) / pm.length : 0.05;
    return { sig2: Math.max(1e-3, varR * 2), s2: Math.max(1e-3, varP), lam: 0.3, mu: pmMean };
  };
  // 3. age: the change in a player's level per year of age, per part of the game, learned together with the filter
  // (maximum likelihood, like its other settings): a value at each of a few ages, straight lines between them
  const KNOTS = [22, 27, 32, 37, 42];
  const gridOf = (kv) => { const g = new Float64Array(AN); for (let i = 0; i < AN; i++) { const a = A0 + i * AS; if (a <= KNOTS[0]) g[i] = kv[0]; else if (a >= KNOTS.at(-1)) g[i] = kv.at(-1); else { const j = KNOTS.findIndex((k) => k > a) - 1; const u = (a - KNOTS[j]) / (KNOTS[j + 1] - KNOTS[j]); g[i] = kv[j] * (1 - u) + kv[j + 1] * u; } } return g; };
  const ageCount = (O) => { const seen = new Set(); let pts = 0; for (let p = 0; p < NP; p++) if (Number.isFinite(birthT[p]) && O.pStart[p + 1] > O.pStart[p]) { seen.add(p); pts += O.pStart[p + 1] - O.pStart[p]; } return { players: seen.size, pts }; };
  const fitDrift = (O, c, th, start, sweeps, width) => {
    const kv = [...start];
    for (let s = 0; s < sweeps; s++) for (let k = 0; k < KNOTS.length; k++) {
      kv[k] = bestOn((v) => { const t = [...kv]; t[k] = v; return run(O, c, th, gridOf(t)); }, kv[k] - width, kv[k] + width, { steps: 8, scan: 6 }).x;
    }
    return kv;
  };

  // the whole fit on the seasons up to `cut`: field strength, then per part of the game the filter's settings, the
  // age curve, then the settings again with the age curve in (warm: from a fit already made, narrower and quicker)
  const fit = (cut, { warm = null } = {}) => {
    const F = adjust(cut), O = observe(F.adj, cut);
    const th = [], drift = [], knots = [];
    const ac = ageCount(O), useAge = ac.players >= 20;
    for (let c = 0; c < NC; c++) {
      let t, kv = null;
      if (warm) {
        t = { ...warm.th[c], ends: undefined }; kv = warm.knots[c] ? [...warm.knots[c]] : null;
        t = fitTheta(O, c, kv ? gridOf(kv) : null, t, 1, true);
        if (kv) kv = fitDrift(O, c, t, kv, 1, 0.08);
      } else {
        t = fitTheta(O, c, null, startOf(O, c), 2);
        if (useAge) { kv = fitDrift(O, c, t, [0, 0, 0, 0, 0], 2, 0.3); t = fitTheta(O, c, gridOf(kv), t, 1, true); kv = fitDrift(O, c, t, kv, 1, 0.08); }
      }
      const g = kv ? gridOf(kv) : null;
      const ends = new Array(NP); run(O, c, t, g, { ends });
      t.ends = ends; th.push(t); drift.push(g); knots.push(kv);
    }
    return { F, O, th, drift, knots, age: ac, useAge, cut };
  };

  /* ---------------- seasons as they were (raw for show, adjusted for checks) ---------------- */
  const seasonStats = (A, cut, onlyTarget) => {
    // per player per season: rounds and the average per part of the game
    const sums = new Map();
    for (let i = 0; i < N; i++) {
      if (YS[i] > cut || (onlyTarget && D.TO[i] !== TT)) continue;
      const key = D.P[i] * NY + YS[i];
      let s = sums.get(key); if (!s) { s = { n: 0, t: [0, 0, 0, 0], m: [0, 0, 0, 0] }; sums.set(key, s); }
      s.n++; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { s.t[c] += A[i * NC + c]; s.m[c]++; }
    }
    const out = new Map();
    for (const [key, s] of sums) out.set(key, { n: s.n, cats: s.t.map((v, c) => (s.m[c] ? v / s.m[c] : 0)) });
    return out;
  };

  /* ---------------- the full model ---------------- */
  const last = NY - 1, lastYear = yrs[last];
  const M = fit(last);
  const rawT = seasonStats(D.V, last, true), adjT = seasonStats(M.F.adj, last, true);
  // a round's total spread around the player's own season average (for the luck in a season of n rounds)
  const sig2Tot = (() => { let e = 0, w = 0; const mean = new Map(); for (const [k, s] of adjT) mean.set(k, s.cats.reduce((a, b) => a + b, 0));
    for (let i = 0; i < N; i++) { if (D.TO[i] !== TT || D.M[i] !== 15) continue; const k = D.P[i] * NY + YS[i], s = adjT.get(k); if (!s || s.n < 10) continue; let t = 0; for (let c = 0; c < NC; c++) t += M.F.adj[i * NC + c]; e += (t - mean.get(k)) ** 2 * (s.n / (s.n - 1)); w++; }
    return w ? e / w : 8; })();
  // the rankings rule on the tour picked, each season: who'd be ranked, and their average (for the story's flags)
  const rankedIn = (y, S) => { const list = [...S].filter(([k]) => k % NY === y).map(([k, s]) => [Math.floor(k / NY), s]); const minR = minRoundsOf(Math.max(0, ...list.map(([, s]) => s.n))); return list.filter(([, s]) => s.n >= minR); };
  const typicalN = (() => { const ns = rankedIn(last, rawT).map(([, s]) => s.n).sort((a, b) => a - b); return ns.length ? ns[Math.floor(ns.length * 0.5)] : 60; })();
  // (update 413) this season's rank so far on the tour picked, as the Stats page ranks it (raw, the rankings rule)
  const nowRanked = rankedIn(last, rawT).map(([p, s0]) => [p, s0.cats.reduce((a, b) => a + b, 0)]);
  const nowRank = (p) => { const s0 = rawT.get(p * NY + last); if (!s0) return null; const v = s0.cats.reduce((a, b) => a + b, 0); const others = nowRanked.filter(([q]) => q !== p); return { rank: 1 + others.filter(([, x]) => x > v).length, of: others.length + 1, ranked: nowRanked.some(([q]) => q === p) }; };

  // a player's projection h seasons on (from where the filter left them): per part of the game, the mean and the
  // uncertainty of their level, and how much of the change is age
  const projectWith = (Mx, p, Y) => {
    const tY = Number(Y) + 0.5, bt = birthT[p];
    const cats = {}, vlev = { s: 0 }; let ageAdd = 0, any = false;
    for (let c = 0; c < NC; c++) {
      const e = Mx.th[c].ends[p]; if (!e) return null;
      any = true;
      const { s2, lam, mu } = Mx.th[c], g = Mx.drift[c];
      // stepped a quarter-season at a time so the age curve follows the player's age
      let x = e.x, P = e.P, t = e.t, a = 0;
      while (t < tY - 1e-9) { const dt = Math.min(0.25, tY - t), f = Math.exp(-lam * dt); const dr = g && Number.isFinite(bt) ? g[ageIdx(t + dt / 2 - bt)] * dt : 0; x = mu + (x - mu) * f + dr; a = a * f + dr; P = P * f * f + s2 * (1 - f * f); t += dt; }
      cats[CATS[c]] = x; vlev.s += P; ageAdd += a;
    }
    if (!any) return null;
    return { cats, total: CATS.reduce((t, c) => t + cats[c], 0), varLevel: vlev.s, ageAdd };
  };

  /* ---------------- 5. checked on seasons it hadn't seen ---------------- */
  const resid = { 1: [], 2: [], 3: [] };
  let outOfSample = false;
  for (let t = 3; t < NY; t++) {
    const Mt = fit(t - 1, { warm: M });
    outOfSample = true;
    const prevS = seasonStats(Mt.F.adj, t - 1, false);
    const prevAvg = (() => { const r = rankedIn(t - 1, seasonStats(Mt.F.adj, t - 1, true)); return r.length ? r.reduce((s0, [, s]) => s0 + s.cats.reduce((a, b) => a + b, 0), 0) / r.length : 0; })();
    for (let h = 1; h <= 3 && t - 1 + h < NY; h++) {
      const yAct = t - 1 + h;
      for (const [key, s] of adjT) {
        if (key % NY !== yAct || s.n < 20) continue;
        const p = Math.floor(key / NY);
        const pr = projectWith(Mt, p, yrs[yAct]); if (!pr) continue;
        const act = s.cats.reduce((a, b) => a + b, 0);
        const sd = Math.sqrt(pr.varLevel + sig2Tot / s.n);
        const pv = prevS.get(p * NY + (t - 1));
        resid[h].push({ r: act - pr.total, z: (act - pr.total) / sd, n: s.n, rLast: pv && pv.n >= 10 ? act - pv.cats.reduce((a, b) => a + b, 0) : null, rAvg: act - prevAvg });
      }
    }
  }
  // the ranges: scaled so 8 in 10 seasons it hadn't seen land inside (one season ahead)
  const kappa = (() => { const z = resid[1].map((x) => Math.abs(x.z)).sort((a, b) => a - b); return z.length >= 20 ? Math.max(0.5, Math.min(3, z[Math.floor(z.length * 0.8)] / 1.2816)) : 1; })();
  const err = [1, 2, 3].map((h) => {
    const R = resid[h]; if (R.length < 10) return null;
    const mae = R.reduce((t, x) => t + Math.abs(x.r), 0) / R.length;
    const B = R.filter((x) => x.rLast != null);
    const bt = B.length >= 10 ? { n: B.length, model: B.reduce((t, x) => t + Math.abs(x.r), 0) / B.length, last: B.reduce((t, x) => t + Math.abs(x.rLast), 0) / B.length, avg: B.reduce((t, x) => t + Math.abs(x.rAvg), 0) / B.length } : null;
    const inside = R.filter((x) => Math.abs(x.z) <= 1.2816 * kappa).length / R.length;
    return { mae, n: R.length, bt, inside, bias: R.reduce((t, x) => t + x.r, 0) / R.length, sd: Math.sqrt(R.reduce((t, x) => t + x.r * x.r, 0) / R.length) };
  });

  /* ---------------- the future seasons, everyone ranked ---------------- */
  const sdOf = (pr, n = typicalN) => kappa * Math.sqrt(pr.varLevel + sig2Tot / Math.max(1, n));
  const projMemo = new Map();
  const project = (key, h) => {
    const p = typeof key === "number" ? key : D.players.findIndex((x) => x.key === key);
    if (p < 0) return null;
    const id = `${p}|${h}`; if (projMemo.has(id)) return projMemo.get(id);
    const pr = projectWith(M, p, Number(lastYear) + h);
    const out = pr ? { ...pr, sd: sdOf(pr) } : null;
    projMemo.set(id, out); return out;
  };
  // the field each future season: the players who'd be ranked on this tour over the last two seasons (the site's rule)
  const recentN = new Map(); for (const [k, s] of rawT) { const y = k % NY; if (y >= last - 1) recentN.set(Math.floor(k / NY), (recentN.get(Math.floor(k / NY)) || 0) + s.n); }
  const minPool = minRoundsOf(Math.max(0, ...recentN.values()));
  const pool = [...recentN].filter(([, n]) => n >= minPool).map(([p]) => p);
  const fieldProj = [1, 2, 3].map((h) => pool.map((p) => ({ k: D.players[p].key, v: project(p, h)?.total, sd: project(p, h)?.sd })).filter((x) => x.v != null).sort((a, b) => b.v - a.v));
  // (update 417) the pool spans two seasons, so it's bigger than one season's rankings: scale ranks to a typical season
  const seasonN = Math.max(rankedIn(last, rawT).length, last > 0 ? rankedIn(last - 1, rawT).length : 0) || (fieldProj[0].length);
  const rankScale = (n) => Math.max(1, seasonN - 1) / Math.max(1, n);
  const chanceMemo = new Map();
  const chances = (key, h, mine, sdM) => {
    const id = `${key}|${h}`; if (chanceMemo.has(id)) return chanceMemo.get(id);
    const others = fieldProj[h - 1].filter((x) => x.k !== key);
    // (update 414: top 100 too)
    if (others.length >= 100 && rankScale(others.length) <= 1 && mine + 5 * sdM < others[99].v - 5 * (others[99].sd || sdM)) { const o = { top10: 0, top50: 0, top100: 0 }; chanceMemo.set(id, o); return o; }
    const r = rng(12345 + h); let t10 = 0, t50 = 0, t100 = 0; const S = 3000, sc = rankScale(others.length), cut = 100 / sc;
    for (let s = 0; s < S; s++) {
      const me = mine + gauss(r) * sdM; let better = 0;
      for (const o of others) { if (o.v + gauss(r) * o.sd > me) { better++; if (better >= cut) break; } }
      const b = better * sc; if (b < 10) t10++; if (b < 50) t50++; if (b < 100) t100++;
    }
    const out = { top10: seasonN >= 10 ? t10 / S : null, top50: seasonN >= 50 ? t50 / S : null, top100: seasonN >= 100 ? t100 / S : null };
    chanceMemo.set(id, out); return out;
  };

  /* ---------------- what it learned, for the page ---------------- */
  const cats = Object.fromEntries(CATS.map((c, i) => { const t = M.th[i]; return [c, { noise: Math.sqrt(t.sig2), spread: Math.sqrt(t.s2), halfLife: Math.log(2) / t.lam, mean: t.mu,
    // how much of a full season (typical rounds) a forecast takes from the player rather than the average
    carry: t.s2 / (t.s2 + t.sig2 / typicalN) }]; }));
  const ageOk = M.drift.some(Boolean);
  const ageCurve = (age) => Object.fromEntries(CATS.map((c, i) => [c, M.drift[i] ? M.drift[i][ageIdx(age)] : 0]));
  const params = {
    kind: "kalman", cats, carry: Object.fromEntries(CATS.map((c) => [c, cats[c].carry])), typicalN, outOfSample, kappa,
    field: { events: M.F.events, spread: M.F.spread },
    age: { players: M.useAge ? M.age.players : 0, pairs: M.useAge ? M.age.pts : 0, knots: KNOTS,
      at: Object.fromEntries([24, 28, 32, 36, 40].map((a) => [a, CATS.reduce((t, c) => t + ageCurve(a)[c], 0)])) },
    spread: err.map((e) => e || { n: 0 }),
  };
  // each season's average of the ranked players on the tour picked (adjusted), for the story's flags
  const meanAdj = new Map(); for (let y = 0; y < NY; y++) { const r = rankedIn(y, adjT); if (r.length) meanAdj.set(yrs[y], r.reduce((t, [, s]) => t + s.cats.reduce((a, b) => a + b, 0), 0) / r.length); }
  const pIndex = new Map(D.players.map((p, i) => [p.key, i]));
  return {
    target, years: yrs, lastYear, params, ageOk, agePlayers: params.age.players, err, outOfSample, sig2Tot, typicalN,
    project, fieldProj, seasonN, rankScale, chances, ageCurve, meanAdj, pIndex, players: D.players, rawT, adjT, NY, nowRank,
    nameOf: new Map(D.players.map((p) => [p.key, p.name])), birthOf: new Map(D.players.map((p) => [p.key, p.birth])),
  };
}

/** One player's forecast (null without anything to go on). */
export function forecastPlayer(model, key) {
  const p = model.pIndex.get(key);
  if (p == null) return null;
  const { lastYear, years: yrs, NY } = model;
  const birth = model.birthOf.get(key) || null;
  const age = birth ? ageAt(birth, lastYear) : null;
  // their seasons on the tour picked, as on the Stats page (raw), and adjusted for the field (for the flags)
  const hist = [], histAdj = [];
  for (let y = 0; y < NY; y++) {
    const s = model.rawT.get(p * NY + y); if (s) hist.push({ year: yrs[y], n: s.n, total: s.cats.reduce((a, b) => a + b, 0), cats: Object.fromEntries(CATS.map((c, i) => [c, s.cats[i]])) });
    const a = model.adjT.get(p * NY + y); if (a) { const mu = model.meanAdj.get(yrs[y]) || 0; histAdj.push({ year: yrs[y], n: a.n, total: a.cats.reduce((x, z) => x + z, 0) - mu, cats: Object.fromEntries(CATS.map((c, i) => [c, a.cats[i] - mu / 4])) }); }
  }
  const years = [];
  for (const h of [1, 2, 3]) {
    const pr = model.project(p, h);
    if (!pr) return null;
    const others = model.fieldProj[h - 1].filter((x) => x.k !== key);
    // (update 417) the rank a score would earn in a real season: everyone else's season has their own ups and downs too,
    // so count each other player by their chance of finishing above it (ranking point projections against each other
    // squeezes the field toward the middle and flatters an average score)
    const sc = model.rankScale(others.length);
    const rankAt = (v) => Math.max(1, Math.round(1 + sc * others.reduce((t, x) => t + ncdf((x.v - v) / Math.max(1e-6, x.sd || pr.sd)), 0)));
    const rank = rankAt(pr.total);
    // the rank at the top and the bottom of their likely range
    const rankHi = rankAt(pr.total + 1.2816 * pr.sd), rankLo = rankAt(pr.total - 1.2816 * pr.sd);
    const ch = model.chances(key, h, pr.total, pr.sd);
    years.push({ year: String(Number(lastYear) + h), total: pr.total, ageAdd: pr.ageAdd, cats: pr.cats, lo: pr.total - 1.2816 * pr.sd, hi: pr.total + 1.2816 * pr.sd, sd: pr.sd, rank, rankHi, rankLo, of: model.seasonN, top10: ch.top10, top50: ch.top50, top100: ch.top100 });
  }
  const lastS = histAdj.at(-1), prev = histAdj.slice(0, -1).slice(-3), wsum = prev.reduce((t, s) => t + s.n, 0);
  const careerPutt = wsum ? prev.reduce((t, s) => t + s.cats.PUTT * s.n, 0) / wsum : null;
  const careerTot = wsum ? prev.reduce((t, s) => t + s.total * s.n, 0) / wsum : null;
  const swing = Math.sqrt(model.sig2Tot / Math.max(1, lastS?.n || 1));
  const flags = {
    rounds: hist.reduce((t, s) => t + s.n, 0), lastN: lastS?.n || 0,
    puttLed: !!lastS && lastS.total > swing && lastS.cats.PUTT > lastS.total / 2,
    puttAboveUsual: careerPutt != null && lastS ? lastS.cats.PUTT - careerPutt : null,
    vsUsual: careerTot != null && lastS ? lastS.total - careerTot : null,
    lastYear: lastS?.year ?? null, lastTot: lastS?.total ?? null, usualTot: careerTot, usualFrom: prev[0]?.year ?? null, usualTo: prev.at(-1)?.year ?? null, lastPutt: lastS?.cats.PUTT ?? null,
    swing, ballStriking: lastS ? lastS.cats.OTT + lastS.cats.APP : null,
    fewRounds: (lastS?.n || 0) < model.typicalN / 2, noBirth: !birth,
  };
  const lastH = hist.at(-1);
  const now = lastH?.year === lastYear ? { ...lastH, ...(model.nowRank?.(p) || {}) } : null;
  return { key, name: model.nameOf.get(key) || key, birth, age, now, hist, years, flags, tour: model.target };
}

/** The write-up for a few players' forecasts, in plain words (best first over the three seasons). */
export function forecastStory(model, fcs) {
  const list = fcs.filter(Boolean);
  if (!list.length) return [];
  const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  const sum3 = (f) => f.years.reduce((t, y) => t + y.total, 0);
  const order = [...list].sort((a, b) => sum3(b) - sum3(a));
  const out = [];
  const lastY = order[0].years.at(-1).year, firstY = order[0].years[0].year;
  const nextBest = [...list].sort((a, b) => b.years[0].total - a.years[0].total)[0];
  const lastBest = [...list].sort((a, b) => b.years.at(-1).total - a.years.at(-1).total)[0];
  if (list.length > 1) out.push(nextBest === lastBest ? `${nextBest.name} projects best both next season and in ${lastY}.` : `${nextBest.name} projects best next season (${firstY}); ${lastBest.name} is projected to be best by ${lastY}.`);
  const carry = model.params.carry;
  for (const f of order) {
    const y1 = f.years[0], y3 = f.years.at(-1), bits = [];
    const trend = y3.total - y1.total;
    const ageBit = Math.abs(y3.ageAdd) >= 0.05 ? ` (age ${y3.ageAdd > 0 ? "adds" : "takes off"} about ${Math.abs(y3.ageAdd).toFixed(2)} by then)` : "";
    bits.push(`${f.name}${f.age != null ? ` (${Math.floor(f.age)})` : ""}: ${f2(y1.total)} a round in ${y1.year} (likely ${f2(y1.lo)} to ${f2(y1.hi)}), ${f2(y3.total)} by ${y3.year}${Math.abs(trend) >= 0.05 ? `, ${trend > 0 ? "rising" : "declining"}${ageBit}` : ageBit}. About ${ordinal(y1.rank)} on tour next season.`);
    const fl = f.flags;
    if (fl.puttLed) bits.push(`Most of their last season came from putting, and a season of putting tells the least about the next (about ${Math.round(carry.PUTT * 100)}% of it carries over in this data), so the forecast leans on it least.`);
    else if (fl.puttAboveUsual != null && Math.abs(fl.puttAboveUsual) > fl.swing / 2) bits.push(`Their putting was ${fl.puttAboveUsual > 0 ? "well above" : "well below"} their usual (${f2(fl.puttAboveUsual)}): ${fl.puttAboveUsual > 0 ? "expect some of it to come back" : "likely to bounce back some"}.`);
    if (fl.vsUsual != null && Math.abs(fl.vsUsual) > fl.swing) bits.push(`Last season was ${fl.vsUsual > 0 ? "well above" : "well below"} their own recent average (${f2(fl.vsUsual)}), after crediting each round for its field.`);
    if (fl.ballStriking != null && fl.ballStriking > fl.swing) bits.push(`Their ball-striking (Off-the-Tee and Approach, ${f2(fl.ballStriking)}) is the part that holds best (about ${Math.round(((carry.OTT + carry.APP) / 2) * 100)}% carries over).`);
    if (fl.fewRounds) bits.push(`Only ${fl.lastN} rounds last season, so treat it as a rougher guess.`);
    if (fl.noBirth) bits.push(`No birth date in the data, so age isn't taken into account.`);
    out.push(bits.join(" "));
  }
  return out;
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
export { CATS as FORECAST_CATS, ageAt };
