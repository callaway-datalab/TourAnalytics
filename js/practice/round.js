/*
 * Playing a round in practice (update 138): made-up holes (or a real course's pars and yards), played shot by shot
 * from wherever the last one finished, until the ball is in the hole.
 *
 *   A hole:  { n, par, length, tee (the tee-shot layout, par 4/5), green (the green's layout), shots: [], done, strokes }
 *   A shot:  the same shape as a practice shot ("tee", "green" or "putt"), so it draws, enters and scores the same way,
 *            plus { played: true, n (stroke number), rcat (OTT / APP / ARG / PUTT, for the round's breakdown) }.
 *
 * Strokes gained add up: every shot is the expected strokes where it started, less where it finished, less one
 * (and a penalty stroke when there is one), so a hole's shots sum to (Tour-average score from the tee) − (your score).
 */
import { holeLayout, greenLayout, puttFrom, scoreShot, startExpected } from "./model.js";
import { expectedStrokes } from "../roundCalc.js";

const rint = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TEE_CARRY = { Driver: 290, "3 wood": 260, Iron: 225 };
export const LONG_SHOT = 250;  // beyond this from the green, the next shot is played down the fairway (not at the green)
export const MAX_STROKES = 12; // a hole stops here (pick up)

/* ---------------------------------------------------------------- the holes ---------------------------------------------------------------- */
const PAR_ORDER = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const LEN = { 3: [140, 235], 4: [345, 480], 5: [505, 595] };

/** 18 (or 9) made-up holes. opts: { holes: 18|9, scale (1 = championship tees), width: "tight"|"standard"|"wide"|"mixed" } */
export function randomHoles({ holes = 18, scale = 1, width = "mixed" } = {}) {
  const pars = PAR_ORDER.slice(0, holes);
  // a little shuffle within each nine, so no two rounds run the same
  for (let k = 0; k < pars.length; k += 9) for (let i = Math.min(k + 8, pars.length - 1); i > k; i--) { const j = k + Math.floor(Math.random() * (i - k + 1)); [pars[i], pars[j]] = [pars[j], pars[i]]; }
  return pars.map((par, i) => makeHole({ n: i + 1, par, length: Math.round(rint(...LEN[par]) * scale / 5) * 5, width }));
}

/** A real course's holes: pars and yards (from a saved scorecard or one of your rounds), the trouble made up. */
export function courseHoles({ par = [], yards = [], width = "standard", only = null }) {
  const out = [];
  par.forEach((p, i) => {
    if (only && !only.includes(i + 1)) return;
    const y = Number(yards[i]) || Math.round(rint(...LEN[p || 4]) / 5) * 5;
    out.push(makeHole({ n: i + 1, par: p || (y < 250 ? 3 : y > 500 ? 5 : 4), length: y, width }));
  });
  return out;
}

function makeHole({ n, par, length, width }) {
  const w = width === "mixed" ? pick(["tight", "standard", "standard", "wide"]) : width;
  const tee = par >= 4 ? holeLayout({ length, width: w, carry: 290, club: "Driver", par }) : null;
  const green = greenLayout(par === 3 ? "APP" : "APP", pick(["easy", "mid", "mid", "hard"]), { size: par === 3 ? 0.9 : par === 5 ? 1.1 : 1 });
  return { n, par, length, widthId: w, tee, green, shots: [], done: false, strokes: 0 };
}

/** A short-game "hole" for a game: a chip or pitch to play out (green, pin and where you're playing from). */
export function shortGameHole(n, { lo = 5, hi = 40, lie = null } = {}) {
  const green = greenLayout("ARG", pick(["easy", "mid", "hard"]));
  const D0 = rint(lo, hi), ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
  let k = D0, sx, sy;
  const { rx, ry } = green.green;
  do { sx = green.pin.x + Math.cos(ang) * k; sy = green.pin.y + Math.sin(ang) * k; k += 1; } while ((sx / (rx + 1)) ** 2 + (sy / (ry + 1)) ** 2 <= 1 && k < D0 + 40);
  const startLie = lie || pick(["Rough", "Rough", "Fringe", "Bunker", "Fairway"]);
  if (startLie === "Bunker") green.hazards.push({ type: "bunker", cx: sx, cy: sy, r: 5.5, start: true });
  return { n, par: 2, length: Math.round(k - 1), widthId: null, tee: null, green, start: { lie: startLie, x: sx, y: sy }, shots: [], done: false, strokes: 0, short: true };
}

