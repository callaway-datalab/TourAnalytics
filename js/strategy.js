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
  // (update 614) the outline round the shots themselves (their convex hull, padded 2.5 yds out from its middle), so a
  // target follows where the shots finished (the rough by a green, say) rather than a circle over the green or a bunker
  const hullOf = (pts) => {
    const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return null;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
    for (const p of [...P].reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
    const H = lo.slice(0, -1).concat(up.slice(0, -1)); if (H.length < 3) return null;
    const mx = mean(H.map((p) => p[0])), my = mean(H.map((p) => p[1])), pad = 2.5 * PPY;
    return H.map(([x, y]) => { const d = Math.hypot(x - mx, y - my) || 1; return [Math.round(x + ((x - mx) / d) * pad), Math.round(y + ((y - my) / d) * pad)]; });
  };
  const circ = (rs, ptOf, tone) => {
    const ps = rs.map(ptOf).filter((q) => q && q[1] != null && q[2] != null); if (ps.length < 3) return null;
    const cx = mean(ps.map((q) => q[1])), cy = mean(ps.map((q) => q[2])), ds = ps.map((q) => Math.hypot(q[1] - cx, q[2] - cy)).sort((a, b) => a - b);
    const r = Math.max(6 * PPY, Math.min(30 * PPY, ds[Math.floor(0.7 * (ds.length - 1))] || 0));
    const inner = ps.filter((q) => Math.hypot(q[1] - cx, q[2] - cy) <= r).map((q) => [q[1], q[2]]); // (most of them: the outliers left out)
    const h = hullOf(inner);
    return h ? [Math.round(cx), Math.round(cy), Math.round(r), tone, h] : [Math.round(cx), Math.round(cy), Math.round(r), tone];
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
      items.push({ k: "tee", h: "Aim", t: `Aim for ${tgt.k}${bb ? ` around ${bb.k} yds` : ""} off the tee ${vn(g0.avg, g0.n)}.`, at: [circ(g0.rs, (r) => r._d.q2, "good")].filter(Boolean) });
      for (const z of zones.filter((z) => !isFw(z) && z.avg <= tgt.avg - 0.05).slice(0, 1))
        items.push({ k: "tee", h: "Surprise", t: `Drives finishing in ${z.k} have scored better than the aim ${vn(z.avg, z.n)}.` });
    }
    const worst = zones.at(-1), best = zones[0];
    if (worst && worst !== tgt && zones.length >= 2 && worst.avg >= best.avg + 0.1) items.push({ k: "tee", h: "Avoid", t: `Stay out of ${worst.k} off the tee ${vn(worst.avg, worst.n)}.`, at: [circ(worst.rs, (r) => r._d.q2, "bad")].filter(Boolean) });
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
    const gen = (minN, radii) => {
      const out = [], seen = new Set();
      for (const c of missPts) for (const ry of radii) {
        const rr = ry * geo.ppy, inR = (x, y) => missPts.filter((p) => p.lie === c.lie && Math.hypot(p.x - x, p.y - y) <= rr);
        let mem = inR(c.x, c.y);
        if (mem.length < minN) continue;
        for (let it = 0; it < 2; it++) { const m2 = inR(mean(mem.map((p) => p.x)), mean(mem.map((p) => p.y))); if (m2.length >= minN) mem = m2; }
        const sig = `${c.lie}|${mem.map((p) => done.indexOf(p.r)).sort((a, b) => a - b).join(",")}`;
        if (!seen.has(sig)) { seen.add(sig); out.push({ ry, mem, avg: mean(mem.map((p) => sc(p.r))) }); }
        break;
      }
      return out;
    };
    const cand = gen(MIN_N, [10, 15]);
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
    const nameAll = (cs) => cs.map((g) => ({ ...g, k: `${sideOf(g.mem)}|${g.mem[0].lie}`, n: g.mem.length, cx: mean(g.mem.map((p) => p.x)), cy: mean(g.mem.map((p) => p.y)) }));
    const named = nameAll(cand);
    const apart = (a, b) => { const s0 = new Set(a.mem.map((p) => p.r)); return a.k !== b.k && b.mem.filter((p) => s0.has(p.r)).length < 0.5 * Math.min(a.n, b.n); };
    const byAvg = [...named].sort((a, b) => a.avg - b.avg || b.n - a.n), pick = [];
    for (const g of byAvg) if (pick.every((x) => apart(x, g))) pick.push(g);
    // (update 614) only two spots with MIN_N: the worst miss from a smaller one (5+ misses, up to 20 yds across), a
    // different place that's scored worse than the second best
    if (pick.length === 2) {
      const w = nameAll(gen(5, [10, 15, 20])).filter((g) => pick.every((x) => apart(x, g)) && g.avg > pick[1].avg).sort((a, b) => b.avg - a.avg)[0];
      if (w) pick.push(w);
    }
    if (pick.length >= 2) spotOrder = pick.map((g) => ({ ...g, lab: lab(g.k), at: (tone) => { const h = hullOf(g.mem.map((p) => [p.x, p.y])); return h ? [Math.round(g.cx), Math.round(g.cy), Math.round(g.ry * geo.ppy), tone, h] : [Math.round(g.cx), Math.round(g.cy), Math.round(g.ry * geo.ppy), tone]; } }));
  }
  const order = spotOrder || (combos.length >= 2 ? combos.map((g) => ({ ...g, lab: lab(g.k) })) : bySide.length >= 2 ? bySide : null);
    if (order) {
    // (update 595) each its own line, with its own circle: the best miss, the second best, the worst
    const [b1, b2] = order, w = order.at(-1);
    // (update 614) the green against a miss, as a whole, first
    { const gg = done.filter((r) => apOut(r) === "green"), mm = done.filter((r) => r.side && !r.fringe);
      if (gg.length && mm.length) { const a = mean(gg.map(sc)), b = mean(mm.map(sc));
        items.push({ k: "miss", h: "Green vs miss", t: `Hitting the green ${vn(a, gg.length)}; missing it within 30 yds ${vn(b, mm.length)}: a miss ${b >= a ? "costs" : "saves"} about ${Math.abs(b - a).toFixed(2)} a hole.` }); } }
    const atOf = (g, tone) => (g.at ? [g.at(tone)] : [circ(g.rs, apPt, tone)].filter(Boolean)); // (update 610: a spot's own circle)
    items.push({ k: "miss", h: "Best miss", t: `If you miss the green, miss ${b1.lab}: ${f2(b1.avg)} (${nTxt(b1.n)}).`, at: atOf(b1, "good") });
    // (update 615) only two spots: the other is the worst (red), not a second best
    if (order.length === 2) items.push({ k: "miss", h: "Worst miss", t: `Worst: ${b2.lab} ${vn(b2.avg, b2.n)}.`, at: atOf(b2, "bad") });
    else items.push({ k: "miss", h: "2nd best miss", t: `Second best: ${b2.lab} ${vn(b2.avg, b2.n)}.`, at: atOf(b2, "ok") });
    if (order.length >= 3) items.push({ k: "miss", h: "Worst miss", t: `Worst: ${w.lab} ${vn(w.avg, w.n)}.`, at: atOf(w, "bad") });
  } else {
    const g = done.filter((r) => apOut(r) === "green"), m = done.filter((r) => r.side);
    if (g.length || m.length) {
      const av = (rs) => f2(mean(rs.map(sc)));
      items.push({ k: "miss", h: "Green vs miss", t: `${g.length ? `Hitting the green ${vn(mean(g.map(sc)), g.length)}` : "No greens hit yet"}${m.length ? `; missing it within 30 yds ${vn(mean(m.map(sc)), m.length)}` : ""}.` });
      const few = [...new Map(m.map((r) => [r.side, 0]))].map(([sd]) => { const rs = m.filter((r) => r.side === sd); return { sd, rs, n: rs.length, avg: mean(rs.map(sc)) }; }).filter((x) => x.n >= 3).sort((a, b) => a.avg - b.avg);
      if (few.length >= 2) {
        const b = few[0], w = few.at(-1), nm = (x) => SIDE[x.sd] || x.sd;
        items.push({ k: "miss", h: "Best miss so far", t: `Too few misses to rank firmly; so far, miss ${nm(b)} ${vn(b.avg, b.n)}.`, at: [circ(b.rs, apPt, "good")].filter(Boolean) });
        items.push({ k: "miss", h: "Worst miss so far", t: `Worst so far: ${nm(w)} ${vn(w.avg, w.n)}.`, at: [circ(w.rs, apPt, "bad")].filter(Boolean) });
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
