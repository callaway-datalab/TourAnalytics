/*
 * The forecaster (update 396; update 397: every setting learned from the data). Next season's strokes gained for a
 * player, and the two after, from the data on this site alone. A "Marcel"-style projection: a weighted blend of recent
 * seasons, pulled back toward the tour average, plus an age change. Nothing in it is a number picked by hand: each
 * setting is the value that best forecast the past seasons in this data.
 *
 *   Learned here (from every player's seasons):
 *     tour offsets      how much harder or easier each other tour is (players on both tours in one season)
 *     season weights    how much the season before last, and the one before that, count against the latest
 *     pull-back (k)     per part of the game: how many "average rounds" are mixed in (how much carries over)
 *     horizon factors   how much of next season's forecast still holds two and three seasons ahead
 *     age curve         the change from one season to the next at each age, and how widely nearby ages are pooled
 *                       and how strongly a thinly measured age is held toward no change (both by cross-validation)
 *     ranges            how far off the forecast was on seasons it hadn't seen (rolling: each season forecast only
 *                       from the seasons before it), and how that shrinks with more rounds
 *   Chances (top 10 / top 50): simulated, every player's season drawn from their own forecast and range.
 *
 *   forecastModel(field, { tour })  → model
 *   forecastPlayer(model, key)      → { name, age, years: [{ year, total, cats, lo, hi, rank, of, top10, top50 }], flags }
 *   forecastStory(model, fcs)       → paragraphs
 */
const CATS = ["OTT", "APP", "ARG", "PUTT"];
const sq = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const minRoundsOf = (most) => Math.max(1, Math.floor((Math.max(0, Number(most) || 0) * 0.33) / 5) * 5); // (the site's rankings rule)

const ageAt = (birth, year) => {
  if (!birth) return null;
  const b = new Date(`${birth}T12:00:00Z`);
  if (isNaN(b)) return null;
  return (Date.UTC(Number(year), 6, 1) - b.getTime()) / (365.25 * 864e5); // (at the middle of the season)
};
// a seeded random number, so the same data always gives the same chances
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function seasonsOf(field) {
  const out = new Map();
  for (const p of field) {
    const m = new Map();
    for (const rd of p.rounds || []) {
      if (!rd.shots?.length || rd.eventLevel) continue;
      const y = String(rd.year || String(rd.date || "").slice(0, 4));
      if (!/^\d{4}$/.test(y)) continue;
      const t = rd.tour || "";
      const s = m.get(`${y}|${t}`) || m.set(`${y}|${t}`, { y, t, n: 0, sum: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 } }).get(`${y}|${t}`);
      s.n++;
      for (const x of rd.shots) if (s.sum[x.cat] != null) s.sum[x.cat] += x.sg || 0;
    }
    out.set(p.key, [...m.values()]);
  }
  return out;
}
// a search for the best value on a scale (golden section, on a log scale for k): f(x) → error
function bestOn(f, lo, hi, { log = false, steps = 40 } = {}) {
  const T = (x) => (log ? Math.exp(x) : x), a0 = log ? Math.log(lo) : lo, b0 = log ? Math.log(hi) : hi;
  // a coarse scan first (the error can have more than one dip), then a fine search around the best
  let best = a0, be = Infinity; const N = 16;
  for (let i = 0; i <= N; i++) { const x = a0 + ((b0 - a0) * i) / N, e = f(T(x)); if (e < be) { be = e; best = x; } }
  let a = Math.max(a0, best - (b0 - a0) / N), b = Math.min(b0, best + (b0 - a0) / N);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(T(c)), fd = f(T(d));
  for (let i = 0; i < steps; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(T(c)); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(T(d)); } }
  const x = (a + b) / 2, e = f(T(x));
  return e <= be ? { x: T(x), e } : { x: T(best), e: be };
}

