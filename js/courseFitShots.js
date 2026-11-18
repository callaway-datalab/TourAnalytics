// (update 862) Course Fit from the shot files: what a course's shots say about why its best players win there, and how a
// player's own misses suit it. Reads the small summary each course keeps on its record (meta.fit, written at Rebuild maps):
//   rF, rT          rounds: the field's, the Top 10's
//   sgF, sgT, cF, cT strokes gained and attempts in each strokes-gained range (the field's, the Top 10's)
//   holes[h]        par, f / t: [plays, total to par] (field, Top 10), dbl: [doubles or worse, their total to par, the
//                   Top 10's], drive: { L, C, R: [n, total to par] } (where the drive finished: left, fairway, right),
//                   app: { G | Short | Long | Left | Right | Short-Left …: [n, total to par] } (the approach's outcome)
//   miss[key]       a player's: t: [left, fairway, right] tee shots, a: { outcome: n } approaches, h: holes, d: doubles
// Everything is per round (18 holes) unless it says otherwise.

const mean = (a) => (a && a[0] ? a[1] / a[0] : null), f2m = (v) => `${v < 0 ? "\u2212" : ""}${Math.abs(v).toFixed(2)}`;
export const hasFit = (meta) => !!(meta?.fit?.v && meta.fit.holes && Object.keys(meta.fit.holes).length >= 9);

/** a strokes-gained range's part of the game (the file's skill names, or the distance ranges) */
export function catOfBucket(b) {
  const s = String(b).toLowerCase();
  if (/tee shot|off.?the.?tee|^ott|driv/.test(s)) return "OTT";
  if (/putt|\bft\b|feet/.test(s)) return "PUTT";
  if (/around|^arg|<\s*30\s*y|30\s*-\s*50\s*y/.test(s)) return "ARG";
  return "APP";
}
export const CAT_NAMES = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };

/**
 * Why the Top 10 win here, part by part: their edge over the rest of the field (strokes gained per round) split into
 *   better: better at the same shots (strokes gained a shot, at the rest's number of attempts), and
 *   more:   more (or fewer) of the shots that are worth strokes here (attempts per round, at the strokes gained a shot);
 * with the ranges where they face the most more (or fewer) shots than the rest (shorter approaches after longer drives …).
 */
