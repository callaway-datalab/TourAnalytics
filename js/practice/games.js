/*
 * Pressure games (update 138): short practice games with a target to beat, a live "what you need" as you go,
 * and your personal best. Every shot is still scored in strokes gained, so games count toward your practice too.
 *
 *   kind "shots": a fixed list of shots (like a practice session), each scored for points.
 *   kind "holes": short-game spots played out until holed (chip, then putts), scored in strokes.
 */
import { generateShots, distribute, BUCKETS, puttFrom } from "./model.js";
import { shortGameHole } from "./round.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const proxFt = (r) => (r.lie === "Holed" ? 0 : r.unit === "ft" ? r.dist : r.dist * 3);
const sgSum = (shots) => shots.filter((s) => s.result).reduce((t, s) => t + (s.sg || 0), 0);

function appShots(n, from, to, mixes) {
  const bs = BUCKETS.APP.filter((b) => b.lo >= from && b.hi <= to);
  const counts = Object.fromEntries(bs.map((b, i) => [b.id, distribute(n, bs.map(() => 1))[i]]));
  return generateShots({ cat: "APP", counts, mixes });
}

export const GAMES = [
  {
    id: "fairway-finder", cat: "OTT", kind: "shots", title: "Fairway Finder", target: 9, better: "high", maxPer: 1, unit: "pts",
    blurb: "14 drives on 14 different holes, mostly tight. A point for every fairway, minus 2 for every penalty. 9 is Tour level.",
    build: () => generateShots({ cat: "OTT", counts: { driver: 14 }, mixes: { width: { tight: 45, standard: 45, wide: 10 } } }),
    points: (s) => (s.result.penalty ? -2 : s.result.lie === "Fairway" ? 1 : 0),
    pointsText: "Fairway 1 · Rough or bunker 0 · Penalty −2",
  },
  {
    id: "pin-seeker", cat: "APP", kind: "shots", title: "Pin Seeker", target: 20, better: "high", maxPer: 10, unit: "pts",
    blurb: "12 approaches from 100 to 200 yards. Points for how close you finish. 20 is Tour level.",
    build: () => appShots(12, 100, 200),
    points: (s) => { const r = s.result; if (r.penalty) return -2; if (r.lie === "Holed") return 10; if (r.lie !== "Green") return 0; const f = proxFt(r); return f <= 8 ? 4 : f <= 15 ? 3 : f <= 25 ? 2 : 1; },
    pointsText: "Holed 10 · Inside 8 ft 4 · Inside 15 ft 3 · Inside 25 ft 2 · On the green 1 · Missed 0 · Water −2",
  },
  {
    id: "beat-the-tour", cat: "APP", kind: "shots", title: "Beat the Tour", target: 0, better: "high", unit: "SG", sg: true,
    blurb: "10 approaches from 125 to 225 yards to tucked pins, some from the rough. Finish above 0.00 strokes gained to beat the Tour average.",
    build: () => appShots(10, 120, 225, { lie: { Fairway: 70, Rough: 30, Bunker: 0 }, pin: { easy: 0, mid: 40, hard: 60 } }),
    points: (s) => s.sg || 0,
    pointsText: "Your total strokes gained against Tour average",
  },
  {
    id: "up-and-down-9", cat: "ARG", kind: "holes", title: "Up & Down 9", target: 20, better: "low", unit: "strokes",
    blurb: "9 spots round the green, from 5 to 40 yards, from the rough, fringe, fairway and bunkers. Play each one out until it's in. Par is 18; 20 or better is Tour level.",
    build: () => Array.from({ length: 9 }, (_, i) => shortGameHole(i + 1)),
    pointsText: "Strokes to hole out from each spot (par 2 each)",
  },
  {
    id: "circle-of-4", cat: "PUTT", kind: "shots", title: "Circle of 4", target: 9, better: "high", maxPer: 1, unit: "makes",
    blurb: "10 four-footers from all round the hole: uphill, downhill and both breaks. Make 9 to pass.",
    build: () => ["straight", "lr", "rl", "lr", "rl", "straight", "lr", "rl", "lr", "rl"].map((b, i) => ({ ...puttFrom(4, b, ["up", "down", "flat"][i % 3]), i: i + 1, bucket: "3-5", bucketLabel: "3-5 ft" })),
    points: (s) => (s.result.lie === "Holed" ? 1 : 0),
    pointsText: "A point for every make",
  },
  {
    id: "ladder-3-6-9", cat: "PUTT", kind: "shots", title: "3-6-9 Ladder", target: 12, better: "high", maxPer: 3, unit: "pts",
    blurb: "Three times up the ladder: 3, 6 and 9 feet. A 3-footer is worth 1, a 6-footer 2 and a 9-footer 3. 12 is Tour level.",
    build: () => [3, 6, 9, 3, 6, 9, 3, 6, 9].map((d, i) => ({ ...puttFrom(d), i: i + 1, bucket: d <= 5 ? "3-5" : "5-10", bucketLabel: d <= 5 ? "3-5 ft" : "5-10 ft" })),
    points: (s) => (s.result.lie === "Holed" ? Math.round(s.startDist / 3) : 0),
    pointsText: "Make from 3 ft 1 · 6 ft 2 · 9 ft 3",
  },
  {
    id: "lag-master", cat: "PUTT", kind: "shots", title: "Lag Master", target: 7, better: "high", maxPer: 1, unit: "pts",
    blurb: "10 long putts from 30 to 60 feet. A point for every one you hole or leave inside 3 feet. 7 is Tour level.",
    build: () => Array.from({ length: 10 }, (_, i) => { const d = Math.round(rnd(30, 60)); return { ...puttFrom(d), i: i + 1, bucket: d < 50 ? "30-50" : "30-50", bucketLabel: "30-50 ft" }; }),
    points: (s) => (s.result.lie === "Holed" || proxFt(s.result) <= 3 ? 1 : 0),
    pointsText: "Holed or inside 3 ft 1 · Further 0",
  },
];
export const gameById = (id) => GAMES.find((g) => g.id === id);

