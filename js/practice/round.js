/*
 * Playing holes in practice (update 139: distance only).
 *
 * Every shot is just a distance: where it started and how far it left you (yards off the green, feet on it).
 * The lie is ignored: a tee shot is scored from the tee, anything else off the green as if from the fairway, and
 * anything on the green as a putt. That keeps entering a shot to one number, on the range or anywhere.
 *
 *   A hole:  { n, par, length, from? (the real hole it came from), start? (yds, for a short-game spot),
 *              shots: [], done, strokes, pickedUp? }
 *   A shot:  { kind: "dist", startLie: "Tee box" | "Fairway" | "Green", startDist, unit: "yds" | "ft", n, rcat,
 *              result: { lie: "Holed" | "Green" | "Off", dist, unit, penalty? }, sg }
 *
 * Strokes gained add up: each shot is the Tour baseline where it started, less where it finished, less one (and a
 * penalty stroke when there is one), so a hole's shots sum to (the Tour baseline from the tee) − (your score).
 */
import { expectedStrokes } from "../roundCalc.js";

const rint = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const MAX_STROKES = 12; // a hole stops here (pick up)

/* ---------------------------------------------------------------- the holes ---------------------------------------------------------------- */
const PAR_ORDER = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const LEN = { 3: [140, 235], 4: [345, 480], 5: [505, 595] };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/**
 * A random course: 18 (or 9) holes. opts: { holes, scale (1 = championship tees), pool }
 * With a pool of real holes ([{ par, yards, course, n }] from your courses), the holes are drawn from it.
 */
export function randomHoles({ holes = 18, scale = 1, pool = null } = {}) {
  if (pool?.length) {
    const picks = [];
    let bag = shuffle(pool);
    while (picks.length < holes) { if (!bag.length) bag = shuffle(pool); picks.push(bag.pop()); }
    return picks.map((h, i) => ({ n: i + 1, par: h.par, length: Math.round(h.yards * scale / 5) * 5, from: `${h.course} #${h.n}`, shots: [], done: false, strokes: 0 }));
  }
  const pars = PAR_ORDER.slice(0, holes);
  for (let k = 0; k < pars.length; k += 9) for (let i = Math.min(k + 8, pars.length - 1); i > k; i--) { const j = k + Math.floor(Math.random() * (i - k + 1)); [pars[i], pars[j]] = [pars[j], pars[i]]; }
  return pars.map((par, i) => ({ n: i + 1, par, length: Math.round(rint(...LEN[par]) * scale / 5) * 5, shots: [], done: false, strokes: 0 }));
}

/** A real course's holes (pars and yards). `only`: the hole numbers to play. */
export function courseHoles({ par = [], yards = [], only = null }) {
  const out = [];
  par.forEach((p, i) => {
    if (only && !only.includes(i + 1)) return;
    const y = Number(yards[i]) || Math.round(rint(...LEN[p || 4]) / 5) * 5;
    out.push({ n: i + 1, par: p || (y < 250 ? 3 : y > 500 ? 5 : 4), length: y, shots: [], done: false, strokes: 0 });
  });
  return out;
}

/** A spot to play out from (a short game or approach game): par 2 inside 50 yds, par 3 beyond. */
export function spotHole(n, lo, hi) {
  const d = rint(lo, hi);
  return { n, par: d <= 50 ? 2 : 3, length: d, start: d, shots: [], done: false, strokes: 0, short: true };
}

/* ---------------------------------------------------------------- the numbers per shot ---------------------------------------------------------------- */
const baseFrom = (lie, dist, unit) => (unit === "ft" ? expectedStrokes("Green", Math.max(0.5, dist)) : expectedStrokes(lie === "Tee box" ? "Tee box" : "Fairway", Math.max(1, dist)));
const baseLeft = (r) => (r.lie === "Holed" ? 0 : r.unit === "ft" ? expectedStrokes("Green", Math.max(0.5, r.dist)) : expectedStrokes("Fairway", Math.max(1, r.dist)));
/** Strokes gained for one shot against the Tour baselines. */
export const shotSG = (shot, r = shot.result) => (r ? baseFrom(shot.startLie, shot.startDist, shot.unit) - baseLeft(r) - 1 - (r.penalty ? 1 : 0) : null);

const rcatOf = (shot, hole, first) => {
  if (shot.unit === "ft") return "PUTT";
  if (first && !hole.start && hole.par >= 4) return "OTT";
  return shot.startDist <= 50 ? "ARG" : "APP";
};

/** The shot to play next on this hole (null once it's finished). */
export function nextShot(hole) {
  if (hole.done) return null;
  const last = hole.shots.at(-1);
  const strokesSoFar = hole.shots.reduce((t, s) => t + 1 + (s.result?.penalty ? 1 : 0), 0);
  let shot;
  if (!last) shot = hole.start ? { startLie: "Fairway", startDist: hole.start, unit: "yds" } : { startLie: "Tee box", startDist: hole.length, unit: "yds" };
  else {
    const r = last.result;
    // (rounds from update 138 kept a lie: anything on the green, in feet, is a putt)
    const onGreen = r.unit === "ft" && r.lie !== "Fringe";
    shot = onGreen ? { startLie: "Green", startDist: r.dist, unit: "ft" } : { startLie: "Fairway", startDist: r.unit === "ft" ? Math.max(1, Math.round(r.dist / 3)) : r.dist, unit: "yds" };
  }
  return { kind: "dist", ...shot, n: strokesSoFar + 1, rcat: rcatOf(shot, hole, !last) };
}

