// (update 834) Official finishes, from the PGA Tour leaderboards the live feed saves (results/{R|H}-{year}.json), for every
// place that says where a player finished: the Stats hero's wins and top 10s, the Watchlist's latest finish and its wins and
// top 10s, Course Fit's history, Best & worst tournaments, Home's results. They're read once a visit (this season and last,
// both tours); until they're in, or for an event they don't have (the DP World Tour, older seasons), each place keeps its
// own count by strokes gained among the players in the stats file, as before.
import * as PI from "./playerInsights.js";

let ready = false, loading = null; const subs = new Set();
export const officialReady = () => ready;
/** load the results (once); each place that asked to be told is drawn again when they're in */
export function preloadOfficial() {
  if (loading) return loading;
  const y = new Date().getFullYear();
  loading = Promise.all([PI.ensureResults("R", [y - 1, y]), PI.ensureResults("H", [y - 1, y])]).catch(() => null)
    .then(() => { ready = true; for (const f of subs) { try { f(); } catch (e) { console.warn(e); } } subs.clear(); });
  return loading;
}
export const whenOfficial = (f) => { if (ready) return; subs.add(f); preloadOfficial(); };
const num = (pos) => { const p = String(pos || "").toUpperCase(); if (p === "1") return 1; const m = /\d+/.exec(p); return m && !/^(CUT|MC|W\/?D|DQ|DNS|MDF)/.test(p) ? Number(m[0]) : null; };
/** { pos ("T5"), text ("Won", "T5", "Missed cut"), num (5; null for a missed cut or withdrawal), of }, or null (not in the results) */
export function officialFinish(event, year, playerName, tour) {
  if (!ready || !event || !playerName) return null;
  const code = PI.tourCodeOf(tour); if (!code) return null;
  const o = PI.officialSync(event, String(year), playerName, code); if (!o?.pos) return null;
  // (update 834) a missed cut or withdrawal too (num null): shown as the finish, beside their strokes-gained rank for the rounds they played
  return { pos: o.pos, text: PI.posText(o.pos), num: num(o.pos), of: o.of };
}
