/*
 * Pressure games (update 139): every game is a small recipe, so the built-in ones can be edited, you can make your
 * own, and a coach can send one to a player.
 *
 *   { id, title, cat: OTT | APP | ARG | PUTT, blurb,
 *     play: "shots" (one shot each) | "holes" (play each one out until it's in, distance only),
 *     shots: how many, dist: { from, to } (yds; ft for putts) or list: [3, 6, 9] (played in order, round and round),
 *     setup: { width, lie, pin } (the made-up hole or green),
 *     scoring: { type, inside? (ft) }, target }
 *
 * Scoring types:
 *   fairways  a point a fairway, −2 a penalty (off the tee)
 *   prox      points for how close: holed 10 · inside 8 ft 4 · 15 ft 3 · 25 ft 2 · on the green 1 · missed 0 · water −2
 *   inside    a point for holing it or finishing inside N feet
 *   makes     a point a make
 *   ladder    a make is worth a point for every 3 feet (3 ft 1, 6 ft 2, 9 ft 3)
 *   sg        total strokes gained against the Tour baselines (beat 0.00)
 *   strokes   strokes to hole out (play: "holes"); lower is better
 */
import { shotFor } from "./model.js";
import { spotHole } from "./round.js";

const rint = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const proxFt = (r) => (r.lie === "Holed" ? 0 : r.unit === "ft" ? r.dist : r.dist * 3);

/** Proximity points: the default table (each game can have its own: scoring.table). */
export const PROX_TABLE = { holed: 10, bands: [[8, 4], [15, 3], [25, 2]], green: 1, miss: 0, water: -2 };
export const proxTable = (g) => {
  const t = g?.scoring?.table || {};
  const bands = (t.bands?.length ? t.bands : PROX_TABLE.bands).map(([ft, pts]) => [Number(ft) || 0, Number(pts) || 0]).filter(([ft]) => ft > 0).sort((a, b) => a[0] - b[0]);
  const n = (k) => (t[k] == null || t[k] === "" || Number.isNaN(Number(t[k])) ? PROX_TABLE[k] : Number(t[k]));
  return { holed: n("holed"), bands, green: n("green"), miss: n("miss"), water: n("water") };
};
const signed = (v) => (v < 0 ? `\u2212${Math.abs(v)}` : String(v));

export const SCORING = {
  fairways: { label: "Fairways", cats: ["OTT"], text: () => "Fairway 1 · Rough or bunker 0 · Penalty −2", maxPer: 1, unit: "pts", points: (s) => (s.result.penalty ? -2 : s.result.lie === "Fairway" ? 1 : 0) },
  prox: { label: "Proximity points", cats: ["APP", "ARG"], unit: "pts",
    text: (g) => { const t = proxTable(g); return [`Holed ${signed(t.holed)}`, ...t.bands.map(([ft, p], i) => `${i ? "" : "Inside "}${ft} ft ${signed(p)}`), `On the green ${signed(t.green)}`, `Missed ${signed(t.miss)}`, `Water ${signed(t.water)}`].join(" \u00b7 "); },
    points: (s, g) => { const t = proxTable(g), r = s.result; if (r.penalty) return t.water; if (r.lie === "Holed") return t.holed; if (r.lie !== "Green") return t.miss; const f = proxFt(r); const b = t.bands.find(([ft]) => f <= ft); return b ? b[1] : t.green; } },
  inside: { label: "Inside a distance", cats: ["APP", "ARG", "PUTT"], text: (g) => `Holed or inside ${g.scoring.inside || 6} ft 1 · Further 0`, maxPer: 1, unit: "pts", points: (s, g) => (s.result.lie === "Holed" || (!s.result.penalty && proxFt(s.result) <= (g.scoring.inside || 6)) ? 1 : 0) },
  makes: { label: "Makes", cats: ["PUTT"], text: () => "A point for every make", maxPer: 1, unit: "makes", points: (s) => (s.result.lie === "Holed" ? 1 : 0) },
  ladder: { label: "Ladder (longer makes worth more)", cats: ["PUTT"], text: () => "A make is worth a point for every 3 ft: 3 ft 1, 6 ft 2, 9 ft 3", maxPer: null, unit: "pts", points: (s) => (s.result.lie === "Holed" ? Math.max(1, Math.round(s.startDist / 3)) : 0) },
  sg: { label: "Strokes gained", cats: ["OTT", "APP", "ARG", "PUTT"], text: () => "Your total strokes gained against the Tour baselines", maxPer: null, unit: "SG", sg: true, points: (s) => s.sg || 0 },
  strokes: { label: "Strokes to hole out", cats: ["APP", "ARG"], text: () => "Strokes to hole out from each spot", unit: "strokes", low: true },
};