/** Record a shot's result on the hole (done when it's in, or at the stroke limit). */
export function playShot(hole, shot, result, { noPutts = false } = {}) {
  shot.result = result;
  shot.sg = shotSG(shot, result);
  hole.shots.push(shot);
  hole.strokes = hole.shots.reduce((t, s) => t + 1 + (s.result?.penalty ? 1 : 0), 0);
  if (result.lie === "Holed") hole.done = true;
  // skipping the putts (the range): the hole ends on the green, with how close
  else if (noPutts && result.unit === "ft") { hole.done = true; hole.prox = result.dist; }
  else if (hole.strokes >= MAX_STROKES) { hole.done = true; hole.pickedUp = true; }
  return hole;
}

/** Take back the last shot on a hole. */
export function undoShot(hole) {
  const s = hole.shots.pop();
  hole.done = false; hole.pickedUp = false; delete hole.prox;
  hole.strokes = hole.shots.reduce((t, x) => t + 1 + (x.result?.penalty ? 1 : 0), 0);
  return s;
}

/** Pick up: the hole counts as par + 3 (or what you've had, if more). */
export function pickUp(hole) {
  hole.done = true; hole.pickedUp = true;
  hole.strokes = Math.max(hole.strokes + 1, hole.par + 3);
}

/** The Tour baseline for the hole: strokes to hole out from the tee (or from the spot). */
export function holeExpected(hole) {
  return hole.start ? expectedStrokes("Fairway", hole.start) : expectedStrokes("Tee box", hole.length);
}

const onGreenResult = (r) => r && (r.lie === "Holed" || (r.unit === "ft" && r.lie !== "Fringe"));

/** A round's (or game's) totals: score, to par, strokes gained by category, greens, putts, scrambling. */
export function roundSummary(holes, { noPutts = false } = {}) {
  const played = holes.filter((h) => h.done);
  const sg = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 };
  let gir = 0, girOf = 0, putts = 0, pens = 0, udAtt = 0, udMade = 0, scr = 0, scrAtt = 0;
  for (const h of played) {
    for (const s of h.shots) if (s.sg != null && sg[s.rcat] != null) sg[s.rcat] += s.sg;
    if (h.pickedUp) continue;
    let k = 0, onAt = null;
    for (const s of h.shots) { k += 1 + (s.result?.penalty ? 1 : 0); if (onAt == null && onGreenResult(s.result)) onAt = k; }
    if (!h.start) {
      girOf++;
      if (onAt != null && onAt <= h.par - 2) gir++;
      else { scrAtt++; if (h.strokes <= h.par) scr++; }
    } else { udAtt++; if (h.strokes <= h.par) udMade++; }
    putts += h.shots.filter((s) => s.rcat === "PUTT").length;
    pens += h.shots.filter((s) => s.result?.penalty).length;
  }
  const score = played.reduce((t, h) => t + h.strokes, 0);
  // skipping putts: compared with regulation (on the green in par − 2), with the average proximity
  const par = played.reduce((t, h) => t + (noPutts ? h.par - 2 : h.par), 0);
  const proxList = played.map((h) => h.prox).filter((v) => v != null);
  return {
    noPutts, prox: proxList.length ? proxList.reduce((a, b) => a + b, 0) / proxList.length : null,
    holes: played.length, score, par, toPar: score - par, sg, sgTotal: Object.values(sg).reduce((a, b) => a + b, 0), expected: played.reduce((t, h) => t + holeExpected(h), 0),
    gir: girOf ? { hit: gir, of: girOf } : null, putts, penalties: pens, scrambling: scrAtt ? { made: scr, of: scrAtt } : null, upDowns: udAtt ? { made: udMade, of: udAtt } : null,
  };
}

/** Name for a hole score: Eagle, Birdie, Par, Bogey … */
export function scoreName(strokes, par) {
  const d = strokes - par;
  return d <= -3 ? "Albatross" : d === -2 ? (strokes === 1 ? "Ace" : "Eagle") : d === -1 ? (strokes === 1 ? "Ace" : "Birdie") : d === 0 ? "Par" : d === 1 ? "Bogey" : d === 2 ? "Double" : `+${d}`;
}

/** Read a said result: "150", "150 yards", "12 feet", "made it", "in the water, 160". */
export function resultFromWords(text, wordsToNumbers, golfFix) {
  const t = ` ${wordsToNumbers(golfFix(String(text || ""))).toLowerCase()} `;
  if (/\b(holed|made|make|in the hole|in the cup|drained|sank|went in|chipped in|holed out)\b/.test(t) && !/\bmiss/.test(t)) return { lie: "Holed", dist: 0, unit: "ft" };
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  const feet = /\b(feet|foot|ft|on the green)\b/.test(t), penalty = /\b(water|wet|hazard|ob|out of bounds|penalty|lost)\b/.test(t);
  return { lie: feet ? "Green" : "Off", dist: n, unit: feet ? "ft" : "yds", ...(penalty ? { penalty: true } : {}) };
}
