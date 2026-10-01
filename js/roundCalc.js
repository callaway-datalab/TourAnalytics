// Turning rounds entered in Data Entry into the same shape the stats dashboards use.
//
// ⚠️ PLACEHOLDER MATH. expectedStrokes() below is a rough stand-in so the dashboards have plausible
// numbers to show. Replace it (or strokesGained()) with your own functions when they're ready;
// nothing else needs to change.

export const LIES = ["Tee box", "Fairway", "Rough", "Bunker", "Recovery", "Green"];
export const END_LIES = ["Fairway", "Rough", "Bunker", "Recovery", "Green", "Holed", "Penalty"];
export const unitFor = (lie) => (lie === "Green" ? "ft" : "yds");

/* ------------------------------ PLACEHOLDER: expected strokes ------------------------------ */
// Average strokes to hole out from a lie and distance (yds off the green, ft on it).
export function expectedStrokes(lie, dist) {
  const d = Math.max(0, Number(dist) || 0);
  if (lie === "Holed") return 0;
  if (lie === "Green") return Math.min(3, 1 + 1.1 * (1 - Math.exp(-Math.max(0, d - 1) / 18)) + (d > 40 ? 0.12 : 0));
  const base = 1.95 + 0.95 * Math.log(1 + d / 45);
  const extra = { "Tee box": -0.06, Fairway: 0, Rough: 0.18, Bunker: d < 50 ? 0.3 : 0.45, Recovery: 0.7, Penalty: 1 }[lie] ?? 0.1;
  return base + extra;
}

/** Strokes gained by one stroke = expected before − expected after − 1 (a penalty costs an extra stroke). */
export function strokesGained(st) {
  if (!st || !st.startLie || st.startDist === "" || st.startDist === null || st.startDist === undefined || !st.endLie) return null;
  const after = st.endLie === "Holed" ? 0 : st.endLie === "Penalty" ? expectedStrokes("Rough", st.endDist ?? st.startDist) + 1
    : expectedStrokes(st.endLie, st.endDist);
  return expectedStrokes(st.startLie, st.startDist) - after - 1;
}
/* ------------------------------------------------------------------------------------------- */

/** Category of a stroke, the way the Tour data splits them. */
export function categoryOf(st, strokeIndex, par) {
  if (st.startLie === "Green") return "PUTT";
  if (strokeIndex === 0 && par >= 4) return "OTT";
  const d = Number(st.startDist) || 0;
  return d <= 50 ? "ARG" : "APP";
}

const APP_BUCKETS = [[50, 75], [75, 100], [100, 120], [120, 140], [140, 160], [160, 180], [180, 200], [200, 225], [225, 250]];
const ARG_BUCKETS = [[0, 10], [10, 20], [20, 30], [30, 50]];
const PUTT_BUCKETS = [[0, 3], [3, 5], [5, 10], [10, 15], [15, 20], [20, 30]];
const bucket = (d, list, unit, over) => {
  const hit = list.find(([a, b]) => d >= a && d < b);
  return hit ? `${hit[0]}-${hit[1]} ${unit}` : over;
};
export function distanceBucket(cat, st, par) {
  const d = Number(st.startDist) || 0;
  if (cat === "OTT") return `Par ${par} tee shots`;
  if (cat === "PUTT") return bucket(d, PUTT_BUCKETS, "ft", "30+ ft");
  if (cat === "ARG") return bucket(d, ARG_BUCKETS, "yds", "30-50 yds");
  return d < 50 ? "50-75 yds" : bucket(d, APP_BUCKETS, "yds", "250+ yds");
}

/** Strokes on a hole, its score, and whether it's finished. */
export function holeScore(strokes = []) {
  const done = strokes.some((s) => s.endLie === "Holed");
  const penalties = strokes.filter((s) => s.endLie === "Penalty").length;
  return { strokes: strokes.length + penalties, done };
}

/** One entered round -> { key, date, event, roundNo, year, shots: [{ cat, sg, w, lie, dist }] }. */
export function roundToPrepared(round) {
  const shots = [];
  for (const h of round.holes || []) {
    const strokes = round.shots?.[`h${h.n}`] || [];
    strokes.forEach((st, i) => {
      const sg = strokesGained(st);
      if (sg === null) return;
      const cat = categoryOf(st, i, h.par);
      shots.push({ cat, sg, w: 1, lie: st.startLie, dist: distanceBucket(cat, st, h.par) });
    });
  }
  const d = new Date(round.date);
  return {
    key: round.id, date: round.date || "", event: round.course || "Entered round", roundNo: "",
    year: isNaN(d) ? "" : String(d.getFullYear()), shots,
  };
}

/** Column map so the shared dashboard offers its lie and distance views for entered rounds. */
export const ENTERED_IDX = { category: 0, sg: 1, lie: 2, distanceRange: 3 };

/** Group entered rounds by player: [{ key, label, rounds }], oldest round first. */
export function enteredPlayers(rounds, labelOf = (r) => r.playerLabel) {
  const by = new Map();
  for (const r of rounds) {
    if (!by.has(r.playerKey)) by.set(r.playerKey, { key: r.playerKey, label: labelOf(r), rounds: [] });
    const p = roundToPrepared(r);
    if (p.shots.length) by.get(r.playerKey).rounds.push(p);
  }
  for (const p of by.values()) p.rounds.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return [...by.values()].filter((p) => p.rounds.length);
}
