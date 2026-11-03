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
  shotFor: ["shotfor"], holeOut: ["holeout"], x: ["x"], y: ["y"], v: ["scoringavg", "strokestoholeout"], pinX: ["pinx"], pinY: ["piny"], dist: ["distance", "dist"] };
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

/** Reads shot rows (a slice at a time) and keeps only what the maps need. */
export function shotAggregator() {
  const courses = new Map(); // name → course
  let ix = null, rowsIn = 0;
  const courseOf = (name, cn) => courses.get(name) || courses.set(name, { name, courseNum: cn, holes: new Map(), players: new Map(), years: new Set() }).get(name);
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
        const H = C.holes.get(hole) || C.holes.set(hole, { par: null, pins: new Map(), tee: [] }).get(hole);
        const par = ix.par != null ? num(r[ix.par]) : null; if (par) H.par = par;
        const pid = ix.pin != null ? String(r[ix.pin] ?? "1").trim() || "1" : "1";
        const P = H.pins.get(pid) || H.pins.set(pid, { px: 0, py: 0, pn: 0, shots: [], hist: {} }).get(pid);
        const px = ix.pinX != null ? num(r[ix.pinX]) : null, py = ix.pinY != null ? num(r[ix.pinY]) : null;
        if (px != null && py != null) { P.px += px; P.py += py; P.pn++; }
        const L = lieIx(r[ix.lie]), dist = ix.dist != null ? num(r[ix.dist]) : null, v = ix.v != null ? num(r[ix.v]) : null, st = num(r[ix.strokes]), out = num(r[ix.holeOut]) === 1, sf = ix.shotFor != null ? num(r[ix.shotFor]) : null;
        if (v != null) P.shots.push(x, y, L, dist ?? -1, v, st ?? 0); // (update 482: and which stroke it was)
        if (L === 0 && dist != null) H.tee.push(dist);
        // the hole's score: shot_for on the shot that holed out (update 480: or, without it, the stroke less par)
        const score = out ? (sf != null ? sf : st != null && (par || H.par) ? st - (par || H.par) : null) : null;
        if (score != null) { const k = Math.max(-2, Math.min(2, Math.round(score))); P.hist[k] = (P.hist[k] || 0) + 1; }
        // the player's trail for this hole
        const key = ix.playerID != null && r[ix.playerID] != null && r[ix.playerID] !== "" ? clientKey(String(num(r[ix.playerID]) ?? r[ix.playerID])) : ix.player != null ? clientKey(String(r[ix.player])) : null;
        if (key) {
          const T = C.players.get(key) || C.players.set(key, { name: ix.player != null ? String(r[ix.player] ?? "") : "", trails: new Map() }).get(key);
          const tk = `${year}|${ix.round != null ? r[ix.round] : ""}|${hole}`;
          const tr = T.trails.get(tk) || T.trails.set(tk, { y: year, r: ix.round != null ? String(num(r[ix.round]) ?? r[ix.round]) : "", h: hole, p: pid, par: par || null, s: null, shots: [] }).get(tk);
          tr.shots.push([st, Math.round(x * 10) / 10, Math.round(y * 10) / 10, L, dist != null ? Math.round(dist * 10) / 10 : null, v]);
          if (score != null) tr.s = Math.round(score);
        }
      }
    },
    /** Each course, boiled down: { name, courseNum, years, data (zones and history), players: Map(key → trails JSON) } */
    finish() {
      const out = [];
      for (const C of courses.values()) {
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
        out.push({ name: C.name, courseNum: C.courseNum, years: [...C.years].sort(), data: { holes, toGo: true, hasN: true, shots: true, lies: LIES }, players });
      }
      return out;
    },
  };
}

/** Admin: saves the boiled-down courses (zones and history in the course; each player's trails apart). */
export async function uploadShotCourses(list, onStatus = () => {}) {
  const existing = await listHeatCourses(true);
  for (const [ci, c] of list.entries()) {
    onStatus(`Saving ${c.name} (${ci + 1} of ${list.length})…`);
    const old = (c.courseNum != null && existing.find((x) => String(x.courseNum ?? "") === String(c.courseNum))) || existing.find((x) => sameCourse(x.name, c.name));
    const id = old?.id || (c.courseNum != null ? `c${heatId(String(c.courseNum))}` : heatId(c.name));
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
    await setDoc(doc(db, "courseHeat", id), { name: c.name, ...(c.courseNum != null ? { courseNum: String(c.courseNum) } : {}), par, yards, dataChunks: chunks, dataBytes: json.length, dataAt: new Date(), zones, players, years: c.years, shotLevel: true }, { merge: true });
  }
  resetHeatList();
  return list.map((c) => c.name);
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
