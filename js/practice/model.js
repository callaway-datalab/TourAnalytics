/*
 * Practice sessions (update 136): the plan, the random shots, the made-up holes and greens, and the scoring.
 *
 * Every shot is scored with the same strokes-gained baseline as Track Round (roundCalc.expectedStrokes,
 * Callaway's scoring-average table), so practice numbers line up with on-course numbers: 0.00 is a Tour-average
 * shot, +0.20 is a fifth of a stroke better.
 *
 * Coordinates:
 *   Off the tee: yards, x = left (−) / right (+) of the target line, y = distance from the tee.
 *   Approach / around the green: yards, green centre at (0, 0), y up = long (away from you), x right.
 *   Putting: feet, hole at (0, 0), the ball below it at (0, −distance).
 */
import { expectedStrokes } from "../roundCalc.js";

export const CATS = {
  OTT: { label: "Off the Tee", short: "OTT", unit: "yds" },
  APP: { label: "Approach", short: "APP", unit: "yds" },
  ARG: { label: "Around the Green", short: "ARG", unit: "yds" },
  PUTT: { label: "Putting", short: "PUTT", unit: "ft" },
};
export const CAT_ORDER = ["OTT", "APP", "ARG", "PUTT"];

// The buckets you split a session across (the same ranges as the Stats page and Track Round)
export const BUCKETS = {
  OTT: [
    { id: "driver", label: "Driver", club: "Driver", hole: [410, 480], carry: 290 },
    { id: "wood", label: "Fairway wood", club: "3 wood", hole: [370, 420], carry: 260 },
    { id: "iron", label: "Hybrid / iron", club: "Iron", hole: [330, 375], carry: 225 },
  ],
  APP: [[50, 75], [75, 100], [100, 120], [120, 140], [140, 160], [160, 180], [180, 200], [200, 225], [225, 250]].map(([a, b]) => ({ id: `${a}-${b}`, label: `${a}-${b} yds`, lo: a, hi: b })),
  ARG: [[3, 10, "<10 yds"], [10, 20, "10-20 yds"], [20, 30, "20-30 yds"], [30, 50, "30-50 yds"]].map(([a, b, label]) => ({ id: `${a}-${b}`, label, lo: a, hi: b })),
  PUTT: [[3, 5], [5, 10], [10, 15], [15, 20], [20, 30], [30, 50]].map(([a, b]) => ({ id: `${a}-${b}`, label: `${a}-${b} ft`, lo: a, hi: b })),
};

// What else a session mixes in, each a set of options with a default share (%)
export const MIXES = {
  OTT: [
    { id: "width", label: "Fairway width", options: [["tight", "Tight · 24 yds", 30], ["standard", "Standard · 32 yds", 50], ["wide", "Wide · 40 yds", 20]] },
    { id: "trouble", label: "Trouble", options: [["left", "Hard left", 40], ["right", "Hard right", 40], ["both", "Both sides", 20]] },
  ],
  APP: [
    { id: "lie", label: "Lie", options: [["Fairway", "Fairway", 65], ["Rough", "Rough", 30], ["Bunker", "Fairway bunker", 5]] },
    { id: "pin", label: "Pin", options: [["easy", "Middle", 35], ["mid", "Corner", 40], ["hard", "Tucked (short side)", 25]] },
  ],
  ARG: [
    { id: "lie", label: "Lie", options: [["Fairway", "Fairway / fringe", 35], ["Rough", "Rough", 40], ["Bunker", "Greenside bunker", 25]] },
    { id: "pin", label: "Pin", options: [["easy", "Lots of green", 40], ["mid", "Some green", 35], ["hard", "Short-sided", 25]] },
  ],
  PUTT: [
    { id: "break", label: "Break", options: [["straight", "Straight", 30], ["lr", "Left to right", 35], ["rl", "Right to left", 35]] },
    { id: "slope", label: "Slope", options: [["up", "Uphill", 35], ["flat", "Flat", 30], ["down", "Downhill", 35]] },
  ],
};

