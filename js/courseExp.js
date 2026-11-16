// (update 761) Expected strokes to hole out from a spot (its lie and distance), learned from a course's own finished holes:
// each shot's strokes left (the hole's score less the strokes already played) averaged over every shot from that lie and
// distance. A shot's strokes gained: the expected strokes from where it was played, less those from where the next one
// was, less the strokes it took (1, or more with a penalty); a holed shot's next spot is 0.
// (The course files' scoring_avg can be each player's own strokes left, not an expectation: then every shot came out 0.00.)
const fine = (lie, d) => (lie === "green" ? `g|${d < 10 ? Math.floor(d) : d < 30 ? 10 + Math.floor((d - 10) / 5) : Math.min(30, 14 + Math.floor((d - 30) / 10))}`
  : `${lie}|${d < 30 ? Math.floor(d / 5) : d < 100 ? 6 + Math.floor((d - 30) / 10) : Math.min(40, 13 + Math.floor((d - 100) / 20))}`);
const coarse = (lie, d) => (lie === "green" ? `G|${d < 5 ? 0 : d < 10 ? 1 : d < 20 ? 2 : d < 40 ? 3 : 4}` : `${lie}|C${Math.min(12, Math.floor(d / 25))}`);
const lieK = (lie) => (lie === "green" ? "green" : lie === "tee" ? "tee" : lie === "fairway" ? "fairway" : lie === "bunker" ? "bunker" : lie === "rough" ? "rough" : "other");
/** trails: [{ par, s (to par, null when unfinished), qs: [{ st, lie, d }] }] → E(q): expected strokes left, or null */
export function expectModel(trails) {
  const acc = new Map(), put = (k, v) => { const a = acc.get(k) || acc.set(k, [0, 0]).get(k); a[0] += v; a[1]++; };
  for (const t of trails) { if (t.s == null || t.par == null) continue; const fin = t.par + t.s;
    for (const q of t.qs) { if (q.d == null || q.st == null) continue; const L = lieK(q.lie), left = fin - q.st + 1; if (left < 1) continue; put(fine(L, q.d), left); put(coarse(L, q.d), left); put(`L|${L}`, left); } }
  const get = (k, n) => { const a = acc.get(k); return a && a[1] >= n ? a[0] / a[1] : null; };
  return (q) => { if (!q || q.d == null) return null; const L = lieK(q.lie); return get(fine(L, q.d), 12) ?? get(coarse(L, q.d), 6) ?? get(`L|${L}`, 6); };
}
/** each shot of a finished trail: its strokes gained (q.sg), or null when a spot can't be valued */
export function shotSG(t, E) {
  if (t.s == null) return t.qs.map(() => null);
  return t.qs.map((q, i) => { const a = E(q); if (a == null) return null; const nx = t.qs[i + 1]; if (!nx) return a - 1; const b = E(nx); if (b == null) return null; return a - b - Math.max(1, nx.st - q.st); });
}