/* ---------------------------------------------------------------- playing a hole ---------------------------------------------------------------- */
const rcatOf = (shot, hole) => {
  if (shot.kind === "putt") return "PUTT";
  if (shot.kind === "tee" && shot.startLie === "Tee box" && hole.par >= 4) return "OTT";
  if (shot.startLie === "Fringe" || (shot.kind === "green" && shot.startDist <= 50 && shot.startLie !== "Tee box")) return "ARG";
  return "APP";
};

/** A shot at the green from (x, y) in the green's yards, from a lie. */
function greenShot(hole, lie, x, y, dist = null) {
  // (the distance, when the last result gave one, so the strokes gained add up exactly)
  const g = hole.green, D = Math.max(0.3, dist ?? Math.round(Math.hypot(g.pin.x - x, g.pin.y - y)));
  const hazards = g.hazards.filter((h) => !h.start);
  if (lie === "Bunker" && !hazards.some((h) => h.type === "bunker" && Math.hypot(h.cx - x, h.cy - y) <= h.r)) hazards.push({ type: "bunker", cx: x, cy: y, r: 5, start: true });
  return { kind: "green", cat: D <= 50 ? "ARG" : "APP", startLie: lie, startDist: D, green: g.green, pin: g.pin, from: { x, y }, hazards, pinMix: g.pinMix };
}

/** The shot to play next on this hole (null once it's finished). */
export function nextShot(hole, club = "Driver") {
  if (hole.done) return null;
  const last = hole.shots.at(-1);
  const strokesSoFar = hole.shots.reduce((t, s) => t + 1 + (s.result?.penalty ? 1 : 0), 0);
  let shot;
  if (!last) {
    if (hole.start) shot = greenShot(hole, hole.start.lie, hole.start.x, hole.start.y);
    else if (hole.par >= 4) shot = { ...hole.tee, club, carry: TEE_CARRY[club] || 290 };
    else shot = greenShot(hole, "Tee box", hole.green.pin.x, hole.green.pin.y - hole.length); // (the card yardage is to the pin)
  } else {
    const r = last.result;
    if (last.kind === "putt") shot = puttFrom(Math.max(0.5, Math.round(r.dist * 10) / 10));
    else if (last.kind === "tee") {
      if (r.penalty === "ob") shot = { ...last, result: undefined, sg: undefined }; // replay from the same spot
      else shot = fromFairway(hole, r.lie === "Penalty" ? "Rough" : r.lie, r.dist, last);
    } else {
      // after a shot at the green
      if (r.lie === "Green") shot = puttFrom(Math.max(0.5, Math.round(r.dist * 10) / 10));
      else {
        const p = whereItFinished(last, r);
        // in the water: a drop beside it, a little back from the edge
        const d = r.unit === "ft" ? r.dist / 3 : r.dist;
        shot = r.penalty ? greenShot(hole, "Rough", Math.sign(p.x || 1) * Math.max(0, Math.abs(p.x) - 2), p.y, d) : greenShot(hole, r.lie, p.x, p.y, d);
      }
    }
  }
  delete shot.result; delete shot.sg;
  return { ...shot, played: true, n: strokesSoFar + 1, rcat: rcatOf(shot, hole), hole: shot.kind === "tee" ? shot.hole : undefined };
}

/** Where a shot at the green finished (green yards): tapped, or (typed / said) that far from the pin on the line it came in on. */
function whereItFinished(last, r) {
  if (r.x != null && r.y != null) return { x: r.x, y: r.y };
  const d = (r.unit === "ft" ? r.dist / 3 : r.dist) || 1, fx = last.from.x - last.pin.x, fy = last.from.y - last.pin.y, k = Math.hypot(fx, fy) || 1;
  return { x: last.pin.x + (fx / k) * d, y: last.pin.y + (fy / k) * d };
}

/** After a tee shot (or a long one): the next from that lie and distance — down the fairway again if it's still a long way. */
function fromFairway(hole, lie, dist, last) {
  if (dist > LONG_SHOT) {
    const carry = Math.min(dist - 25, lie === "Fairway" ? 245 : lie === "Bunker" ? 190 : 215);
    return holeLayout({ length: dist, width: last.width, trouble: last.trouble, carry, club: lie === "Fairway" ? "Fairway wood" : "Hybrid", startLie: lie, par: hole.par });
  }
  // at the green, from straight back (a little off to the side the drive finished on)
  const side = Math.max(-0.35, Math.min(0.35, (last.result?.offline || 0) / Math.max(60, dist)));
  return greenShot(hole, lie, Math.sin(side) * dist + hole.green.pin.x, -Math.cos(side) * dist + hole.green.pin.y, dist);
}