/* ------------------------------------------------------------------ random helpers ------------------------------------------------------------------ */
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** A list of `n` option ids in the given shares (rounded so they add up), shuffled. */
function spread(options, n) {
  const total = options.reduce((t, o) => t + Math.max(0, o[2]), 0) || 1;
  const raw = options.map((o) => (Math.max(0, o[2]) / total) * n);
  const counts = raw.map(Math.floor);
  let left = n - counts.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left--; } });
  return shuffle(options.flatMap((o, i) => Array(counts[i]).fill(o[0])));
}
export function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** Spread `total` shots over the buckets in proportion to `weights` (whole numbers that add up to total). */
export function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

/* ------------------------------------------------------------------ generating a session ------------------------------------------------------------------ */
/**
 * The shots for a plan: { cat, counts: { bucketId: n }, mixes: { mixId: { optionId: share } } }.
 * Each shot carries everything needed to draw and score it.
 */
export function generateShots(plan) {
  const buckets = BUCKETS[plan.cat];
  const list = shuffle(buckets.flatMap((b) => Array(Math.max(0, plan.counts[b.id] || 0)).fill(b)));
  const n = list.length;
  const mixOf = (id) => {
    const m = (MIXES[plan.cat] || []).find((x) => x.id === id);
    return m ? spread(m.options.map(([k, , def]) => [k, null, plan.mixes?.[id]?.[k] ?? def]), n) : [];
  };
  const mix = Object.fromEntries((MIXES[plan.cat] || []).map((m) => [m.id, mixOf(m.id)]));
  return list.map((b, i) => {
    const base = { i: i + 1, bucket: b.id, bucketLabel: b.label };
    if (plan.cat === "OTT") return { ...base, ...makeHole(b, mix.width[i], mix.trouble[i]) };
    if (plan.cat === "PUTT") return { ...base, ...makePutt(b, mix.break[i], mix.slope[i]) };
    return { ...base, ...makeGreenShot(plan.cat, b, mix.lie[i], mix.pin[i]) };
  });
}

/* ---- off the tee: a made-up par 4 / 5 drive, with a fairway, a hard side and an easier side ---- */
const WIDTHS = { tight: 24, standard: 32, wide: 40 };
function makeHole(b, width, trouble) {
  return holeLayout({ length: rint(b.hole[0], b.hole[1]), width, trouble, carry: b.carry, club: b.club });
}
/** A made-up hole off the tee of a given length (rounds and course prep use this too). */
export function holeLayout({ length, width = "standard", trouble = pick(["left", "right", "both"]), carry = 290, club = "Driver", startLie = "Tee box", par = null }) {
  const L = Math.round(length), b = { carry, club };
  const w = typeof width === "number" ? width : WIDTHS[width] || 32;
  const hard = { kind: pick(["water", "ob", "water"]), at: rint(8, 14) };      // penalty this far past the fairway edge
  const soft = { kind: pick(["trees", "bunker", "rough"]), at: rint(18, 28) }; // trees / waste this far past
  const sides = trouble === "left" ? { left: hard, right: soft } : trouble === "right" ? { left: soft, right: hard }
    : { left: { kind: "trees", at: rint(12, 18) }, right: { kind: pick(["water", "ob"]), at: rint(12, 18) } };
  // a fairway bunker on one side, around where the ball comes down
  const bSide = Math.random() < 0.5 ? -1 : 1;
  const fb = Math.random() < 0.75 ? { side: bSide, y0: carry - rint(15, 30), y1: carry + rint(5, 20), depth: rint(7, 11) } : null;
  return { kind: "tee", club: b.club, hole: L, par: par || (L > 470 ? 5 : 4), width: w, widthId: width, trouble, sides, bunker: fb, startLie, startDist: L, carry };
}

