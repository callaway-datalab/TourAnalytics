/*
 * The field's per-round lie / distance detail in Cloud Storage (see fieldDetail.js for the file format),
 * and the soft budget pause.
 *
 *   fieldDetail/{datasetId}/{year}.bin.gz   one gzipped file per year of the data file
 *   fieldStats/{datasetId}.detail           { years, sourceUploadedAt, bytes, format } (which files are current)
 *   config/billing                          { paused } set by the budget function when the monthly budget is
 *                                           reached; while it's on, nothing is downloaded from Cloud Storage
 *                                           and the app falls back to the round totals (as before Blaze)
 *
 * Each device keeps the files it downloaded (IndexedDB), so a file is fetched once per upload, not per visit.
 */
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { app, db } from "./firebase-init.js";
import { encodeFieldDetail, decodeFieldDetail, mergeYears, gzip, gunzip } from "./fieldDetail.js";

const SDK = "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";
const cfg = window.PORTAL_CONFIG || {};
// the default bucket of a project set up on Blaze: <project id>.firebasestorage.app (config can name another)
const BUCKET = cfg.fieldDetailBucket || `${cfg.firebase?.projectId}.firebasestorage.app`;
const FORMAT = 2; // (update 243: each shot's club model and ball kept, for the club and ball breakdowns)

let storageP = null;
function storage() {
  storageP ||= import(SDK).then((m) => ({ m, s: m.getStorage(app, `gs://${BUCKET}`) }));
  return storageP;
}
const pathOf = (datasetId, year) => `fieldDetail/${datasetId}/${year || "none"}.bin.gz`;

/* ---------------- budget pause ---------------- */

/** { paused, period, cost, budget } — paused when the budget function has switched downloads off. */
export async function billingState() {
  try { const s = await getDoc(doc(db, "config", "billing")); return s.exists() ? { paused: s.data().paused === true, ...s.data() } : { paused: false }; }
  catch { return { paused: false }; }
}

/** Admin: switch downloads back on. (The budget function won't pause again in the same budget month.) */
export async function resumeDownloads() {
  const st = await billingState();
  await setDoc(doc(db, "config", "billing"), { paused: false, resumedPeriod: st.period ?? null, resumedAt: serverTimestamp() }, { merge: true });
}

/* ---------------- publish (admin, on a computer) ---------------- */

/** When the detail was last built from the data file (ms), or null if it never was (or is an old format). */
export async function detailSource(datasetId) {
  const snap = await getDoc(doc(db, "fieldStats", datasetId));
  const d = snap.exists() ? snap.data().detail : null;
  return d && d.format === FORMAT ? d.sourceUploadedAt ?? 0 : null;
}

/** Pack every player's rounds and save them, one file per year. players: [{ key, name, rounds }]. */
export async function publishFieldDetail(datasetId, players, sourceUploadedAt) {
  if ((await billingState()).paused) return { skipped: "paused" };
  const { m, s } = await storage();
  const files = encodeFieldDetail(players);
  let bytes = 0;
  for (const f of files) {
    const gz = await gzip(f.bytes);
    bytes += gz.length;
    await m.uploadBytes(m.ref(s, pathOf(datasetId, f.year)), gz, { contentType: "application/octet-stream" });
  }
  const years = files.map((f) => f.year);
  // (a year that's no longer in the file: its old detail goes)
  try {
    const list = await m.listAll(m.ref(s, `fieldDetail/${datasetId}`));
    for (const it of list.items) if (!years.some((y) => it.fullPath === pathOf(datasetId, y))) await m.deleteObject(it);
  } catch (err) { console.warn("Couldn't tidy old detail files", err); }
  await setDoc(doc(db, "fieldStats", datasetId), { detail: { years, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: FORMAT, builtAt: serverTimestamp() } }, { merge: true });
  return { years, bytes };
}

/** Delete a data file's detail (when the data file is deleted). */
export async function deleteFieldDetail(datasetId) {
  try {
    const { m, s } = await storage();
    const list = await m.listAll(m.ref(s, `fieldDetail/${datasetId}`));
    for (const it of list.items) await m.deleteObject(it);
  } catch (err) { console.warn("Couldn't delete the detail files", err); }
}

/* ---------------- read (phones, players' portals, reports) ---------------- */

/**
 * Every player's rounds with lie / distance detail, or { players: null, why } when there's none to use:
 *   why: "none" (never built), "stale" (built from an older upload), "paused" (budget reached), "error".
 * uploadedAt: the data file's upload time (ms): detail built from an older upload isn't used.
 */
