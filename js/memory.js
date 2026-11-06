// (update 556) Memory let go when you switch pages. The big things kept while the app is open (every player's rows, the
// prepared field, the lie / distance detail, the course maps) are freed when the page you go to doesn't use them, so they
// don't pile up until the phone, or Safari on a computer, reloads the page. Each module that keeps one registers how to
// free it here (so this file loads none of them).
//   Groups: "stats" (Leaderboards, Player Stats, My Stats, and on a computer the other pages that use the field: the
//   Watchlist, Compare, Rankings, Product Usage), "maps" (Course Prep, Course History). Anything else: its own.
//   On a phone only Leaderboards, Player Stats and My Stats share; every other switch frees everything.
const freers = []; // [{ group, what, fn }]
/** Register how to free something kept for a group of pages. */
export function onFree(group, what, fn) { freers.push({ group, what, fn }); }
const phone = () => { try { return matchMedia("(hover: none) and (pointer: coarse)").matches; } catch { return false; } };
const STATS = ["admin-analyze", "admin-player-stats", "dashboard", "player-stats"];
const STATS_WIDE = [...STATS, "watchlist", "comparisons", "leaderboards", "product-usage", "live"];
const MAPS = ["course-prep", "course-reports"];
const groupOf = (routeId) => ((phone() ? STATS : STATS_WIDE).includes(routeId) ? "stats" : MAPS.includes(routeId) ? "maps" : `page:${routeId}`);
let lastGroup = null;
/** Called by the router as a page opens: frees what the last group of pages kept and this one doesn't use. */
export function freeFor(routeId) {
  const g = groupOf(routeId), prev = lastGroup;
  lastGroup = g;
  if (prev == null || prev === g) return;
  const done = [];
  for (const f of freers) if (f.group !== g) { try { if (f.fn() !== false) done.push(f.what); } catch { /* */ } }
  if (done.length) import("./perf.js").then((p) => p.bootLog(`freed for ${routeId}: ${[...new Set(done)].join(", ")}`)).catch(() => {});
}
