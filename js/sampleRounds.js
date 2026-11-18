// (update 863) Sample rounds for "Me" (the admin's own entered rounds): 10 finished rounds, shot by shot, at the tour's
// courses (their par and yardage from the course files, "Tour" tees), a few played twice, spread over the last few months.
// A steady low-handicap game: about 2-6 over par. Each is marked sample: true so they can all be taken out again.
import { createRound, updateRound, deleteRound } from "./rounds.js";

const iso = (d) => d.toISOString().slice(0, 10);
const clubFor = (yds) => (yds >= 215 ? ["3 Wood", "Fairway"] : yds >= 195 ? ["4 Hybrid", "Hybrid"] : yds >= 180 ? ["4 Iron", "Iron"] : yds >= 168 ? ["5 Iron", "Iron"] : yds >= 156 ? ["6 Iron", "Iron"] : yds >= 144 ? ["7 Iron", "Iron"] : yds >= 132 ? ["8 Iron", "Iron"] : yds >= 120 ? ["9 Iron", "Iron"] : yds >= 105 ? ["PW", "Wedge"] : yds >= 85 ? ["50°", "Wedge"] : yds >= 60 ? ["54°", "Wedge"] : ["58°", "Wedge"]);

/** one hole's strokes, as Enter New Round saves them (each starts where the last finished; the green in feet) */
export function simHole(par, yards, rnd) {
  const g = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 1.22; };
  const out = [], push = (s, club) => out.push({ ...s, ...(club ? { club: club[0], clubCat: club[1] } : {}), open: false });
  let lie = "Tee box", d = yards || (par === 3 ? 175 : par === 4 ? 410 : 545);
  if (par >= 4) {
    const carry = Math.min(d - 40, 262 + g() * 18), r = rnd(), end = r < 0.56 ? "Fairway" : r < 0.9 ? "Rough" : "Bunker";
    const left = Math.max(40, Math.round(d - carry)); push({ startLie: lie, startDist: d, endLie: end, endDist: left }, ["Driver", "Driver"]); lie = end; d = left;
    if (par === 5 && d > 250) { const lay = Math.round(85 + rnd() * 40), e2 = rnd() < 0.7 ? "Fairway" : "Rough"; push({ startLie: lie, startDist: d, endLie: e2, endDist: lay }, ["3 Wood", "Fairway"]); lie = e2; d = lay; }
  }
  let ft = null, guard = 0;
  while (ft == null && guard++ < 6) {
    if (d > 45) { // an approach
      const pGreen = Math.max(0.15, Math.min(0.9, 1.0 - d / 330 - (lie === "Rough" ? 0.12 : lie === "Bunker" ? 0.22 : 0)));
      if (rnd() < pGreen) { const f = Math.max(2, Math.round((d * 0.105 + g() * 6) * (0.75 + rnd() * 0.5))); push({ startLie: lie, startDist: d, endLie: "Green", endDist: f }, clubFor(d)); ft = f; }
      else { const e = rnd() < 0.72 ? "Rough" : "Bunker", left = Math.round(6 + rnd() * 22); push({ startLie: lie, startDist: d, endLie: e, endDist: left }, clubFor(d)); lie = e; d = left; }
    } else { // around the green
      if (rnd() < 0.02) { push({ startLie: lie, startDist: d, endLie: "Holed", endDist: 0 }, ["58°", "Wedge"]); return out; }
      const f = Math.max(1, Math.round(3 + rnd() * 9 + d * 0.18 + (lie === "Bunker" ? 4 : 0))); push({ startLie: lie, startDist: d, endLie: "Green", endDist: f }, [lie === "Bunker" ? "58°" : "54°", "Wedge"]); ft = f;
    }
  }
  // putts (feet)
  for (let n = 0; n < 5; n++) {
    const make = ft < 3 ? 0.98 : ft < 5 ? 0.84 : ft < 8 ? 0.6 : ft < 12 ? 0.38 : ft < 20 ? 0.2 : ft < 30 ? 0.1 : 0.05;
    if (rnd() < make || n === 4) { push({ startLie: "Green", startDist: ft, endLie: "Holed", endDist: 0 }, ["Putter", "Putter"]); break; }
    const left = Math.max(1, Math.round(ft * (0.05 + rnd() * 0.08) + rnd() * 1.5)); push({ startLie: "Green", startDist: ft, endLie: "Green", endDist: left }, ["Putter", "Putter"]); ft = left;
  }
  return out;
}

/** the courses to use: the tour's courses with a full scorecard (par for every hole) */
export const tourCards = (metas) => (metas || []).filter((m) => Array.isArray(m.par) && m.par.length >= 18 && m.par.slice(0, 18).every((p) => p >= 3 && p <= 5))
  .map((m) => ({ name: m.name, holes: m.par.slice(0, 18).map((p, i) => ({ n: i + 1, par: p, yards: m.yards?.[i] ? Math.round(m.yards[i]) : null, hcp: null })), events: (m.events || []).map((e) => e?.name || e).filter(Boolean) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** the plan: 10 rounds, the dates and courses (a few played twice), without saving anything */
export function samplePlan(cards, n = 10, seed = 863, today = new Date()) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  if (!cards.length) return [];
  const order = cards.map((c) => [rnd(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]), distinct = Math.min(order.length, Math.max(1, n - 2)), use = order.slice(0, distinct), list = [...use];
  // the repeats: a couple of those courses played again (different ones while there are enough)
  const again = use.map((c) => [rnd(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); for (let i = 0; list.length < n; i++) list.push(again[i % again.length]);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } // (spread through the months)
  const days = list.map((_, i) => Math.round(i * (95 / n) + rnd() * 6)).sort((a, b) => b - a);
  return list.map((c, i) => { const d = new Date(today.getTime() - days[i] * 864e5); return { course: c, date: iso(d), seed: Math.floor(rnd() * 1e9) + 1 }; });
}

/** save them (onStatus: a line for the page) */
export async function addSampleRounds({ playerKey, playerLabel, ownerUid, ownerName, metas, onStatus = () => {} }) {
  const plan = samplePlan(tourCards(metas));
  if (!plan.length) throw new Error("No tour courses with a full scorecard yet (upload a course's shot data first).");
  let i = 0;
  for (const p of plan) {
    onStatus(`Adding sample round ${++i} of ${plan.length}: ${p.course.name}…`);
    let s = p.seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const shots = {}; for (const h of p.course.holes) shots[`h${h.n}`] = simHole(h.par, h.yards, rnd);
    const id = await createRound({ playerKey, playerLabel, ownerUid, ownerName, date: p.date, course: p.course.name, location: "", tees: "Tour", type: "practice", tournament: "", tour: "", holes: p.course.holes, mode: "full" });
    await updateRound(playerKey, id, { shots, status: "complete", sample: true });
  }
  return plan.length;
}
/** take every sample round out again */
export async function removeSampleRounds(playerKey, rounds) { const xs = (rounds || []).filter((r) => r.sample); for (const r of xs) await deleteRound(playerKey, r.id); return xs.length; }