/** Where a drive finished, from its total distance and how far off line (+ right): { lie, dist, penalty, zone }. */
export function teeResult(shot, total, offline) {
  const half = shot.width / 2, ax = Math.abs(offline), side = offline < 0 ? "left" : "right";
  const remaining = Math.max(1, Math.round(Math.hypot(shot.hole - total, offline)));
  const fb = shot.bunker;
  const inBunker = fb && Math.sign(offline || 1) === fb.side && total >= fb.y0 && total <= fb.y1 && ax >= half - 4 && ax <= half + fb.depth;
  if (inBunker) return { lie: "Bunker", dist: remaining, zone: "Fairway bunker" };
  if (ax <= half) return { lie: "Fairway", dist: remaining, zone: "Fairway" };
  const t = shot.sides[side], beyond = ax - half;
  if (beyond >= t.at) {
    if (t.kind === "ob") return { lie: "OB", dist: shot.hole, penalty: "ob", zone: "Out of bounds" };
    if (t.kind === "water") return { lie: "Penalty", dist: remaining, penalty: "water", zone: "Water" };
    if (t.kind === "trees") return { lie: "Rough", dist: remaining, recovery: true, zone: "Trees" };
    if (t.kind === "bunker") return { lie: "Bunker", dist: remaining, zone: "Waste bunker" };
  }
  return { lie: "Rough", dist: remaining, zone: "Rough" };
}

/** Strokes after the tee shot (to finish the hole), for a result from teeResult. */
export function afterTee(shot, r) {
  if (r.penalty === "ob") return 1 + expectedStrokes(shot.startLie || "Tee box", shot.hole); // stroke and distance
  if (r.penalty === "water") return 1 + expectedStrokes("Rough", r.dist);        // drop, plus a stroke
  return expectedStrokes(r.lie, r.dist) + (r.recovery && !shot.played ? 0.3 : 0); // (trees: a punch-out costs about a third; in a round the next shot shows it)
}

/* ---- approach / around the green: a green with a pin, bunkers and maybe water ---- */
function makeGreenShot(cat, b, lie, pinMix) {
  let D = rint(b.lo, Math.max(b.lo, b.hi - 1));
  const g = greenLayout(cat, pinMix);
  const { rx, ry } = g.green, { x: px, y: py } = g.pin, near = Math.sign(px) || 1, hazards = g.hazards;
  // where you're hitting from: straight back for an approach; for a chip, off one side or the front
  let sx = 0, sy = -D;
  if (cat === "ARG") {
    const ang = -Math.PI / 2 + (pinMix === "hard" ? near * rnd(0.6, 1.2) : rnd(-0.9, 0.9));
    sx = px + Math.cos(ang) * D; sy = py + Math.sin(ang) * D;
    // never on the green itself: step back until it's just off it (the distance grows to match)
    let k = D;
    while ((sx / (rx + 1)) ** 2 + (sy / (ry + 1)) ** 2 <= 1 && k < D + 40) { k += 1; sx = px + Math.cos(ang) * k; sy = py + Math.sin(ang) * k; }
    if (k !== D) D = Math.round(k);
    if (lie === "Bunker") hazards.push({ type: "bunker", cx: sx, cy: sy, r: 5.5, start: true });
    else if (lie === "Fairway" && Math.hypot(sx / (rx + 4), sy / (ry + 4)) <= 1) lie = "Fringe";
  }
  return { kind: "green", cat, startLie: lie, startDist: D, green: g.green, pin: g.pin, from: { x: sx, y: sy }, hazards, pinMix };
}
/** A made-up green: its size, the pin, bunkers and maybe water (yds, centre at 0,0). */
export function greenLayout(cat = "APP", pinMix = pick(["easy", "mid", "mid", "hard"]), { size = 1 } = {}) {
  const rx = Math.round(rint(12, 17) * size), ry = Math.round(rint(13, 19) * size); // green half-width, half-depth (yds)
  // the pin: middle, a corner, or tucked by trouble
  const px = pinMix === "easy" ? rnd(-0.2, 0.2) * rx : (Math.random() < 0.5 ? -1 : 1) * rnd(0.45, pinMix === "hard" ? 0.72 : 0.6) * rx;
  const py = pinMix === "easy" ? rnd(-0.2, 0.2) * ry : (Math.random() < 0.5 ? -1 : 1) * rnd(0.4, pinMix === "hard" ? 0.7 : 0.55) * ry;
  const near = Math.sign(px) || 1; // the pin's side: trouble there short-sides you
  const hazards = [];
  // bunkers: one on the pin's side (worse when it's tucked), one elsewhere
  hazards.push({ type: "bunker", ...edgePoint(rx, ry, near > 0 ? rnd(-0.6, 0.3) : Math.PI - rnd(-0.3, 0.6), rnd(4.5, 6.5)) });
  if (Math.random() < 0.7) hazards.push({ type: "bunker", ...edgePoint(rx, ry, -Math.PI / 2 + rnd(-0.7, 0.7), rnd(4, 5.5)) });
  // water: for approaches, sometimes, on one side (often the pin's side when it's tucked)
  if (cat === "APP" && Math.random() < 0.45) hazards.push({ type: "water", side: pinMix === "hard" ? near : pick([-1, 1]), from: rx + rnd(5, 9) });
  return { green: { rx, ry }, pin: { x: px, y: py }, hazards, pinMix };
}
function edgePoint(rx, ry, ang, r) {
  // a bunker just off the green edge, at that angle from the centre
  const k = 1 + (r + 1.5) / Math.min(rx, ry);
  return { cx: Math.cos(ang) * rx * k, cy: Math.sin(ang) * ry * k, r };
}
const FRINGE = 1.4; // yds of fringe round the green