// (learning it takes a few seconds on a full field: kept for the field and tour, so Compare and Cal share it)
const modelMemo = new WeakMap();
export function forecastModel(field, { tour = null } = {}) {
  const byTour = modelMemo.get(field) || (modelMemo.set(field, new Map()), modelMemo.get(field));
  const id = sq(tour || "");
  if (!byTour.has(id)) byTour.set(id, learnModel(field, { tour }));
  return byTour.get(id);
}
function learnModel(field, { tour = null } = {}) {
  const lines = seasonsOf(field);
  const tn = new Map(); for (const ls of lines.values()) for (const l of ls) tn.set(l.t, (tn.get(l.t) || 0) + l.n);
  const target = tour ? [...tn.keys()].find((t) => sq(t) === sq(tour)) ?? [...tn.keys()].find((t) => sq(t).includes(sq(tour)) || sq(tour).includes(sq(t))) ?? tour : [...tn].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const yearsAll = [...new Set([...lines.values()].flatMap((ls) => ls.map((l) => l.y)))].sort();
  // the tour average each season: the players who'd be ranked on the target tour that season (the site's rule)
  const meanOn = new Map();
  for (const y of yearsAll) {
    const ls = [...lines.values()].map((a) => a.find((l) => l.y === y && l.t === target)).filter(Boolean);
    const minR = minRoundsOf(Math.max(0, ...ls.map((l) => l.n)));
    const q = ls.filter((l) => l.n >= minR);
    meanOn.set(y, Object.fromEntries(CATS.map((c) => [c, q.length ? q.reduce((t, l) => t + l.sum[c] / l.n, 0) / q.length : 0])));
  }
  // (1) other tours: the gap for players on both in one season, weighted by the smaller number of rounds; how far to
  // trust it is learned with the pull-back below (k for that part of the game), so a thin tour gets a small offset
  const pairs = new Map();
  for (const ls of lines.values()) {
    const byY = new Map(); for (const l of ls) (byY.get(l.y) || byY.set(l.y, []).get(l.y)).push(l);
    for (const arr of byY.values()) {
      const main = arr.find((l) => l.t === target); if (!main) continue;
      for (const o of arr) {
        if (o.t === target) continue;
        const a = pairs.get(o.t) || pairs.set(o.t, { OTT: 0, APP: 0, ARG: 0, PUTT: 0, w: 0 }).get(o.t);
        const w = (main.n * o.n) / (main.n + o.n);
        for (const c of CATS) a[c] += w * (main.sum[c] / main.n - o.sum[c] / o.n);
        a.w += w;
      }
    }
  }
  const birthOf = new Map(field.map((p) => [p.key, p.birth || null]));
  const nameOf = new Map(field.map((p) => [p.key, p.name || p.key]));
  const build = (K) => {
    const tourAdj = new Map([[target, { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }]]);
    for (const [t, a] of pairs) if (a.w > 0) tourAdj.set(t, Object.fromEntries(CATS.map((c) => [c, a[c] / (a.w + (K?.[c] ?? 0))])));
    const seasons = new Map();
    for (const [key, ls] of lines) {
      const byY = new Map();
      for (const l of ls) {
        const adj = tourAdj.get(l.t); if (!adj) continue;
        const s = byY.get(l.y) || byY.set(l.y, { n: 0, sum: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 } }).get(l.y);
        s.n += l.n; for (const c of CATS) s.sum[c] += l.sum[c] + adj[c] * l.n;
      }
      const m = new Map();
      for (const [y, s] of byY) { const mu = meanOn.get(y); m.set(y, { n: s.n, d: Object.fromEntries(CATS.map((c) => [c, s.sum[c] / s.n - mu[c]])) }); }
      seasons.set(key, m);
    }
    return { tourAdj, seasons };
  };
  const years = yearsAll, lastYear = years.at(-1);
  // the blend of the seasons up to year index i: weights W = [1, w2, w3] × rounds
  const blendAt = (seasons, key, i, W) => {
    const m = seasons.get(key); if (!m) return null;
    let wn = 0, n = 0; const dev = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 };
    for (let j = 0; j < W.length && i - j >= 0; j++) {
      const s = m.get(years[i - j]); if (!s) continue;
      const w = W[j] * s.n;
      for (const c of CATS) dev[c] += w * s.d[c];
      wn += w; n += s.n;
    }
    return wn > 0 ? { dev, wn, n } : null;
  };
  // every (player, season → a later season) the history offers, h seasons ahead, weighted by the later season's rounds
  const casesOf = (seasons, h, W, maxY = null) => {
    const out = [];
    for (let i = 0; i + h < years.length; i++) {
      if (maxY && years[i + h] > maxY) continue;
      for (const [key, m] of seasons) {
        const next = m.get(years[i + h]); if (!next) continue;
        const b = blendAt(seasons, key, i, W); if (!b) continue;
        out.push({ key, b, next, i, h, w: next.n });
      }
    }
    return out;
  };
  // flat arrays for one-season-ahead cases: rounds and values of the three seasons behind each, and the result
  const packOf = (seasons, h, maxY = null) => {
    const rows = [];
    for (let i = 0; i + h < years.length; i++) {
      if (maxY && years[i + h] > maxY) continue;
      for (const [, m] of seasons) {
        const next = m.get(years[i + h]); if (!next) continue;
        const back = [0, 1, 2].map((j) => (i - j >= 0 ? m.get(years[i - j]) : null));
        if (!back.some(Boolean)) continue;
        rows.push({ next, back });
      }
    }
    const N = rows.length, n = [0, 1, 2].map(() => new Float64Array(N)), d = Object.fromEntries(CATS.map((c) => [c, [0, 1, 2].map(() => new Float64Array(N))])), y = Object.fromEntries(CATS.map((c) => [c, new Float64Array(N)])), w = new Float64Array(N);
    rows.forEach((r, k) => { w[k] = r.next.n; for (const c of CATS) y[c][k] = r.next.d[c]; r.back.forEach((b, j) => { if (!b) return; n[j][k] = b.n; for (const c of CATS) d[c][j][k] = b.d[c]; }); });
    return { N, n, d, y, w };
  };
  // for weights W: each case's weighted rounds (wn) and the weighted deviation per part of the game
  const blendPack = (pk, W) => {
    const wn = new Float64Array(pk.N), dev = Object.fromEntries(CATS.map((c) => [c, new Float64Array(pk.N)]));
    for (let k = 0; k < pk.N; k++) { let t = 0; for (let j = 0; j < 3; j++) { const v = W[j] * pk.n[j][k]; t += v; for (const c of CATS) dev[c][k] += v * pk.d[c][j][k]; } wn[k] = t; }
    return { wn, dev };
  };
  const errK = (pk, bl, c, k) => { let e = 0, w = 0; const y = pk.y[c], dv = bl.dev[c], wn = bl.wn, ww = pk.w; for (let i = 0; i < pk.N; i++) { if (wn[i] <= 0) continue; const r = y[i] - dv[i] / (wn[i] + k); e += ww[i] * r * r; w += ww[i]; } return w ? e / w : Infinity; };
  // (2) the season weights and the pull-back for each part of the game, learned together on one-season-ahead cases
  // (the tour offsets use the pull-back, so they're refined with it: two passes)
  const fitCore = (maxY = null) => {
    let K = { OTT: 100, APP: 100, ARG: 100, PUTT: 100 }, W = [1, 0.5, 0.25], built = build(K);
    for (let pass = 0; pass < 2; pass++) {
      built = build(K);
      const pk = packOf(built.seasons, 1, maxY);
      if (!pk.N) break;
      const total = (W2) => { const bl = blendPack(pk, W2); let e = 0; for (const c of CATS) e += bestOn((k) => errK(pk, bl, c, k), 0.5, 20000, { log: true, steps: 8 }).e; return e; };
      // w2 then w3 (each 0 to 1.5 of the latest season's weight), each with the pull-back re-learned inside; twice round
      let w2 = W[1], w3 = W[2];
      for (let r = 0; r < 1; r++) { w2 = bestOn((w) => total([1, w, w3]), 0, 1.5, { steps: 12 }).x; w3 = bestOn((w) => total([1, w2, w]), 0, 1.5, { steps: 12 }).x; }
      W = [1, w2, w3];
      const bl = blendPack(pk, W);
      K = Object.fromEntries(CATS.map((c) => [c, bestOn((k) => errK(pk, bl, c, k), 0.5, 20000, { log: true }).x]));
    }
    built = build(K);
    return { K, W, built };
  };
  // (3) how much of the forecast holds two and three seasons ahead: the least-squares factor on those cases
  const fitHorizon = (core, maxY = null) => {
    const H = [1];
    for (const h of [2, 3]) {
      const cs = casesOf(core.built.seasons, h, core.W, maxY);
      let num = 0, den = 0;
      for (const x of cs) for (const c of CATS) { const p = x.b.dev[c] / (x.b.wn + core.K[c]); num += x.w * p * x.next.d[c]; den += x.w * p * p; }
      H.push(den > 0 ? Math.max(0, Math.min(1.5, num / den)) : H.at(-1));
    }
    return H;
  };
  // (4) age: each player's change from one season to the next (both seasons' strokes gained against the tour average),
  // weighted by how many rounds are behind it, less the change the pull-back already expects; pooled over nearby
  // ages (how widely: cross-validated) and held toward no change where it's thin (how strongly: cross-validated)
  const fitAge = (core, maxY = null) => {
    const pts = [];
    for (const [key, m] of core.built.seasons) {
      const birth = birthOf.get(key); if (!birth) continue;
      for (let i = 0; i + 1 < years.length; i++) {
        if (maxY && years[i + 1] > maxY) continue;
        const next = m.get(years[i + 1]); if (!next) continue;
        const b = blendAt(core.built.seasons, key, i, core.W); if (!b) continue;
        const age = ageAt(birth, years[i]); if (age == null || age < 15 || age > 65) continue;
        // what's left after the forecast without age: the part age explains (plus noise)
        pts.push({ age, key, w: (next.n * b.n) / (next.n + b.n), r: Object.fromEntries(CATS.map((c) => [c, next.d[c] - b.dev[c] / (b.wn + core.K[c])])) });
      }
    }
    // the points summed into quarter-year bins (weights and weighted changes), per fold, so a curve is quick to draw
    const binsOf = (P) => { const m = new Map(); for (const x of P) { const a = Math.round(x.age * 4) / 4; const b = m.get(a) || m.set(a, { age: a, w: 0, OTT: 0, APP: 0, ARG: 0, PUTT: 0 }).get(a); b.w += x.w; for (const c of CATS) b[c] += x.w * x.r[c]; } return [...m.values()]; };
    const curveOf = (P, bw, s, B = binsOf(P)) => (age) => {
      const out = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }; let w = 0;
      for (const b of B) { const k = Math.exp(-((b.age - age) ** 2) / (2 * bw * bw)); w += k * b.w; for (const c of CATS) out[c] += k * b[c]; }
      if (!w) return out;
      for (const c of CATS) out[c] /= w + s; // (held toward no change by s "rounds" of no change)
      return out;
    };
    if (pts.length < 2) return { pts: 0, curve: () => ({ OTT: 0, APP: 0, ARG: 0, PUTT: 0 }), bw: null, s: null, players: 0 };
    // 5 groups of players: each group's changes forecast from a curve learned on the other four
    const fold = (k) => { let h = 0; for (const ch of String(k)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 5; };
    const folds = [0, 1, 2, 3, 4].map((f) => { const tr = pts.filter((x) => fold(x.key) !== f), te = pts.filter((x) => fold(x.key) === f); return { tr, te, B: binsOf(tr) }; });
    // each fold's test changes, summed by half-year of age; the training curve's kernel sums there, kept per bandwidth
    for (const f of folds) { const m = new Map(); for (const x of f.te) { const a = Math.round(x.age * 2) / 2; const g = m.get(a) || m.set(a, { a, w: 0, r: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }, rr: 0, xs: [] }).get(a); g.xs.push(x); } f.g = [...m.values()]; }
    const sumMemo = new Map();
    const sumsFor = (fi, bw) => {
      const id = `${fi}|${bw}`; if (sumMemo.has(id)) return sumMemo.get(id);
      const { B, g } = folds[fi], inv = 1 / (2 * bw * bw);
      const out = g.map((gr) => { let w = 0; const sc = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }; for (const b of B) { const k = Math.exp(-((b.age - gr.a) ** 2) * inv); w += k * b.w; for (const c of CATS) sc[c] += k * b[c]; } return { w, sc }; });
      sumMemo.set(id, out); return out;
    };
    const cv = (bw, s) => {
      let e = 0, w = 0;
      folds.forEach((f, fi) => {
        if (!f.tr.length || !f.te.length) return;
        const S = sumsFor(fi, bw);
        f.g.forEach((gr, gi) => { const { w: sw, sc } = S[gi]; for (const x of gr.xs) for (const c of CATS) { const p = sw ? sc[c] / (sw + s) : 0, r = x.r[c] - p; e += x.w * r * r; w += x.w; } });
      });
      return w ? e / w : Infinity;
    };
    const span = Math.max(1, Math.max(...pts.map((x) => x.age)) - Math.min(...pts.map((x) => x.age)));
    let bw = 3, s = 100;
    for (let it = 0; it < 2; it++) {
      bw = bestOn((v) => cv(v, s), 0.5, Math.max(1, span), { log: true, steps: 12 }).x;
      s = bestOn((v) => cv(bw, v), 1, 1e6, { log: true, steps: 12 }).x;
    }
    const cur = curveOf(pts, bw, s), memo = new Map();
    return { pts: pts.length, players: new Set(pts.map((x) => x.key)).size, bw, s, curve: (age) => { const a = Math.round(age * 4) / 4; if (!memo.has(a)) memo.set(a, cur(a)); return memo.get(a); } };
  };
  const projectWith = (P, seasons, key, i, h) => {
    const b = blendAt(seasons, key, i, P.W); if (!b) return null;
    const age0 = ageAt(birthOf.get(key), years[i]);
    const cats = {}; let ageAdd = 0;
    for (const c of CATS) {
      let a = 0;
      if (age0 != null) for (let j = 0; j < h; j++) a += P.age.curve(age0 + j)[c];
      cats[c] = (b.dev[c] / (b.wn + P.K[c])) * P.H[h - 1] + a; ageAdd += a;
    }
    return { cats, total: CATS.reduce((t, c) => t + cats[c], 0), n: b.n, ageAdd };
  };
  const fitAll = (maxY = null) => { const core = fitCore(maxY); const H = fitHorizon(core, maxY); const age = fitAge(core, maxY); return { K: core.K, W: core.W, H, age, built: core.built }; };
  const P = fitAll();
  // (5) how far off it is on seasons it hasn't seen: each season from the fourth on, forecast from a model learned only
  // on the seasons before it (with fewer seasons than that, the error on the seasons it learned from, and it says so)
  const resid = { 1: [], 2: [], 3: [] };
  let outOfSample = false;
  for (let t = 3; t < years.length; t++) {
    const Pt = fitAll(years[t - 1]);
    outOfSample = true;
    for (const h of [1, 2, 3]) {
      const i = t - h; if (i < 0) continue;
      for (const [key, m] of Pt.built.seasons) {
        const act = m.get(years[t]); if (!act) continue;
        const pr = projectWith(Pt, Pt.built.seasons, key, i, h); if (!pr) continue;
        const a = CATS.reduce((s0, c) => s0 + act.d[c], 0);
        resid[h].push({ r: a - pr.total, n: act.n, nb: pr.n });
      }
    }
  }
  if (!outOfSample) for (const h of [1, 2, 3]) for (let i = 0; i + h < years.length; i++) for (const [key, m] of P.built.seasons) {
    const act = m.get(years[i + h]); if (!act) continue;
    const pr = projectWith(P, P.built.seasons, key, i, h); if (!pr) continue;
    resid[h].push({ r: CATS.reduce((s0, c) => s0 + act.d[c], 0) - pr.total, n: act.n, nb: pr.n });
  }
  // the spread of a season's result: a part from the player (how much their level moves) and a part from the rounds
  // (luck that evens out over more of them): r² ≈ a + b / rounds, fitted by least squares
  const spread = [1, 2, 3].map((h) => {
    const R = resid[h].length ? resid[h] : resid[1];
    if (R.length < 3) return { a: 0.3, b: 30, n: R.length };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, sw = 0;
    for (const x of R) { const u = 1 / Math.max(1, x.n), y = x.r * x.r, w = x.n; sw += w; sx += w * u; sy += w * y; sxx += w * u * u; sxy += w * u * y; }
    const den = sw * sxx - sx * sx;
    let b = den > 0 ? (sw * sxy - sx * sy) / den : 0, a = (sy - b * sx) / sw;
    if (b < 0) { b = 0; a = sy / sw; } if (a < 0) { a = 0; b = sy / sx; }
    const mae = R.reduce((t, x) => t + Math.abs(x.r), 0) / R.length;
    return { a, b, n: R.length, mae, sd: Math.sqrt(R.reduce((t, x) => t + x.r * x.r, 0) / R.length) };
  });
  // a forecast's range for a full season (the tour's typical rounds a season for ranked players)
  const typicalN = (() => { const ns = []; for (const m of P.built.seasons.values()) { const s = m.get(lastYear); if (s) ns.push(s.n); } ns.sort((a, b) => a - b); return ns.length ? ns[Math.floor(ns.length * 0.75)] : 60; })();
  const sdFor = (h, n = typicalN) => Math.sqrt(spread[h - 1].a + spread[h - 1].b / Math.max(1, n));
  const project = (key, h) => projectWith(P, P.built.seasons, key, years.length - 1, h);
  // the field each future season: the players who'd be ranked on this tour over the last two seasons (the site's rule)
  const recentYears = new Set(years.slice(-2));
  const recentN = [...lines].map(([k, ls]) => [k, ls.filter((l) => l.t === target && recentYears.has(l.y)).reduce((t, l) => t + l.n, 0)]);
  const minPool = minRoundsOf(Math.max(0, ...recentN.map(([, n]) => n)));
  const pool = recentN.filter(([, n]) => n >= minPool).map(([k]) => k);
  const fieldProj = [1, 2, 3].map((h) => pool.map((k) => ({ k, v: project(k, h)?.total })).filter((x) => x.v != null).sort((a, b) => b.v - a.v));
  // (6) chances: 3,000 simulated seasons, each player drawn from their own forecast and range
  const chanceMemo = new Map();
  const chances = (key, h, mine) => {
    const id = `${key}|${h}`; if (chanceMemo.has(id)) return chanceMemo.get(id);
    const others = fieldProj[h - 1].filter((x) => x.k !== key), sdO = sdFor(h), sdM = sdFor(h);
    // (far below the 50th best even in a great season: no chance worth drawing for)
    if (others.length >= 50 && mine + 5 * sdM < others[49].v - 5 * sdO) { const o = { top10: 0, top50: 0 }; chanceMemo.set(id, o); return o; }
    const r = rng(12345 + h); let t10 = 0, t50 = 0; const S = 3000;
    for (let s = 0; s < S; s++) {
      const me = mine + gauss(r) * sdM; let better = 0;
      for (const o of others) { if (o.v + gauss(r) * sdO > me) { better++; if (better >= 50) break; } }
      if (better < 10) t10++; if (better < 50) t50++;
    }
    const out = { top10: others.length >= 10 ? t10 / S : null, top50: others.length >= 50 ? t50 / S : null };
    chanceMemo.set(id, out); return out;
  };
  const params = {
    weights: P.W, K: P.K, H: P.H,
    carry: Object.fromEntries(CATS.map((c) => [c, (typicalN) / (typicalN + P.K[c])])), // (how much of a full season's number carries over)
    age: { pairs: P.age.pts, players: P.age.players, bandwidth: P.age.bw, hold: P.age.s, at: Object.fromEntries([24, 28, 32, 36, 40].map((a) => [a, CATS.reduce((t, c) => t + P.age.curve(a)[c], 0)])) },
    tours: [...pairs].map(([t, a]) => ({ tour: t, rounds: Math.round(a.w), offset: CATS.reduce((s0, c) => s0 + (P.built.tourAdj.get(t)?.[c] || 0), 0) })),
    typicalN, outOfSample, spread,
  };
  return {
    target, years, lastYear, params, K: P.K, ageOk: P.age.pts >= 2 && P.age.bw != null, agePlayers: P.age.players || 0,
    err: spread.map((s) => (s.n ? { sd: s.sd, mae: s.mae, n: s.n } : null)), outOfSample,
    seasons: P.built.seasons, birthOf, nameOf, project, sdFor, fieldProj, chances, ageCurve: (a) => P.age.curve(a), meanOn,
  };
}