const shared = { key: null, promise: null, result: null }; // (update 296)
/** (update 325) what the shared detail holds: players, rounds and shots */
export function detailInfo() {
  const ps = shared.result?.players;
  if (!ps) return { players: 0, rounds: 0, shots: 0 };
  let rounds = 0, shots = 0; const tables = new Set();
  for (const p of ps) { rounds += p.rounds.length; for (const r of p.rounds) { shots += r.shots?.length || 0; if (r.shots?.t) tables.add(r.shots.t); if (r.obs?.t) tables.add(r.obs.t); } }
  let bytes = 0; for (const t of tables) bytes += (t.I?.byteLength || 0) + (t.F?.byteLength || 0); // (update 327: the packed columns)
  return { players: ps.length, rounds, shots, mb: tables.size ? Math.round(bytes / 1048576) : null };
}
export async function getFieldDetail(datasetId, uploadedAt, { onProgress = null } = {}) {
  try {
    const snap = await getDoc(doc(db, "fieldStats", datasetId));
    const d = snap.exists() ? snap.data().detail : null;
    if (!d || d.format !== FORMAT || !d.years?.length) return { players: null, why: "none" };
    if (uploadedAt && (d.sourceUploadedAt ?? 0) < uploadedAt) return { players: null, why: "stale" };
    // (update 296) one copy in memory, shared by every page that asks (Watchlist, Stats, Leaderboards, Cal, reports):
    // each used to unpack its own, and a phone ran out of memory and reloaded the page ("A problem repeatedly occurred")
    const mk = `${datasetId}|${d.sourceUploadedAt}|${d.years.join(",")}`;
    if (shared.key !== mk || !shared.promise) {
      shared.key = mk; shared.result = null; // (the previous copy, if any, is let go)
      shared.promise = (async () => {
        const lists = [];
        let paused = null;
        for (const [i, year] of d.years.entries()) {
          const key = `${datasetId}|${year}|${d.sourceUploadedAt}`;
          let gz = await cacheGet(key);
          if (!gz) {
            paused ??= (await billingState()).paused;
            if (paused) return { players: null, why: "paused" };
            const { m, s: st } = await storage();
            gz = new Uint8Array(await m.getBytes(m.ref(st, pathOf(datasetId, year))));
            await cachePut(key, gz, datasetId);
          }
          lists.push(decodeFieldDetail(await gunzip(gz)));
          onProgress?.(i + 1, d.years.length);
        }
        const out = { players: mergeYears(lists), why: null };
        shared.result = out; // (update 325: for the admin's Performance readout)
        return out;
      })();
      shared.promise.then((r) => { if (!r.players && shared.key === mk) { shared.key = null; shared.promise = null; } }, () => { if (shared.key === mk) { shared.key = null; shared.promise = null; } });
    } else onProgress?.(d.years.length, d.years.length);
    return await shared.promise;
  } catch (err) {
    console.error("Couldn't load the field detail", err);
    return { players: null, why: err?.code === "storage/unauthorized" ? "paused" : "error" };
  }
}

/* ---------------- this device's copies ---------------- */

const DB_NAME = "ta-detail", STORE = "files";
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => { const dbh = req.result; dbh.onversionchange = () => dbh.close(); resolve(dbh); }; // (so a sign-out's delete isn't held up)
    req.onerror = () => reject(req.error);
  });
}
async function cacheGet(key) {
  try {
    const dbh = await openDb();
    const got = await new Promise((resolve) => { const r = dbh.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
    dbh.close();
    return got;
  } catch { return null; }
}

/**
 * Once per visit: drop copies of detail that's no longer current — its data file was deleted, or the detail
 * was rebuilt from a newer upload (or no longer has that year). Kept as they are when Firestore can't be reached.
 */
export async function pruneDetailCopies() {
  let dbh;
  try { dbh = await openDb(); } catch { return; }
  try {
    const keys = await new Promise((resolve) => { const r = dbh.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
    const ids = [...new Set(keys.map((k) => String(k).split("|")[0]))];
    const gone = [];
    for (const id of ids) {
      let d;
      try { const snap = await getDoc(doc(db, "fieldStats", id)); d = snap.exists() ? snap.data().detail : null; }
      catch { continue; } // (offline or not allowed: leave this file's copies alone)
      for (const k of keys) {
        const [kid, year, src] = String(k).split("|");
        if (kid !== id) continue;
        const current = d && d.format === FORMAT && String(d.sourceUploadedAt) === src && (d.years || []).map(String).includes(year);
        if (!current) gone.push(k);
      }
    }
    if (gone.length) await new Promise((resolve) => { const tx = dbh.transaction(STORE, "readwrite"); for (const k of gone) tx.objectStore(STORE).delete(k); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); });
    return gone.length;
  } finally { dbh.close(); }
}
async function cachePut(key, bytes, datasetId) {
  try {
    const dbh = await openDb();
    await new Promise((resolve) => {
      const tx = dbh.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
      // (the same file's older copies go: one copy per year of each data file)
      const year = key.split("|")[1];
      const all = st.getAllKeys();
      all.onsuccess = () => { for (const k of all.result) if (String(k).startsWith(`${datasetId}|${year}|`) && k !== key) st.delete(k); st.put(bytes, key); };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
    dbh.close();
  } catch { /* (no copy kept: it's downloaded again next time) */ }
}