/** Record a shot's result on the hole; returns the hole (done when the ball's in, or at the stroke limit). */
export function playShot(hole, shot, result) {
  shot.result = result;
  shot.sg = scoreShot(shot);
  hole.shots.push(shot);
  hole.strokes = hole.shots.reduce((t, s) => t + 1 + (s.result?.penalty ? 1 : 0), 0);
  if (result.lie === "Holed") hole.done = true;
  else if (hole.strokes >= MAX_STROKES) { hole.done = true; hole.pickedUp = true; }
  return hole;
}

/** Take back the last shot on a hole. */
export function undoShot(hole) {
  const s = hole.shots.pop();
  hole.done = false; hole.pickedUp = false;
  hole.strokes = hole.shots.reduce((t, x) => t + 1 + (x.result?.penalty ? 1 : 0), 0);
  return s;
}

/** Pick up: the hole counts as par + 3 (or what you've had, if more), with no strokes gained for the rest. */
export function pickUp(hole) {
  hole.done = true; hole.pickedUp = true;
  hole.strokes = Math.max(hole.strokes + 1, hole.par + 3);
}

/* ---------------------------------------------------------------- the numbers ---------------------------------------------------------------- */
/** Tour-average score for the hole (from the tee, or from where a short-game hole starts). */
export function holeExpected(hole) {
  if (hole.start) return startExpected(greenShot(hole, hole.start.lie, hole.start.x, hole.start.y));
  return expectedStrokes("Tee box", hole.length);
}

/** A round's (or game's) totals: score, to par, strokes gained by category, and the usual stats. */
export function roundSummary(holes) {
  const played = holes.filter((h) => h.done);
  const sg = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 };
  let fwHit = 0, fwAtt = 0, gir = 0, putts = 0, pens = 0, udAtt = 0, udMade = 0, scr = 0, scrAtt = 0;
  for (const h of played) {
    for (const s of h.shots) if (s.sg != null && sg[s.rcat] != null) sg[s.rcat] += s.sg;
    if (h.pickedUp) continue;
    const tee = h.shots[0];
    if (h.par >= 4 && tee && !h.start) { fwAtt++; if (tee.result?.lie === "Fairway") fwHit++; }
    // on the green in regulation: on it (or in) with par − 2 strokes or fewer
    let k = 0, onAt = null;
    for (const s of h.shots) { k += 1 + (s.result?.penalty ? 1 : 0); if ((s.result?.lie === "Green" || s.result?.lie === "Holed") && onAt == null) onAt = k; }
    if (!h.start && onAt != null && onAt <= h.par - 2) gir++;
    if (!h.start && (onAt == null || onAt > h.par - 2)) { scrAtt++; if (h.strokes <= h.par) scr++; }
    putts += h.shots.filter((s) => s.kind === "putt").length;
    pens += h.shots.filter((s) => s.result?.penalty).length;
    if (h.start) { udAtt++; if (h.strokes <= 2) udMade++; }
  }
  const score = played.reduce((t, h) => t + h.strokes, 0), par = played.reduce((t, h) => t + h.par, 0);
  const total = Object.values(sg).reduce((a, b) => a + b, 0);
  return {
    holes: played.length, score, par, toPar: score - par, sg, sgTotal: total, expected: played.reduce((t, h) => t + holeExpected(h), 0),
    fairways: fwAtt ? { hit: fwHit, of: fwAtt } : null, gir: played.some((h) => !h.start) ? { hit: gir, of: played.filter((h) => !h.start && !h.pickedUp).length } : null,
    putts, penalties: pens, scrambling: scrAtt ? { made: scr, of: scrAtt } : null, upDowns: udAtt ? { made: udMade, of: udAtt } : null,
  };
}

/** Name for a hole score: Eagle, Birdie, Par, Bogey … */
export function scoreName(strokes, par) {
  const d = strokes - par;
  return d <= -3 ? "Albatross" : d === -2 ? (strokes === 1 ? "Ace" : "Eagle") : d === -1 ? (strokes === 1 ? "Ace" : "Birdie") : d === 0 ? "Par" : d === 1 ? "Bogey" : d === 2 ? "Double" : `+${d}`;
}
