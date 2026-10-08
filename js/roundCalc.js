// Turning rounds entered in Data Entry into the same shape the stats dashboards use.

export const LIES = ["Tee box", "Fairway", "Rough", "Bunker", "Green"];
export const END_LIES = ["Fairway", "Rough", "Bunker", "Green", "Holed", "Penalty"];
export const unitFor = (lie) => (lie === "Green" || lie === "Fringe" ? "ft" : "yds");

/* ------------------------------ expected strokes (the baseline) ------------------------------ */
// The average strokes to hole out from each lie and distance (Tee, Fairway, Rough and Sand in yards;
// Fringe and Green in feet), from the scoring-average table supplied for Callaway.
//
// The model: an isotonic regression of each lie's table (the expected score can only rise with distance,
// so the table's small dips, e.g. Rough at 400 yds or Green at 120 ft, are pooled with their neighbours),
// then a monotone cubic (Fritsch-Carlson / PCHIP) curve through those points, so values between the
// listed distances are smooth and never fall as the ball gets farther away. Shorter than the first
// distance holds the first value; longer than the last carries on at the closing slope.
const BASELINE_KNOTS = {
  Tee: [[10, 100, 120, 150.0, 180, 200, 220, 240, 260, 290.0, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 630.0, 700], [2.8, 2.83, 2.96, 2.975, 3.05, 3.09, 3.14, 3.2, 3.28, 3.58, 3.72, 3.83, 3.91, 3.97, 3.99, 4.0, 4.07, 4.14, 4.19, 4.29, 4.45, 4.54, 4.61, 4.68, 4.69, 5.0]],
  Fairway: [[1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600], [1.85, 2.08, 2.32, 2.46, 2.56, 2.65, 2.68, 2.7, 2.72, 2.73, 2.76, 2.81, 2.86, 2.94, 3.02, 3.12, 3.27, 3.37, 3.47, 3.56, 3.69, 3.78, 3.88, 3.91, 4.09, 4.11, 4.19, 4.27, 4.34, 4.42, 4.5, 4.58, 4.66, 4.74, 4.82, 4.89]],
  Rough: [[1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 400.0, 460, 480, 500, 520, 540, 560, 580, 600], [2.0, 2.26, 2.51, 2.63, 2.74, 2.82, 2.88, 2.9, 2.92, 2.94, 2.97, 3.05, 3.11, 3.2, 3.28, 3.39, 3.53, 3.61, 3.7, 3.77, 3.84, 3.95, 4.02, 4.174, 4.2, 4.43, 4.77, 4.87, 4.96, 5.06, 5.15, 5.25]],
  Sand: [[1, 10, 20, 30, 40, 50, 60, 95.0, 140, 160, 180, 200, 220, 240, 260, 280, 300, 330.0, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600], [2.42, 2.47, 2.51, 2.61, 2.78, 3.0, 3.16, 3.206, 3.22, 3.29, 3.4, 3.57, 3.72, 3.76, 3.88, 3.94, 4.07, 4.165, 4.26, 4.55, 4.69, 4.83, 4.97, 5.11, 5.25, 5.4, 5.54, 5.68, 5.82, 5.96, 6.1]],
  Fringe: [[0.3333, 1.0, 1.3333, 1.6667, 2.0, 2.3333, 2.6667, 3.0, 3.3333, 5.0, 6.6667, 10.0, 13.3333, 16.6667, 20.0, 30.0, 33.3333, 36.6667, 40.0, 50.0], [1.001, 1.046, 1.13, 1.245, 1.42, 1.54, 1.63, 1.67, 1.72, 1.84, 1.92, 2.02, 2.08, 2.16, 2.31, 2.44, 2.5, 2.77, 2.82, 2.97]],
  Green: [[1, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50, 60, 90, 100, 115.0, 150], [1.0, 1.03, 1.1, 1.2, 1.31, 1.4, 1.48, 1.55, 1.6, 1.77, 1.86, 1.96, 2.04, 2.12, 2.2, 2.39, 2.42, 2.525, 2.97]],
};
const LIE_TABLE = { "Tee box": "Tee", Tee: "Tee", Fairway: "Fairway", Rough: "Rough", Recovery: "Rough", Bunker: "Sand", Sand: "Sand", Fringe: "Fringe", Green: "Green" };

// slopes for the monotone cubic through each table (worked out once)
const CURVES = Object.fromEntries(Object.entries(BASELINE_KNOTS).map(([k, [x, y]]) => {
  const n = x.length, h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); dl.push((y[i + 1] - y[i]) / h[i]); }
  const m = new Array(n).fill(0);
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]);
  }
  // keep the end slopes from overshooting (shape-preserving ends)
  const endFix = (i, d0, d1) => { if (Math.sign(m[i]) !== Math.sign(d0)) m[i] = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m[i]) > 3 * Math.abs(d0)) m[i] = 3 * d0; };
  if (n > 2) { m[0] = ((2 * h[0] + h[1]) * dl[0] - h[0] * dl[1]) / (h[0] + h[1]); endFix(0, dl[0], dl[1]);
    m[n - 1] = ((2 * h[n - 2] + h[n - 3]) * dl[n - 2] - h[n - 2] * dl[n - 3]) / (h[n - 2] + h[n - 3]); endFix(n - 1, dl[n - 2], dl[n - 3]); }
  const tail = Math.max(0, (y[n - 1] - y[Math.max(0, n - 4)]) / (x[n - 1] - x[Math.max(0, n - 4)])); // beyond the table
  return [k, { x, y, m, tail }];
}));
function curveAt(c, d) {
  const { x, y, m, tail } = c, n = x.length;
  if (d <= x[0]) return y[0];
  if (d >= x[n - 1]) return y[n - 1] + tail * (d - x[n - 1]);
  let i = 0; while (d > x[i + 1]) i++;
  const h = x[i + 1] - x[i], t = (d - x[i]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
}

/** Average strokes to hole out from a lie and distance (yds off the green, ft on the green and fringe). */
export function expectedStrokes(lie, dist) {
  if (lie === "Holed") return 0;
  const d = Math.max(0, Number(dist) || 0);
  const c = CURVES[LIE_TABLE[lie] || "Rough"];
  return curveAt(c, d);
}

/** Strokes gained by one stroke = expected before − expected after − 1 (a penalty costs an extra stroke). */
export function strokesGained(st) {
  if (!st || !st.startLie || st.startDist === "" || st.startDist === null || st.startDist === undefined || !st.endLie) return null;
  const after = st.endLie === "Holed" ? 0 : st.endLie === "Penalty" ? expectedStrokes("Rough", st.endDist ?? st.startDist) + 1
    : expectedStrokes(st.endLie, st.endDist);
  return expectedStrokes(st.startLie, st.startDist) - after - 1;
}

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
    key: round.id, date: round.date || "", event: round.tournament || round.course || "Entered round", roundNo: "", tour: round.tour || "",
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
