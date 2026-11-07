/*
 * (update 479) Strategy Maps from a shot-level file: one row per shot, every shot of every player, columns
 *   year, courseNum, course, player, playerID, round, hole, par, pin_id, lie, strokes, shot_for, hole_out,
 *   x, y, scoring_avg, pin_x, pin_y, distance
 * (strokes: which stroke the shot was; shot_for: the score it was for, to par; hole_out: 1 on the hole's last shot, whose
 *  shot_for is the score; scoring_avg: that shot's strokes to hole out, 1 on the last; distance: from the pin, yards, feet
 *  on the green; x, y, pin_x, pin_y: pixels on the hole's image)
 * Far too much for a phone, so it's boiled down here, on the admin's computer, as the file is read (a slice at a time):
 *   zones: the shots of each lie grouped by where they were (small zones near the green, bigger ones far out), with
 *          how many and their average strokes to hole out (the same zones the heatmap draws from)
 *   hole history: for each hole and pin, the scoring average and how many eagles, birdies, pars, bogeys and worse
 *   each player's own shots, stroke by stroke (their trails), stored apart so they're only read for that player
 */
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { listHeatCourses, writeChunks, readChunks, heatId, resetHeatList, lieName } from "./courseHeat.js";
import { sameCourse } from "./sg.js";
import { clientKey } from "./data.js";
import { strategyOf, goOf } from "./strategy.js"; // (update 588; 595: going for it or laying up, one rule)

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLS = { year: ["year", "season"], courseNum: ["coursenum", "coursenumber", "courseid"], course: ["course", "coursename"], player: ["player", "playername", "name"], playerID: ["playerid", "player_id", "pid"],
  round: ["round", "rnd", "roundno"], hole: ["hole"], par: ["par", "holepar"], pin: ["pinid", "pin", "pinlocation"], lie: ["lie", "fromlocation"], strokes: ["strokes", "stroke", "shotnum", "shotnumber"],
  shotFor: ["shotfor"], holeOut: ["holeout"], x: ["x"], y: ["y"], v: ["scoringavg", "strokestoholeout"], pinX: ["pinx"], pinY: ["piny"], dist: ["distance", "dist"], event: ["tournament", "tournamentname", "event", "eventname"],
  skill: ["distance_range", "distancerange", "skill", "shotskill"],
  trueDist: ["true_distance", "truedistance"] }; // (update 526: the distance shown on a past shot) // (update 512: the file's distance_range (its skill) for each shot, for the skills against the Top 10)
export function shotColumns(header) {
  const h = header.map(norm), ix = {};
  for (const [k, names] of Object.entries(COLS)) { const i = names.map((n) => h.indexOf(norm(n))).find((x) => x >= 0); if (i != null && i >= 0) ix[k] = i; }
  return ix;
}
/** Is this a shot-level file (a row per shot)? */
export const isShotFile = (header) => { const ix = shotColumns(header); return ix.hole != null && ix.x != null && (ix.strokes != null || ix.holeOut != null || (ix.player != null && ix.round != null) || (ix.playerID != null && ix.round != null)); }; // (update 480: looser)

