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
// (update 597) "21 samples"; under SMALL_N "only 8 samples"; a tip says its value and count together: "(3.78, only 9 samples)"
const nTxt = (n) => `${n < SMALL_N ? "only " : ""}${n} sample${n === 1 ? "" : "s"}`;
const vn = (v, n) => `(${f2(v)}, ${nTxt(n)})`;
// (update 604) the corner directions hyphenated ("short-left"), so they're not read as two
const SIDE = { "Long-Left": "long-left", Long: "long", "Long-Right": "long-right", Left: "left", Right: "right", "Short-Left": "short-left", Short: "short", "Short-Right": "short-right" };
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
  // (update 614) the outline round the shots themselves; (616) a rounded oval: turned the way the shots spread, reaching
  // the farthest of them plus 2.5 yds, at least 5 yds across and never thinner than about half as wide as it is long
  // (a hull of a few shots along a strip was a thin sliver); drawn as its outline's points
  // (update 631) round most of the shots (the nearest 85% to their middle), 1.5 yds beyond them, and no wider than it
  // needs to be (at least 0.4 as wide as long): a wide oval spilled into the fairway or rough beside a patch
  const hullOf = (pts0, lim = null) => {
    if (!pts0 || pts0.length < 3) return null;
    let pts = pts0; { const cx = mean(pts.map((p) => p[0])), cy = mean(pts.map((p) => p[1])); if (pts.length >= 6) pts = [...pts].sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy)).slice(0, Math.ceil(pts.length * 0.85)); }
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
    let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux, pad = 1.5 * PPY;
    let a = Math.max(...pts.map(([x, y]) => Math.abs((x - mx) * ux + (y - my) * uy))) + pad;
    let b = Math.max(...pts.map(([x, y]) => Math.abs((x - mx) * vx + (y - my) * vy))) + pad;
    a = Math.max(a, 5 * PPY); b = Math.max(b, 0.4 * a, 4 * PPY);
    // (update 655) a tee target (aim, avoid): its radius, either way, between 8 and 15 yds
    if (lim) { const lo = lim[0] * PPY, hi = lim[1] * PPY; a = Math.min(hi, Math.max(lo, a)); b = Math.min(hi, Math.max(lo, b)); }
    return Array.from({ length: 20 }, (_, k) => { const t = (k / 20) * 2 * Math.PI, ca = Math.cos(t) * a, sb = Math.sin(t) * b; return [Math.round(mx + ca * ux + sb * vx), Math.round(my + ca * uy + sb * vy)]; });
  };
  const TEE_LIM = [8, 15]; // (update 655: tee targets; 656: the approach miss spots too)
  // (update 714) every circle a size the map's circle tool can be set to (its radius in yards), so it can be checked there
  const R_SET = [8, 10, 15, 20]; // (update 717: target circles only 8, 10, 15 or 20 yds across the middle to the edge)
  const ring = (cx, cy, R, tone) => [Math.round(cx), Math.round(cy), Math.round(R * 10) / 10, tone, Array.from({ length: 24 }, (_, k) => [Math.round(cx + R * Math.cos(k * Math.PI / 12)), Math.round(cy + R * Math.sin(k * Math.PI / 12))])];
  // (update 716) fast enough for a whole course's shots: the shots filed in a grid (only those near a circle are looked
  // at), and the circles started from one shot in each little square (bigger squares for bigger circles), not every shot
  const gridIdx = (pts) => { const cell = 5 * PPY, m = new Map(); for (const p of pts) { const k = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`; (m.get(k) || m.set(k, []).get(k)).push(p); }
    return { near(x, y, r, keep = null) { const out = [], c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), d0 = Math.floor((y - r) / cell), d1 = Math.floor((y + r) / cell);
      for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) { const a = m.get(`${i}|${j}`); if (a) for (const p of a) if ((!keep || keep(p)) && Math.hypot(p.x - x, p.y - y) <= r) out.push(p); }
      return out; } }; };
  const startsOf = (pts, ry, fits = () => true) => { const g = Math.max(3, ry / 3) * PPY, seen = new Set(), out = [];
    for (const c of pts) { if (!fits(c.lie)) continue; const k = `${c.lie}|${Math.round(c.x / g)}|${Math.round(c.y / g)}`; if (!seen.has(k)) { seen.add(k); out.push(c); } } return out; };
  // (update 716) where to put circles is searched on an even sample (600 at most); what's inside each is then counted exactly
  const CAP = 600, thin = (pts) => { if (pts.length <= CAP) return pts; const k = pts.length / CAP, out = []; for (let i = 0; i < CAP; i++) out.push(pts[Math.floor(i * k)]); return out; };
  const meanXY = (ps) => { let sx = 0, sy = 0; for (const p of ps) { sx += p.x; sy += p.y; } return [sx / ps.length, sy / ps.length]; };
  // (update 714) circles over shots that finished somewhere (pts: [{ x, y, lie, r }]): around a shot of a lie that fits, at
  // each size, both where it is and moved onto the middle of that lie's shots inside it; each judged on that lie's shots
  // inside it (what the circle tool's row for that lie shows), kept with minN or more and when 60%+ of what's inside is that lie
  const spotsOf = (pts, fits, radii, minN) => {
    const out = [], seen = new Set(), S = thin(pts), G = gridIdx(S), GF = S === pts ? G : gridIdx(pts);
    for (const ry of radii) { const rr = ry * PPY;
      for (const c of startsOf(S, ry, fits)) for (const shift of [false, true]) {
        let x = c.x, y = c.y;
        if (shift) for (let it = 0; it < 5; it++) { const m = G.near(x, y, rr, (p) => p.lie === c.lie); if (!m.length) break; const [nx, ny] = meanXY(m), mv = Math.hypot(nx - x, ny - y); x = nx; y = ny; if (mv < PPY * 0.5) break; }
        x = Math.round(x); y = Math.round(y); // (the centre as drawn, so what's counted is what's inside the circle on the map)
        const sig = `${c.lie}|${ry}|${Math.round(x / (2 * PPY))}|${Math.round(y / (2 * PPY))}`; if (seen.has(sig)) continue; seen.add(sig);
        const inside = GF.near(x, y, rr), mem = inside.filter((p) => p.lie === c.lie);
        if (mem.length < minN || mem.length < 0.6 * inside.length) continue;
        out.push({ ry, x, y, lie: c.lie, mem, n: mem.length, avg: mean(mem.map((p) => sc(p.r))) });
      } }
    return out;
  };
  const circ = (rs, ptOf, tone, lim = null) => {
    const ps = rs.map(ptOf).filter((q) => q && q[1] != null && q[2] != null); if (ps.length < 3) return null;
    const cx = mean(ps.map((q) => q[1])), cy = mean(ps.map((q) => q[2])), ds = ps.map((q) => Math.hypot(q[1] - cx, q[2] - cy)).sort((a, b) => a - b);
    const r = Math.max((lim ? lim[0] : 6) * PPY, Math.min((lim ? lim[1] : 30) * PPY, ds[Math.floor(0.7 * (ds.length - 1))] || 0));
    // (update 717) a circle of an allowed size (8, 10, 15 or 20 yds): the smallest that holds most of them, else 20
    const ry = R_SET.find((v) => v * PPY >= r) ?? R_SET.at(-1);
    return ring(cx, cy, ry * PPY, tone);
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
      teeOpts = [...m].filter(([, ds]) => ds.length >= OPT_N).map(([k, ds]) => { const [z, L] = k.split("|"); return { z, len: Number(L), n: ds.length, avg: Math.round(mean(ds.map((d) => sc(d.r))) * 1000) / 1000, left: med(ds.map((d) => d.q2[4])), at: circ(ds, (d) => d.q2, "good", TEE_LIM) }; });
      if (!teeOpts.length) teeOpts = null; }
    const isFw = (z) => /fairway$/.test(z.k) && !/bunkers$/.test(z.k);
    // (update 714) the aim and the place to avoid are circles (sizes the circle tool has) where drives finished, each said
    // with the drives inside it of the lie it names, so the tip's numbers are the circle tool's for that circle. Named by
    // where the circle sits: the fairway third (or rough / bunkers, left or right) and how far from the tee
    const dpts = drives.filter((d) => d.q2[1] != null && d.q2[2] != null).map((d) => ({ x: d.q2[1], y: d.q2[2], lie: LIE[d.q2[3]] || "other", r: d.r, d }));
    const tee0 = dpts.length ? [mean(dpts.map((p) => p.d.q1[1])), mean(dpts.map((p) => p.d.q1[2]))] : null;
    const latAt = (x, y) => { const ux = geo.fw[0] - tee0[0], uy = geo.fw[1] - tee0[1], ul = Math.hypot(ux, uy) || 1; return (ux * (y - tee0[1]) - uy * (x - tee0[0])) / ul; };
    const nameAt = (g) => { const la = latAt(g.x, g.y);
      if (g.lie === "fairway") return t1 == null ? "the fairway" : la < t1 ? "the left side of the fairway" : la > t2 ? "the right side of the fairway" : "the middle of the fairway";
      if (g.lie === "rough") return la < 0 ? "the left rough" : "the right rough";
      if (g.lie === "bunker") return la < 0 ? "the left fairway bunkers" : "the right fairway bunkers";
      return null; };
    const ydsAt = (g) => Math.round(Math.hypot(g.x - tee0[0], g.y - tee0[1]) / geo.ppy / 5) * 5;
    const allA = dpts.length ? mean(dpts.map((p) => sc(p.r))) : base, adjT = (g) => (g.n * g.avg + MIN_N * allA) / (g.n + MIN_N);
    // (update 715) never at the far end: the field's aim and avoid sit between the 25th and 75th percentile of how far
    // drives went on this hole (a player's own, where they're viewed: their 10th to 90th, from teeOpts)
    const dLen = dpts.map((p) => Math.hypot(p.x - p.d.q1[1], p.y - p.d.q1[2]) / geo.ppy).sort((a, b) => a - b), pq = (f) => dLen[Math.min(dLen.length - 1, Math.floor(f * dLen.length))];
    const lo25 = dLen.length ? pq(0.25) : 0, hi75 = dLen.length ? pq(0.75) : Infinity, inBand = (g, lo, hi) => { const L = Math.hypot(g.x - tee0[0], g.y - tee0[1]) / geo.ppy; return L >= lo && L <= hi; };
    const aimAll = tee0 ? spotsOf(dpts, (l) => l === "fairway", R_SET, MIN_N).sort((a, b) => adjT(a) - adjT(b) || b.n - a.n) : [];
    const badAll = tee0 ? spotsOf(dpts, (l) => l === "rough" || l === "bunker", R_SET, MIN_N).filter((g) => nameAt(g)).sort((a, b) => adjT(b) - adjT(a) || b.n - a.n) : [];
    // (update 715) every circle kept for a player's own aim and avoid (worked out where they're viewed), with how far it is
    if (tee0 && (aimAll.length || badAll.length)) {
      const opt = (g, kind) => ({ kind, z: nameAt(g), len: ydsAt(g), n: g.n, avg: Math.round(g.avg * 1000) / 1000, adj: Math.round(adjT(g) * 1000) / 1000, left: med(g.mem.map((p) => p.d.q2[4])), at: ring(g.x, g.y, g.ry * PPY, kind === "aim" ? "good" : "bad") });
      teeOpts = [...aimAll.slice(0, 60).map((g) => opt(g, "aim")), ...badAll.slice(0, 40).map((g) => opt(g, "avoid"))];
    }
    const aimC = aimAll.find((g) => inBand(g, lo25, hi75)) || null;
    const tgt = zones.filter(isFw)[0];
    if (aimC) {
      items.push({ k: "tee", h: "Aim", t: `Aim for ${nameAt(aimC)} around ${ydsAt(aimC)} yds off the tee ${vn(aimC.avg, aimC.n)}.`, at: [ring(aimC.x, aimC.y, aimC.ry * PPY, "good")] });
      for (const z of zones.filter((z) => !isFw(z) && z.avg <= aimC.avg - 0.05).slice(0, 1))
        items.push({ k: "tee", h: "Surprise", t: `Drives finishing in ${z.k} have scored better than the aim ${vn(z.avg, z.n)}.` });
      const badC = badAll.find((g) => g.avg >= aimC.avg + 0.1 && inBand(g, lo25, hi75));
      if (badC) items.push({ k: "tee", h: "Avoid", t: `Stay out of ${nameAt(badC)} around ${ydsAt(badC)} yds off the tee ${vn(badC.avg, badC.n)}.`, at: [ring(badC.x, badC.y, badC.ry * PPY, "bad")] });
    } else if (tgt) items.push({ k: "tee", h: "Aim", t: `Aim for ${tgt.k} off the tee ${vn(tgt.avg, tgt.n)}.` }); // (no circle with enough drives: the fairway third, as a whole)
  }

  // ---- the approach: every result (the green, and each miss's side and lie within 30 yds) against every other ----
  // (update 590) always said: the miss order by side and lie (8+ rounds each), else by side, else the green against a miss
  const apOut = (r) => {
    if (r.fringe) return null; // (update 601) the fringe right by the green: neither a miss nor the green
    if (r.side) return `${r.side}|${r.mLie || "other"}`;
    const q = r.apIdx != null ? r.qs[r.apIdx + 1] : null;
    return q && q[3] === 4 ? "green" : null;
  };
  const lab = (k) => { if (k === "green") return "on the green"; const [sd, l] = k.split("|"); return `${SIDE[sd] || sd.toLowerCase()} ${lieIn(l)}`; };
  const outs = group(done, apOut).sort((a, b) => a.avg - b.avg);
  const combos = outs.filter((g) => g.k !== "green"), green = outs.find((g) => g.k === "green");
  const bySide = group(done.filter((r) => r.side), (r) => r.side).sort((a, b) => a.avg - b.avg).map((g) => ({ ...g, lab: SIDE[g.k] || g.k }));
  // (update 610) the miss spots as circles, the way the map's circle reads them: around each miss, the misses of the same
  // lie within 10 yds (15 when that's too few), centred on the middle of its misses, with MIN_N or more; then the best, second best and worst of those spots,
  // each a different place (not mostly the same misses) and named by the direction most of its misses are in
  const missPts = done.filter((r) => r.side && !r.fringe).map((r) => { const q = apPt(r); return q && q[1] != null && q[2] != null ? { r, x: q[1], y: q[2], lie: r.mLie || "other", side: r.side } : null; }).filter(Boolean);
  let spotOrder = null;
  if (geo.ppy && missPts.length >= MIN_N) {
    // 10 yds, widened to 15 when that's too few; each circle then moved to the middle of its misses and counted again
    // (twice), so it holds the whole cluster rather than whichever part a single miss reaches
    // (update 617) each spot is a cluster's centre found by moving a circle to the middle of its misses until it stops
    // (the densest place), and judged on every miss of that lie inside it: whole bunkers and patches of rough, not the
    // best- or worst-scoring slice of one (that made a left bunker look worse than a right one that really was worse)
    let allMiss = missPts.slice();
    const gen = (minN, radii) => {
      const mS = thin(missPts), aS = thin(allMiss), out = [], seen = new Set(), GM = gridIdx(mS), GAs = gridIdx(aS), GA = gridIdx(allMiss); // (update 716: a grid, the search on a sample, the counts exact)
      for (const ry of radii) for (const c of startsOf(mS, ry)) {
        const rr = ry * geo.ppy, inR = (x, y) => GM.near(x, y, rr, (p) => p.lie === c.lie);
        for (const shift of [true, false]) { // (update 714: also the circle right where this miss is, not only settled on its cluster)
        let x = c.x, y = c.y, mem = inR(x, y);
        if (shift) for (let it = 0; it < 10 && mem.length; it++) { const nx = mean(mem.map((p) => p.x)), ny = mean(mem.map((p) => p.y)), moved = Math.hypot(nx - x, ny - y); x = nx; y = ny; mem = inR(x, y); if (moved < geo.ppy) break; }
        // (update 619) one side of the green only: misses whose direction shares a part with the spot's main one (a long
        // spot keeps long, long-left and long-right; not a left miss the rough round the green joins it to)
        if (mem.length) { const cnt = new Map(); for (const p of mem) for (const w of String(p.side).split("-")) cnt.set(w, (cnt.get(w) || 0) + 1);
          const main = [...cnt].sort((a, b) => b[1] - a[1])[0][0]; mem = mem.filter((p) => String(p.side).split("-").includes(main)); }
        // (update 631) one patch: misses linked to each other within 5 yds, the biggest such group (two bunkers, or a
        // bunker and the one beside it, inside a 20 yd circle are two places, not one)
        if (mem.length) { const L = 5 * geo.ppy, cells = new Map(), parts = []; // (update 716: patches from 5-yd squares that touch, not miss against miss)
          for (const p of mem) { const k = `${Math.floor(p.x / L)}|${Math.floor(p.y / L)}`; (cells.get(k) || cells.set(k, []).get(k)).push(p); }
          const left = new Set(cells.keys());
          while (left.size) { const k0 = left.values().next().value, q = [k0], part = []; left.delete(k0);
            for (let i = 0; i < q.length; i++) { const [cx, cy] = q[i].split("|").map(Number); part.push(...cells.get(q[i]));
              for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = `${cx + dx}|${cy + dy}`; if (left.has(k)) { left.delete(k); q.push(k); } } }
            parts.push(part); }
          mem = parts.sort((a, b) => b.length - a.length)[0]; x = mean(mem.map((p) => p.x)); y = mean(mem.map((p) => p.y)); }
        // (update 657) the spot IS the circle drawn: its middle where the search settled, its radius the circle's (8 to
        // 15 yds), and every miss inside it counted, whatever its side (the search above only finds where to put it)
        // (update 658) only the lie in its name (a couple of rough misses in a bunker spot don't count toward "in a bunker")
        // (update 683) the circle sits on the misses it names: moved to the middle of that lie's misses inside it until it
        // settles (it had stopped where the search did, half over the rough beside the bunker it named), and kept only
        // when most of what's inside it (60% or more) is that lie, so a "bunker" circle is mostly bunker
        let inside = GAs.near(x, y, rr);
        if (!shift) { x = c.x; y = c.y; inside = GAs.near(x, y, rr); }
        else for (let it = 0; it < 6; it++) {
          inside = GAs.near(x, y, rr);
          const m = inside.filter((p) => p.lie === c.lie); if (!m.length) break;
          const nx = mean(m.map((p) => p.x)), ny = mean(m.map((p) => p.y)), moved = Math.hypot(nx - x, ny - y); x = nx; y = ny;
          if (moved < geo.ppy * 0.5) { inside = GAs.near(x, y, rr); break; }
        }
        x = Math.round(x); y = Math.round(y); inside = GA.near(x, y, rr); // (update 715: counted from the centre as drawn)
        mem = inside.filter((p) => p.lie === c.lie);
        if (mem.length < minN || mem.length < 0.6 * inside.length) continue;
        // (update 625) every circle size (not just the first that's big enough), so a tight cluster (the rough left of a
        // green) is a spot of its own rather than swallowed by a bigger one nearby
        const sig = `${c.lie}|${ry}|${Math.round(x / (3 * geo.ppy))}|${Math.round(y / (3 * geo.ppy))}`;
        if (!seen.has(sig)) { seen.add(sig); out.push({ ry, x, y, mem, avg: mean(mem.map((p) => sc(p.r))) }); }
        }
      }
      return out;
    };
    // (update 619) a fairway or rough miss beside a bunker (a quarter or more of the misses within 6 yds of it in a bunker)
    // is a lucky lie, not a place: left out of every spot, so a spot of long rough isn't flattered by the strip of rough
    // in front of a bunker that the rough round the green joins it to
    // (update 634) narrower: a quarter of misses within 6 yds, or any bunker miss within 4 yds, took out whole patches of
    // rough that border a bunker (rough left of a green, 35 misses scoring 4.20, never became a spot). Now: two in five of
    // 4+ misses within 5 yds in a bunker, or a bunker miss within 2 yds (the strip right at a bunker's edge)
    { const R = 5 * geo.ppy, all = missPts.slice(), GL = gridIdx(all); // (update 716: neighbours from the grid)
      // (update 635) and only a miss between a bunker and the green (a bunker behind it): rough beside a bunker is a fine miss
      for (const p of all) { if ((p.lie !== "rough" && p.lie !== "fairway") || !p.r.bb) continue;
        const nb = GL.near(p.x, p.y, R, (q) => q !== p);
        if ((nb.length >= 4 && nb.filter((q) => q.lie === "bunker").length / nb.length >= 0.4) || GL.near(p.x, p.y, 2 * geo.ppy, (q) => q.lie === "bunker").length > 0) p.lucky = true; } // (or a bunker miss within 2 yds)
      allMiss = missPts.slice(); // (update 657: counted in any circle they're inside, just not used to place one)
      for (let i = missPts.length - 1; i >= 0; i--) if (missPts[i].lucky) missPts.splice(i, 1); }
    const cand = gen(MIN_N, R_SET); // (update 717: 8, 10, 15 or 20 yds)
    // its direction: the one most of its misses are in; when none has half, the part nearly all share ("Long" for misses
    // spread over long-left, long and long-right)
    const sideOf = (mem) => {
      const m = new Map(); for (const p of mem) m.set(p.side, (m.get(p.side) || 0) + 1);
      const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0];
      if (n >= mem.length / 2) return top;
      const part = new Map(); for (const p of mem) for (const w of String(p.side).split("-")) part.set(w, (part.get(w) || 0) + 1);
      const [pw, pn] = [...part].sort((a, b) => b[1] - a[1])[0];
      return pn >= mem.length * 0.7 ? pw : top;
    };
    // (update 657) named by the lie most of its misses are in; centred where the circle is drawn
    const lieMost = (mem) => { const m = new Map(); for (const p of mem) m.set(p.lie, (m.get(p.lie) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0][0]; };
    const nameAll = (cs) => cs.map((g) => ({ ...g, k: `${sideOf(g.mem)}|${lieMost(g.mem)}`, n: g.mem.length, cx: g.x, cy: g.y }));
    const named = nameAll(cand);
    const apart = (a, b) => { const s0 = new Set(a.mem.map((p) => p.r)); return a.k !== b.k && b.mem.filter((p) => s0.has(p.r)).length < 0.5 * Math.min(a.n, b.n); };
    // (update 618) a place to aim has to be safe to aim at: not a sliver of rough or fairway beside a bunker that only
    // scored well by luck. Within 6 yds of a spot's middle, if a quarter or more of all the misses (any lie) are in a
    // bunker, it can't be the best or second best miss (it can still be the worst)
    const risky = (g) => {
      if (lieMost(g.mem) === "bunker") return false;
      if (g.mem.filter((p) => p.r.bb).length < g.mem.length / 2) return false; // (update 635) beside a bunker is fine; in front of one isn't
      // (update 634) a third or more within 5 yds (was a quarter within 6)
      const R = 5 * geo.ppy, nb = missPts.filter((p) => Math.hypot(p.x - g.cx, p.y - g.cy) <= R);
      return nb.length >= 4 && nb.filter((p) => p.lie === "bunker").length / nb.length >= 0.34;
    };
    // (update 625) ranked on an average pulled toward the average of every miss when there are few (8 misses' worth), so a
    // spot of 9 doesn't beat one of 26 by luck; the tip still says the spot's own average
    const allAvg = mean(missPts.map((p) => sc(p.r))), adj = (g) => (g.n * g.avg + MIN_N * allAvg) / (g.n + MIN_N);
    const byAvg = [...named].sort((a, b) => adj(a) - adj(b) || b.n - a.n), pick = [];
    for (const g of byAvg) { if (pick.length < 2 && risky(g)) continue; if (pick.every((x) => apart(x, g))) pick.push(g); }
    // (update 614) only two spots with MIN_N: the worst miss from a smaller one (5+ misses, up to 20 yds across), a
    // different place that's scored worse than the second best
    if (pick.length === 2) {
      const w = nameAll(gen(5, [10, 15, 20])).filter((g) => pick.every((x) => apart(x, g)) && g.avg > pick[1].avg).sort((a, b) => b.avg - a.avg)[0];
      if (w) pick.push(w);
    }
    if (pick.length >= 2) spotOrder = pick.map((g) => ({ ...g, lab: lab(g.k), at: (tone) => { const R = g.ry * geo.ppy; return [Math.round(g.cx), Math.round(g.cy), Math.round(R * 10) / 10, tone, Array.from({ length: 24 }, (_, k) => [Math.round(g.cx + R * Math.cos(k * Math.PI / 12)), Math.round(g.cy + R * Math.sin(k * Math.PI / 12))])]; } })); // (update 657: the circle itself (as points, so the map scales and turns it like any outline), no oval: what's drawn is what's counted)
  }
  const order = spotOrder || (combos.length >= 2 ? combos.map((g) => ({ ...g, lab: lab(g.k) })) : bySide.length >= 2 ? bySide : null);
    if (order) {
    // (update 595) each its own line, with its own circle: the best miss, the second best, the worst
    const [b1, b2] = order, w = order.at(-1);
    // (update 614) the green against a miss, as a whole, first
    { const gg = done.filter((r) => apOut(r) === "green"), mm = done.filter((r) => r.side && !r.fringe);
      if (gg.length && mm.length) { const a = mean(gg.map(sc)), b = mean(mm.map(sc));
        items.push({ k: "miss", h: "Green vs miss", t: `Hitting the green ${vn(a, gg.length)}; missing it within 30 yds ${vn(b, mm.length)}: a miss ${b >= a ? "costs" : "saves"} about ${Math.abs(b - a).toFixed(2)} a hole.` }); } }
    const atOf = (g, tone) => (g.at ? [g.at(tone)] : [circ(g.rs, apPt, tone, TEE_LIM)].filter(Boolean)); // (update 610: a spot's own circle)
    items.push({ k: "miss", h: "Best miss", t: `If you miss the green, miss ${b1.lab}: ${f2(b1.avg)} (${nTxt(b1.n)}).`, at: atOf(b1, "good") });
    // (update 615) only two spots: the other is the worst (red), not a second best
    if (order.length === 2) items.push({ k: "miss", h: "Worst miss", t: `Worst: ${b2.lab} ${vn(b2.avg, b2.n)}.`, at: atOf(b2, "bad") });
    // (update 634) ranked on an average weighed for its sample size: a second best with a lower average says why it's second
    else items.push({ k: "miss", h: "2nd best miss", t: `Second best: ${b2.lab} ${vn(b2.avg, b2.n)}${b2.avg < b1.avg ? `: a lower average, but on too few samples to rank above the best miss` : ""}.`, at: atOf(b2, "ok") });
    if (order.length >= 3) items.push({ k: "miss", h: "Worst miss", t: `Worst: ${w.lab} ${vn(w.avg, w.n)}.`, at: atOf(w, "bad") });
  } else {
    const g = done.filter((r) => apOut(r) === "green"), m = done.filter((r) => r.side);
    if (g.length || m.length) {
      const av = (rs) => f2(mean(rs.map(sc)));
      items.push({ k: "miss", h: "Green vs miss", t: `${g.length ? `Hitting the green ${vn(mean(g.map(sc)), g.length)}` : "No greens hit yet"}${m.length ? `; missing it within 30 yds ${vn(mean(m.map(sc)), m.length)}` : ""}.` });
      const few = [...new Map(m.map((r) => [r.side, 0]))].map(([sd]) => { const rs = m.filter((r) => r.side === sd); return { sd, rs, n: rs.length, avg: mean(rs.map(sc)) }; }).filter((x) => x.n >= 3).sort((a, b) => a.avg - b.avg);
      if (few.length >= 2) {
        const b = few[0], w = few.at(-1), nm = (x) => SIDE[x.sd] || x.sd;
        items.push({ k: "miss", h: "Best miss so far", t: `Too few misses to rank firmly; so far, miss ${nm(b)} ${vn(b.avg, b.n)}.`, at: [circ(b.rs, apPt, "good", TEE_LIM)].filter(Boolean) });
        items.push({ k: "miss", h: "Worst miss so far", t: `Worst so far: ${nm(w)} ${vn(w.avg, w.n)}.`, at: [circ(w.rs, apPt, "bad", TEE_LIM)].filter(Boolean) });
      }
    } else items.push({ k: "miss", h: "Too few", t: `Too few approach shots recorded to this pin to read yet (${nTxt(done.length)}).` });
  }
  // ---- surprises: a miss in the rough or a bunker that scored better than the best fairway miss ----
  // (update 604) against the best fairway spot only (not whichever fairway spot makes the biggest gap), so it only shows
  // when the rough or bunker beats every fairway option
  // (update 610) from the same spots as the misses when there are spots (so the numbers match)
  const src = spotOrder || outs;
  const rough = src.filter((g) => /\|(rough|bunker)$/.test(g.k)), bestFw = src.filter((g) => /\|fairway$/.test(g.k)).sort((a, b) => a.avg - b.avg)[0];
  if (bestFw) for (const a of rough.filter((g) => g.avg <= bestFw.avg - 0.1).sort((x, y) => x.avg - y.avg).slice(0, 2))
    items.push({ k: "surprise", h: "Surprise", t: `Missing ${lab(a.k)} ${vn(a.avg, a.n)} has scored better than the best fairway miss, ${lab(bestFw.k)} (${f2(bestFw.avg)}).` });

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
        lines.push({ gap: Math.abs(ga - la), go, t: `${where}, ${go ? "go for the green" : "lay up"} ${vn(go ? ga : la, go ? g.length : l.length)}.` });
      }
      lines.sort((a, b) => b.gap - a.gap).slice(0, 2).forEach((x) => items.push({ k: goSt === 1 ? "tee" : "layup", h: x.go ? "Go for it" : "Lay up", t: x.t }));
      // the best place to lay up to: the yards left after the lay-up
      const lay = plays.filter((p) => !p.go && p.nx[4] != null), lb = 20;
      const byLeft = group(lay.map((p) => ({ ...p.r, _l: p.nx[4] })), (r) => `${Math.floor(r._l / lb) * lb}`).sort((a, b) => a.avg - b.avg);
      if (byLeft.length >= 2) items.push({ k: "layup", h: "Lay-up distance", t: `Laying up, leave ${byLeft[0].k}-${Number(byLeft[0].k) + lb} yds ${vn(byLeft[0].avg, byLeft[0].n)}.`, at: [circ(byLeft[0].rs, (r) => r.qs.find((q) => q[0] === goSt + 1), "good")].filter(Boolean) });
    }
  }
  return items.length ? { base: Math.round(base * 100) / 100, n: done.length, items, ...(teeOpts ? { teeOpts } : {}), ...(layOpts ? { layOpts } : {}) } : null;
}