export function whyTopWin(F) {
  const rR = F.rF - F.rT; if (!F.rT || rR <= 0) return null;
  const rows = [];
  for (const b of Object.keys(F.cF || {})) {
    const cT = F.cT?.[b] || 0, cR = (F.cF[b] || 0) - cT; if (cT < 10 || cR < 30) continue;
    const aT = cT / F.rT, aR = cR / rR, sT = (F.sgT?.[b] || 0) / cT, sR = ((F.sgF?.[b] || 0) - (F.sgT?.[b] || 0)) / cR;
    rows.push({ b, cat: catOfBucket(b), aT, aR, sT, sR, gap: aT * sT - aR * sR, more: (aT - aR) * (sT + sR) / 2, better: (sT - sR) * (aT + aR) / 2 });
  }
  if (!rows.length) return null;
  const parts = ["OTT", "APP", "ARG", "PUTT"].map((c) => { const xs = rows.filter((x) => x.cat === c); if (!xs.length) return null;
    return { cat: c, gap: xs.reduce((t, x) => t + x.gap, 0), better: xs.reduce((t, x) => t + x.better, 0), more: xs.reduce((t, x) => t + x.more, 0), rows: xs }; }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  const faced = [...rows].filter((x) => x.cat !== "OTT").sort((a, b) => Math.abs(b.aT - b.aR) - Math.abs(a.aT - a.aR)).slice(0, 3).filter((x) => Math.abs(x.aT - x.aR) >= 0.15);
  return { parts, faced, total: parts.reduce((t, p) => t + p.gap, 0) };
}

/**
 * Where the Top 10 win it: each hole's scoring (field, Top 10, the rest), the Top 10's edge there a round, its share of their
 * whole edge, and how often it blows up (double bogey or worse); with how much of the edge the three biggest holes hold.
 */
export function whereTopWin(F) {
  const hs = [];
  for (const [h, X] of Object.entries(F.holes || {})) {
    const fN = X.f?.[0] || 0, tN = X.t?.[0] || 0, rN = fN - tN; if (fN < 20 || tN < 4 || rN < 10) continue;
    const top = X.t[1] / tN, rest = (X.f[1] - X.t[1]) / rN, dN = X.dbl?.[0] || 0, dT = X.dbl?.[2] || 0;
    hs.push({ h: Number(h), par: X.par, field: X.f[1] / fN, top, rest, edge: rest - top, dbl: dN / fN, dblTop: tN ? dT / tN : 0, dblRest: rN ? (dN - dT) / rN : 0,
      // the strokes a round the hole's blow-ups cost beyond a bogey (how much a double or worse there hurts, on average)
      blow: dN ? (X.dbl[1] - dN) / fN : 0 });
  }
  if (hs.length < 9) return null;
  const tot = hs.reduce((t, x) => t + Math.max(0, x.edge), 0) || 1;
  for (const x of hs) x.share = Math.max(0, x.edge) / tot;
  const byEdge = [...hs].sort((a, b) => b.edge - a.edge), top3 = byEdge.slice(0, 3), conc = top3.reduce((t, x) => t + x.share, 0);
  const blowups = [...hs].filter((x) => x.dbl >= 0.06).sort((a, b) => b.blow - a.blow).slice(0, 3);
  return { holes: hs.sort((a, b) => a.h - b.h), byEdge, top3, conc, even: conc < 0.3 + 3 / hs.length, blowups, exposure: hs.reduce((t, x) => t + x.blow, 0) * (18 / hs.length) };
}

// ---------- each player's misses, from every course they've played on record ----------
const SIDES5 = ["G", "Short", "Long", "Left", "Right"];
/** an approach outcome split into the five (a corner miss counts half to each side) */
const split5 = (o) => { const out = { G: 0, Short: 0, Long: 0, Left: 0, Right: 0 };
  for (const [k, v] of Object.entries(o || {})) { const n = Array.isArray(v) ? v[0] : v; if (!n) continue; const p = String(k).split("-").filter((x) => x in out); if (!p.length) continue; for (const q of p) out[q] += n / p.length; }
  return out; };
const split5Sum = (o) => { const out = { G: [0, 0], Short: [0, 0], Long: [0, 0], Left: [0, 0], Right: [0, 0] };
  for (const [k, v] of Object.entries(o || {})) { const p = String(k).split("-").filter((x) => x in out); if (!p.length || !v?.[0]) continue; for (const q of p) { out[q][0] += v[0] / p.length; out[q][1] += v[1] / p.length; } }
  return out; };

/** a player's misses: every uploaded course added up (and the field's, every player, for comparing) */
export function missProfile(key, metas) {
  const me = { t: [0, 0, 0], a: { G: 0, Short: 0, Long: 0, Left: 0, Right: 0 }, h: 0, d: 0, courses: 0 }, all = { t: [0, 0, 0], a: { G: 0, Short: 0, Long: 0, Left: 0, Right: 0 }, h: 0, d: 0 };
  for (const m of metas) { if (!hasFit(m)) continue;
    for (const [k, P] of Object.entries(m.fit.miss || {})) { const tgt = [all, ...(k === key ? [me] : [])];
      if (k === key) me.courses++;
      const a5 = split5(P.a);
      for (const T of tgt) { for (let i = 0; i < 3; i++) T.t[i] += P.t?.[i] || 0; for (const s of SIDES5) T.a[s] += a5[s]; T.h += P.h || 0; T.d += P.d || 0; } } }
  const tN = me.t[0] + me.t[1] + me.t[2], aN = SIDES5.reduce((t, s) => t + me.a[s], 0), tA = all.t[0] + all.t[1] + all.t[2], aA = SIDES5.reduce((t, s) => t + all.a[s], 0);
  const pct = (v, n) => (n ? v / n : null);
  return { key, courses: me.courses, tee: { n: tN, L: pct(me.t[0], tN), C: pct(me.t[1], tN), R: pct(me.t[2], tN) }, app: { n: aN, ...Object.fromEntries(SIDES5.map((s) => [s, pct(me.a[s], aN)])) },
    holes: me.h, dbl: pct(me.d, me.h),
    field: { tee: { L: pct(all.t[0], tA), C: pct(all.t[1], tA), R: pct(all.t[2], tA) }, app: Object.fromEntries(SIDES5.map((s) => [s, pct(all.a[s], aA)])), dbl: pct(all.d, all.h) },
    enough: { tee: tN >= 60, app: aN >= 60, dbl: me.h >= 90 } };
}
/** a few words on a profile: their tee miss and approach miss against the field's */
export function missWords(P, who = "They") {
  const out = [];
  if (P.tee.n >= 20) { const lr = P.tee.L + P.tee.R ? P.tee.L / (P.tee.L + P.tee.R) : 0.5, flr = P.field.tee.L + P.field.tee.R ? P.field.tee.L / (P.field.tee.L + P.field.tee.R) : 0.5;
    const side = lr >= flr + 0.08 ? "left" : lr <= flr - 0.08 ? "right" : null;
    out.push(`Off the tee: ${Math.round(P.tee.C * 100)}% fairways (the field ${Math.round(P.field.tee.C * 100)}%); misses ${side ? `go ${side} ${Math.round((side === "left" ? lr : 1 - lr) * 100)}% of the time (the field ${Math.round((side === "left" ? flr : 1 - flr) * 100)}%)` : `split about evenly left and right (${Math.round(lr * 100)}% left)`} · ${P.tee.n} tee shots`); }
  if (P.app.n >= 20) { const miss = 1 - P.app.G, fmiss = 1 - P.field.app.G, sh = (s) => (miss ? P.app[s] / miss : 0), fsh = (s) => (fmiss ? P.field.app[s] / fmiss : 0);
    const lean = ["Short", "Long", "Left", "Right"].map((s) => ({ s, d: sh(s) - fsh(s) })).sort((a, b) => b.d - a.d)[0];
    out.push(`Approaches: ${Math.round(P.app.G * 100)}% on the green (the field ${Math.round(P.field.app.G * 100)}%)${lean.d >= 0.05 ? `; misses ${lean.s.toLowerCase()} more than most (${Math.round(sh(lean.s) * 100)}% of misses, the field ${Math.round(fsh(lean.s) * 100)}%)` : "; misses spread like the field's"} · ${P.app.n} approaches`); }
  if (P.holes >= 30 && P.dbl != null) out.push(`Doubles or worse: ${(P.dbl * 18).toFixed(2)} a round (the field ${(P.field.dbl * 18).toFixed(2)}) · ${P.holes} holes`);
  return out.length ? out : [`${who} have too few shots in the course files for a miss pattern yet.`];
}

/**
 * What a player's misses cost (or save) at a course against an average player there, strokes per round: off the tee, each
 * hole's average score after a drive left, in the fairway and right, weighted by how often they finish there against the
 * field; on the approach, the same with the green and each miss side. Their shares are pulled toward the field's when
 * they have few shots (K shots' worth of the field). Plus the blow-up holes: how often they make a double or worse
 * against the field, times how much this course's blow-ups cost against a usual course's.
 */
export function missFit(P, F, usualExposure = null, K = 40) {
  const res = { tee: 0, app: 0, blow: 0, holes: [] };
  const shrink = (mine, field, n) => (mine == null ? field : (mine * n + field * K) / (n + K));
  for (const [h, X] of Object.entries(F.holes || {})) {
    let tee = 0, app = 0; const why = [];
    // off the tee (par 4s and 5s)
    const D = X.drive || {}, dn = (D.L?.[0] || 0) + (D.C?.[0] || 0) + (D.R?.[0] || 0);
    if (X.par >= 4 && dn >= 30 && D.C?.[0] && P.tee.n) {
      // direction only: the field's fairway rate here, their split of the misses (left against right): how often they miss
      // is their driving, already in the stats file's parts of the game; which way is what this adds
      const fL = (D.L?.[0] || 0) / dn, fR = (D.R?.[0] || 0) / dn, fM = fL + fR, myM = (P.tee.L || 0) + (P.tee.R || 0);
      const fLs = fM ? fL / fM : 0.5, myLs = shrink(myM ? P.tee.L / myM : null, fLs, P.tee.n * (myM || 0));
      if (fM && D.L?.[0] && D.R?.[0]) tee = fM * (myLs - fLs) * (mean(D.L) - mean(D.R));
      const cL = D.L?.[0] >= 5 ? mean(D.L) - mean(D.C) : null, cR = D.R?.[0] >= 5 ? mean(D.R) - mean(D.C) : null;
      if (cL != null && cR != null && Math.abs(cL - cR) >= 0.15) why.push(`a drive ${cL > cR ? "left" : "right"} costs ${f2m(Math.max(cL, cR))} against the fairway (${cL > cR ? "right" : "left"} ${f2m(Math.min(cL, cR))})`);
    }
    // the approach
    const A = split5Sum(X.app), an = SIDES5.reduce((t, s) => t + A[s][0], 0);
    if (an >= 30 && A.G[0] && P.app.n) {
      // direction only, as off the tee: the field's green rate here, their split of the misses between the four sides
      const M4 = ["Short", "Long", "Left", "Right"], fMiss = M4.reduce((t, s) => t + A[s][0], 0) / an, myMiss = M4.reduce((t, s) => t + (P.app[s] || 0), 0), fTot = M4.reduce((t, s) => t + A[s][0], 0);
      if (fMiss && myMiss) for (const s of M4) { if (!A[s][0]) continue; const fs = A[s][0] / fTot, ms = shrink(P.app[s] / myMiss, fs, P.app.n * myMiss); app += fMiss * (ms - fs) * (A[s][1] / A[s][0]); }
      const worst = ["Short", "Long", "Left", "Right"].filter((s) => A[s][0] >= 5).map((s) => ({ s, c: A[s][1] / A[s][0] - A.G[1] / A.G[0] })).sort((a, b) => b.c - a.c)[0];
      if (worst && worst.c >= 0.5) why.push(`an approach missed ${worst.s.toLowerCase()} costs ${worst.c.toFixed(2)} against hitting the green`);
    }
    res.tee += tee; res.app += app;
    res.holes.push({ h: Number(h), par: X.par, cost: tee + app, tee, app, why });
  }
  // as strokes gained (positive: their misses suit it); a hole's cost stays a cost (positive: it hurts them)
  const n = res.holes.length || 18, k18 = 18 / n; res.tee *= -k18; res.app *= -k18; res.k18 = k18;
  // blow-ups: their doubles against the field's, where this course's cost more (or less) than a usual course's
  const W = whereTopWin(F);
  if (W && P.dbl != null && P.field.dbl && usualExposure != null) { const ratio = shrink(P.dbl, P.field.dbl, P.holes / 18 * 4) / P.field.dbl; res.blow = -(ratio - 1) * (W.exposure - usualExposure); res.ratio = ratio; }
  res.total = res.tee + res.app + res.blow;
  res.holes.sort((a, b) => b.cost - a.cost);
  // the hole that hurts them most, and what the course is worth to them without it
  const w = res.holes[0]; if (w && w.cost > 0.02) res.without = { h: w.h, cost: w.cost * k18, total: res.total + w.cost * k18 };
  return res;
}
/** the average blow-up cost a round across every course with a summary (a usual course) */
export function usualExposure(metas) { const xs = metas.filter(hasFit).map((m) => whereTopWin(m.fit)?.exposure).filter((v) => v != null); return xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null; }
/** the course record (meta) for a tournament, by its events' names */
export function metaForEvent(metas, name, match) { for (const m of metas) { if (!hasFit(m)) continue; const names = (m.events || []).map((e) => (typeof e === "string" ? e : e?.name)).filter(Boolean); if (names.length && match(name, names)) return m; } return null; }