export const BUILT_IN = [
  { id: "fairway-finder", cat: "OTT", title: "Fairway Finder", play: "shots", shots: 14, setup: { width: "mixed" }, scoring: { type: "fairways" }, target: 9,
    blurb: "14 drives on 14 different holes. A point for every fairway, minus 2 for every penalty. 9 is Tour level." },
  { id: "tight-ten", cat: "OTT", title: "Tight Ten", play: "shots", shots: 10, setup: { width: "tight" }, scoring: { type: "fairways" }, target: 6,
    blurb: "10 drives into 24-yard fairways with trouble both sides. Hit 6 to pass." },
  { id: "pin-seeker", cat: "APP", title: "Pin Seeker", play: "shots", shots: 12, dist: { from: 100, to: 200 }, setup: { lie: "Fairway", pin: "mixed" }, scoring: { type: "prox" }, target: 20,
    blurb: "12 approaches from 100 to 200 yards. Points for how close you finish. 20 is Tour level." },
  { id: "beat-the-tour", cat: "APP", title: "Beat the Tour", play: "shots", shots: 10, dist: { from: 125, to: 225 }, setup: { lie: "mixed", pin: "hard" }, scoring: { type: "sg" }, target: 0,
    blurb: "10 approaches from 125 to 225 yards to tucked pins, some from the rough. Finish above 0.00 strokes gained to beat the Tour baselines." },
  { id: "wedge-wizard", cat: "APP", title: "Wedge Wizard", play: "shots", shots: 10, dist: { from: 50, to: 115 }, setup: { lie: "Fairway", pin: "mixed" }, scoring: { type: "inside", inside: 15 }, target: 6,
    blurb: "10 wedges from 50 to 115 yards. A point for every one inside 15 feet. 6 is Tour level." },
  { id: "approach-nine", cat: "APP", title: "Approach Nine", play: "holes", shots: 9, dist: { from: 100, to: 180 }, scoring: { type: "strokes" }, target: 26,
    blurb: "Nine approaches from 100 to 180 yards, each played out until it's in. Par is 27; 26 or better is Tour level." },
  { id: "up-and-down-9", cat: "ARG", title: "Up & Down 9", play: "holes", shots: 9, dist: { from: 5, to: 40 }, scoring: { type: "strokes" }, target: 20,
    blurb: "9 spots round the green, from 5 to 40 yards. Play each one out until it's in. Par is 18; 20 or better is Tour level." },
  { id: "get-it-close", cat: "ARG", title: "Get It Close", play: "shots", shots: 10, dist: { from: 8, to: 30 }, setup: { lie: "mixed", pin: "mixed" }, scoring: { type: "inside", inside: 6 }, target: 6,
    blurb: "10 chips and pitches from 8 to 30 yards, from all sorts of lies. A point for every one inside 6 feet. 6 is Tour level." },
  { id: "circle-of-4", cat: "PUTT", title: "Circle of 4", play: "shots", shots: 10, list: [4], scoring: { type: "makes" }, target: 9,
    blurb: "10 four-footers from all round the hole: uphill, downhill and both breaks. Make 9 to pass." },
  { id: "around-the-world", cat: "PUTT", title: "Around the World", play: "shots", shots: 8, list: [3], scoring: { type: "makes" }, target: 8,
    blurb: "8 three-footers, every break. All 8 or it doesn't count." },
  { id: "pressure-sixes", cat: "PUTT", title: "Pressure Sixes", play: "shots", shots: 10, list: [6], scoring: { type: "makes" }, target: 7,
    blurb: "10 six-footers. Make 7 to pass, the Tour make rate from there." },
  { id: "ladder-3-6-9", cat: "PUTT", title: "3-6-9 Ladder", play: "shots", shots: 9, list: [3, 6, 9], scoring: { type: "ladder" }, target: 12,
    blurb: "Three times up the ladder: 3, 6 and 9 feet. A 3-footer is worth 1, a 6-footer 2 and a 9-footer 3. 12 is Tour level." },
  { id: "lag-master", cat: "PUTT", title: "Lag Master", play: "shots", shots: 10, dist: { from: 30, to: 60 }, scoring: { type: "inside", inside: 3 }, target: 7,
    blurb: "10 long putts from 30 to 60 feet. A point for every one you hole or leave inside 3 feet. 7 is Tour level." },
];

/** The distances for a game's shots. */
function distances(g) {
  const n = Math.max(1, Math.min(60, Number(g.shots) || 10));
  if (g.list?.length) return Array.from({ length: n }, (_, i) => g.list[i % g.list.length]);
  if (g.cat === "OTT") return Array(n).fill(0);
  const lo = Number(g.dist?.from) || 10, hi = Math.max(lo, Number(g.dist?.to) || lo);
  return Array.from({ length: n }, () => (g.cat === "PUTT" ? Math.round((lo + Math.random() * (hi - lo)) * 2) / 2 : rint(lo, hi)));
}