/** One player's forecast (null without any season to go on). */
export function forecastPlayer(model, key) {
  const { lastYear, seasons } = model;
  const m = seasons.get(key);
  if (!m || !lastYear || !m.size) return null;
  const birth = model.birthOf.get(key) || null;
  const age = birth ? ageAt(birth, lastYear) : null;
  const hist = [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([y, s]) => ({ year: y, n: s.n, total: CATS.reduce((t, c) => t + s.d[c], 0), cats: { ...s.d } }));
  const years = [];
  for (const h of [1, 2, 3]) {
    const pr = model.project(key, h);
    if (!pr) return null;
    const sd = model.sdFor(h);
    const others = model.fieldProj[h - 1].filter((x) => x.k !== key);
    const rank = 1 + others.filter((x) => x.v > pr.total).length;
    const ch = model.chances(key, h, pr.total);
    years.push({ year: String(Number(lastYear) + h), total: pr.total, ageAdd: pr.ageAdd, cats: pr.cats, lo: pr.total - 1.2816 * sd, hi: pr.total + 1.2816 * sd, sd, rank, of: others.length + 1, top10: ch.top10, top50: ch.top50 });
  }
  const lastS = hist.at(-1);
  const prev = hist.slice(0, -1).slice(-3);
  const wsum = prev.reduce((t, s) => t + s.n, 0);
  const careerPutt = wsum ? prev.reduce((t, s) => t + s.cats.PUTT * s.n, 0) / wsum : null;
  const careerTot = wsum ? prev.reduce((t, s) => t + s.total * s.n, 0) / wsum : null;
  // a season's luck is told against how much it would normally swing with this many rounds (the model's own spread)
  const swing = Math.sqrt(model.params.spread[0].b / Math.max(1, lastS?.n || 1));
  const flags = {
    rounds: hist.reduce((t, s) => t + s.n, 0), lastN: lastS?.n || 0,
    puttLed: !!lastS && lastS.total > swing && lastS.cats.PUTT > lastS.total / 2,
    puttAboveUsual: careerPutt != null && lastS ? lastS.cats.PUTT - careerPutt : null,
    vsUsual: careerTot != null && lastS ? lastS.total - careerTot : null,
    swing,
    ballStriking: lastS ? lastS.cats.OTT + lastS.cats.APP : null,
    fewRounds: (lastS?.n || 0) < model.params.typicalN / 2,
    noBirth: !birth,
  };
  return { key, name: model.nameOf.get(key) || key, birth, age, now: lastS?.year === lastYear ? lastS : null, hist, years, flags, tour: model.target };
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
    if (fl.puttLed) bits.push(`Most of their last season came from putting, and in this data only about ${Math.round(carry.PUTT * 100)}% of a putting number carries into the next season, so the forecast pulls it back.`);
    else if (fl.puttAboveUsual != null && Math.abs(fl.puttAboveUsual) > fl.swing / 2) bits.push(`Their putting was ${fl.puttAboveUsual > 0 ? "well above" : "well below"} their usual (${f2(fl.puttAboveUsual)}): ${fl.puttAboveUsual > 0 ? "expect some of it to come back" : "likely to bounce back some"}.`);
    if (fl.vsUsual != null && Math.abs(fl.vsUsual) > fl.swing) bits.push(`Last season was ${fl.vsUsual > 0 ? "well above" : "well below"} their own recent average (${f2(fl.vsUsual)}).`);
    if (fl.ballStriking != null && fl.ballStriking > fl.swing) bits.push(`Their ball-striking (Off-the-Tee and Approach, ${f2(fl.ballStriking)}) is the part that holds best (about ${Math.round(((carry.OTT + carry.APP) / 2) * 100)}% carries over).`);
    if (fl.fewRounds) bits.push(`Only ${fl.lastN} rounds last season, so treat it as a rougher guess.`);
    if (fl.noBirth) bits.push(`No birth date in the data, so age isn't taken into account.`);
    out.push(bits.join(" "));
  }
  return out;
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
export { CATS as FORECAST_CATS, ageAt };
