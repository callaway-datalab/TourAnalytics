/*
 * Practice in Analyze (update 139): every finished practice session, game and round becomes a "round" of shots
 * for the Stats dashboard — the same shape as Enter New Round's entered rounds — so strokes gained by category,
 * distance and lie (and the trends) work on practice too.
 */
import { distanceBucket } from "../roundCalc.js";
import { scoreShot, CATS } from "./model.js";
import { gameOf } from "./games.js";

const dayOf = (iso) => String(iso || "").slice(0, 10);

/** A player's practice sessions as prepared rounds (oldest first). */
export function practiceRounds(sessions) {
  const out = [];
  for (const s of sessions || []) {
    if (s.status !== "done" || s.cat === "BAG") continue;
    const shots = [];
    const add = (cat, sg, lie, dist, club = null) => { if (cat && sg != null && Number.isFinite(sg)) shots.push({ cat, sg, w: 1, lie: lie || null, dist, club, clubCat: club ? (club === "Driver" ? "Driver" : /wood|^\d+\s*w$/i.test(club) ? "Fairway Wood" : "Iron") : null }); };
    if (s.cat === "ROUND") {
      for (const h of s.holes || []) for (const x of h.shots || []) {
        const d = x.unit === "ft" || x.kind === "putt" ? x.startDist : x.startDist;
        add(x.rcat, x.sg, x.startLie === "Green" || x.unit === "ft" ? "Green" : x.startLie, distanceBucket(x.rcat, { startDist: d }, h.par), x.clubUsed || null);
      }
    } else {
      for (const x of s.shots || []) {
        if (!x.result) continue;
        const sg = x.sg ?? scoreShot(x);
        const cat = s.cat;
        add(cat, sg, x.kind === "putt" ? "Green" : x.startLie, distanceBucket(cat, { startDist: x.startDist }, x.par || 4), x.clubUsed || (cat === "OTT" ? x.club : null));
      }
    }
    if (!shots.length) continue;
    const g = gameOf(s);
    const event = g ? `Game · ${g.title}` : s.cat === "ROUND" ? `Course Prep · ${s.course?.name || "Round"}` : `Practice · ${CATS[s.cat]?.label || ""}`;
    const date = dayOf(s.startedAt);
    // the Session filter: Custom practice, Course Prep, Sim rounds, or the game
    const ptype = g ? `game:${g.title}` : s.cat === "ROUND" ? (s.mode === "sim" ? "sim" : "prep") : "custom";
    out.push({ key: s.id, date, event, roundNo: "", tour: "", year: date.slice(0, 4), shots, obs: [], has: new Set(["sg"]), ptype });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** A player's practice: their own (by their practice key), or — for their coach or the admin — theirs by player key. */
export async function loadPracticeFor(ownerKey) {
  const { listSessions } = await import("./store.js");
  return practiceRounds(await listSessions(ownerKey));
}