/** Where a game stands: { score, done, left, status: "playing" | "passed" | "failed" | "on" | "out", need } */
export function gameProgress(g, session) {
  if (g.kind === "holes") {
    const holes = session.holes || [], done = holes.filter((h) => h.done);
    const score = done.reduce((t, h) => t + h.strokes, 0), left = holes.length - done.length;
    const finished = !left;
    // at least 1 stroke for each spot left
    const best = score + left;
    const status = finished ? (score <= g.target ? "passed" : "failed") : best > g.target ? "out" : "on";
    const need = finished ? "" : best > g.target ? "Target out of reach" : `${g.target - score} strokes or fewer for the last ${left}`;
    return { score, done: done.length, left, status, need, toPar: score - done.length * 2 };
  }
  const shots = session.shots || [], done = shots.filter((s) => s.result);
  const score = g.sg ? sgSum(shots) : done.reduce((t, s) => t + g.points(s), 0);
  const left = shots.length - done.length, finished = !left;
  if (g.sg) return { score, done: done.length, left, status: finished ? (score > g.target ? "passed" : "failed") : score > g.target ? "on" : "behind", need: finished ? "" : `${score >= 0 ? "Ahead of" : "Behind"} the Tour by ${Math.abs(score).toFixed(2)}` };
  const reach = score + left * (g.maxPer || 1);
  const status = finished ? (score >= g.target ? "passed" : "failed") : score >= g.target ? "on" : reach < g.target ? "out" : "on";
  const need = finished ? "" : score >= g.target ? "Target reached — keep going for a best" : reach < g.target ? "Target out of reach" : `${g.target - score} more ${g.unit === "makes" ? "makes" : "points"} from the last ${left}`;
  return { score, done: done.length, left, status, need };
}

export const fmtGameScore = (g, v) => (v == null ? "—" : g.sg ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}` : String(Math.round(v)));
/** Your best finished score at a game, or null. */
export function personalBest(g, sessions) {
  const scores = sessions.filter((s) => s.mode === "game" && s.gameId === g.id && s.status === "done" && s.game?.score != null && s.game.complete !== false).map((s) => s.game.score);
  if (!scores.length) return null;
  return g.better === "low" ? Math.min(...scores) : Math.max(...scores);
}
