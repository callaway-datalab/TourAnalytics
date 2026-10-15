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
export function randomHoles({ holes = 18, scale = 1, pool = null, pars = null } = {}) {
  // (update 157) only some pars: the pool's holes of those pars, or made-up ones
  const some = pars?.length && pars.length < 3;
  if (some && pool?.length) pool = pool.filter((h) => pars.includes(h.par));
  if (some && !pool?.length) {
    const order = PAR_ORDER.filter((p) => pars.includes(p));
    return Array.from({ length: holes }, (_, i) => order[i % order.length]).sort(() => Math.random() - 0.5)
      .map((par, i) => ({ n: i + 1, par, length: Math.round(rint(...LEN[par]) * scale / 5) * 5, shots: [], done: false, strokes: 0 }));
  }
  if (pool?.length) {
    const picks = [];
    let bag = shuffle(pool);
    while (picks.length < holes) { if (!bag.length) bag = shuffle(pool); picks.push(bag.pop()); }
    return picks.map((h, i) => ({ n: i + 1, par: h.par, length: Math.round(h.yards * scale / 5) * 5, from: `${h.course} #${h.n}`, shots: [], done: false, strokes: 0 }));
  }
  const ps = PAR_ORDER.slice(0, holes);
  for (let k = 0; k < ps.length; k += 9) for (let i = Math.min(k + 8, ps.length - 1); i > k; i--) { const j = k + Math.floor(Math.random() * (i - k + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  return ps.map((par, i) => ({ n: i + 1, par, length: Math.round(rint(...LEN[par]) * scale / 5) * 5, shots: [], done: false, strokes: 0 }));
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
// (update 154) the lie counts when it's known (course prep's made-up holes say where it finished); else as from the fairway
const LIES = ["Tee box", "Fairway", "Rough", "Bunker", "Fringe"];
const lieOf = (l) => (LIES.includes(l) ? l : "Fairway");
const baseFrom = (lie, dist, unit) => (unit === "ft" ? expectedStrokes(lie === "Fringe" ? "Fringe" : "Green", Math.max(0.5, dist)) : expectedStrokes(lieOf(lie), Math.max(1, dist)));
const baseLeft = (r) => (r.lie === "Holed" ? 0 : r.unit === "ft" ? expectedStrokes(r.lie === "Fringe" ? "Fringe" : "Green", Math.max(0.5, r.dist)) : expectedStrokes(r.penalty ? "Fairway" : lieOf(r.lie), Math.max(1, r.dist)));
/** Strokes gained for one shot against the Tour baselines. */
// (update 160) pockets: a made-up hole's spot that plays harder or easier carries its "adj" to the next shot's start
export const shotSG = (shot, r = shot.result) => (r ? r.penalty === "ob" ? -2 /* (replaying from the same spot, a stroke down) */
  : baseFrom(shot.startLie, shot.startDist, shot.unit) + (shot.startAdj || 0) - (baseLeft(r) + (r.lie === "Holed" || r.penalty ? 0 : r.adj || 0)) - 1 - (r.penalty ? 1 : 0) : null);

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
    // out of bounds: stroke and distance, from where the last one was played
    if (r.penalty === "ob") shot = { startLie: last.startLie, startDist: last.startDist, unit: last.unit, ...(last.startAdj ? { startAdj: last.startAdj } : {}) };
    else shot = onGreen ? { startLie: "Green", startDist: r.dist, unit: "ft" } : { startLie: r.penalty ? "Fairway" : lieOf(r.lie === "Off" ? "Fairway" : r.lie), startDist: r.unit === "ft" ? Math.max(1, Math.round(r.dist / 3)) : r.dist, unit: "yds" };
    if (!r.penalty && r.adj) shot.startAdj = r.adj;
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

/** Take back the last shot on a hole (and any played for you after it). */
export function undoShot(hole) {
  while (hole.shots.at(-1)?.auto) hole.shots.pop();
  const s = hole.shots.pop();
  hole.done = false; hole.pickedUp = false; delete hole.prox; delete hole.rest;
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

/* ---------------------------------------------------------------- practising only some shots (update 157) ---------------------------------------------------------------- */
/*
 * Course Prep's filters: which categories, distances and lies you want to play. Any other shot is played for you
 * at the Tour average (strokes gained 0, marked auto), heading for the next shot you do want: off the tee with your
 * stock driver distance, then to a distance (and lie) you picked, or onto the green. When nothing you picked is
 * left on the hole, the rest of it is counted at the Tour average from there.
 *   filt: { cats: ["OTT", "APP", "ARG", "PUTT"], dists: [bucket ids], lies: ["Fairway", "Rough", "Bunker"] }
 */
export const YD_BUCKETS = [["y0", "Inside 50 yds", 0, 50], ["y50", "50\u2013100 yds", 50, 100], ["y100", "100\u2013150 yds", 100, 150], ["y150", "150\u2013200 yds", 150, 200], ["y200", "200\u2013250 yds", 200, 250], ["y250", "250+ yds", 250, 1000]];
export const FT_BUCKETS = [["f0", "Inside 6 ft", 0, 6], ["f6", "6\u201315 ft", 6, 15], ["f15", "15\u201330 ft", 15, 30], ["f30", "30+ ft", 30, 1000]];
export const FILTER_LIES = ["Fairway", "Rough", "Bunker"];
const inB = (d, b) => d >= b[2] && d < b[3];
const lieKey = (l) => (l === "Fringe" ? "Fairway" : l);
const catOfYds = (lo) => (lo < 50 ? "ARG" : "APP");

/** Is this a shot you want to play? */
export function shotPicked(shot, f) {
  if (!f) return true;
  if (!f.cats.includes(shot.rcat)) return false;
  if (shot.rcat !== "OTT") {
    const b = (shot.unit === "ft" ? FT_BUCKETS : YD_BUCKETS).find((x) => inB(shot.startDist, x));
    if (b && !f.dists.includes(b[0])) return false;
  }
  return !FILTER_LIES.includes(lieKey(shot.startLie)) || f.lies.includes(lieKey(shot.startLie));
}
const pickLie = (f) => {
  const w = { Fairway: 6, Rough: 3, Bunker: 1 }, ok = FILTER_LIES.filter((l) => f.lies.includes(l));
  if (!ok.length) return "Fairway";
  let t = Math.random() * ok.reduce((a, l) => a + w[l], 0);
  for (const l of ok) { t -= w[l]; if (t <= 0) return l; }
  return ok[0];
};
const putts = (f) => (f.cats.includes("PUTT") ? FT_BUCKETS.filter((b) => f.dists.includes(b[0])) : []);
// a spot on the green in a putt length you picked (else about where the Tour leaves it)
function onGreen(f, d) {
  const want = putts(f), ft = Math.max(3, Math.min(45, d * 0.2 * (0.6 + Math.random() * 0.8)));
  if (!want.length || want.some((b) => inB(ft, b))) return Math.round(ft * 2) / 2;
  const b = want[Math.floor(Math.random() * want.length)];
  return Math.round((b[2] + Math.random() * (Math.min(b[3], 45) - b[2])) * 2) / 2 || 2;
}
/** Where a shot you didn't pick goes (null: nothing you picked is left on the hole). */
function autoResult(shot, f, drive) {
  const d = shot.startDist;
  if (shot.unit === "ft") {
    const lower = putts(f).filter((b) => b[2] < d - 0.5);
    if (!lower.length) return null;
    const b = lower[lower.length - 1], hi = Math.min(b[3], d - 0.5), lo = Math.max(b[2], 0.5);
    return { lie: "Green", dist: Math.round((lo + Math.random() * (hi - lo)) * 2) / 2, unit: "ft", auto: true };
  }
  const yards = YD_BUCKETS.filter((b) => f.dists.includes(b[0]) && f.cats.includes(catOfYds(b[2])));
  const anyLeft = yards.some((b) => b[2] < d - 15) || putts(f).length;
  if (!anyLeft) return null;
  const reach = shot.startLie === "Tee box" ? drive : Math.min(drive - 15, 240) * (shot.startLie === "Rough" ? 0.9 : shot.startLie === "Bunker" ? 0.8 : 1);
  const natural = d - reach;
  const ranges = yards.map((b) => [Math.max(b[2], natural, 5), Math.min(b[3] - 1, d - 15)]).filter(([a, z]) => a <= z).sort((p, q) => p[0] - q[0]);
  if (ranges.length) {
    const [a0, z] = ranges[0], a = Math.min(z, Math.max(a0, 8));
    // about where your stock shot leaves it; when that's short of what you picked, somewhere in the first band you did
    const dist = natural >= a ? natural + Math.random() * 10 : a + Math.random() * Math.min(30, z - a);
    return { lie: pickLie(f), dist: Math.round(Math.max(a, Math.min(z, dist))), unit: "yds", auto: true };
  }
  if (natural > 15) return { lie: "Fairway", dist: Math.round(natural), unit: "yds", auto: true };
  return putts(f).length ? { lie: "Green", dist: onGreen(f, d), unit: "ft", auto: true } : null;
}
/** Play the shots you didn't pick; the next one you did (null once the hole's finished). */
export function playFiltered(hole, f, { drive = 250 } = {}) {
  for (let k = 0; k < 14 && !hole.done; k++) {
    const shot = nextShot(hole);
    if (!shot || shotPicked(shot, f)) return shot;
    const r = autoResult(shot, f, drive);
    if (!r) {
      // the rest of the hole at the Tour average from here
      const rest = Math.max(1, Math.round(baseFrom(shot.startLie, shot.startDist, shot.unit)));
      hole.rest = rest; hole.done = true;
      hole.strokes = hole.shots.reduce((t, x) => t + 1 + (x.result?.penalty ? 1 : 0), 0) + rest;
      if (shot.unit === "ft") hole.prox = shot.startDist;
      return null;
    }
    shot.auto = true;
    playShot(hole, shot, r);
    shot.sg = 0;
  }
  return hole.done ? null : nextShot(hole);
}
/** "Approach · 100–150 yds · rough" — what the filters leave in (empty when everything is). */
export function filtText(f) {
  if (!f) return "";
  const names = { OTT: "Tee shots", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
  const bits = [];
  if (f.cats.length < 4) bits.push(f.cats.map((c) => names[c]).join(", "));
  const all = [...YD_BUCKETS, ...FT_BUCKETS];
  if (f.dists.length < all.length) bits.push(`${f.dists.length} distance${f.dists.length === 1 ? "" : "s"}`);
  if (f.lies.length < 3) bits.push(f.lies.join(", ").toLowerCase());
  return bits.join(" \u00b7 ");
}