const num = (v) => { if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const LIES = ["tee", "fairway", "rough", "bunker", "green", "water", "other"];
const lieIx = (s) => { const L = lieName(s); const i = LIES.indexOf(L); return i >= 0 ? i : 6; };

/*
 * (update 485) One map a course. Sources (a courseNum and spelling each) that are the same course are put together: a
 * shared courseNum, or the same course name. Before they're put together, each is checked against the biggest one: if its
 * tee shots or its pins sit somewhere else on the image (a different coordinate system: on average more than a fifth of
 * the hole's length away), it isn't used, and only the data with the most shots is kept. A pin id both use for different
 * spots (pin 1 one week, pin 1 another) is kept apart: the second is "{pin}_e{courseNum}".
 */
const centre = (sx, sy, n) => (n ? [sx / n, sy / n] : null);
const pinCentre = (H) => { let x = 0, y = 0, n = 0; for (const P of H.pins.values()) { x += P.px; y += P.py; n += P.pn; } return centre(x, y, n); };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** How far apart two sources' tees and pins are, as a share of the hole's length (the median over their holes), or null. */
export function offsetOf(A, B) {
  const r = [];
  for (const [h, HA] of A.holes) {
    const HB = B.holes.get(h); if (!HB) continue;
    const tA = centre(HA.tx, HA.ty, HA.tn), tB = centre(HB.tx, HB.ty, HB.tn), pA = pinCentre(HA), pB = pinCentre(HB);
    if (!tA || !pA) continue;
    const len = dist2(tA, pA); if (len < 1) continue;
    const off = Math.max(tB ? dist2(tA, tB) : 0, pB ? dist2(pA, pB) : 0);
    if (tB || pB) r.push(off / len);
  }
  if (!r.length) return null;
  r.sort((a, b) => a - b);
  return r[Math.floor(r.length / 2)];
}
export const OFFSET_MAX = 0.2;
function sameCourses(list) {
  // the groups: sources joined by a courseNum or a name they share
  const up = list.map((_, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
  for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) {
    const a = list[i], b = list[j];
    // (update 486) a map per courseNum: a course that hosted two events (two courseNums) has a map for each, on its own
    // images; one courseNum spelled two ways is one map. Without courseNums, the same name is one map.
    if (a.courseNum ? a.courseNum === b.courseNum : !b.courseNum && sameCourse(a.name, b.name)) up[find(i)] = find(j);
  }
  const groups = new Map(); list.forEach((c, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(c));
  const out = [];
  for (const g of groups.values()) {
    const big = [...g].sort((a, b) => b.n - a.n)[0];
    const keep = g.filter((c) => c === big || !((offsetOf(big, c) ?? 0) > OFFSET_MAX));
    const dropped = g.filter((c) => !keep.includes(c)).map((c) => ({ courseNum: c.courseNum, name: c.name, shots: c.n, offset: Math.round(offsetOf(big, c) * 100) }));
    // (the first courseNum's pin ids stay as they are, so the admin's pin names and edits keep working week to week)
    keep.sort((a, b) => String(a.courseNum ?? "").localeCompare(String(b.courseNum ?? ""), undefined, { numeric: true }) || b.n - a.n);
    const M = { name: big.name, names: new Map(), courseNum: keep[0].courseNum, holes: new Map(), players: new Map(), years: new Set(), events: new Map(), n: 0 };
    for (const c of keep) mergeSource(M, c);
    M.courseNums = [...new Set(keep.map((c) => c.courseNum).filter(Boolean))];
    M.dropped = dropped;
    // (update 486) every courseNum's shots and how far its tees and pins are from the biggest one's, to report
    M.sources = g.map((c) => { const o = c === big ? 0 : offsetOf(big, c); return { courseNum: c.courseNum, name: c.name, shots: c.n, offset: o == null ? null : Math.round(o * 100), kept: keep.includes(c), biggest: c === big }; });
    out.push(M);
  }
  return out;
}
function mergeSource(M, C) {
  const ren = new Map();
  for (const [nm, k] of C.names) M.names.set(nm, (M.names.get(nm) || 0) + k);
  for (const y of C.years) M.years.add(y);
  for (const [e, ys] of C.events) { const t = M.events.get(e) || M.events.set(e, new Set()).get(e); ys.forEach((y) => t.add(y)); }
  M.n += C.n;
  for (const [h, HC] of C.holes) {
    let HM = M.holes.get(h);
    if (!HM) { HM = { par: null, pins: new Map(), tee: [], tx: 0, ty: 0, tn: 0 }; M.holes.set(h, HM); }
    HM.par ||= HC.par;
    for (const t of HC.tee) HM.tee.push(t);
    const tM = centre(HM.tx, HM.ty, HM.tn), pM = pinCentre(HM), len = tM && pM ? dist2(tM, pM) : null;
    HM.tx += HC.tx; HM.ty += HC.ty; HM.tn += HC.tn;
    for (const [pid, PC] of HC.pins) {
      let id = pid;
      const PM = HM.pins.get(pid);
      if (PM && PM.pn && PC.pn && len && dist2(centre(PM.px, PM.py, PM.pn), centre(PC.px, PC.py, PC.pn)) > 0.03 * len) id = `${pid}_e${C.courseNum ?? "x"}`;
      ren.set(`${h}|${pid}`, id);
      const T = HM.pins.get(id);
      if (!T) { HM.pins.set(id, { px: PC.px, py: PC.py, pn: PC.pn, shots: PC.shots, hist: { ...PC.hist } }); continue; }
      T.px += PC.px; T.py += PC.py; T.pn += PC.pn;
      for (const v of PC.shots) T.shots.push(v);
      for (const [k, n] of Object.entries(PC.hist)) T.hist[k] = (T.hist[k] || 0) + n;
    }
  }
  for (const [key, TC] of C.players) {
    const TM = M.players.get(key) || M.players.set(key, { name: TC.name, trails: new Map() }).get(key);
    TM.name ||= TC.name;
    for (const [tk, tr] of TC.trails) { tr.p = ren.get(`${tr.h}|${tr.p}`) ?? tr.p; TM.trails.set(tk, tr); }
  }
}

/*
 * (update 488) Course Insights: what the course report's first pages show, worked out from the shots (also in
 * course_upload.py: keep the two the same).
 *   events: each year's winning, Top 10 and Top 25 scores (to par, of those who played every round) and the cut line
 *   holes: scoring of the field and of the Top 10 finishers (eagle+, birdie, par, bogey+), what hitting the fairway, the
 *          green in regulation and going for it are worth, fairway widths where tee shots land, the left and right tee
 *          misses (drive_direction) and up & down by where the approach missed the green (app_side_loc) and the lie
 *   attempts: shots by distance (not tee shots on par 4s and 5s), for the distribution against every course's
 *   sg: strokes gained by distance (against this course's own field) of the field and of the Top 10, a round, and the
 *       expected strokes from each lie and distance, so a player's can be worked out the same way
 */
const r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10;
export const ATT_B = ["3-5 ft", "5-10 ft", "10-15 ft", "15-20 ft", "20-25 ft", ">25 ft", "<30 yds", "30-50 yds", "50-100 yds", "100-120 yds", "120-140 yds", "140-160 yds", "160-180 yds", "180-200 yds", "200-220 yds", ">220 yds"];
export const SG_B = ["<5 ft", ...ATT_B.slice(1), "Tee shot"];
/** (update 512) the skills with strokes gained: the shot file's skill column when it has one, else the distances */
export const skillsOf = (...objs) => { const ks = new Set(); for (const o of objs) for (const k of Object.keys(o || {})) ks.add(k); return ks.size ? [...ks] : SG_B; };
const ydB = (d) => (d < 30 ? "<30 yds" : d < 50 ? "30-50 yds" : d < 100 ? "50-100 yds" : d < 120 ? "100-120 yds" : d < 140 ? "120-140 yds" : d < 160 ? "140-160 yds" : d < 180 ? "160-180 yds" : d < 200 ? "180-200 yds" : d < 220 ? "200-220 yds" : ">220 yds");
const ftB = (d) => (d < 5 ? "<5 ft" : d < 10 ? "5-10 ft" : d < 15 ? "10-15 ft" : d < 20 ? "15-20 ft" : d < 25 ? "20-25 ft" : ">25 ft");
/** a shot's distance bucket ([stroke, x, y, lie, dist, toHoleOut]): for strokes gained (sg) or the attempt distribution */
export function bucketOf(q, par, sg) {
  const L = q[3], d = dOf(q); // (update 537: true_distance when the file has it)
  if (sg && q[6]) return String(q[6]); // (update 512) strokes gained by the file's skill column, when it has one
  if (q[0] === 1 && par >= 4) return sg ? "Tee shot" : null;
  if (d == null) return null;
  if (L === 4) { if (!sg && d < 3) return null; const b = ftB(d); return sg ? b : b === "<5 ft" ? "3-5 ft" : b; }
  return ydB(d);
}
/** the expected strokes key of a spot: its lie and distance, finer close in */
/** (update 537) a shot's distance to the hole: the file's true_distance (kept 8th) when it has it, else its distance */
export const dOf = (q) => (q[7] != null ? q[7] : q[4]);
export function eKey(L, d) {
  if (d == null) return null;
  const b = L === 4 ? (d < 10 ? Math.floor(d) : d < 30 ? 10 + Math.floor((d - 10) / 5) : Math.min(30, 14 + Math.floor((d - 30) / 10)))
    : (d < 30 ? Math.floor(d / 5) : d < 100 ? 6 + Math.floor((d - 30) / 10) : Math.min(40, 13 + Math.floor((d - 100) / 20)));
  return `${L}|${b}`;
}
/** strokes gained on each shot of a trail, by bucket, added to into (null when it can't be worked out) */
export function trailSG(t, par, E, into) {
  const qs = t.shots;
  for (let i = 0; i < qs.length; i++) {
    const k0 = eKey(qs[i][3], dOf(qs[i])); if (k0 == null || E[k0] == null) continue;
    let nx;
    if (i + 1 < qs.length) { const k1 = eKey(qs[i + 1][3], dOf(qs[i + 1])); if (k1 == null || E[k1] == null) continue; nx = E[k1]; } else if (t.s != null) nx = 0; else continue;
    const b = bucketOf(qs[i], par, true); if (!b) continue;
    into[b] = (into[b] || 0) + (E[k0] - nx - 1);
  }
}
/* (update 501) shared by the build and the map: the approach miss on a hole (the first shot from off the green within
 * 30 yards, after one from farther out) */
/*
 * (update 502) A hole's up & down boards, per pin. The line of play: from the middle of the fairway (halfway between the
 * farthest-left and farthest-right shots played from the fairway (update 555: of the half closest to the pin; 558: replaced
 * by halfway between where the approaches were hit from: the farthest-right of those that missed left and the farthest-left
 * of those that missed right), across the line from the tee to the green) to the pin,
 * or from the tee on a par 3. The board's middle square: 20 x 20 ft around the pin (10 ft each way along and across that
 * line; update 503: 40 x 40 ft, 20 ft each way), less where the green runs out sooner (its edges: the 1st and 99th percentiles of where shots were played on it).
 * shots: [{ x, y, L, d, st }] (every shot on the hole, rounded as the trails are); pins: Map(pin id → [x, y]).
 */
export function holeBoards(shots, pins, par) {
  const avg = (l) => (l.length ? [l.reduce((t, q) => t + q.x, 0) / l.length, l.reduce((t, q) => t + q.y, 0) / l.length] : null);
  const tees = shots.filter((q) => q.st === 1), greens = shots.filter((q) => q.L === 4), T = avg(tees), G = avg(greens);
  if (!T || !G || greens.length < 20) return null;
  let ref = T;
  // (update 555) only the half of the fairway shots closest to the pin (its yards to the pin; else to the green's middle):
  // the fairway near the green sets the line, not drives' far-flung landing spots
  const fwAll = par >= 4 ? shots.filter((q) => q.L === 1) : [];
  const byYds = fwAll.every((q) => q.d != null && Number.isFinite(q.d)), dTo = (q) => (byYds ? q.d : Math.hypot(q.x - G[0], q.y - G[1]));
  // (update 557) the approach shots from the fairway (more than 30 yds out, when the yards are known): the half nearest the pin
  const appr = byYds ? fwAll.filter((q) => q.d > 30) : fwAll;
  const fwA = appr.length >= 4 ? [...appr].sort((p, q) => dTo(p) - dTo(q)).slice(0, Math.ceil(appr.length / 2)) : appr;
  const dx = G[0] - T[0], dy = G[1] - T[1], dl = Math.hypot(dx, dy) || 1, lat = (q) => (dx * (q.y - T[1]) - dy * (q.x - T[0])) / dl;
  const midOf = (list) => { let lo = list[0], hi = list[0]; for (const q of list) { if (lat(q) < lat(lo)) lo = q; if (lat(q) > lat(hi)) hi = q; } return [(lo.x + hi.x) / 2, (lo.y + hi.y) / 2]; };
  if (fwA.length >= 2) ref = midOf(fwA); // (a first line: the fairway's approach shots, as in update 555)
  // (update 559, 560) the line of play, in steps (par 4s and 5s; a par 3: the tee):
  //   1. the drives that missed the fairway left or right (as Off the tee calls them: from where the drive finished,
  //      against the middle of where drives finish in the fairway);
  //   2. of all of those, the half closest to the pin;
  //   3. of the left misses left, the farthest right (nearest the fairway); of the right misses, the farthest left;
  //   4. halfway between those two: the line runs from there to the pin. (The two are kept to mark on the map.)
  // (update 560) each miss's side from the fairway beside it (not from the tee: on a dogleg that put misses on the wrong side):
  // the fairway drives nearest the miss give the fairway's line there; left or right of that line (on the map's pixels,
  // y downward: across the line > 0 is right). One side with none left: the two fairway drives farthest apart instead.
  let marks = null;
  if (par >= 4) {
    const fwD = shots.filter((q) => q.st === 2 && q.L === 1);
    const axisAt = (x, y) => {
      const nn = [...fwD].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, 15);
      if (nn.length < 3) return null;
      const cx = nn.reduce((t, q) => t + q.x, 0) / nn.length, cy = nn.reduce((t, q) => t + q.y, 0) / nn.length;
      let sxx = 0, syy = 0, sxy = 0; for (const q of nn) { sxx += (q.x - cx) ** 2; syy += (q.y - cy) ** 2; sxy += (q.x - cx) * (q.y - cy); }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let ux = Math.cos(th), uy = Math.sin(th);
      // along the fairway toward the green (and, where the drives sit in a round blob, the line from the tee to the green)
      if (Math.abs(sxx - syy) < 1e-6 && Math.abs(sxy) < 1e-6) { const gl = Math.hypot(G[0] - T[0], G[1] - T[1]) || 1; ux = (G[0] - T[0]) / gl; uy = (G[1] - T[1]) / gl; }
      if (ux * (G[0] - cx) + uy * (G[1] - cy) < 0) { ux = -ux; uy = -uy; }
      return { cx, cy, ux, uy };
    };
    const latAt = (A, x, y) => A.ux * (y - A.cy) - A.uy * (x - A.cx);
    const miss = [];
    for (const q of shots) {
      if (q.st !== 2 || q.L === 1 || q.L === 4) continue;
      const A = axisAt(q.x, q.y); if (!A) continue;
      const la = latAt(A, q.x, q.y);
      if (la) miss.push({ q, side: la < 0 ? "L" : "R", off: Math.abs(la) });
    }
    const byYds = miss.every((m) => m.q.d != null && Number.isFinite(m.q.d)), dTo2 = (m) => (byYds ? m.q.d : Math.hypot(m.q.x - G[0], m.q.y - G[1]));
    const half = [...miss].sort((a, b) => dTo2(a) - dTo2(b)).slice(0, Math.ceil(miss.length / 2));
    const L = half.filter((m) => m.side === "L"), R = half.filter((m) => m.side === "R");
    let a = null, b = null;
    if (L.length && R.length) {
      // the left miss nearest the fairway (the farthest right of them), and the right miss nearest it (the farthest left)
      a = L.reduce((p, c) => (c.off < p.off ? c : p)).q; b = R.reduce((p, c) => (c.off < p.off ? c : p)).q;
    } else if (fwD.length >= 2) {
      // one side empty: the two fairway drives farthest apart across the fairway (of the half nearest the pin)
      const fyd = fwD.every((q) => q.d != null && Number.isFinite(q.d)), fd = (q) => (fyd ? q.d : Math.hypot(q.x - G[0], q.y - G[1]));
      const near = [...fwD].sort((p, c) => fd(p) - fd(c)).slice(0, Math.max(2, Math.ceil(fwD.length / 2)));
      const mx = near.reduce((t, q) => t + q.x, 0) / near.length, my = near.reduce((t, q) => t + q.y, 0) / near.length, A = axisAt(mx, my);
      if (A) { const lat = (q) => latAt(A, q.x, q.y); a = near.reduce((p, c) => (lat(c) < lat(p) ? c : p)); b = near.reduce((p, c) => (lat(c) > lat(p) ? c : p)); if (a === b) a = b = null; }
    }
    if (a && b) { marks = [[a.x, a.y], [b.x, b.y]]; ref = [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
  }
  // pixels a yard (each shot's pixels from its pin against its yards), for the 10 ft
  const rs = []; for (const q of shots) { const P = pins.get(q.pid); if (P && q.L !== 4 && q.d != null && q.d > 15) rs.push(Math.hypot(q.x - P[0], q.y - P[1]) / q.d); }
  rs.sort((a, b) => a - b); const ppy = rs.length ? rs[Math.floor(rs.length / 2)] : 3, ten = (20 / 3) * ppy; // (update 503: 40 x 40 ft, 20 ft each way)
  const memo = new Map();
  const boardOf = (pid) => {
    if (memo.has(pid)) return memo.get(pid);
    const P = pins.get(pid); if (!P) { memo.set(pid, null); return null; }
    const ux0 = P[0] - ref[0], uy0 = P[1] - ref[1], ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul;
    const A = greens.map((q) => (q.x - P[0]) * ux + (q.y - P[1]) * uy).sort((a, b) => a - b), L = greens.map((q) => ux * (q.y - P[1]) - uy * (q.x - P[0])).sort((a, b) => a - b);
    const pc = (v, f) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    const b = { gx: P[0], gy: P[1], ux, uy, a0: -Math.min(ten, Math.max(0, -pc(A, 0.01))), a1: Math.min(ten, Math.max(0, pc(A, 0.99))), l0: -Math.min(ten, Math.max(0, -pc(L, 0.01))), l1: Math.min(ten, Math.max(0, pc(L, 0.99))), ref };
    memo.set(pid, b);
    return b;
  };
  const sideOf = (pid, nq) => {
    const B = boardOf(pid); if (!B) return null;
    const vx = nq[1] - B.gx, vy = nq[2] - B.gy, along = vx * B.ux + vy * B.uy, lat = B.ux * vy - B.uy * vx;
    const row = along > B.a1 ? "Long" : along < B.a0 ? "Short" : "", colm = lat > B.l1 ? "Right" : lat < B.l0 ? "Left" : "";
    if (row || colm) return row && colm ? `${row}-${colm}` : row || colm;
    const da = Math.min(B.a1 - along, along - B.a0), dl = Math.min(B.l1 - lat, lat - B.l0);
    return da < dl ? (along > (B.a0 + B.a1) / 2 ? "Long" : "Short") : (lat > (B.l0 + B.l1) / 2 ? "Right" : "Left");
  };
  // (update 561) each pin's name from where it sits on the green: Front / Back of the green's middle along the line in (the
  // grid's line: from its start to that pin), and Left / Center / Right across it (Center: the middle third of the green's width)
  const pinNamesAll = () => {
    const out = {}, used = new Map();
    for (const [pid, P] of pins) {
      const ux0 = P[0] - ref[0], uy0 = P[1] - ref[1], ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul;
      const lats = greens.map((q) => ux * (q.y - G[1]) - uy * (q.x - G[0])).sort((a, b) => a - b);
      const pc = (f) => lats[Math.min(lats.length - 1, Math.max(0, Math.round(f * (lats.length - 1))))], third = (pc(0.95) - pc(0.05)) / 6;
      const vx = P[0] - G[0], vy = P[1] - G[1], al = vx * ux + vy * uy, la = ux * vy - uy * vx;
      const base = `${al < 0 ? "Front" : "Back"} ${la > third ? "Right" : la < -third ? "Left" : "Center"}`, k = (used.get(base) || 0) + 1;
      used.set(base, k); out[pid] = k > 1 ? `${base} ${k}` : base;
    }
    return out;
  };
  return { ref, marks, ppy, boardOf, sideOf, pinNamesAll };
}
export function approachMiss(qs) {
  for (let i = 1; i < qs.length; i++) {
    const nq = qs[i], pq = qs[i - 1];
    if (nq[4] == null || nq[4] > 30 || ![1, 2, 3].includes(nq[3])) continue;
    if (pq[3] === 4 || (pq[4] != null && pq[4] <= 30 && pq[3] !== 0)) return null; // (a second chip: not the approach's miss)
    return { pq, nq };
  }
  return null;
}
const add2 = (o, k, v) => { const a = o[k] || (o[k] = [0, 0]); a[0]++; a[1] += v; };
const sc5 = () => ({ n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 });
const addSc = (o, s) => { o.n++; o.sum += s; if (s <= -2) o.e++; else if (s === -1) o.b++; else if (s === 0) o.p++; else o.g++; };
export function courseInsights(C) {
  const all = []; // [key, trail] with its shots in order
  for (const [key, T] of C.players) for (const t of T.trails.values()) all.push([key, t, [...t.shots].sort((a, b) => a[0] - b[0])]);
  const parOf = (h) => C.holes.get(h)?.par || 4;
  // the events: each year, those who played every hole of every round; Top 10 finishers (ties too)
  const byY = new Map();
  for (const [key, t] of all) { if (t.s == null) continue; const Y = byY.get(t.y) || byY.set(t.y, new Map()).get(t.y); const P = Y.get(key) || Y.set(key, { n: 0, tot: 0, rs: new Set(), r12: 0 }).get(key); P.n++; P.tot += t.s; P.rs.add(String(t.r)); const rn = num(t.r); if (rn != null && rn <= 2) P.r12 += t.s; }
  const events = [], top = new Set();
  for (const [y, Y] of byY) {
    const ps = [...Y.entries()], maxN = Math.max(...ps.map(([, P]) => P.n)), maxR = Math.max(...ps.map(([, P]) => P.rs.size));
    const full = ps.filter(([, P]) => P.n === maxN), tots = full.map(([, P]) => P.tot).sort((a, b) => a - b);
    const t10 = tots[Math.min(9, tots.length - 1)];
    for (const [k, P] of full) if (P.tot <= t10) top.add(`${k}|${y}`);
    let cut = null;
    if (maxR >= 3) { const made = ps.filter(([, P]) => P.rs.size >= 3), missed = ps.filter(([, P]) => P.rs.size === 2); if (made.length && missed.length) cut = Math.max(...made.map(([, P]) => P.r12)); }
    events.push({ y, players: ps.length, full: full.length, rounds: maxR, win: tots[0] ?? null, top10: tots.length >= 10 ? tots[9] : null, top25: tots.length >= 25 ? tots[24] : null, cut });
  }
  // the expected strokes from each lie and distance (this course's own field)
  const Es = {};
  for (const [, , qs] of all) for (const q of qs) { if (q[5] == null) continue; const k = eKey(q[3], dOf(q)); if (k == null) continue; const a = Es[k] || (Es[k] = [0, 0]); a[0] += q[5]; a[1]++; }
  const E = {}; for (const k of Object.keys(Es)) E[k] = r4(Es[k][0] / Es[k][1]);
  // pixels a yard on each hole (shots' pixels from their pin against their yards), for the fairway widths
  const ppy = new Map();
  for (const [h, H] of C.holes) {
    const rs = [];
    for (const [, t, qs] of all) { if (t.h !== h || rs.length >= 3000) continue; const P = H.pins.get(t.p); if (!P?.pn) continue; const px = P.px / P.pn, py = P.py / P.pn; for (const q of qs) if (q[3] !== 4 && q[4] != null && q[4] > 15 && rs.length < 3000) rs.push(Math.hypot(q[1] - px, q[2] - py) / q[4]); }
    rs.sort((a, b) => a - b); ppy.set(h, rs.length ? rs[Math.floor(rs.length / 2)] : null);
  }
  // (update 494) tee misses and approach misses from the shots themselves (not the file's direction columns): the centre of
  // each green (where every putt started), and where drives finish in the fairway (the line of play off the tee)
  const gAcc = new Map(), fAcc = new Map();
  for (const [, t, qs] of all) for (const q of qs) {
    if (q[3] === 4) { const a = gAcc.get(t.h) || gAcc.set(t.h, [0, 0, 0]).get(t.h); a[0] += q[1]; a[1] += q[2]; a[2]++; }
    if (q[0] === 2 && q[3] === 1) { const a = fAcc.get(t.h) || fAcc.set(t.h, [0, 0, 0]).get(t.h); a[0] += q[1]; a[1] += q[2]; a[2]++; }
  }
  const mid = (m, h) => { const a = m.get(h); return a && a[2] ? [a[0] / a[2], a[1] / a[2]] : null; };
  // (update 502; shared with the map) each hole's up & down boards, per pin: holeBoards
  const hbMemo = new Map();
  const hbOf = (h) => {
    if (hbMemo.has(h)) return hbMemo.get(h);
    const shots = []; let ti = 0; for (const [, t, qs] of all) if (t.h === h) { ti++; for (const q of qs) shots.push({ x: q[1], y: q[2], L: q[3], d: q[4], st: q[0], pid: t.p, tr: ti }); } // (update 558: tr, each trail)
    const H = C.holes.get(h), pins = new Map(); for (const [pid, P] of H?.pins || []) if (P.pn) pins.set(pid, [P.px / P.pn, P.py / P.pn]);
    const hb = holeBoards(shots, pins, H?.par || 4); hbMemo.set(h, hb); return hb;
  };
  const holes = {}, attempts = {}, sgF = {}, sgT = {}, rF = new Set(), rT = new Set();
  for (const [h, H] of C.holes) holes[h] = { par: parOf(h), field: sc5(), top: sc5(), fwy: {}, gir: {}, go: {}, drive: {}, ud: {}, udp: {}, drivep: {}, ps: {}, land: [], sp: {} };
  for (const [key, t, qs] of all) {
    const X = holes[t.h]; if (!X) continue;
    const par = X.par, isTop = top.has(`${key}|${t.y}`), rk = `${key}|${t.y}|${t.r}`;
    for (const q of qs) { const b = bucketOf(q, par, false); if (b) attempts[b] = (attempts[b] || 0) + 1; }
    rF.add(rk); if (isTop) rT.add(rk);
    const one = {}; trailSG({ ...t, shots: qs }, par, E, one);
    for (const [b, v] of Object.entries(one)) { sgF[b] = (sgF[b] || 0) + v; if (isTop) sgT[b] = (sgT[b] || 0) + v; }
    const at = (k) => qs.find((q) => q[0] === k);
    // where approaches missed the green: the first shot played from off the green within 30 yards (after a shot from
    // farther out); its side from the green's centre, along the line the approach came in on (update 494)
    const HB = hbOf(t.h), m = HB ? approachMiss(qs) : null, side = m ? HB.sideOf(t.p, m.nq) : null;
    if (side) {
      const { nq } = m;
      const lie = LIES[nq[3]][0].toUpperCase() + LIES[nq[3]].slice(1), o = X.ud[side] || (X.ud[side] = {}), a = o[lie] || (o[lie] = [0, 0]);
      const made = nq[5] != null && nq[5] <= 2;
      a[0]++; if (made) a[1]++;
      // (update 491) and for the pin it was played to (Strategy Maps shows it with each pin)
      const U = X.udp[t.p] || (X.udp[t.p] = {}), o2 = U[side] || (U[side] = {}), a2 = o2[lie] || (o2[lie] = [0, 0]);
      a2[0]++; if (made) a2[1]++;
    }
    if (t.s == null) continue;
    // (update 588) every finished round to its pin, for the strategy insights: its shots, its approach (the last shot from
    // more than 30 yds before the green or within 30 yds) and that approach's miss, if any
    { let apIdx = null; for (let i = 0; i + 1 < qs.length; i++) if (qs[i][4] != null && qs[i][4] > 30 && qs[i][3] !== 4 && (qs[i + 1][3] === 4 || (qs[i + 1][4] != null && qs[i + 1][4] <= 30))) { apIdx = i; break; }
      (X.sp[t.p] || (X.sp[t.p] = [])).push({ s: t.s, qs, side, mLie: m ? LIES[m.nq[3]] : null, apIdx }); }
    addSc(X.field, t.s); if (isTop) addSc(X.top, t.s);
    // (update 508) and the same for its pin
    const PS = X.ps[t.p] || (X.ps[t.p] = { field: sc5(), top: sc5(), fwy: {}, gir: {}, go: {}, land: [] });
    addSc(PS.field, t.s); if (isTop) addSc(PS.top, t.s);
    const s = t.s, q2 = at(2);
    if (par >= 4 && q2) { add2(X.fwy, q2[3] === 1 ? "hit" : "miss", s); add2(PS.fwy, q2[3] === 1 ? "hit" : "miss", s); }
    const gir = qs.some((q) => q[0] != null && q[0] <= par - 1 && q[3] === 4) || s <= -2 ? "hit" : "miss"; add2(X.gir, gir, s); add2(PS.gir, gir, s);
    const qg = par >= 5 ? at(3) : par === 4 ? q2 : null;
    if (qg) { const gk = goOf(at(par >= 5 ? 2 : 1), qg, par, ppy.get(t.h)); if (gk) { add2(X.go, gk, s); add2(PS.go, gk, s); } } // (update 595: the same rule as Cal's Read)
    const q1 = at(1), fw = mid(fAcc, t.h);
    let dd = null; // (update 494: from where the drive finished)
    if (q1 && q2 && q2[3] !== 4) { if (q2[3] === 1) dd = "C"; else if (fw) { const lat = (fw[0] - q1[1]) * (q2[2] - q1[2]) - (fw[1] - q1[2]) * (q2[1] - q1[1]); dd = lat < 0 ? "L" : lat > 0 ? "R" : null; } }
    if (par >= 4 && dd) { add2(X.drive, dd, s); add2(X.drivep[t.p] || (X.drivep[t.p] = {}), dd, s); } // (update 492: and per pin)
    if (par >= 4 && q1 && q2 && q2[3] === 1) { X.land.push([q1[1], q1[2], q2[1], q2[2]]); PS.land.push([q1[1], q1[2], q2[1], q2[2]]); }
  }
  const out = {};
  for (const [h, X] of Object.entries(holes)) {
    // fairway widths where tee shots finished in the fairway, 250 to 325 yards out (the spread across the line of play)
    const k = ppy.get(Number(h)) ?? ppy.get(h);
    const widthsOf = (land) => {
      const widths = {};
      if (k) for (const c of [250, 275, 300, 325]) {
        const pts = land.filter((l) => Math.abs(Math.hypot(l[2] - l[0], l[3] - l[1]) / k - c) <= 12.5);
        if (pts.length < 8) continue;
        const tx = pts.reduce((a, l) => a + l[0], 0) / pts.length, ty = pts.reduce((a, l) => a + l[1], 0) / pts.length, cx = pts.reduce((a, l) => a + l[2], 0) / pts.length, cy = pts.reduce((a, l) => a + l[3], 0) / pts.length;
        const dl = Math.hypot(cx - tx, cy - ty) || 1, ux = (cx - tx) / dl, uy = (cy - ty) / dl;
        const off = pts.map((l) => ((l[2] - tx) * uy - (l[3] - ty) * ux) / k).sort((a, b) => a - b);
        widths[c] = Math.round(off[Math.floor(0.95 * (off.length - 1))] - off[Math.floor(0.05 * (off.length - 1))]);
      }
      return widths;
    };
    const widths = widthsOf(X.land);
    const fx = (o) => ({ ...o, sum: r4(o.sum) }), f2 = (o) => Object.fromEntries(Object.entries(o).map(([kk, a]) => [kk, [a[0], r4(a[1])]]));
    // (update 508) each pin's own: scoring (field, Top 10), fairway / green / going for it, fairway widths
    const pinStats = Object.fromEntries(Object.entries(X.ps).map(([pp, P]) => [pp, { field: fx(P.field), top: fx(P.top), fwy: f2(P.fwy), gir: f2(P.gir), go: f2(P.go), widths: widthsOf(P.land) }]));
    const pinAuto = (() => { try { return (hbOf(Number(h)) || hbOf(h))?.pinNamesAll?.() || {}; } catch { return {}; } })(); // (update 561)
    // (update 588) the strategy insights: each pin, and every pin together ("*")
    const strategy = (() => { const geo = { ppy: ppy.get(Number(h)) ?? ppy.get(h), fw: mid(fAcc, Number(h)) || mid(fAcc, h) }, o = {};
      try { for (const [pp, recs] of Object.entries(X.sp || {})) { const r = strategyOf(recs, X.par, geo); if (r) o[pp] = r; }
        const all = strategyOf(Object.values(X.sp || {}).flat(), X.par, geo); if (all) o["*"] = all; } catch (err) { console.warn("Strategy insights", err); }
      return o; })();
    out[h] = { strategy, pinAuto, par: X.par, field: fx(X.field), top: fx(X.top), fwy: f2(X.fwy), gir: f2(X.gir), go: f2(X.go), drive: f2(X.drive), drivePins: Object.fromEntries(Object.entries(X.drivep).map(([pp, o]) => [pp, f2(o)])), ud: X.ud, udPins: X.udp, pinStats, udBoards: (() => { const HB = hbOf(Number(h)) || hbOf(h), o = {}; if (HB) for (const pp of Object.keys(X.udp)) { const B = HB.boardOf(pp); if (B) o[pp] = { gx: r1(B.gx), gy: r1(B.gy), ux: r4(B.ux), uy: r4(B.uy), a0: r1(B.a0), a1: r1(B.a1), l0: r1(B.l0), l1: r1(B.l1), rx: r1(B.ref[0]), ry: r1(B.ref[1]), ...(HB.marks ? { mk: HB.marks.map((m) => [r1(m[0]), r1(m[1])]) } : {}) }; } return o; })(), widths };
  }
  const r4o = (o) => Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, r4(v)]));
  return { events, holes: out, attempts, sg: { field: r4o(sgF), top: r4o(sgT), fieldRounds: rF.size, topRounds: rT.size, E }, top: [...top] };
}

/** Reads shot rows (a slice at a time) and keeps only what the maps need. */
export function shotAggregator() {
  const courses = new Map(); // name → course
  let ix = null, rowsIn = 0;
  // (update 485) read as sources, one per courseNum and spelling; finish() puts together the sources that are the same
  // course (a shared courseNum, or the same name: one course that hosted two events has two courseNums), so each course is
  // one map
  const courseOf = (name, cn) => { const k = `${cn ?? ""}|${name}`; const C = courses.get(k) || courses.set(k, { name, names: new Map([[name, 0]]), courseNum: cn, holes: new Map(), players: new Map(), years: new Set(), events: new Map(), n: 0 }).get(k); C.names.set(name, C.names.get(name) + 1); C.n++; return C; };
  return {
    get rows() { return rowsIn; },
    add({ columns, rows }) {
      ix ||= shotColumns(columns);
      const need = ["course", "hole", "x", "y", "strokes", "holeOut"].filter((k) => ix[k] == null);
      if (need.length) throw new Error(`The shot file is missing ${need.join(", ")}.`);
      for (const r of rows) {
        const name = String(r[ix.course] ?? "").trim(), hole = num(r[ix.hole]), x = num(r[ix.x]), y = num(r[ix.y]);
        if (!name || !hole || x == null || y == null) continue;
        rowsIn++;
        const cn = ix.courseNum != null && r[ix.courseNum] != null && r[ix.courseNum] !== "" ? String(num(r[ix.courseNum]) ?? r[ix.courseNum]) : null;
        const C = courseOf(name, cn); if (cn && !C.courseNum) C.courseNum = cn;
        const year = ix.year != null ? String(num(r[ix.year]) ?? r[ix.year] ?? "") : ""; if (year) C.years.add(year);
        const ev = ix.event != null ? String(r[ix.event] ?? "").trim() : ""; // (update 486: the tournament, when the file has it)
        if (ev) { const e = C.events.get(ev) || C.events.set(ev, new Set()).get(ev); if (year) e.add(year); }
        const H = C.holes.get(hole) || C.holes.set(hole, { par: null, pins: new Map(), tee: [], tx: 0, ty: 0, tn: 0 }).get(hole);
        const par = ix.par != null ? num(r[ix.par]) : null; if (par) H.par = par;
        const pid = ix.pin != null ? String(r[ix.pin] ?? "1").trim() || "1" : "1";
        const P = H.pins.get(pid) || H.pins.set(pid, { px: 0, py: 0, pn: 0, shots: [], hist: {} }).get(pid);
        const px = ix.pinX != null ? num(r[ix.pinX]) : null, py = ix.pinY != null ? num(r[ix.pinY]) : null;
        if (px != null && py != null) { P.px += px; P.py += py; P.pn++; }
        const L = lieIx(r[ix.lie]), dist = ix.dist != null ? num(r[ix.dist]) : null, v = ix.v != null ? num(r[ix.v]) : null, st = num(r[ix.strokes]), out = num(r[ix.holeOut]) === 1, sf = ix.shotFor != null ? num(r[ix.shotFor]) : null;
        if (v != null) P.shots.push(x, y, L, dist ?? -1, v, st ?? 0); // (update 482: and which stroke it was)
        if (L === 0 && dist != null) H.tee.push(dist);
        if (st === 1) { H.tx += x; H.ty += y; H.tn++; } // (update 485: where the tee shots start, to check two events line up)
        // the hole's score: shot_for on the shot that holed out (update 480: or, without it, the stroke less par)
        const score = out ? (sf != null ? sf : st != null && (par || H.par) ? st - (par || H.par) : null) : null;
        if (score != null) { const k = Math.max(-2, Math.min(2, Math.round(score))); P.hist[k] = (P.hist[k] || 0) + 1; }
        // the player's trail for this hole
        const key = ix.playerID != null && r[ix.playerID] != null && r[ix.playerID] !== "" ? clientKey(String(num(r[ix.playerID]) ?? r[ix.playerID])) : ix.player != null ? clientKey(String(r[ix.player])) : null;
        if (key) {
          const T = C.players.get(key) || C.players.set(key, { name: ix.player != null ? String(r[ix.player] ?? "") : "", trails: new Map() }).get(key);
          const tk = `${year}|${ix.round != null ? r[ix.round] : ""}|${hole}|${cn ?? ""}`; // (update 485: and the event's courseNum)
          const tr = T.trails.get(tk) || T.trails.set(tk, { y: year, r: ix.round != null ? String(num(r[ix.round]) ?? r[ix.round]) : "", h: hole, p: pid, par: par || null, s: null, shots: [] }).get(tk);
          const sk = ix.skill != null ? String(r[ix.skill] ?? "").trim() : ""; // (update 512: the shot's skill, kept 7th when the file has it)
          const td = ix.trueDist != null ? num(r[ix.trueDist]) : null; // (update 526: kept 8th, for the past shot's popup)
          tr.shots.push([st, Math.round(x * 10) / 10, Math.round(y * 10) / 10, L, dist != null ? Math.round(dist * 10) / 10 : null, v, ...(sk || td != null ? [sk || null] : []), ...(td != null ? [Math.round(td * 10) / 10] : [])]);
          if (score != null) tr.s = Math.round(score);
          // (update 494: the tee and approach misses come from the shots themselves, not the file's direction columns)
        }
      }
    },
    /** Each course, boiled down: { name, courseNum, years, data (zones and history), players: Map(key → trails JSON) } */
    finish() {
      const out = [];
      for (const C of sameCourses([...courses.values()])) {
        const holes = {};
        for (const [h, H] of C.holes) {
          const pins = {}, holeHist = {};
          for (const [pid, P] of H.pins) {
            const pinX = P.pn ? P.px / P.pn : null, pinY = P.pn ? P.py / P.pn : null;
            // pixels a yard on this image (each shot's pixels from the pin against its yards), for the zone sizes
            const ratios = [];
            for (let i = 0; i < P.shots.length && ratios.length < 3000; i += 6) { const L = P.shots[i + 2], d = P.shots[i + 3]; if (pinX == null || d <= 15 || L === 4) continue; ratios.push(Math.hypot(P.shots[i] - pinX, P.shots[i + 1] - pinY) / d); }
            ratios.sort((a, b) => a - b);
            const ppy = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 3;
            // zones: shots of the same lie in the same square; squares about 2 yards across on and by the green, growing
            // to 12 yards far out (5% of the distance), so the map is fine where it matters and not huge
            const zoneRows = (want) => {
              const cells = new Map();
              for (let i = 0; i < P.shots.length; i += 6) {
                if (want && P.shots[i + 5] !== want) continue;
                const x = P.shots[i], y = P.shots[i + 1], L = P.shots[i + 2], d = P.shots[i + 3], v = P.shots[i + 4];
                const yd = d < 0 ? (pinX != null ? Math.hypot(x - pinX, y - pinY) / ppy : 50) : L === 4 ? d / 3 : d;
                const band = yd < 15 ? 2 : yd < 40 ? 3 : yd < 90 ? 5 : yd < 170 ? 8 : 12, size = band * ppy;
                const k = `${L}|${band}|${Math.floor(x / size)}|${Math.floor(y / size)}`;
                const c = cells.get(k) || cells.set(k, { L, sx: 0, sy: 0, sv: 0, sd: 0, nd: 0, n: 0 }).get(k);
                c.sx += x; c.sy += y; c.sv += v; c.n++; if (d >= 0) { c.sd += d; c.nd++; }
              }
              return [...cells.values()].map((c) => { const dist = c.nd ? c.sd / c.nd : null; return { x: Math.round(c.sx / c.n * 10) / 10, y: Math.round(c.sy / c.n * 10) / 10, lie: LIES[c.L][0].toUpperCase() + LIES[c.L].slice(1), d: dist != null ? `${Math.round(dist)} ${c.L === 4 ? "ft" : "yds"}` : "", dist: dist != null ? Math.round(dist * 10) / 10 : null, v: Math.round(c.sv / c.n * 1000) / 1000, n: c.n }; });
            };
            const rows = zoneRows(0);
            // (update 482) where each shot finished: the zones of the next shot's starting spots (shot 1 on a par 3; 1 and 2
            // on a par 4; 1 to 3 on a par 5)
            const byShot = {};
            for (let k = 1; k <= Math.max(1, Math.min(3, (H.par || 4) - 2)); k++) { const r = zoneRows(k + 1); if (r.length) byShot[k] = r; }
            pins[pid] = { x: pinX, y: pinY, rows, hist: P.hist, byShot };
            for (const [k, n] of Object.entries(P.hist)) holeHist[k] = (holeHist[k] || 0) + n;
          }
          const tee = H.tee.length ? H.tee.reduce((t, x) => t + x, 0) / H.tee.length : null;
          holes[h] = { par: H.par, yards: tee ? Math.round(tee) : null, pins, hist: holeHist };
        }
        const players = new Map();
        for (const [key, T] of C.players) players.set(key, { name: T.name, trails: [...T.trails.values()].map((t) => ({ ...t, shots: t.shots.sort((a, b) => a[0] - b[0]) })) });
        out.push({ name: [...C.names].sort((a, b) => b[1] - a[1])[0]?.[0] || C.name, courseNum: C.courseNum, courseNums: C.courseNums, dropped: C.dropped, sources: C.sources, events: [...C.events].map(([name, ys]) => ({ name, years: [...ys].sort() })), years: [...C.years].sort(), data: { holes, toGo: true, hasN: true, shots: true, lies: LIES, insights: courseInsights(C) }, players });
      }
      return out;
    },
  };
}

/** Admin: saves the boiled-down courses (zones and history in the course; each player's trails apart). */
/** (update 496) the map a course goes into: the one made for its courseNum (id c{courseNum}), else one with that courseNum,
 *  else (no courseNum) one of the same name without one; a new one's id otherwise */
export function mapIdFor(courseNum, name, existing) {
  const bn = courseNum != null && courseNum !== "" ? String(courseNum) : "";
  const old = bn ? existing.find((x) => x.id === `c${heatId(bn)}`) || existing.find((x) => String(x.courseNum ?? "") === bn) || existing.find((x) => !x.courseNum && sameCourse(x.name, name)) || null
    : existing.find((x) => !x.courseNum && sameCourse(x.name, name)) || null;
  return { old, id: old?.id || (bn ? `c${heatId(bn)}` : heatId(name)) };
}
export async function uploadShotCourses(list, onStatus = () => {}, { into = null } = {}) {
  const existing = await listHeatCourses(true);
  for (const [ci, c] of list.entries()) {
    onStatus(`Saving ${c.name} (${ci + 1} of ${list.length})…`);
    // (update 485) the map already there: any of its courseNums, else the same name
    const nums = (c.courseNums?.length ? c.courseNums : [c.courseNum]).filter((x) => x != null).map(String);
    // (update 486) the map already there: the one with this courseNum (each event's map is its own, with its own images);
    // a course without courseNums, the one of the same name that has none either
    const bn = c.courseNum != null ? String(c.courseNum) : "";
    // (update 487) first the map made for that courseNum (its id, c{courseNum}, which no upload ever relabels)
    // (update 496) a rebuild goes into the map its raw shots are kept in
    const { old, id } = into ? { old: existing.find((x) => x.id === into) || null, id: into } : mapIdFor(bn, c.name, existing);
    const json = JSON.stringify(c.data), chunks = await writeChunks(id, "data", json, old?.dataChunks || 0);
    const players = {};
    let k = 0;
    for (const [key, p] of c.players) {
      if (++k % 25 === 0) onStatus(`Saving ${c.name}: players ${k} of ${c.players.size}…`);
      const pj = JSON.stringify(p), safe = key.replace(/[^A-Za-z0-9_%-]/g, "_");
      players[key] = { c: await writeChunks(id, `p_${safe}`, pj, old?.players?.[key]?.c || 0), n: p.trails.length, f: safe };
    }
    const holesN = Object.keys(c.data.holes).map(Number), n = Math.max(0, ...holesN);
    const par = Array.from({ length: n }, (_, i) => c.data.holes[i + 1]?.par || old?.par?.[i] || null), yards = Array.from({ length: n }, (_, i) => c.data.holes[i + 1]?.yards || old?.yards?.[i] || null);
    const zones = Object.values(c.data.holes).reduce((t, h) => t + Object.values(h.pins).reduce((u, p) => u + p.rows.length, 0), 0);
    await setDoc(doc(db, "courseHeat", id), { name: c.name, ...(bn ? { courseNum: bn } : {}), courseNums: nums, events: c.events || [], attempts: c.data.insights?.attempts || {}, /* (update 488: for the attempt distribution against every course) */ par, yards, dataChunks: chunks, dataBytes: json.length, dataAt: new Date(), zones, players, years: c.years, shotLevel: true,
      // (update 561) every pin's name from where it sits on the green (the course's own names, typed by hand, still come first)
      pinAuto: Object.fromEntries(Object.entries(c.data.insights?.holes || {}).flatMap(([h, X]) => Object.entries(X.pinAuto || {}).map(([pid, nm]) => [`${h}|${pid}`, nm]))) }, { merge: true });
  }
  resetHeatList();
  // (update 485) what was left out: an event whose tees and pins don't line up with the rest
  const why = (c) => (c.sources?.length > 1 ? ` [${c.sources.map((s) => `courseNum ${s.courseNum ?? "—"}: ${s.shots.toLocaleString()} shots${s.biggest ? "" : `, ${s.offset ?? "?"}% off`}${s.kept ? "" : " (left out)"}`).join("; ")}]` : "") + "";
  return list.map((c) => c.name + why(c) + (c.dropped?.length ? ` (left out: ${c.dropped.map((d) => `courseNum ${d.courseNum ?? "—"}, ${d.shots.toLocaleString()} shots, tees/pins ${d.offset}% of the hole away`).join("; ")})` : ""));
}

const trailMemo = new Map();
import("./memory.js").then((m) => m.onFree("maps", "players' trails", () => { trailMemo.clear(); })).catch(() => {}); // (update 556)
/** A player's trails at a course ([{ y, r, h, p, par, s, shots: [[stroke, x, y, lie, dist, toHoleOut]] }]), or null. */
export async function playerTrails(meta, key) {
  const p = meta?.players?.[key];
  if (!p?.c) return null;
  const k = `${meta.id}|${key}|${meta.dataAt?.toMillis?.() ?? meta.dataAt ?? ""}`;
  if (!trailMemo.has(k)) trailMemo.set(k, readChunks(meta.id, `p_${p.f}`, p.c).then((s) => (s ? JSON.parse(s) : null)).catch(() => null));
  return trailMemo.get(k);
}
export const LIE_NAMES = LIES.map((l) => l[0].toUpperCase() + l.slice(1));
