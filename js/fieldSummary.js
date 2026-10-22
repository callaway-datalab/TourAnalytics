// (update 259) The whole field, for Live Feed and Callie: the newest strokes-gained data file this person can see,
// and its published field summary (every player's rounds: strokes gained by category and the other stats, round
// by round). The same numbers Leaderboards uses; one read of the summary, kept for the visit.
//   who sees which file: the admin, the newest of all; a coach or analyst, their players'; a player, their own;
//   the admin looking at someone's portal, that person's.
import { getState } from "./auth.js";
import { effectiveTeam } from "./preview.js";
import { teamLabels, plainName } from "./names.js";
import { watchAdminDatasets, watchClientDatasets, getFieldStats } from "./store.js";
import { detectColumns, isShotData, summaryPlayers } from "./sg.js";

const newestShot = (list) => (list || []).filter((d) => isShotData(detectColumns(d.columns || [])))
  .sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0] || null;

/** Watch the newest strokes-gained file: cb(dataset | null) now and after every upload. Returns stop(). */
export function watchNewestDataset(cb) {
  const state = getState(), team = effectiveTeam(state), pc = window.__previewClient;
  if (state.isAdmin && !team.preview && !pc?.key) return watchAdminDatasets((list) => cb(newestShot(list)));
  const access = team.isTeam ? team.teamAccess || {} : {};
  const key = pc?.key || (team.isTeam ? Object.keys(access).sort()[0] : state.profile?.clientKey) || null;
  if (!key) { cb(null); return () => {}; }
  return watchClientDatasets(key, (list) => cb(newestShot(list)));
}

/** Names as the portal shows them (a coach sees their own labels for their players). */
export function nameOf(key, name) {
  const team = effectiveTeam(getState());
  const tl = team.isTeam ? teamLabels(team.teamAccess || {}) : null;
  return tl?.get(key) ?? plainName(name || String(key).replace(/^c_/, ""));
}

const summaries = new Map(); // `${id}|${uploadedAt}` → Promise<field>
/** The field for a data file: [{ key, name, rounds }] (rounds as summaryPlayers makes them). */
export function fieldOf(ds) {
  const v = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
  if (!summaries.has(v)) {
    summaries.set(v, getFieldStats(ds.id).then((s) => summaryPlayers(s).map((p) => ({ ...p, name: nameOf(p.key, p.name) })).filter((p) => p.rounds.length))
      .catch((err) => { summaries.delete(v); throw err; }));
  }
  return summaries.get(v);
}

/** Once: the newest file and its field ({ ds, field, uploadedAt } or null when there's no file). */
export function currentField() {
  return new Promise((resolve, reject) => {
    let stop = () => {}, done = false;
    stop = watchNewestDataset(async (ds) => {
      if (done) return; done = true;
      setTimeout(() => stop(), 0);
      if (!ds) { resolve(null); return; }
      try { resolve({ ds, field: await fieldOf(ds), uploadedAt: ds.uploadedAt?.toMillis?.() ?? null }); } catch (e) { reject(e); }
    });
  });
}