/** A new set of shots (or spots) for a game. */
export function buildGame(g) {
  const ds = distances(g);
  if (g.play === "holes") return ds.map((d, i) => spotHole(i + 1, d, d));
  const breaks = ["straight", "lr", "rl"], slopes = ["up", "down", "flat"];
  return ds.map((d, i) => {
    const s = shotFor(g.cat, d, { ...(g.setup || {}), width: g.setup?.width || "standard" });
    // short putts go all round the hole: every break and slope in turn
    if (g.cat === "PUTT" && g.list?.length) { s.breakDir = breaks[i % 3]; s.slope = slopes[Math.floor(i / 3) % 3]; s.sidePct = s.breakDir === "straight" ? 0 : s.sidePct || 1.5; s.upPct = s.slope === "flat" ? 0 : s.upPct || 1.5; }
    return { ...s, i: i + 1 };
  });
}

export const scoringOf = (g) => SCORING[g.scoring?.type] || SCORING.makes;
export const isLow = (g) => !!scoringOf(g).low;
/** What a point is worth at most per shot (for "still possible?"). */
function maxPer(g) {
  const sc = scoringOf(g);
  if (g.scoring?.type === "prox") { const t = proxTable(g); return Math.max(t.holed, t.green, t.miss, ...t.bands.map((b) => b[1])); }
  if (g.scoring?.type === "ladder") return Math.max(...(g.list?.length ? g.list : [Number(g.dist?.to) || 9]).map((d) => Math.max(1, Math.round(d / 3))));
  return sc.maxPer ?? 1;
}
/** A shot's points in a game. */
export const pointsFor = (g, s) => scoringOf(g).points?.(s, g) ?? 0;

/** Where a game stands: { score, done, left, status: "on" | "out" | "behind" | "passed" | "failed", need } */
export function gameProgress(g, session) {
  const sc = scoringOf(g);
  if (g.play === "holes") {
    const holes = session.holes || [], done = holes.filter((h) => h.done);
    const score = done.reduce((t, h) => t + h.strokes, 0), left = holes.length - done.length;
    const best = score + left;
    const status = !left ? (score <= g.target ? "passed" : "failed") : best > g.target ? "out" : "on";
    const need = !left ? "" : best > g.target ? "Target out of reach" : `${g.target - score} strokes or fewer for the last ${left}`;
    return { score, done: done.length, left, status, need };
  }
  const shots = session.shots || [], done = shots.filter((s) => s.result);
  const score = done.reduce((t, s) => t + pointsFor(g, s), 0);
  const left = shots.length - done.length, finished = !left;
  if (sc.sg) return { score, done: done.length, left, status: finished ? (score > g.target ? "passed" : "failed") : score > g.target ? "on" : "behind", need: finished ? "" : `${score >= 0 ? "Ahead of" : "Behind"} the Tour baselines by ${Math.abs(score).toFixed(2)}` };
  const reach = score + left * maxPer(g);
  const status = finished ? (score >= g.target ? "passed" : "failed") : score >= g.target ? "on" : reach < g.target ? "out" : "on";
  const word = sc.unit === "makes" ? "makes" : "points";
  const need = finished ? "" : score >= g.target ? "Target reached — keep going for a best" : reach < g.target ? "Target out of reach" : `${g.target - score} more ${word} from the last ${left}`;
  return { score, done: done.length, left, status, need };
}

export const fmtGameScore = (g, v) => (v == null ? "—" : scoringOf(g).sg ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}` : String(Math.round(v)));
export const targetText = (g) => (scoringOf(g).sg ? `Beat ${Number(g.target || 0).toFixed(2)} SG` : `Target ${g.target}${isLow(g) ? " or less" : ""}`);
export const passedIt = (g, score) => (isLow(g) ? score <= g.target : scoringOf(g).sg ? score > g.target : score >= g.target);

/** Your best finished score at a game (by its id), or null. */
export function personalBest(g, sessions) {
  const scores = sessions.filter((s) => s.mode === "game" && s.gameId === g.id && s.status === "done" && s.game?.score != null && s.game.complete !== false).map((s) => s.game.score);
  if (!scores.length) return null;
  return isLow(g) ? Math.min(...scores) : Math.max(...scores);
}

/** A plain description of a recipe (for games made in the editor). */
export function describeGame(g) {
  const what = { OTT: "drives", APP: "approaches", ARG: "short-game shots", PUTT: "putts" }[g.cat];
  const unit = g.cat === "PUTT" ? "feet" : "yards";
  const where = g.cat === "OTT" ? "" : g.list?.length ? ` from ${g.list.join(", ")} ${unit}` : ` from ${g.dist?.from} to ${g.dist?.to} ${unit}`;
  const how = g.play === "holes" ? ", each played out until it's in" : "";
  return `${g.shots} ${what}${where}${how}. ${scoringOf(g).text(g)}.`;
}

/** The recipe a game session was played with (kept on the session, so it shows even if the game's since changed). */
export const gameOf = (s) => (s?.mode === "game" ? s.gameDef || BUILT_IN.find((g) => g.id === s.gameId) || null : null);