/** What's at a point (yds, green coordinates): "Green" | "Fringe" | "Bunker" | "Water" | "Rough". */
export function surfaceAt(shot, x, y) {
  const { rx, ry } = shot.green;
  for (const h of shot.hazards) {
    if (h.type === "water" && Math.sign(x) === h.side && Math.abs(x) >= h.from) return "Water";
    if (h.type === "bunker" && Math.hypot(x - h.cx, y - h.cy) <= h.r) return "Bunker";
  }
  const e = (x / rx) ** 2 + (y / ry) ** 2;
  if (e <= 1) return "Green";
  const ef = (x / (rx + FRINGE)) ** 2 + (y / (ry + FRINGE)) ** 2;
  if (ef <= 1) return "Fringe";
  return "Rough";
}
/** The result of a ball finishing at (x, y): { lie, dist (ft on the green / fringe, else yds), penalty }. */
export function greenResult(shot, x, y) {
  const s = surfaceAt(shot, x, y), dy = Math.hypot(x - shot.pin.x, y - shot.pin.y);
  if (s === "Green" || s === "Fringe") return { lie: s, dist: Math.max(0, Math.round(dy * 3 * 10) / 10), unit: "ft", x, y };
  if (s === "Water") return { lie: "Penalty", dist: Math.round(dy), unit: "yds", penalty: "water", x, y };
  return { lie: s, dist: Math.round(dy), unit: "yds", x, y };
}
/** Strokes to finish from a green result. */
export const afterGreen = (r) => (r.lie === "Holed" ? 0 : r.penalty ? 1 + expectedStrokes("Rough", Math.max(r.dist, 3)) : expectedStrokes(r.lie, r.dist));

/* ---- putting: a distance, a break and a slope ---- */
function makePutt(b, brk, slope) {
  return puttFrom(Math.round(rnd(b.lo, b.hi) * 2) / 2, brk, slope);
}
/** A putt of a given length (ft), with a break and slope (random unless given). */
export function puttFrom(D, brk = pick(["straight", "lr", "lr", "rl", "rl"]), slope = pick(["up", "flat", "down"])) {
  const pct = brk === "straight" ? 0 : Math.round(rnd(1, 3) * 10) / 10; // side slope, %
  return { kind: "putt", startLie: "Green", startDist: D, breakDir: brk, slope, sidePct: pct, upPct: slope === "flat" ? 0 : Math.round(rnd(1, 2.5) * 10) / 10 };
}
/** A rough read: how far to aim outside the hole (inches) and how much longer / shorter it plays (ft). */
export function puttRead(p, stimp = 11) {
  const dir = p.breakDir === "lr" ? -1 : p.breakDir === "rl" ? 1 : 0; // aim left for a left-to-right putt
  const speed = stimp / 11;
  // break grows a little faster than the distance, more on quick greens and downhill
  const breakIn = dir ? Math.round(p.sidePct * Math.pow(p.startDist, 1.15) * 0.25 * speed * (p.slope === "down" ? 1.35 : p.slope === "up" ? 0.75 : 1)) : 0;
  const plays = p.slope === "up" ? +(p.startDist * p.upPct * 0.06).toFixed(1) : p.slope === "down" ? -(p.startDist * p.upPct * 0.06).toFixed(1) : 0;
  return { aimSide: dir < 0 ? "left" : dir > 0 ? "right" : "", aimIn: breakIn, cups: +(breakIn / 4.25).toFixed(1), plays };
}

