// Turning rounds entered in Data Entry into the same shape the stats dashboards use.
//
// ⚠️ PLACEHOLDER MATH. expectedStrokes() below is a rough stand-in so the dashboards have plausible
// numbers to show. Replace it (or strokesGained()) with your own functions when they're ready;
// nothing else needs to change.

export const LIES = ["Tee box", "Fairway", "Rough", "Bunker", "Green"];
export const END_LIES = ["Fairway", "Rough", "Bunker", "Green", "Holed", "Penalty"];
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
  // Off-the-Tee is the tee shot on a par 4 or 5 only; a par 3 tee shot is an Approach.
  if (strokeIndex === 0 && Number(par) >= 4) return "OTT";
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

/** The bag group of a club label, for shots saved before groups were recorded. */
export function clubGroupOf(label) {
  const s = String(label || "");
  if (/^driver/i.test(s)) return "Driver";
  if (/^\d+w$/i.test(s)) return "Fairway Wood";
  if (/^\d+H$/.test(s)) return "Hybrid";
  if (/^\d+i$/i.test(s) || /^(PW|AW)$/i.test(s)) return "Iron";
  if (/wedge/i.test(s)) return "Wedge";
  if (/putter/i.test(s)) return "Putter";
  return "Other";
}

/** A hole's score in a round: from its shots, or (quick mode) the score typed in. */
export function roundHoleScore(round, h, shots = undefined) {
  const st = shots !== undefined ? shots : round?.shots?.[`h${h.n}`];
  if (st && st.length) return holeScore(st);
  const q = round?.quick?.[`h${h.n}`];
  return q && Number(q.score) > 0 ? { strokes: Number(q.score), done: true, quick: true } : { strokes: 0, done: false };
}

/** Strokes on a hole, its score, and whether it's finished. */
export function holeScore(strokes = []) {
  const done = strokes.some((s) => s.endLie === "Holed");
  const penalties = strokes.filter((s) => s.endLie === "Penalty").length;
  return { strokes: strokes.length + penalties, done };
}

/**
 * Traditional stats for one entered round, as counts (so any set of rounds adds up): finished holes only.
 *   score / par, GIR, fairways, putts, 3-putts, up-and-downs, birdies, pars or better, driving distance,
 *   approach proximity and approaches that hit the green.
 */
export function basicCounts(round) {
  const c = { holes: 0, score: 0, par: 0, gir: 0, fwyN: 0, fwy: 0, putts: 0, puttHoles: 0, threePutts: 0, udN: 0, ud: 0, birdies: 0, parOrBetter: 0,
    drives: 0, driveYds: 0, apps: 0, appGreen: 0, proxN: 0, proxFt: 0 };
  const yds = (lie, d) => (d === "" || d == null ? null : lie === "Green" ? Number(d) / 3 : Number(d));
  for (const h of round.holes || []) {
    const strokes = round.shots?.[`h${h.n}`] || [];
    const q = round.quick?.[`h${h.n}`];
    if (!strokes.length && q && Number(q.score) > 0 && h.par) {
      // quick mode: score, putts, fairway, green in regulation
      const sc = Number(q.score), pu = q.putts === "" || q.putts == null ? null : Number(q.putts);
      c.holes++; c.score += sc; c.par += h.par;
      if (sc <= h.par - 1) c.birdies++;
      if (sc <= h.par) c.parOrBetter++;
      const gir = q.gir != null ? !!q.gir : pu != null && sc - pu <= h.par - 2;
      if (gir) c.gir++; else { c.udN++; if (sc <= h.par) c.ud++; }
      if (h.par >= 4 && (q.fwy === true || q.fwy === false)) { c.fwyN++; if (q.fwy) c.fwy++; }
      if (pu != null) { c.putts += pu; c.puttHoles++; if (pu >= 3) c.threePutts++; }
      continue;
    }
    const { strokes: score, done } = holeScore(strokes);
    if (!done || !h.par) continue;
    c.holes++; c.score += score; c.par += h.par;
    if (score <= h.par - 1) c.birdies++;
    if (score <= h.par) c.parOrBetter++;
    // to the green: strokes (and penalties) until the ball is on the green or in the hole
    let toGreen = null, pens = 0;
    strokes.forEach((st, i) => { if (st.endLie === "Penalty") pens++; if (toGreen == null && (st.endLie === "Green" || st.endLie === "Holed")) toGreen = i + 1 + pens; });
    const gir = toGreen != null && toGreen <= h.par - 2;
    if (gir) c.gir++;
    else { c.udN++; if (score <= h.par) c.ud++; } // missed the green in regulation: got up and down for par or better?
    const tee = strokes[0];
    if (h.par >= 4 && tee) {
      c.fwyN++; if (tee.endLie === "Fairway") c.fwy++;
      const a = yds(tee.startLie, tee.startDist), b = yds(tee.endLie, tee.endDist);
      if (a != null && b != null && tee.endLie !== "Penalty") { c.drives++; c.driveYds += a - b; }
    }
    const putts = strokes.filter((st) => st.startLie === "Green").length;
    if (putts) { c.putts += putts; c.puttHoles++; if (putts >= 3) c.threePutts++; }
    strokes.forEach((st, i) => {
      if (categoryOf(st, i, h.par) !== "APP") return;
      c.apps++;
      if (st.endLie === "Green" || st.endLie === "Holed") { c.appGreen++; c.proxN++; c.proxFt += st.endLie === "Holed" ? 0 : Number(st.endDist) || 0; }
    });
  }
  return c;
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
      // Club: "7i · Titleist T100" when the brand / model is known; its group (Iron, Wedge…) for the filter.
      const club = st.club ? (st.clubMake ? `${st.club} \u00b7 ${st.clubMake}` : st.club) : null;
      shots.push({ cat, sg, w: 1, lie: st.startLie, dist: distanceBucket(cat, st, h.par), club, clubCat: st.club ? (st.clubCat || clubGroupOf(st.club)) : null });
    });
  }
  const d = new Date(round.date);
  return {
    key: round.id, date: round.date || "", event: round.tournament || round.course || "Entered round", roundNo: "",
    year: isNaN(d) ? "" : String(d.getFullYear()), shots, basic: basicCounts(round),
  };
}

/** Column map so the shared dashboard offers its lie and distance views for entered rounds. */
export const ENTERED_IDX = { category: 0, sg: 1, lie: 2, distanceRange: 3, club: 4 };

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
