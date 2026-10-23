// (update 312) Everything the pages need, loaded once while the app opens (the course photo, the ball round the cup and
// "Loading Data…"), so moving between pages afterwards doesn't wait on the network each time:
//   • the newest strokes-gained file's field summary and its lie / distance detail (Watchlist, Stats, Leaderboards, Cal)
//   • the admin: every name (users, codes, files), every entered round (kept live), and on a computer every player's rows
//   • a player: their own rows
// Each piece lands in the cache the pages already read from (store.js, fieldStore.js, fieldCache.js, rounds.js).
import { isShotData, detectColumns } from "./sg.js";

const once = (watch) => new Promise((res) => {
  let un = null, done = false;
  const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); };
  try { un = watch(fin); } catch { fin([]); }
  setTimeout(() => fin([]), 10000);
});
const newestShot = (list) => (list || []).filter((d) => isShotData(detectColumns(d.columns || [])))
  .sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0] || null;

/** Load it all. onStep(text): what's loading, for the loading screen. Never throws. */
export async function warmUp(state, onStep = () => {}) {
  try {
    const store = await import("./store.js");
    const { getFieldDetail } = await import("./fieldStore.js");
    const jobs = [];
    let ds = null;
    if (state.isAdmin) {
      jobs.push(store.adminAllClients());
      jobs.push(import("./rounds.js").then((m) => m.liveAllRounds()));
      ds = newestShot(await once((cb) => store.watchAdminDatasets(cb)));
    } else {
      const keys = state.isTeam ? Object.keys(state.teamAccess || {}) : [state.profile?.clientKey].filter(Boolean);
      if (keys[0]) ds = newestShot(await once((cb) => store.watchClientDatasets(keys[0], cb)));
      if (ds) {
        // a player's own rows (their Stats); everyone else's come from the field detail
        for (const k of state.isTeam ? [] : keys) jobs.push(store.getDatasetMeta(k, ds.id).then((m) => store.getDatasetRows(k, ds.id, m.chunkCount)).catch(() => null));
      }
    }
    if (ds) {
      const up = ds.uploadedAt?.toMillis?.() ?? 0;
      jobs.push(store.getFieldStats(ds.id).catch(() => null));
      jobs.push(getFieldDetail(ds.id, up, { onProgress: (i, n) => onStep(n > 1 ? `Loading Data… (${i} of ${n} seasons)` : "") }));
      // the admin on a computer: every player's full rows, for Stats and Leaderboards (phones use the detail instead)
      if (state.isAdmin) {
        const fc = await import("./fieldCache.js");
        if (!fc.isLiteDevice()) jobs.push(fc.loadDatasetPlayers(ds.id, { ds, onProgress: (i, n) => onStep(`Loading Data… (${i} of ${n} players)`) }).catch(() => null));
      }
    }
    await Promise.allSettled(jobs);
  } catch (err) { console.warn("Preload", err); }
}
