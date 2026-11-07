// (update 588) Strategy insights for a hole and pin, worked out from every player's shots at Rebuild maps and kept with the
// course: where drives that led to the best scores finished, how each approach result scored (the green, and each miss side
// and lie within 30 yds), any surprises (a bunker or rough result that beat a fairway or green one), and on par 5s (and
// drivable par 4s) going for the green against laying up, from where the shot was played. A finding needs at least
// MIN_N rounds; under SMALL_N it says so.
//
// recs: [{ s, qs, side, mLie, apIdx }] one per round played to the pin: s, the score to par; qs, its shots [stroke, x, y,
// lie, yardsToPin, ...] in order; side, its approach miss ("Long-Left" …) when it missed within 30 yds; mLie, that miss's
// lie; apIdx, the index in qs of the approach (the last shot from more than 30 yds before the green or within 30 yds).
// geo: { ppy (pixels a yard), fw ([x, y] the middle of where drives finish in the fairway) }.
// Returns { base, n, items: [{ k: "tee" | "miss" | "surprise" | "layup", t }] } (t: the sentence), or null.

export const MIN_N = 8, SMALL_N = 15;
const LIE = ["tee", "fairway", "rough", "bunker", "green", "water", "other"];
const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const f2 = (v) => v.toFixed(2);
const nTxt = (n) => `${n} sample${n === 1 ? "" : "s"}${n < SMALL_N ? ", a small sample" : ""}`;
const SIDE = { "Long-Left": "long left", Long: "long", "Long-Right": "long right", Left: "left", Right: "right", "Short-Left": "short left", Short: "short", "Short-Right": "short right" };
// (update 595) going for the green or laying up, from the shot itself (par 5: the second shot; par 4: the tee shot): it
// went for it when it finished on the green or within 30 yds, or travelled most of the way there (80%; a par 4's tee
// shot 92%) wherever it ended up; it laid up when it went clearly shorter and finished in a normal lay-up spot (40-130
// yds out, a par 4 40-160, in the fairway or rough). A penalty (a stroke skipped, water) or anything else: neither.
// q, nx: the shot and the next one ([stroke, x, y, lie, yardsToPin, ...]); ppy: the map's pixels a yard (none: yards to the pin).
export function goOf(q, nx, par, ppy = null) {
  if (!q || !nx || q[3] === 4 || q[4] == null || q[4] <= 30) return null;
  if (nx[0] != null && q[0] != null && nx[0] !== q[0] + 1) return null;
  if (nx[3] === 5 || nx[3] === 6) return null;
  if (nx[3] === 4 || (nx[4] != null && nx[4] <= 30)) return "go";
  const trav = ppy && q[1] != null && nx[1] != null ? Math.hypot(nx[1] - q[1], nx[2] - q[2]) / ppy : nx[4] != null ? q[4] - nx[4] : null;
  if (trav == null) return null;
  if (trav >= (par === 4 ? 0.92 : 0.8) * q[4]) return "go";
  if (nx[4] != null && nx[4] >= 40 && nx[4] <= (par === 4 ? 160 : 130) && (nx[3] === 1 || nx[3] === 2)) return "lay";
  return null;
}
const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const lieIn = (l) => ({ fairway: "in the fairway", rough: "in the rough", bunker: "in a bunker", green: "on the green", water: "in the water", tee: "on the tee box", other: "elsewhere" }[l] || "elsewhere");

