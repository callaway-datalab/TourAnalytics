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

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLS = { year: ["year", "season"], courseNum: ["coursenum", "coursenumber", "courseid"], course: ["course", "coursename"], player: ["player", "playername", "name"], playerID: ["playerid", "player_id", "pid"],
  round: ["round", "rnd", "roundno"], hole: ["hole"], par: ["par", "holepar"], pin: ["pinid", "pin", "pinlocation"], lie: ["lie", "fromlocation"], strokes: ["strokes", "stroke", "shotnum", "shotnumber"],
  shotFor: ["shotfor"], holeOut: ["holeout"], x: ["x"], y: ["y"], v: ["scoringavg", "strokestoholeout"], pinX: ["pinx"], pinY: ["piny"], dist: ["distance", "dist"], event: ["tournament", "tournamentname", "event", "eventname"],
  appSide: ["appsideloc", "appside", "approachside", "missside"], drive: ["drivedirection", "drivedir", "teedirection"] }; // (update 488)
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
const SIDES = ["Long-Left", "Long", "Long-Right", "Left", "Right", "Short-Left", "Short", "Short-Right"];
export function sideOf(v) {
  const t = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim(); if (!t) return null;
  const ab = /^(s|l)(l|r)$/.exec(t.replace(/ /g, ""));
  const lo = ab ? ab[1] === "l" : /long|over|back/.test(t), sh = ab ? ab[1] === "s" : /short|front/.test(t);
  const le = ab ? ab[2] === "l" : /left/.test(t), ri = ab ? ab[2] === "r" : /right/.test(t);
  const a = lo ? "Long" : sh ? "Short" : "", b = le ? "Left" : ri ? "Right" : "";
  return a && b ? `${a}-${b}` : a || b || null;
}
// (update 493) a tee shot's direction by any common spelling: Left / L / Lft / Missed left, Right / R / Rgt, Fairway / Fwy /
// Center / C / F / Middle / Hit
export function driveOf(v) {
  const t = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim(); if (!t) return null;
  const w = t.split(" ");
  if (/left/.test(t) || w.some((x) => ["l", "lft", "lt"].includes(x))) return "L";
  if (/right/.test(t) || w.some((x) => ["r", "rgt", "rt"].includes(x))) return "R";
  if (/fair|fwy|cent|middle|straight|hit/.test(t) || w.some((x) => ["c", "f", "m", "on"].includes(x))) return "C";
  return null;
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;
export const ATT_B = ["3-5 ft", "5-10 ft", "10-15 ft", "15-20 ft", "20-25 ft", ">25 ft", "<30 yds", "30-50 yds", "50-100 yds", "100-120 yds", "120-140 yds", "140-160 yds", "160-180 yds", "180-200 yds", "200-220 yds", ">220 yds"];
export const SG_B = ["<5 ft", ...ATT_B.slice(1), "Tee shot"];
const ydB = (d) => (d < 30 ? "<30 yds" : d < 50 ? "30-50 yds" : d < 100 ? "50-100 yds" : d < 120 ? "100-120 yds" : d < 140 ? "120-140 yds" : d < 160 ? "140-160 yds" : d < 180 ? "160-180 yds" : d < 200 ? "180-200 yds" : d < 220 ? "200-220 yds" : ">220 yds");
const ftB = (d) => (d < 5 ? "<5 ft" : d < 10 ? "5-10 ft" : d < 15 ? "10-15 ft" : d < 20 ? "15-20 ft" : d < 25 ? "20-25 ft" : ">25 ft");
/** a shot's distance bucket ([stroke, x, y, lie, dist, toHoleOut]): for strokes gained (sg) or the attempt distribution */
export function bucketOf(q, par, sg) {
  const L = q[3], d = q[4];
  if (q[0] === 1 && par >= 4) return sg ? "Tee shot" : null;
  if (d == null) return null;
  if (L === 4) { if (!sg && d < 3) return null; const b = ftB(d); return sg ? b : b === "<5 ft" ? "3-5 ft" : b; }
  return ydB(d);
}
/** the expected strokes key of a spot: its lie and distance, finer close in */
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
    const k0 = eKey(qs[i][3], qs[i][4]); if (k0 == null || E[k0] == null) continue;
    let nx;
    if (i + 1 < qs.length) { const k1 = eKey(qs[i + 1][3], qs[i + 1][4]); if (k1 == null || E[k1] == null) continue; nx = E[k1]; } else if (t.s != null) nx = 0; else continue;
    const b = bucketOf(qs[i], par, true); if (!b) continue;
    into[b] = (into[b] || 0) + (E[k0] - nx - 1);
  }
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
  for (const [, , qs] of all) for (const q of qs) { if (q[5] == null) continue; const k = eKey(q[3], q[4]); if (k == null) continue; const a = Es[k] || (Es[k] = [0, 0]); a[0] += q[5]; a[1]++; }
  const E = {}; for (const k of Object.keys(Es)) E[k] = r4(Es[k][0] / Es[k][1]);
  // pixels a yard on each hole (shots' pixels from their pin against their yards), for the fairway widths
  const ppy = new Map();
  for (const [h, H] of C.holes) {
    const rs = [];
    for (const [, t, qs] of all) { if (t.h !== h || rs.length >= 3000) continue; const P = H.pins.get(t.p); if (!P?.pn) continue; const px = P.px / P.pn, py = P.py / P.pn; for (const q of qs) if (q[3] !== 4 && q[4] != null && q[4] > 15 && rs.length < 3000) rs.push(Math.hypot(q[1] - px, q[2] - py) / q[4]); }
    rs.sort((a, b) => a - b); ppy.set(h, rs.length ? rs[Math.floor(rs.length / 2)] : null);
  }
  const holes = {}, attempts = {}, sgF = {}, sgT = {}, rF = new Set(), rT = new Set();
  for (const [h, H] of C.holes) holes[h] = { par: parOf(h), field: sc5(), top: sc5(), fwy: {}, gir: {}, go: {}, drive: {}, ud: {}, udp: {}, drivep: {}, land: [] };
  for (const [key, t, qs] of all) {
    const X = holes[t.h]; if (!X) continue;
    const par = X.par, isTop = top.has(`${key}|${t.y}`), rk = `${key}|${t.y}|${t.r}`;
    for (const q of qs) { const b = bucketOf(q, par, false); if (b) attempts[b] = (attempts[b] || 0) + 1; }
    rF.add(rk); if (isTop) rT.add(rk);
    const one = {}; trailSG({ ...t, shots: qs }, par, E, one);
    for (const [b, v] of Object.entries(one)) { sgF[b] = (sgF[b] || 0) + v; if (isTop) sgT[b] = (sgT[b] || 0) + v; }
    const at = (k) => qs.find((q) => q[0] === k);
    // where approaches missed the green: up and down (in two from there) by side and lie, close to the green
    for (const [k, side] of Object.entries(t.as || {})) {
      const nq = at(Number(k) + 1); if (!nq || nq[4] == null || nq[4] > 30 || ![1, 2, 3].includes(nq[3])) continue;
      const lie = LIES[nq[3]][0].toUpperCase() + LIES[nq[3]].slice(1), o = X.ud[side] || (X.ud[side] = {}), a = o[lie] || (o[lie] = [0, 0]);
      const made = nq[5] != null && nq[5] <= 2;
      a[0]++; if (made) a[1]++;
      // (update 491) and for the pin it was played to (Strategy Maps shows it with each pin)
      const U = X.udp[t.p] || (X.udp[t.p] = {}), o2 = U[side] || (U[side] = {}), a2 = o2[lie] || (o2[lie] = [0, 0]);
      a2[0]++; if (made) a2[1]++;
    }
    if (t.s == null) continue;
    addSc(X.field, t.s); if (isTop) addSc(X.top, t.s);
    const s = t.s, q2 = at(2);
    if (par >= 4 && q2) add2(X.fwy, q2[3] === 1 ? "hit" : "miss", s);
    add2(X.gir, qs.some((q) => q[0] != null && q[0] <= par - 1 && q[3] === 4) || s <= -2 ? "hit" : "miss", s);
    const qg = par >= 5 ? at(3) : par === 4 ? q2 : null;
    if (qg) { const d = qg[3] === 4 ? 0 : qg[4]; if (d != null && d <= 30) add2(X.go, "go", s); else if (d != null && d <= 100) add2(X.go, "lay", s); }
    const dd = t.dd || (t.dv != null ? (q2 && q2[3] === 1 ? "C" : t.dv < 0 ? "L" : t.dv > 0 ? "R" : null) : null); // (update 493: a number: in the fairway, else its side)
    if (par >= 4 && dd) { add2(X.drive, dd, s); add2(X.drivep[t.p] || (X.drivep[t.p] = {}), dd, s); } // (update 492: and per pin)
    const q1 = at(1); if (par >= 4 && q1 && q2 && q2[3] === 1) X.land.push([q1[1], q1[2], q2[1], q2[2]]);
  }
  const out = {};
  for (const [h, X] of Object.entries(holes)) {
    // fairway widths where tee shots finished in the fairway, 250 to 325 yards out (the spread across the line of play)
    const widths = {}, k = ppy.get(Number(h)) ?? ppy.get(h);
    if (k) for (const c of [250, 275, 300, 325]) {
      const pts = X.land.filter((l) => Math.abs(Math.hypot(l[2] - l[0], l[3] - l[1]) / k - c) <= 12.5);
      if (pts.length < 8) continue;
      const tx = pts.reduce((a, l) => a + l[0], 0) / pts.length, ty = pts.reduce((a, l) => a + l[1], 0) / pts.length, cx = pts.reduce((a, l) => a + l[2], 0) / pts.length, cy = pts.reduce((a, l) => a + l[3], 0) / pts.length;
      const dl = Math.hypot(cx - tx, cy - ty) || 1, ux = (cx - tx) / dl, uy = (cy - ty) / dl;
      const off = pts.map((l) => ((l[2] - tx) * uy - (l[3] - ty) * ux) / k).sort((a, b) => a - b);
      widths[c] = Math.round(off[Math.floor(0.95 * (off.length - 1))] - off[Math.floor(0.05 * (off.length - 1))]);
    }
    const fx = (o) => ({ ...o, sum: r4(o.sum) }), f2 = (o) => Object.fromEntries(Object.entries(o).map(([kk, a]) => [kk, [a[0], r4(a[1])]]));
    out[h] = { par: X.par, field: fx(X.field), top: fx(X.top), fwy: f2(X.fwy), gir: f2(X.gir), go: f2(X.go), drive: f2(X.drive), drivePins: Object.fromEntries(Object.entries(X.drivep).map(([pp, o]) => [pp, f2(o)])), ud: X.ud, udPins: X.udp, widths };
  }
  const r4o = (o) => Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, r4(v)]));
  return { events, holes: out, attempts, sg: { field: r4o(sgF), top: r4o(sgT), fieldRounds: rF.size, topRounds: rT.size, E }, top: [...top] };
}

