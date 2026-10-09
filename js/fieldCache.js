// Every player's rows in a data file, for the admin (Analyze, reports, a player's portal seen as admin).
//
// Loading 780+ players from Firestore takes a while and costs a read per piece, so:
//   1. this tab keeps them in memory (switching pages or players reloads nothing);
//   2. this device keeps a copy in IndexedDB, tagged with when the file was uploaded, so a page refresh
//      reads it from the device instead of Firestore. A new upload of the file changes the tag and the
//      copy is replaced the next time it's opened. Copies of older files are cleared out.
//   3. when it does go to Firestore, each player is one request (no record read first), 16 at a time.
import { getDatasetRecord, getDatasetRowsListed } from "./store.js";

const DB_NAME = "ta-cache", STORE = "datasets", PREFIX = "ds:";
const FORMAT = 1; // bump if the stored shape changes
const memory = new Map(); // datasetId -> { version, players: Map<key, { label, rows }> }
const inflight = new Map(); // datasetId|version -> Promise

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const dbh = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = dbh.transaction(STORE, mode), st = tx.objectStore(STORE);
      let out;
      Promise.resolve(fn(st, (v) => { out = v; })).catch(reject);
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { dbh.close(); }
}
const readCopy = (id) => idb("readonly", (st, done) => { const r = st.get(PREFIX + id); r.onsuccess = () => done(r.result || null); }).catch(() => null);
const writeCopy = (id, value) => idb("readwrite", (st) => {
  st.put(value, PREFIX + id);
  const keys = st.getAllKeys(); // this device keeps one data file's copy per file id; drop the rest of the old ones
  keys.onsuccess = () => { for (const k of keys.result) if (String(k).startsWith(PREFIX) && k !== PREFIX + id && !memory.has(String(k).slice(PREFIX.length))) st.delete(k); };
}).catch((err) => console.warn("Couldn't keep a copy of the data on this device", err));

const versionOf = (ds) => ds?.uploadedAt?.toMillis?.() ?? null;
const nameOf = (ds, key) => ds?.playerNames?.[key] || key.replace(/^c_/, "");

/**
 * Every player's { label, rows } in the file, keyed by clientKey (in the file's player order).
 * ds: the file's catalogue record when the caller has it (saves a read). onProgress(done, total) while
 * loading from Firestore; not called when the copy on this device is used.
 */
export async function loadDatasetPlayers(datasetId, { ds = null, onProgress = null } = {}) {
  if (!ds) ds = await getDatasetRecord(datasetId);
  if (!ds) return { players: new Map(), from: "none" };
  const version = versionOf(ds), keys = ds.clientKeys || [];
  const mem = memory.get(datasetId);
  if (mem && version != null && mem.version === version && !mem.failed?.length) return { players: mem.players, from: "memory" };
  const flightKey = `${datasetId}|${version}`;
  if (inflight.has(flightKey)) return inflight.get(flightKey);
  const job = (async () => {
    // on this device?
    if (version != null) {
      const copy = await readCopy(datasetId);
      if (copy && copy.format === FORMAT && copy.version === version && copy.players?.length === keys.length) {
        const players = new Map(copy.players.map(([k, label, rows]) => [k, { label: nameOf(ds, k) || label, rows }]));
        memory.set(datasetId, { version, players });
        return { players, from: "device" };
      }
    }
    // from Firestore (after a load where some players failed, only those are fetched again)
    const retry = mem && version != null && mem.version === version && mem.failed?.length ? mem : null;
    const players = retry ? retry.players : new Map(keys.map((k) => [k, null]));
    const queue = retry ? [...retry.failed] : [...keys];
    const failedKeys = [];
    let done = retry ? keys.length - queue.length : 0, error = null;
    const next = async () => {
      while (queue.length) {
        const key = queue.shift();
        try { players.set(key, { label: nameOf(ds, key), rows: await getDatasetRowsListed(key, datasetId) }); }
        catch (err) { failedKeys.push(key); error = error || err; players.set(key, { label: nameOf(ds, key), rows: [] }); }
        done++;
        onProgress?.(done, keys.length);
      }
    };
    await Promise.all(Array.from({ length: 16 }, next));
    if (failedKeys.length) {
      // keep what did load (so a redraw doesn't fetch everyone again) and say who didn't, and why
      if (version != null) memory.set(datasetId, { version, players, failed: failedKeys });
      return { players, from: "network", failed: failedKeys, error };
    }
    if (version != null) {
      memory.set(datasetId, { version, players });
      // saved after the page has drawn, so it never slows this load down
      setTimeout(() => writeCopy(datasetId, { format: FORMAT, version, savedAt: Date.now(), players: [...players].map(([k, p]) => [k, p.label, p.rows]) }), 1500);
    }
    return { players, from: "network" };
  })();
  inflight.set(flightKey, job);
  try { return await job; } finally { inflight.delete(flightKey); }
}

/**
 * Phones and tablets (a touch screen with no mouse): their browsers stop a page that holds too much (iPhone
 * Safari reloads it), and every player's full rows of a big file is far more than that. On these, Analyze and
 * the reports use the shared field summary for everyone else and load full rows only for the player picked.
 */
export function isLiteDevice() {
  try {
    const touchOnly = matchMedia("(hover: none) and (pointer: coarse)").matches;
    const lowMem = typeof navigator !== "undefined" && navigator.deviceMemory && navigator.deviceMemory < 4;
    return !!(touchOnly || lowMem);
  } catch { return false; }
}

/** Why Firestore didn't return something, in plain words. */
export function loadErrorText(err) {
  const code = String(err?.code || err?.message || "");
  if (/resource-exhausted|quota/i.test(code)) return "Firestore's daily read limit was reached (the free plan allows 50,000 reads a day); it resets at midnight Pacific";
  if (/permission-denied/i.test(code)) return "Firestore refused the read (check the published rules)";
  if (/unavailable|network|offline|deadline/i.test(code)) return "the connection dropped";
  return code ? `Firestore said: ${code}` : "Firestore didn't return them";
}
/** One player's rows, fetched again (e.g. after a load where they failed). */
export async function reloadPlayerRows(datasetId, key) {
  const rows = await getDatasetRowsListed(key, datasetId);
  const mem = memory.get(datasetId);
  if (mem) { const p = mem.players.get(key); mem.players.set(key, { label: p?.label || key, rows }); if (mem.failed) mem.failed = mem.failed.filter((k) => k !== key); }
  return rows;
}

/** Forget this device's copies (e.g. on sign-out). */
export async function clearDatasetCopies() {
  memory.clear();
  await idb("readwrite", (st) => { st.clear(); }).catch(() => {});
}