/* ------------------------------------------------------------------ scoring ------------------------------------------------------------------ */
/** Strokes gained for a shot with its result filled in, or null. */
export function scoreShot(shot) {
  const r = shot.result;
  if (!r) return null;
  if (shot.kind === "tee") return expectedStrokes(shot.startLie || "Tee box", shot.hole) - afterTee(shot, r) - 1;
  if (shot.kind === "putt") return expectedStrokes("Green", shot.startDist) - (r.lie === "Holed" ? 0 : expectedStrokes("Green", r.dist)) - 1;
  return startExpected(shot) - afterGreen(r) - 1;
}

/** Expected strokes from where a green-side shot starts (startDist is yds; fringe and green are looked up in feet). */
export function startExpected(shot) {
  const lie = shot.startLie;
  if (lie === "Fringe" || lie === "Green") return expectedStrokes(lie, shot.startDist * 3);
  return expectedStrokes(lie, shot.startDist);
}

/* ------------------------------------------------------------------ where to aim ------------------------------------------------------------------ */
// Gauss–Hermite-ish grid: the shot pattern as a 7×7 grid of offsets (in standard deviations) and weights.
const GRID = (() => {
  const z = [-2.2, -1.4, -0.7, 0, 0.7, 1.4, 2.2], w = z.map((v) => Math.exp(-v * v / 2));
  const out = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) out.push([z[i], z[j], w[i] * w[j]]);
  const s = out.reduce((t, x) => t + x[2], 0);
  return out.map(([a, b, c]) => [a, b, c / s]);
})();

/** Expected strokes after a tee shot that finishes at (offline x, total y). */
export const teeValue = (shot, x, y) => afterTee(shot, teeResult(shot, y, x));
/** Expected strokes after an approach / chip that finishes at (x, y). */
export const greenValue = (shot, x, y) => afterGreen(greenResult(shot, x, y));

/** The pattern a player's shots spread over (yds): from their history when there's enough, else Tour-like. */
export function spreadFor(shot, history = null) {
  if (history?.sx && history.n >= 12) return { sx: history.sx, sy: history.sy };
  if (shot.kind === "tee") return shot.club === "Driver" ? { sx: 15, sy: 11 } : shot.club === "3 wood" ? { sx: 12, sy: 10 } : { sx: 9, sy: 8 };
  const D = shot.startDist;
  return shot.cat === "ARG" ? { sx: 0.1 * D + 0.8, sy: 0.12 * D + 1 } : { sx: 0.045 * D + 2.2, sy: 0.055 * D + 2.8 };
}

/** The aim point with the fewest strokes to finish, for this player's spread: { x, y, value }. */
export function bestAim(shot, spread, carry = null) {
  const val = shot.kind === "tee" ? (x, y) => teeValue(shot, x, y) : (x, y) => greenValue(shot, x, y);
  const mean = (ax, ay) => GRID.reduce((t, [a, b, w]) => t + w * val(ax + a * spread.sx, ay + b * spread.sy), 0);
  let best = null;
  if (shot.kind === "tee") {
    const y = Math.min(carry || 280, shot.hole - 60);
    for (let x = -shot.width / 2 - 8; x <= shot.width / 2 + 8; x += 1.5) { const v = mean(x, y); if (!best || v < best.value) best = { x, y, value: v }; }
  } else {
    const { rx, ry } = shot.green;
    for (let x = -rx; x <= rx; x += 1.2) for (let y = -ry; y <= ry; y += 1.2) {
      if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
      const v = mean(x, y); if (!best || v < best.value) best = { x, y, value: v };
    }
  }
  return best;
}