/** Reads shot rows (a slice at a time) and keeps only what the maps need. */
export function shotAggregator() {
  const courses = new Map(); // name → course
  let ix = null, rowsIn = 0;
  const reads = { drive: new Map(), side: new Map() };
  const note = (m, v, got) => { const k = String(v ?? "").trim(); if (!k) return; const e = m.get(k) || (m.size < 60 ? m.set(k, { n: 0, as: got }).get(k) : null); if (e) e.n++; };
  // (update 485) read as sources, one per courseNum and spelling; finish() puts together the sources that are the same
  // course (a shared courseNum, or the same name: one course that hosted two events has two courseNums), so each course is
  // one map
  const courseOf = (name, cn) => { const k = `${cn ?? ""}|${name}`; const C = courses.get(k) || courses.set(k, { name, names: new Map([[name, 0]]), courseNum: cn, holes: new Map(), players: new Map(), years: new Set(), events: new Map(), n: 0 }).get(k); C.names.set(name, C.names.get(name) + 1); C.n++; return C; };
  return {
    get rows() { return rowsIn; },
    /** (update 493) the values found in drive_direction and app_side_loc, and what each was read as (null: not understood) */
    get reads() { return { drive: [...reads.drive].map(([v, e]) => ({ v, n: e.n, as: e.as })), side: [...reads.side].map(([v, e]) => ({ v, n: e.n, as: e.as })) }; },
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
          tr.shots.push([st, Math.round(x * 10) / 10, Math.round(y * 10) / 10, L, dist != null ? Math.round(dist * 10) / 10 : null, v]);
          if (score != null) tr.s = Math.round(score);
          // (update 488) where an approach finished around the green, and which way the tee shot went
          const sd = ix.appSide != null ? sideOf(r[ix.appSide]) : null; if (sd) (tr.as ||= {})[st] = sd;
          // (update 493) drive_direction: a number (below 0 left of the line, above 0 right: a miss unless the next shot is
          // from the fairway, worked out in courseInsights) or words (Left, R, Fairway …)
          const dRaw = ix.drive != null && st === 1 ? r[ix.drive] : null, dNum = typeof dRaw === "number" || (typeof dRaw === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(dRaw)) ? num(dRaw) : null;
          const dd = dNum == null && dRaw != null ? driveOf(dRaw) : null;
          if (dNum != null) tr.dv = Math.round(dNum * 100) / 100; else if (dd) tr.dd = dd;
          // what each value in the two columns was read as, to show after the upload
          if (ix.drive != null && st === 1) { if (dNum != null) note(reads.drive, dNum < 0 ? "below 0" : dNum > 0 ? "above 0" : "0", dNum < 0 ? "L*" : dNum > 0 ? "R*" : "C*"); else note(reads.drive, dRaw, dd); }
          if (ix.appSide != null) note(reads.side, r[ix.appSide], sd);
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

/** (update 493) the reads in words: "drive_direction: Left → left (1,204), L → left (90), Pushed → not understood (3)" */
export function readsText(rd) {
  const name = { L: "left", R: "right", C: "fairway", "L*": "left miss (unless in the fairway)", "R*": "right miss (unless in the fairway)", "C*": "fairway or straight" };
  const part = (col, list, f) => (list.length ? `${col}: ${list.sort((a, b) => b.n - a.n).slice(0, 8).map((x) => `${x.v} \u2192 ${x.as ? f(x.as) : "not understood"} (${x.n.toLocaleString()})`).join(", ")}` : `${col}: not in the file`);
  return `${part("drive_direction", rd.drive, (a) => name[a] || a)}. ${part("app_side_loc", rd.side, (a) => a.replace("-", " ").toLowerCase())}.`;
}
/** Admin: saves the boiled-down courses (zones and history in the course; each player's trails apart). */
export async function uploadShotCourses(list, onStatus = () => {}) {
  const existing = await listHeatCourses(true);
  for (const [ci, c] of list.entries()) {
    onStatus(`Saving ${c.name} (${ci + 1} of ${list.length})…`);
    // (update 485) the map already there: any of its courseNums, else the same name
    const nums = (c.courseNums?.length ? c.courseNums : [c.courseNum]).filter((x) => x != null).map(String);
    // (update 486) the map already there: the one with this courseNum (each event's map is its own, with its own images);
    // a course without courseNums, the one of the same name that has none either
    const bn = c.courseNum != null ? String(c.courseNum) : "";
    // (update 487) first the map made for that courseNum (its id, c{courseNum}, which no upload ever relabels)
    const old = bn ? existing.find((x) => x.id === `c${heatId(bn)}`) || existing.find((x) => String(x.courseNum ?? "") === bn) || existing.find((x) => !x.courseNum && sameCourse(x.name, c.name)) || null
      : existing.find((x) => !x.courseNum && sameCourse(x.name, c.name)) || null;
    const id = old?.id || (bn ? `c${heatId(bn)}` : heatId(c.name));
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
    await setDoc(doc(db, "courseHeat", id), { name: c.name, ...(bn ? { courseNum: bn } : {}), courseNums: nums, events: c.events || [], attempts: c.data.insights?.attempts || {}, /* (update 488: for the attempt distribution against every course) */ par, yards, dataChunks: chunks, dataBytes: json.length, dataAt: new Date(), zones, players, years: c.years, shotLevel: true }, { merge: true });
  }
  resetHeatList();
  // (update 485) what was left out: an event whose tees and pins don't line up with the rest
  const why = (c) => (c.sources?.length > 1 ? ` [${c.sources.map((s) => `courseNum ${s.courseNum ?? "—"}: ${s.shots.toLocaleString()} shots${s.biggest ? "" : `, ${s.offset ?? "?"}% off`}${s.kept ? "" : " (left out)"}`).join("; ")}]` : "") + "";
  return list.map((c) => c.name + why(c) + (c.dropped?.length ? ` (left out: ${c.dropped.map((d) => `courseNum ${d.courseNum ?? "—"}, ${d.shots.toLocaleString()} shots, tees/pins ${d.offset}% of the hole away`).join("; ")})` : ""));
}

const trailMemo = new Map();
/** A player's trails at a course ([{ y, r, h, p, par, s, shots: [[stroke, x, y, lie, dist, toHoleOut]] }]), or null. */
export async function playerTrails(meta, key) {
  const p = meta?.players?.[key];
  if (!p?.c) return null;
  const k = `${meta.id}|${key}|${meta.dataAt?.toMillis?.() ?? meta.dataAt ?? ""}`;
  if (!trailMemo.has(k)) trailMemo.set(k, readChunks(meta.id, `p_${p.f}`, p.c).then((s) => (s ? JSON.parse(s) : null)).catch(() => null));
  return trailMemo.get(k);
}
export const LIE_NAMES = LIES.map((l) => l[0].toUpperCase() + l.slice(1));
