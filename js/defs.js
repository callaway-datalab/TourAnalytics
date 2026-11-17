// (update 812) The site's shared definitions: one place for the windows, units, distance ranges, minimum samples and
// confidence rules every insight uses, so two cards can't count the same thing two ways.
//
//   Form           the last 12 rounds against the 12 before; on the DP World Tour (its numbers are whole events) the last
//                  3 events against the 3 before. A streak on the DP World Tour is counted in events.
//   Units          strokes gained per round (higher is better), strokes gained a shot (higher is better), score to par
//                  (lower is better). Every number names its unit.
//   Ranges         the distance ranges are the data's own ("140-160 yds", "<30 yds", ">25 ft"), never made up; a course's
//                  shots go in the range that holds their distance.
//   Samples        the least that's shown (below it a number is left out, not guessed).
//   Confidence     a difference is "clear" when Welch's t is 1.65+ (about 90% sure) with enough rounds on both sides.

/** the form window's size: 12 rounds, or 3 events where the numbers are whole events (the DP World Tour) */
export const FORM = { rounds: 12, events: 3 };
export const formN = (byEvent) => (byEvent ? FORM.events : FORM.rounds);
export const isDP = (t) => /^(dpwt|dp world tour)$/i.test(String(t || "").trim());

/** the form window for these rounds (or the tour picked): { ev, n, unit, label, lastLabel, beforeLabel } */
export function formWindow(rounds, tourPick = null) {
  const ev = tourPick && tourPick !== "__all" ? isDP(tourPick) : (rounds || []).some((r) => isDP(r.tour));
  const n = formN(ev), unit = ev ? "event" : "round";
  return { ev, n, unit, label: `${n} ${unit}s`, lastLabel: `Last ${n}${ev ? " events" : ""}`, beforeLabel: `${n}${ev ? " events" : ""} before` };
}
/** the rounds in units (per round each; on the DP World Tour an event each), oldest first */
export function formUnits(rounds, ev, eventsOf) { return ev ? eventsOf(rounds).map((e) => e.rs) : rounds.map((r) => [r]); }
/** the last n units against the n before: { n, lbl, last, prev } (rounds), or null when there aren't 2n */
export function formSplit(rounds, tourPick, eventsOf) {
  const w = formWindow(rounds, tourPick), u = formUnits(rounds, w.ev, eventsOf); if (u.length < 2 * w.n) return null;
  return { n: w.n, lbl: w.label, ev: w.ev, last: u.slice(-w.n).flat(), prev: u.slice(-2 * w.n, -w.n).flat() };
}

export const UNIT = {
  sgRound: "strokes gained per round", sgShot: "strokes gained a shot", toPar: "score to par (lower is better)",
};
export const sg2 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
export const sg3 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`);

/** the least that's shown */
export const MIN = {
  seasonRounds: 8,        // a player's season (ranks, steadiness)
  rangeShotsSeason: 25,   // a distance range over a season (sweet spot, leak)
  rangeShotsForm: 10,     // a distance range in each of the two form windows
  rangeShotsLeak: 8,      // a range in the Where to Improve breakdown
  courseRangeShots: 10,   // a distance range at a course (all players)
  courseTopShots: 5,      // ... of which the top 10's
  coursePlayerShots: 3,   // ... a player's own there
  holePlays: 8,           // a player's hole at a course
  fieldPlayers: 10,       // a ranking needs this many players
};

/** a distance label's range [lo, hi): "140-160 yds" → [140, 160]; "<30 yds" → [0, 30]; ">25 ft" / "250+" → [25, ∞) */
export function rangeOf(label) {
  const t = String(label); let m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(t); if (m) return [Number(m[1]), Number(m[2])];
  m = /^\s*[<≤]\s*(\d+)/.exec(t); if (m) return [0, Number(m[1])];
  m = /^\s*[>≥]\s*(\d+)|(\d+)\s*\+/.exec(t); if (m) return [Number(m[1] || m[2]), 1e9];
  return null;
}
/** the data's own ranges for a part of the game, from any rounds with shots: [[label, [lo, hi]]], nearest first */
export function dataRanges(cat, roundLists) {
  const seen = new Map();
  for (const rs of roundLists) for (const r of rs || []) for (const s of r.shots || []) if (s.cat === cat && s.dist && !seen.has(s.dist)) seen.set(s.dist, rangeOf(s.dist));
  return [...seen].filter(([, g]) => g).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
}
export const rangeFor = (ranges, d) => ranges.find(([, g]) => d >= g[0] && d < g[1])?.[0] || null;

/** Welch's t for two sets of values; "clear" at 1.65+ with minN on both sides */
export function clearDiff(a, b, minN = 8) {
  const m = (x) => x.reduce((t, v) => t + v, 0) / x.length, sd = (x) => { if (x.length < 2) return 0; const mm = m(x); return Math.sqrt(x.reduce((t, v) => t + (v - mm) ** 2, 0) / (x.length - 1)); };
  if (!a.length || !b.length) return { clear: false, t: 0, d: 0 };
  const d = m(a) - m(b), t = Math.abs(d) / Math.max(1e-6, Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length));
  return { clear: a.length >= minN && b.length >= minN && t >= 1.65, t, d };
}