export function strategyOf(recs, par, geo = {}) {
  const done = (recs || []).filter((r) => r.s != null && r.qs?.length);
  // (update 592) a pin with fewer than MIN_N still gets its approach read (said as a small sample); every finding that
  // ranks one place against another still needs MIN_N each
  if (done.length < 3) return null;
  const sc = (r) => par + r.s, base = mean(done.map(sc)), items = [];
  // (update 594) for a player's own aim (worked out where they're viewed): each fairway spot by how far the drive went, and
  // each lay-up distance, with its scoring, the yards it left and its circle (OPT_N+ samples each)
  const OPT_N = 5, med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  let teeOpts = null, layOpts = null;
  // (update 592) a circle round where a group's shots finished (map pixels): their middle, and most of their spread
  const PPY = geo.ppy || 3;
  const circ = (rs, ptOf, tone) => {
    const ps = rs.map(ptOf).filter((q) => q && q[1] != null && q[2] != null); if (ps.length < 3) return null;
    const cx = mean(ps.map((q) => q[1])), cy = mean(ps.map((q) => q[2])), ds = ps.map((q) => Math.hypot(q[1] - cx, q[2] - cy)).sort((a, b) => a - b);
    const r = Math.max(6 * PPY, Math.min(30 * PPY, ds[Math.floor(0.7 * (ds.length - 1))] || 0));
    return [Math.round(cx), Math.round(cy), Math.round(r), tone];
  };
  const apPt = (r) => (r.apIdx != null ? r.qs[r.apIdx + 1] : null);
  const group = (list, keyOf) => { const m = new Map(); for (const r of list) { const k = keyOf(r); if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(r); } return [...m].map(([k, rs]) => ({ k, rs, n: rs.length, avg: mean(rs.map(sc)) })).filter((g) => g.n >= MIN_N); };
  const at = (r, st) => r.qs.find((q) => q[0] === st);

  // ---- the tee shot (par 4s and 5s): where the drive finished (its lie and side), every place against every other ----
  // (update 590) the target is the fairway third that scored best, said against every other place drives finished (8+
  // rounds each); a rough or bunker that beat it is a surprise, never a target; the distance only when one length band
  // in that third beat the others
  if (par >= 4 && geo.fw && geo.ppy) {
    const drives = done.map((r) => { const q1 = at(r, 1), q2 = at(r, 2); return q1 && q2 && q2[3] !== 4 ? { r, q1, q2 } : null; }).filter(Boolean);
    const lat = (d) => { const ux = geo.fw[0] - d.q1[1], uy = geo.fw[1] - d.q1[2], ul = Math.hypot(ux, uy) || 1; return (ux * (d.q2[2] - d.q1[2]) - uy * (d.q2[1] - d.q1[1])) / ul; };
    const fwL = drives.filter((d) => d.q2[3] === 1).map(lat).sort((a, b) => a - b);
    const thirds = fwL.length >= 3 * MIN_N, t1 = thirds ? fwL[Math.floor(fwL.length / 3)] : null, t2 = thirds ? fwL[Math.floor((2 * fwL.length) / 3)] : null;
    const len = (d) => Math.hypot(d.q2[1] - d.q1[1], d.q2[2] - d.q1[2]) / geo.ppy;
    const zoneOf = (d) => {
      const lie = LIE[d.q2[3]] || "other", la = lat(d);
      if (lie === "fairway") return t1 == null ? "the fairway" : la < t1 ? "the left side of the fairway" : la > t2 ? "the right side of the fairway" : "the middle of the fairway";
      if (lie === "rough") return la < 0 ? "the left rough" : "the right rough";
      if (lie === "bunker") return la < 0 ? "the left fairway bunkers" : "the right fairway bunkers";
      return null;
    };
    const zones = group(drives.map((d) => ({ ...d.r, _d: d })), (r) => zoneOf(r._d)).sort((a, b) => a.avg - b.avg);
    { const m = new Map();
      for (const d of drives) { const z = zoneOf(d); if (!z || !/fairway$/.test(z) || /bunkers$/.test(z)) continue; const L = Math.round(len(d) / 20) * 20, k = `${z}|${L}`; (m.get(k) || m.set(k, []).get(k)).push(d); }
      teeOpts = [...m].filter(([, ds]) => ds.length >= OPT_N).map(([k, ds]) => { const [z, L] = k.split("|"); return { z, len: Number(L), n: ds.length, avg: Math.round(mean(ds.map((d) => sc(d.r))) * 1000) / 1000, left: med(ds.map((d) => d.q2[4])), at: circ(ds, (d) => d.q2, "good") }; });
      if (!teeOpts.length) teeOpts = null; }
    const isFw = (z) => /fairway$/.test(z.k) && !/bunkers$/.test(z.k);
    const tgt = zones.filter(isFw)[0];
    if (tgt) {
      const others = zones.filter((z) => z !== tgt), band = 20;
      const bands = group(tgt.rs, (r) => `${Math.round(len(r._d) / band) * band}`).sort((a, b) => a.avg - b.avg);
      const bb = bands.length >= 2 && bands[0].avg < tgt.avg ? bands[0] : null;
      // (update 595) just the value of what's recommended (the spot was still picked against every other place)
      const g0 = bb || tgt;
      items.push({ k: "tee", h: "Aim", t: `Aim for ${tgt.k}${bb ? ` around ${bb.k} yds` : ""}: ${f2(g0.avg)} (${nTxt(g0.n)}).`, at: [circ(g0.rs, (r) => r._d.q2, "good")].filter(Boolean) });
      for (const z of zones.filter((z) => !isFw(z) && z.avg <= tgt.avg - 0.05).slice(0, 1))
        items.push({ k: "tee", h: "Surprise", t: `Drives finishing in ${z.k} have scored better than the aim: ${f2(z.avg)} (${nTxt(z.n)}).` });
    }
    const worst = zones.at(-1), best = zones[0];
    if (worst && worst !== tgt && zones.length >= 2 && worst.avg >= best.avg + 0.1) items.push({ k: "tee", h: "Avoid", t: `Stay out of ${worst.k}: ${f2(worst.avg)} (${nTxt(worst.n)}).`, at: [circ(worst.rs, (r) => r._d.q2, "bad")].filter(Boolean) });
  }

  // ---- the approach: every result (the green, and each miss's side and lie within 30 yds) against every other ----
  // (update 590) always said: the miss order by side and lie (8+ rounds each), else by side, else the green against a miss
  const apOut = (r) => {
    if (r.side) return `${r.side}|${r.mLie || "other"}`;
    const q = r.apIdx != null ? r.qs[r.apIdx + 1] : null;
    return q && q[3] === 4 ? "green" : null;
  };
  const lab = (k) => { if (k === "green") return "on the green"; const [sd, l] = k.split("|"); return `${SIDE[sd] || sd.toLowerCase()} ${lieIn(l)}`; };
  const outs = group(done, apOut).sort((a, b) => a.avg - b.avg);
  const combos = outs.filter((g) => g.k !== "green"), green = outs.find((g) => g.k === "green");
  const bySide = group(done.filter((r) => r.side), (r) => r.side).sort((a, b) => a.avg - b.avg).map((g) => ({ ...g, lab: SIDE[g.k] || g.k }));
  const order = combos.length >= 2 ? combos.map((g) => ({ ...g, lab: lab(g.k) })) : bySide.length >= 2 ? bySide : null;
    if (order) {
    // (update 595) each its own line, with its own circle: the best miss, the second best, the worst
    const [b1, b2] = order, w = order.at(-1);
    items.push({ k: "miss", h: "Best miss", t: `If you miss the green, miss ${b1.lab}: ${f2(b1.avg)} (${nTxt(b1.n)}).`, at: [circ(b1.rs, apPt, "good")].filter(Boolean) });
    items.push({ k: "miss", h: "2nd best miss", t: `${cap1(b2.lab)}: ${f2(b2.avg)} (${nTxt(b2.n)}).`, at: [circ(b2.rs, apPt, "ok")].filter(Boolean) });
    if (order.length >= 3) items.push({ k: "miss", h: "Worst miss", t: `Don\u2019t miss ${w.lab}: ${f2(w.avg)} (${nTxt(w.n)}).`, at: [circ(w.rs, apPt, "bad")].filter(Boolean) });
  } else {
    const g = done.filter((r) => apOut(r) === "green"), m = done.filter((r) => r.side);
    if (g.length || m.length) {
      const av = (rs) => f2(mean(rs.map(sc)));
      items.push({ k: "miss", h: "Green vs miss", t: `${g.length ? `Hitting the green: ${av(g)} (${nTxt(g.length)})` : "No greens hit yet"}${m.length ? `; missing it within 30 yds: ${av(m)} (${nTxt(m.length)})` : ""}.` });
      const few = [...new Map(m.map((r) => [r.side, 0]))].map(([sd]) => { const rs = m.filter((r) => r.side === sd); return { sd, rs, n: rs.length, avg: mean(rs.map(sc)) }; }).filter((x) => x.n >= 3).sort((a, b) => a.avg - b.avg);
      if (few.length >= 2) {
        const b = few[0], w = few.at(-1), nm = (x) => SIDE[x.sd] || x.sd;
        items.push({ k: "miss", h: "Best miss so far", t: `Too few misses to rank firmly; so far, miss ${nm(b)}: ${f2(b.avg)} (${nTxt(b.n)}).`, at: [circ(b.rs, apPt, "good")].filter(Boolean) });
        items.push({ k: "miss", h: "Worst miss so far", t: `${cap1(nm(w))}: ${f2(w.avg)} (${nTxt(w.n)}).`, at: [circ(w.rs, apPt, "bad")].filter(Boolean) });
      }
    } else items.push({ k: "miss", h: "Too few", t: `Too few approach shots recorded to this pin to read yet (${nTxt(done.length)}).` });
  }
  // ---- surprises: a miss in the rough or a bunker that scored better than a fairway or green result ----
  const rough = outs.filter((g) => /\|(rough|bunker)$/.test(g.k)), clean = outs.filter((g) => g.k === "green" || /\|fairway$/.test(g.k));
  const sur = [];
  for (const a of rough) for (const b of clean) if (a.avg <= b.avg - 0.1) sur.push({ a, b, gap: b.avg - a.avg });
  sur.sort((x, y) => y.gap - x.gap);
  const seen = new Set();
  for (const { a, b } of sur) { if (seen.has(a.k) || items.filter((i) => i.k === "surprise").length >= 2) continue; seen.add(a.k);
    items.push({ k: "surprise", h: "Surprise", t: `Missing ${lab(a.k)} has scored better than finishing ${lab(b.k)}: ${f2(a.avg)} (${nTxt(a.n)}) against ${f2(b.avg)}.` }); }

  // ---- going for the green or laying up: par 5s (the second shot), drivable par 4s (the tee shot), by where it's played from ----
  const goSt = par >= 5 ? 2 : par === 4 ? 1 : null;
  if (goSt) {
    const plays = done.map((r) => { const q = at(r, goSt), nx = at(r, goSt + 1), gl = goOf(q, nx, par, geo.ppy); return gl ? { r, q, nx, go: gl === "go" } : null; }).filter(Boolean); // (update 595: from the shot itself)
    if (par >= 5) { const m = new Map(); for (const p of plays) { if (p.go || p.nx[4] == null || p.nx[4] < 40) continue; const k = Math.floor(p.nx[4] / 20) * 20; (m.get(k) || m.set(k, []).get(k)).push(p); }
      layOpts = [...m].filter(([, ps]) => ps.length >= OPT_N).map(([k, ps]) => ({ left: k, n: ps.length, avg: Math.round(mean(ps.map((p) => sc(p.r))) * 1000) / 1000, at: circ(ps, (p) => p.nx, "good") }));
      if (!layOpts.length) layOpts = null; }
    const goN = plays.filter((p) => p.go).length;
    if (goN >= MIN_N && plays.length - goN >= MIN_N) {
      const from = (p) => { const l = LIE[p.q[3]] || "other", d = p.q[4]; if (d == null) return null; const b = 25, lo = Math.floor(d / b) * b; return `${lo}|${lo + b}|${l}`; };
      const lines = [];
      const byFrom = new Map(); for (const p of plays) { const k = goSt === 1 ? "tee|tee|tee" : from(p); if (!k) continue; (byFrom.get(k) || byFrom.set(k, []).get(k)).push(p); }
      for (const [k, ps] of byFrom) {
        const g = ps.filter((p) => p.go), l = ps.filter((p) => !p.go);
        if (g.length < MIN_N || l.length < MIN_N) continue;
        const ga = mean(g.map((p) => sc(p.r))), la = mean(l.map((p) => sc(p.r)));
        const [lo, hi, lie] = k.split("|"), where = goSt === 1 ? "Off the tee" : `From ${lo}-${hi} yds ${lieIn(lie)}`, go = ga < la;
        lines.push({ gap: Math.abs(ga - la), go, t: `${where}, ${go ? "go for the green" : "lay up"}: ${f2(go ? ga : la)} (${nTxt(go ? g.length : l.length)}).` });
      }
      lines.sort((a, b) => b.gap - a.gap).slice(0, 2).forEach((x) => items.push({ k: goSt === 1 ? "tee" : "layup", h: x.go ? "Go for it" : "Lay up", t: x.t }));
      // the best place to lay up to: the yards left after the lay-up
      const lay = plays.filter((p) => !p.go && p.nx[4] != null), lb = 20;
      const byLeft = group(lay.map((p) => ({ ...p.r, _l: p.nx[4] })), (r) => `${Math.floor(r._l / lb) * lb}`).sort((a, b) => a.avg - b.avg);
      if (byLeft.length >= 2) items.push({ k: "layup", h: "Lay-up distance", t: `Laying up, leave ${byLeft[0].k}-${Number(byLeft[0].k) + lb} yds: ${f2(byLeft[0].avg)} (${nTxt(byLeft[0].n)}).`, at: [circ(byLeft[0].rs, (r) => r.qs.find((q) => q[0] === goSt + 1), "good")].filter(Boolean) });
    }
  }
  return items.length ? { base: Math.round(base * 100) / 100, n: done.length, items, ...(teeOpts ? { teeOpts } : {}), ...(layOpts ? { layOpts } : {}) } : null;
}
