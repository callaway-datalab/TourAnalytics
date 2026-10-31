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
 *   2. Talent now (update 435: the method baseball's projection systems use). As in Marcel (Tom Tango), Steamer and
 *      Data Golf: a weighted average of each player's rounds (a round's weight halves every so many years), regressed
 *      toward the average by adding so many rounds of average play. The half-life and the rounds added, per part of the
 *      game, and each part's weight in the total (as Data Golf does), are the ones that best forecast each next season.
 *      The regression happens once: seasons after the next only add aging.
 *   3. Age. The delta method, as in baseball: each player's change from one season to the next, averaged by age, with
 *      players who didn't come back given the season they'd have been expected to have (the survivor fix), smoothed
 *      over nearby ages; trusted fully at ages with plenty of seasons and less at the thin extremes.
 *   4. Ranges. The spread of a season's result (the player's level is uncertain, and a season is a limited number of
 *      rounds), scaled so that 8 in 10 past seasons it hadn't seen landed inside.
 *   5. Checked: each season from the fourth on forecast from a model learned only on the seasons before it, against
 *      two simple guesses on the same seasons (the latest season as it was, and the tour average).
 *
 *   6. Signals (update 433): ball speed and driving distance changes, a season led by putting, the last 6 months vs.
 *      the lasting level, other tours, rounds played. Each tested on the unseen seasons (each held out in turn); only
 *      those that make those forecasts better, overall and in most seasons, are kept.
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
  // (update 433) each round's ball speed and driving distance (NaN when not there), for the signals
  const BS = new Float32Array(N).fill(NaN), DD = new Float32Array(N).fill(NaN);
  const obsAvg = (rd, key) => { let t = 0, w = 0; for (const o of rd.obs || []) if (o.k === key && Number.isFinite(o.v) && o.v > 0) { const ww = Number(o.w) > 0 ? Number(o.w) : 1; t += o.v * ww; w += ww; } return w ? t / w : NaN; };
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
      BS[k] = obsAvg(rd, "ballSpeed"); DD[k] = obsAvg(rd, "drive");
      k++;
    }
    players.push({ key: p.key, name: p.name || p.key, birth: p.birth || null, a, b: k });
  });
  return { kind: "rounds", players, n: k, T: T.slice(0, k), V: V.slice(0, k * NC), M: M.slice(0, k), Y: Y.slice(0, k), TO: TO.slice(0, k), E: E.slice(0, k), P: P.slice(0, k), BS: BS.slice(0, k), DD: DD.slice(0, k), years: [...yearsM.keys()], tours: [...toursM.keys()], nEvents: eventsM.size };
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
    const evYear = new Int16Array(NE).fill(-1); for (let i = 0; i < N; i++) evYear[D.E[i]] = YS[i];
    for (let i = 0; i < N * NC; i++) adj[i] = D.V[i];
    for (let it = 0; it < 4; it++) {
      skill.fill(0); cnt.fill(0);
      for (let i = 0; i < N; i++) { if (YS[i] > cut) continue; const base = (D.P[i] * NY + YS[i]) * NC; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { skill[base + c] += adj[i * NC + c]; cnt[base + c]++; } }
      for (let j = 0; j < skill.length; j++) if (cnt[j]) skill[j] /= cnt[j];
      str.fill(0); scnt.fill(0);
      for (let i = 0; i < N; i++) { if (YS[i] > cut) continue; const base = (D.P[i] * NY + YS[i]) * NC; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { str[D.E[i] * NC + c] += skill[base + c]; scnt[D.E[i] * NC + c]++; } }
      for (let j = 0; j < str.length; j++) if (scnt[j]) str[j] /= scnt[j];
      // (update 439) each season on its own scale: the average field on the tour picked that season is 0 (as Data Golf
      // benchmarks to the average PGA Tour player in a given year). Seasons share no players' levels, so nothing else
      // ties one season's level to another's, and without this the passes drift a season's level up or down (that
      // showed as everyone losing about a quarter of a stroke a season)
      const sy = new Float64Array(NY * NC), sn = new Float64Array(NY * NC);
      for (let i = 0; i < N; i++) { if (YS[i] > cut || D.TO[i] !== TT) continue; for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { sy[YS[i] * NC + c] += str[D.E[i] * NC + c]; sn[YS[i] * NC + c]++; } }
      for (let j = 0; j < sy.length; j++) if (sn[j]) sy[j] /= sn[j];
      for (let e = 0; e < NE; e++) { const y = evYear[e]; if (y < 0) continue; for (let c = 0; c < NC; c++) str[e * NC + c] -= sy[y * NC + c]; }
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
    // (update 428) averaged over every round, as the site's tables do (a round with no shot of a kind gained 0 there)
    for (const [key, s] of sums) out.set(key, { n: s.n, cats: s.t.map((v) => v / s.n) });
    return out;
  };

  /* ---------------- 2. talent now (update 435: the method baseball's projection systems use) ----------------
   * Marcel (Tom Tango), Steamer and Data Golf all start the same way: a weighted average of a player's past results
   * (the most recent counting most), regressed toward the average by adding a fixed amount of average performance (in
   * Marcel, 1,200 plate appearances of league average). Steamer and Data Golf learn the weights and the amount from
   * past data instead of fixing them; so does this: per part of the game, the half-life of a round's weight and how many
   * rounds of average are added are the ones that best forecast each next season. Like Data Golf, the parts of the game
   * are then combined with learned weights (putting tells the least about the future, driving the most). */
  const A0 = 15, AS = 0.25, AN = 200;
  const ageIdx = (age) => Math.max(0, Math.min(AN - 1, Math.round((age - A0) / AS)));
  const HALVES = [0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8]; // half-lives tried, years
  const KS = Array.from({ length: 28 }, (_, i) => Math.round(2 * Math.pow(1.32, i))); // rounds of average added, tried
  // each player's rounds in season order (season, then date)
  const order = D.players.map(({ a, b }) => { const ix = []; for (let i = a; i < b; i++) ix.push(i); return ix.sort((x, y) => YS[x] - YS[y] || D.T[x] - D.T[y]); });
  const seasonEnd = (() => { const e = new Float64Array(NY).fill(-Infinity); for (let i = 0; i < N; i++) if (D.T[i] > e[YS[i]]) e[YS[i]] = D.T[i]; for (let y = 1; y < NY; y++) if (e[y] < e[y - 1]) e[y] = e[y - 1]; return e; })();
  // the decayed sums at the end of each season up to `cut`, for one half-life: weight, and weight × value, per part
  const sumsAt = (A, cut, hl) => {
    const lam = Math.log(2) / hl, W = new Float64Array(NP * NY * NC), X = new Float64Array(NP * NY * NC);
    for (let p = 0; p < NP; p++) {
      const ix = order[p]; let k = 0; const w = [0, 0, 0, 0], x = [0, 0, 0, 0]; let tAt = -Infinity;
      for (let y = 0; y <= cut; y++) {
        const t0 = seasonEnd[y];
        const decay = (t) => { if (tAt > -Infinity && t > tAt) { const f = Math.exp(-lam * (t - tAt)); for (let c = 0; c < NC; c++) { w[c] *= f; x[c] *= f; } } if (t > tAt) tAt = t; };
        while (k < ix.length && YS[ix[k]] <= y) { const i = ix[k++]; decay(Math.min(D.T[i], t0)); for (let c = 0; c < NC; c++) if (D.M[i] & (1 << c)) { w[c] += 1; x[c] += A[i * NC + c]; } }
        decay(t0);
        const base = (p * NY + y) * NC; for (let c = 0; c < NC; c++) { W[base + c] = w[c]; X[base + c] = x[c]; }
      }
    }
    return { W, X };
  };
  const ageAtT = (p, t) => (Number.isFinite(birthT[p]) ? t - birthT[p] : NaN);

  // aging: the delta method (season to season changes, averaged by age), with the survivor fix baseball uses (players
  // who didn't come back get the season they'd have been expected to have), smoothed over nearby ages
  const agingOf = (S, cut, talent) => {
    const curves = [], wsum = new Float64Array(AN), pts = { players: new Set(), pairs: 0 };
    const acc = Array.from({ length: NC }, () => ({ v: new Float64Array(AN), w: new Float64Array(AN) }));
    for (const [key, s] of S) {
      const p = Math.floor(key / NY), y = key % NY;
      if (y >= cut || s.n < 10 || !Number.isFinite(birthT[p])) continue;
      const nx = S.get(p * NY + y + 1), a = ageAtT(p, seasonEnd[y]), ai = ageIdx(a);
      let next = null, w = 0;
      // (update 436) the next season as played; when it's missing or thin (a bad year often costs a player their starts:
      // leaving them out makes the players who stayed, the lucky ones, look like they declined), the season they'd have
      // been expected to have instead (baseball's survivor fix). Weighted by the first season's rounds.
      if (nx && nx.n >= 20) { next = nx.cats; w = s.n; }
      else if (y + 1 < cut && s.n >= 20) { const tl = talent(p, y); if (tl) { next = nx && nx.n ? tl.map((v, c) => (v * 20 + nx.cats[c] * nx.n) / (20 + nx.n)) : tl; w = s.n; } }
      if (!next) continue;
      pts.players.add(p); pts.pairs++;
      for (let c = 0; c < NC; c++) { acc[c].v[ai] += w * (next[c] - s.cats[c]); acc[c].w[ai] += w; }
      wsum[ai] += w;
    }
    // smoothed over about ±1.5 years; and a wider version (±4 years) that thin ages lean on instead (so a thin age keeps
    // the trend of the ages around it rather than losing its age effect)
    const smooth = (c, bwYears) => { const BW = bwYears / AS, g = new Float64Array(AN); for (let i = 0; i < AN; i++) { let t = 0, ww = 0; for (let j = Math.max(0, i - 3 * BW); j <= Math.min(AN - 1, i + 3 * BW); j++) { if (!acc[c].w[j]) continue; const k = Math.exp(-0.5 * ((i - j) / BW) ** 2) * acc[c].w[j]; t += k * acc[c].v[j] / acc[c].w[j]; ww += k; } g[i] = ww ? t / ww : 0; } return g; };
    for (let c = 0; c < NC; c++) {
      const g = smooth(c, 1.5);
      let m = 0, mw = 0; for (let i = 0; i < AN; i++) if (wsum[i]) { m += wsum[i] * g[i]; mw += wsum[i]; }
      g.mean = mw ? m / mw : 0; g.wide = smooth(c, 4); curves.push(g);
    }
    return { curves, aw: wsum, players: pts.players.size, pairs: pts.pairs };
  };

  // the whole fit on the seasons up to `cut`
  const fit = (cut) => {
    const F = adjust(cut), A = F.adj, S = seasonStats(A, cut, false), Tg = seasonStats(A, cut, true);
    // examples: each player at the end of each season, and their next season on the tour picked (20+ rounds)
    const ex = []; for (const [key, s] of Tg) { const y = key % NY; if (y >= 1 && s.n >= 20) ex.push({ p: Math.floor(key / NY), y: y - 1, n: s.n, act: s.cats }); }
    const sums = new Map(); const sumsFor = (hl) => { if (!sums.has(hl)) sums.set(hl, sumsAt(A, cut, hl)); return sums.get(hl); };
    // per part of the game: the half-life and the rounds of average added (and the average itself) that best forecast
    // the next season
    const best = [];
    for (let c = 0; c < NC; c++) {
      let b = null;
      for (const hl of HALVES) {
        const { W, X } = sumsFor(hl);
        for (const K of KS) {
          let num = 0, den = 0; for (const e of ex) { const i = (e.p * NY + e.y) * NC + c, wv = W[i], a = K / (wv + K); num += e.n * a * (e.act[c] - X[i] / (wv + K)); den += e.n * a * a; }
          const m = den ? num / den : 0; let err = 0;
          for (const e of ex) { const i = (e.p * NY + e.y) * NC + c, pr = (X[i] + K * m) / (W[i] + K); err += e.n * (e.act[c] - pr) ** 2; }
          if (!b || err < b.err) b = { hl, K, m, err };
        }
      }
      best.push(b || { hl: 1, K: 100, m: 0, err: 0 });
    }
    const estAt = (p, y) => { const out = []; for (let c = 0; c < NC; c++) { const { W, X } = sumsFor(best[c].hl), i = (p * NY + y) * NC + c; if (!W[i]) return null; out.push((X[i] + best[c].K * best[c].m) / (W[i] + best[c].K)); } return out; };
    // aging, from the seasons and the talent at each season's end (for the phantoms)
    const ag = agingOf(S, cut, estAt);
    const useAge = ag.players >= 20;
    const curves = useAge ? ag.curves : null;
    // the parts combined (Data Golf: each part's weight in the total, learned), with a year of aging in
    const XtX = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), Xty = [0, 0, 0, 0];
    for (const e of ex) { const est = estAt(e.p, e.y); if (!est) continue; const tot = e.act.reduce((s0, v) => s0 + v, 0); for (let i = 0; i < NC; i++) { Xty[i] += e.n * est[i] * tot; for (let j = 0; j < NC; j++) XtX[i][j] += e.n * est[i] * est[j]; } }
    // (a little shrinkage toward 1, each part counted as itself)
    for (let i = 0; i < NC; i++) { const lam = 1e-6 + 0.02 * XtX[i][i]; XtX[i][i] += lam; Xty[i] += lam; }
    const bw = solve4(XtX, Xty).map((v) => Math.max(0.3, Math.min(1.6, Number.isFinite(v) ? v : 1)));
    // how noisy a round is per part (for the uncertainty of a talent estimate)
    const sig2 = [0, 0, 0, 0].map((_, c) => { let e = 0, w = 0; for (let i = 0; i < N; i++) { if (YS[i] > cut || !(D.M[i] & (1 << c))) continue; const s = S.get(D.P[i] * NY + YS[i]); if (!s || s.n < 10) continue; e += (A[i * NC + c] - s.cats[c]) ** 2; w++; } return w ? e / w : 1; });
    return { F, cut, best, b: bw, sig2, curves, aw: ag.aw, useAge, age: { players: ag.players, pts: ag.pairs }, estAt, sumsFor };
  };
  // (a 4×4 solve)
  function solve4(A, bv) { const n = bv.length, M2 = A.map((r, i) => [...r, bv[i]]); for (let i = 0; i < n; i++) { let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(M2[r][i]) > Math.abs(M2[piv][i])) piv = r; [M2[i], M2[piv]] = [M2[piv], M2[i]]; const d = M2[i][i] || 1e-12; for (let r = 0; r < n; r++) if (r !== i) { const f = M2[r][i] / d; for (let c = i; c <= n; c++) M2[r][c] -= f * M2[i][c]; } } return M2.map((r, i) => r[n] / (r[i] || 1e-12)); }

  // a player's projection for season Y: their talent at the end of the last season fitted, aged forward a season at a
  // time (the age curve trusted by how much data each age has). No further pull to the average: that happens once.
  const AGE_K = [0, 0.1, 0.3, 1, 3, Infinity];
  const trustOf = (Mx, kc) => {
    Mx.trust ||= new Map(); if (Mx.trust.has(kc)) return Mx.trust.get(kc);
    const tw = new Float64Array(AN);
    if (kc === 0) tw.fill(1);
    else if (kc !== Infinity) {
      const w = Mx.aw, dens = new Float64Array(AN);
      for (let i = 0; i < AN; i++) { let t = 0; for (let j = Math.max(0, i - 8); j <= Math.min(AN - 1, i + 8); j++) t += w[j]; dens[i] = t; }
      const seen = [...dens].filter((v) => v > 0).sort((a, b) => a - b), med = seen.length ? seen[Math.floor(seen.length / 2)] : 0, k = kc * med;
      for (let i = 0; i < AN; i++) tw[i] = dens[i] + k > 0 ? dens[i] / (dens[i] + k) : 0;
    }
    Mx.trust.set(kc, tw); return tw;
  };
  const projectWith = (Mx, p, Y, kc = 0, shOn = 1) => {
    const y0 = Mx.cut, est = Mx.estAt(p, y0); if (!est) return null;
    const tw = trustOf(Mx, kc), bt = birthT[p];
    // from the middle of the last season (where the weighted average sits, roughly) to the middle of season Y
    const t0 = Number(yrs[y0]) + 0.5, tY = Number(Y) + 0.5;
    const cats = {}; let vl = 0, ageAdd = 0, lasting = 0;
    for (let c = 0; c < NC; c++) {
      const g = Mx.curves?.[c]; let a = 0, sh = 0;
      // (update 437) next season: only how a player's age makes them differ from the average change (the average change
      // itself is already in the next-season fit). Each season after that: the full change for their age (the average
      // change across players, plus how their age differs from it, trusted by how much data that age has)
      if (g) for (let t = t0; t < tY - 1e-9; t += 0.25) { const dt = Math.min(0.25, tY - t), m0 = g.mean || 0; if (shOn && t >= t0 + 1 - 1e-9) sh += m0 * dt; if (Number.isFinite(bt) && kc !== Infinity) { const ia = ageIdx(t + dt / 2 - bt), w0 = tw[ia]; a += (w0 * g[ia] + (1 - w0) * g.wide[ia] - m0) * dt; } }
      const v = Mx.b[c] * (est[c] + sh + a);
      cats[CATS[c]] = v; ageAdd += Mx.b[c] * (a + sh); lasting += Mx.b[c] * est[c];
      const { W } = Mx.sumsFor(Mx.best[c].hl), wv = W[(p * NY + y0) * NC + c];
      vl += Mx.b[c] ** 2 * Mx.sig2[c] / (wv + Mx.best[c].K);
    }
    return { cats, total: CATS.reduce((t, c) => t + cats[c], 0), varLevel: vl, ageAdd, lasting, temp: 0, trend: 0 };
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

  /* ---------------- 4b. signals: what might say a player will keep rising or falling ---------------- */
  // (update 433) each is worked out from the seasons up to the cut, then tested on seasons the model hadn't seen: only
  // the ones that make those forecasts better are kept. Age is already in the filter (above).
  const SIGS = [
    { key: "ballSpeed", label: "Ball speed change (mph, latest season vs. the one before)" },
    { key: "drive", label: "Driving distance change (yds, latest season vs. the one before)" },
    { key: "puttLed", label: "Putting ahead of the rest of their game (latest season)" },
    { key: "recentGap", label: "Last 6 months vs. their weighted average" },
    { key: "otherTours", label: "Other tours (Korn Ferry etc., credited for field strength) vs. their weighted average" },
    { key: "rounds", label: "Rounds played (latest season)" },
  ];
  const endOfCut = new Map();
  const sigOf = (Mx, p) => {
    Mx.sig ||= new Map(); if (Mx.sig.has(p)) return Mx.sig.get(p);
    const cut = Mx.cut, A = Mx.F.adj;
    if (!endOfCut.has(cut)) { let e = -Infinity; for (let i = 0; i < N; i++) if (YS[i] <= cut && D.T[i] > e) e = D.T[i]; endOfCut.set(cut, e); }
    const tEnd = endOfCut.get(cut);
    const est = Mx.estAt(p, Mx.cut); if (!est) { Mx.sig.set(p, null); return null; } const level = est.reduce((a, b) => a + b, 0);
    const { a, b } = D.players[p];
    const bs = [[0, 0], [0, 0]], dd = [[0, 0], [0, 0]], ct = [0, 0, 0, 0]; let n = 0, rN = 0, rT = 0, oN = 0, oT = 0;
    for (let i = a; i < b; i++) {
      if (YS[i] > cut) continue;
      let tot = 0; for (let c = 0; c < NC; c++) tot += A[i * NC + c];
      if (D.T[i] > tEnd - 0.5) { rN++; rT += tot; }
      const yy = cut - YS[i]; if (yy > 1) continue;
      if (D.BS && Number.isFinite(D.BS[i])) { bs[yy][0] += D.BS[i]; bs[yy][1]++; }
      if (D.DD && Number.isFinite(D.DD[i])) { dd[yy][0] += D.DD[i]; dd[yy][1]++; }
      if (yy) continue;
      n++; for (let c = 0; c < NC; c++) ct[c] += A[i * NC + c];
      if (D.TO[i] !== TT) { oN++; oT += tot; }
    }
    const chg = (x) => (x[0][1] >= 5 && x[1][1] >= 5 ? x[0][0] / x[0][1] - x[1][0] / x[1][1] : NaN);
    const z = [chg(bs), chg(dd), n >= 10 ? ct[3] / n - (ct[0] + ct[1] + ct[2]) / n / 3 : NaN, rN >= 8 ? rT / rN - level : NaN, oN >= 4 ? (oT / oN - level) * (oN / n) : 0, Math.log1p(n)];
    Mx.sig.set(p, z); return z;
  };
  const sigRecs = [];

  /* ---------------- 5. checked on seasons it hadn't seen ---------------- */
  const resid = { 1: [], 2: [], 3: [] };
  // (update 438) the age settings tried: how far to trust each age. The average change across players (mostly the tour
  // getting stronger) is never added: it would move everyone down by the same amount, which changes no rank or chance,
  // only makes every line slope down. Projections are against today's average field, as Marcel's are against today's
  // league (its age adjustment is centered the same way).
  const AGE_OPTS = AGE_K.map((kc) => ({ kc, sh: 0 }));
  const ageErr = AGE_OPTS.map(() => 0); let ageErrN = 0;
  let outOfSample = false;
  for (let t = 3; t < NY; t++) {
    const Mt = fit(t - 1);
    outOfSample = true;
    const prevS = seasonStats(Mt.F.adj, t - 1, false);
    const prevAvg = (() => { const r = rankedIn(t - 1, seasonStats(Mt.F.adj, t - 1, true)); return r.length ? r.reduce((s0, [, s]) => s0 + s.cats.reduce((a, b) => a + b, 0), 0) / r.length : 0; })();
    for (let h = 1; h <= 3 && t - 1 + h < NY; h++) {
      const yAct = t - 1 + h;
      for (const [key, s] of adjT) {
        if (key % NY !== yAct || s.n < 20) continue;
        const p = Math.floor(key / NY);
        const pr = projectWith(Mt, p, yrs[yAct], 0, 0); if (!pr) continue;
        const act = s.cats.reduce((a, b) => a + b, 0);
        // (update 420) how much of the age curve to use: tried at several strengths on these unseen seasons
        const preds = Mt.curves ? AGE_OPTS.map((o) => (o.kc === 0 ? pr : projectWith(Mt, p, yrs[yAct], o.kc, o.sh)).total) : null;
        if (preds) { preds.forEach((v, i) => { ageErr[i] += s.n * (act - v) ** 2; }); ageErrN += s.n; }
        const sd = Math.sqrt(pr.varLevel + sig2Tot / s.n);
        const pv = prevS.get(p * NY + (t - 1));
        const rec = { act, preds, sd, vl: pr.varLevel, r: act - pr.total, z: (act - pr.total) / sd, n: s.n, rLast: pv && pv.n >= 10 ? act - pv.cats.reduce((a, b) => a + b, 0) : null, rAvg: act - prevAvg };
        resid[h].push(rec);
        const zz = sigOf(Mt, p); if (zz) sigRecs.push({ rec, h, cut: t - 1, z: zz });
      }
    }
  }
  // (update 422) how far to trust the age curve, by how much data each age has: the setting that predicted these unseen seasons best
  const ageOpt = ageErrN >= 600 ? AGE_OPTS[ageErr.indexOf(Math.min(...ageErr))] : { kc: 0, sh: 0 };
  const ageK = ageOpt.kc, ageSh = ageOpt.sh;
  if (ageK !== 0) for (const h of [1, 2, 3]) for (const x of resid[h]) if (x.preds) { const v = x.preds[AGE_OPTS.indexOf(ageOpt)]; x.r = x.act - v; x.z = x.r / x.sd; }
  const trustAt = (age) => trustOf(M, ageK)[ageIdx(age)];
  // (update 433) the signals: standardized, then added one at a time while they make the unseen seasons' forecasts
  // better (each season held out in turn, the effects learned on the others); only those are kept
  const sigStd = SIGS.map((_, k) => { const v = sigRecs.map((x) => x.z[k]).filter(Number.isFinite); const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { m, sd, n: v.length }; });
  const zstd = (z, k) => (Number.isFinite(z[k]) && sigStd[k].sd > 1e-9 ? (z[k] - sigStd[k].m) / sigStd[k].sd : 0);
  const solve = (A, bv) => { const n = bv.length, M2 = A.map((r, i) => [...r, bv[i]]); for (let i = 0; i < n; i++) { let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(M2[r][i]) > Math.abs(M2[piv][i])) piv = r; [M2[i], M2[piv]] = [M2[piv], M2[i]]; const d = M2[i][i] || 1e-12; for (let r = 0; r < n; r++) if (r !== i) { const f = M2[r][i] / d; for (let c = i; c <= n; c++) M2[r][c] -= f * M2[i][c]; } } return M2.map((r, i) => r[n] / (r[i] || 1e-12)); };
  const fitB = (recs, ks) => [1, 2, 3].map((h) => {
    const R = recs.filter((x) => x.h === h); if (!ks.length || R.length < 30) return ks.map(() => 0);
    const A = ks.map(() => ks.map(() => 0)), bv = ks.map(() => 0); let wsum = 0;
    for (const x of R) { const w = 1 / (x.rec.sd * x.rec.sd), zz = ks.map((k) => zstd(x.z, k)); wsum += w; for (let i = 0; i < ks.length; i++) { bv[i] += w * zz[i] * x.rec.r; for (let j = 0; j < ks.length; j++) A[i][j] += w * zz[i] * zz[j]; } }
    for (let i = 0; i < ks.length; i++) A[i][i] += 0.01 * wsum; // (a little shrinkage)
    return solve(A, bv);
  });
  const predOf = (B, ks, x) => { const b = B[x.h - 1] || B[0]; let v = 0; ks.forEach((k, i) => { v += (b[i] || 0) * zstd(x.z, k); }); return v; };
  const cuts = [...new Set(sigRecs.map((x) => x.cut))];
  const cvBy = (ks) => cuts.map((c0) => { const B = fitB(sigRecs.filter((x) => x.cut !== c0), ks); let e = 0; for (const x of sigRecs) if (x.cut === c0) { const w = 1 / (x.rec.sd * x.rec.sd); e += w * (x.rec.r - predOf(B, ks, x)) ** 2; } return e; });
  const cvErr = (ks) => cvBy(ks).reduce((a, b) => a + b, 0);
  let kept = [], sigTried = null;
  if (cuts.length >= 2 && sigRecs.length >= 200) {
    const base = cvErr([]); let cur = base; sigTried = [];
    const avail = SIGS.map((_, k) => k).filter((k) => sigStd[k].n >= 50 && sigStd[k].sd > 1e-9);
    for (;;) {
      let best = null; const curBy = cvBy(kept);
      for (const k of avail) { if (kept.includes(k)) continue; const by = cvBy([...kept, k]), e = by.reduce((a, b) => a + b, 0); if (!best || e < best.e) best = { k, e, wins: by.filter((v, i) => v < curBy[i]).length }; }
      // it has to help by more than chance would: overall, and in most of the seasons held out
      if (!best || best.e > cur * 0.997 || best.wins < Math.ceil(cuts.length * 0.6)) break;
      kept.push(best.k); cur = best.e;
    }
    for (const k of avail) sigTried.push({ key: SIGS[k].key, label: SIGS[k].label, kept: kept.includes(k), alone: 1 - cvErr([k]) / base });
    sigTried.push({ key: "all", gain: 1 - cur / base });
  }
  const sigB = fitB(sigRecs, kept);
  // the kept signals' effect on the checks too (so the ranges are scaled on the forecasts as they'll be made)
  if (kept.length) for (const x of sigRecs) { const v = predOf(sigB, kept, x); x.rec.r -= v; x.rec.z = x.rec.r / x.rec.sd; }
  const sigAddOf = (p, h) => { if (!kept.length) return { add: 0, parts: {} }; const z = sigOf(M, p); if (!z) return { add: 0, parts: {} }; const b = sigB[h - 1] || sigB[0], parts = {}; let add = 0; kept.forEach((k, i) => { const v = (b[i] || 0) * zstd(z, k); parts[SIGS[k].key] = v; add += v; }); return { add, parts }; };

  // the ranges: scaled so 8 in 10 seasons it hadn't seen land inside (one season ahead)
  // (update 435) per season ahead, as ZiPS reports its ranges: 1 in 10 below the low end, 1 in 10 above the high end
  const kapOf = (R) => { const z = R.map((x) => Math.abs(x.z)).sort((a, b) => a - b); return z.length >= 20 ? Math.max(0.5, Math.min(4, z[Math.floor(z.length * 0.8)] / 1.2816)) : null; };
  const kappaH = [1, 2, 3].map((h) => kapOf(resid[h])); for (let h = 0; h < 3; h++) if (kappaH[h] == null) kappaH[h] = h ? kappaH[h - 1] * 1.15 : 1;
  for (let h = 1; h < 3; h++) kappaH[h] = Math.max(kappaH[h], kappaH[h - 1]); // (never narrower further out)
  const kappa = kappaH[0];
  // (update 439) the likely range of a player's LEVEL (not of one season's result, which adds that season's luck on top):
  // how far forecasts missed on unseen seasons, minus the part a season's luck alone explains, scaled onto each player's
  // own uncertainty (more rounds, narrower)
  const levelK = [1, 2, 3].map((h) => { const R = resid[h]; if (R.length < 20) return null; let e = 0, nz = 0, vl = 0; for (const x of R) { e += x.r * x.r; nz += sig2Tot / x.n; vl += x.vl; } const lv = Math.max(0.0025 * R.length, e - nz); return vl > 0 ? Math.sqrt(lv / vl) : null; });
  for (let h = 0; h < 3; h++) if (levelK[h] == null) levelK[h] = h ? levelK[h - 1] : 1;
  for (let h = 1; h < 3; h++) levelK[h] = Math.max(levelK[h], levelK[h - 1]);
  const err = [1, 2, 3].map((h) => {
    const R = resid[h]; if (R.length < 10) return null;
    const mae = R.reduce((t, x) => t + Math.abs(x.r), 0) / R.length;
    const B = R.filter((x) => x.rLast != null);
    const bt = B.length >= 10 ? { n: B.length, model: B.reduce((t, x) => t + Math.abs(x.r), 0) / B.length, last: B.reduce((t, x) => t + Math.abs(x.rLast), 0) / B.length, avg: B.reduce((t, x) => t + Math.abs(x.rAvg), 0) / B.length } : null;
    const inside = R.filter((x) => Math.abs(x.z) <= 1.2816 * kappaH[h - 1]).length / R.length;
    return { mae, n: R.length, bt, inside, bias: R.reduce((t, x) => t + x.r, 0) / R.length, sd: Math.sqrt(R.reduce((t, x) => t + x.r * x.r, 0) / R.length) };
  });

  /* ---------------- the future seasons, everyone ranked ---------------- */
  const sdOf = (pr, n = typicalN, h = 1) => kappaH[Math.min(3, Math.max(1, h)) - 1] * Math.sqrt(pr.varLevel + sig2Tot / Math.max(1, n));
  const projMemo = new Map();
  const project = (key, h) => {
    const p = typeof key === "number" ? key : D.players.findIndex((x) => x.key === key);
    if (p < 0) return null;
    const id = `${p}|${h}`; if (projMemo.has(id)) return projMemo.get(id);
    const pr = projectWith(M, p, Number(lastYear) + h, ageK, ageSh);
    let out = null;
    if (pr) { const sg = sigAddOf(p, h); out = { ...pr, total: pr.total + sg.add, sigAdd: sg.add, sigParts: sg.parts }; out.sd = sdOf(out, typicalN, h); out.sdLevel = levelK[h - 1] * Math.sqrt(pr.varLevel); }
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
  // per part of the game: the half-life of a round's weight, the rounds of average added, the weight in the total, and
  // so how much of a full season (typical rounds) carries into the next forecast
  const cats = Object.fromEntries(CATS.map((c, i) => { const b = M.best[i], lam = Math.log(2) / b.hl, fullW = typicalN * (1 - Math.exp(-lam)) / lam; // (a season's rounds, decayed over the season)
    return [c, { halfLife: b.hl, regressRounds: b.K, mean: b.m, weight: M.b[i], noise: Math.sqrt(M.sig2[i]), carry: Math.min(1, M.b[i] * fullW / (fullW + b.K)) }]; }));
  const ageOk = !!M.curves && ageK !== Infinity;
  // a season's change for age (as the projection applies it after next season)
  const ageCurve = (age) => Object.fromEntries(CATS.map((c, i) => { const g = M.curves?.[i]; if (!g || ageK === Infinity) return [c, 0]; const ia = ageIdx(age), w0 = trustAt(age); return [c, M.b[i] * (w0 * g[ia] + (1 - w0) * g.wide[ia] - (ageSh ? 0 : g.mean || 0))]; }));
  const sharedDrift = M.curves ? M.curves.reduce((t, g, i) => t + M.b[i] * (g.mean || 0), 0) : 0;
  const params = {
    kind: "marcel", sig2Tot, cats, carry: Object.fromEntries(CATS.map((c) => [c, cats[c].carry])), typicalN, outOfSample, kappa,
    field: { events: M.F.events, spread: M.F.spread },
    age: { shared: sharedDrift, k: ageK, none: ageK === Infinity, trust: Object.fromEntries([22, 26, 30, 34, 38, 42, 46, 50].map((a) => [a, trustAt(a)])), sharedOn: !!ageSh, tried: ageErrN >= 600 ? AGE_K.map((k) => ({ k, rmse: Math.sqrt(Math.min(...AGE_OPTS.map((o, i) => (o.kc === k ? ageErr[i] : Infinity))) / ageErrN) })) : null, players: M.useAge ? M.age.players : 0, pairs: M.useAge ? M.age.pts : 0, method: "delta",
      at: Object.fromEntries([24, 28, 32, 36, 40].map((a) => [a, CATS.reduce((t, c) => t + ageCurve(a)[c], 0)])) },
    spread: err.map((e) => e || { n: 0 }),
    signals: { tried: sigTried, kept: kept.map((k) => ({ key: SIGS[k].key, label: SIGS[k].label, perSd: sigB.map((b) => b[kept.indexOf(k)] || 0), sd: sigStd[k].sd })) },
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
    const sdL = pr.sdLevel ?? pr.sd, rankHi = rankAt(pr.total + 1.2816 * sdL), rankLo = rankAt(pr.total - 1.2816 * sdL);
    const ch = model.chances(key, h, pr.total, pr.sd);
    years.push({ year: String(Number(lastYear) + h), total: pr.total, ageAdd: pr.ageAdd, sigAdd: pr.sigAdd || 0, sigParts: pr.sigParts || {}, lasting: pr.lasting, temp: pr.temp, trend: pr.trend, cats: pr.cats, lo: pr.total - 1.2816 * (pr.sdLevel ?? pr.sd), hi: pr.total + 1.2816 * (pr.sdLevel ?? pr.sd), sdSeason: pr.sd, sd: pr.sd, rank, rankHi, rankLo, of: model.seasonN, top10: ch.top10, top50: ch.top50, top100: ch.top100 });
  }
  // (update 426) on the tour picked, raw, as the report's season table shows them (not field-adjusted), so the numbers match
  const lastS = hist.at(-1), prev = hist.slice(0, -1).slice(-3), wsum = prev.reduce((t, s) => t + s.n, 0);
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
    if (fl.vsUsual != null && Math.abs(fl.vsUsual) > fl.swing) bits.push(`Last season was ${fl.vsUsual > 0 ? "well above" : "well below"} their own recent average (${f2(fl.vsUsual)})${fl.usualFrom ? `, ${fl.usualFrom === fl.usualTo ? fl.usualFrom : `${fl.usualFrom}–${fl.usualTo}`}` : ""}.`);
    if (fl.ballStriking != null && fl.ballStriking > fl.swing) bits.push(`Their ball-striking (Off-the-Tee and Approach, ${f2(fl.ballStriking)}) is the part that holds best (about ${Math.round(((carry.OTT + carry.APP) / 2) * 100)}% carries over).`);
    if (fl.fewRounds) bits.push(`Only ${fl.lastN} rounds last season, so treat it as a rougher guess.`);
    if (fl.noBirth) bits.push(`No birth date in the data, so age isn't taken into account.`);
    out.push(bits.join(" "));
  }
  return out;
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
export { CATS as FORECAST_CATS, ageAt };
