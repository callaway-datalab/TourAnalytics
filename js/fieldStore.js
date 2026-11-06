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
import { bootLog } from "./perf.js"; // (update 535: start-up steps, for the Performance readout)

const SDK = "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";
const cfg = window.PORTAL_CONFIG || {};
// the default bucket of a project set up on Blaze: <project id>.firebasestorage.app (config can name another)
const BUCKET = cfg.fieldDetailBucket || `${cfg.firebase?.projectId}.firebasestorage.app`;
const FORMAT = 2; // (update 243: each shot's club model and ball kept, for the club and ball breakdowns)

/** (update 403) Ask the cloud (the data-import function) to rebuild a file's rankings and lie / distance detail from its
    saved rows: a small marker in incoming/_rebuild/, as tour_upload.py drops. Progress shows on Upload Data. */
export async function requestRebuild(datasetId, name = "") {
  const { m, s } = await storage();
  const statusId = `rebuild_${datasetId}_${Date.now()}`;
  await m.uploadBytes(m.ref(s, `incoming/_rebuild/${datasetId}.json`), new Blob([JSON.stringify({ datasetId })], { type: "application/json" }),
    { contentType: "application/json", customMetadata: { kind: "rebuild", datasetId, statusId, name: String(name || "").slice(0, 200) } });
  return statusId;
}

let storageP = null;
function storage() {
  storageP ||= import(SDK).then((m) => ({ m, s: m.getStorage(app, `gs://${BUCKET}`) }));
  return storageP;
}
const pathOf = (datasetId, year) => `fieldDetail/${datasetId}/${year || "none"}.bin.gz`;
/* (update 538) the detail split by tour: one file a tour and season (as the cloud's data-import writes it) */
export const tourSlug = (t) => String(t || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "none";
const pathOfT = (datasetId, tour, year) => `fieldDetail/${datasetId}/${tourSlug(tour)}~${year || "none"}.bin.gz`;
/** (update 538) The tour on screen (the Stats page's tour buttons set it); the detail loads only that tour's files. */
const LS_TOUR = "ta.tour";
export function setActiveTour(t) { try { if (t == null) localStorage.removeItem(LS_TOUR); else localStorage.setItem(LS_TOUR, String(t)); } catch { /* */ } }
export function activeTour() { try { return localStorage.getItem(LS_TOUR); } catch { return null; } }
const PHONE_PACKED_MAX = 5 * 1048576; // (a phone: at most this much packed detail, about 40 MB once unpacked; update 542: 5 MB, as 2025 alone (4.2 MB) loaded fine)

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
  // (update 538) a file a tour and season, as the cloud writes them
  const byTour = new Map();
  for (const p of players) { const rs = new Map(); for (const rd of p.rounds) { const t = rd.tour || ""; (rs.get(t) || rs.set(t, []).get(t)).push(rd); } for (const [t, rounds] of rs) (byTour.get(t) || byTour.set(t, []).get(t)).push({ ...p, rounds }); }
  let bytes = 0;
  const tours = {}, sizes = {}, paths = new Set(), allYears = new Set();
  for (const [t, ps] of byTour) {
    for (const f of encodeFieldDetail(ps)) {
      const gz = await gzip(f.bytes);
      bytes += gz.length;
      const path = pathOfT(datasetId, t, f.year); paths.add(path);
      await m.uploadBytes(m.ref(s, path), gz, { contentType: "application/octet-stream" });
      (tours[t] ||= []).push(f.year); sizes[`${t}|${f.year ?? ""}`] = gz.length; allYears.add(f.year);
    }
  }
  for (const t of Object.keys(tours)) tours[t].sort();
  const years = [...allYears].sort();
  // (the files no longer wanted: before the split, or a season gone)
  try {
    const list = await m.listAll(m.ref(s, `fieldDetail/${datasetId}`));
    for (const it of list.items) if (!paths.has(it.fullPath)) await m.deleteObject(it);
  } catch (err) { console.warn("Couldn't tidy old detail files", err); }
  await setDoc(doc(db, "fieldStats", datasetId), { detail: { years, tours, sizes, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: FORMAT, builtAt: serverTimestamp() } }, { merge: true });
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
// (update 556) let go away from the pages that use it (not while it's loading)
import("./memory.js").then((m) => m.onFree("stats", "lie / distance detail", () => { if (shared.promise && !shared.result) return false; shared.key = null; shared.promise = null; shared.result = null; })).catch(() => {});
/** (update 325) what the shared detail holds: players, rounds and shots */
export function detailInfo() {
  const ps = shared.result?.players;
  if (!ps) return { players: 0, rounds: 0, shots: 0 };
  let rounds = 0, shots = 0; const tables = new Set();
  for (const p of ps) { rounds += p.rounds.length; for (const r of p.rounds) { shots += r.shots?.length || 0; if (r.shots?.t) tables.add(r.shots.t); if (r.obs?.t) tables.add(r.obs.t); } }
  let bytes = 0; for (const t of tables) bytes += (t.I?.byteLength || 0) + (t.F?.byteLength || 0); // (update 327: the packed columns)
  return { players: ps.length, rounds, shots, mb: tables.size ? Math.round(bytes / 1048576) : null };
}
/**
 * (update 538) tour: which tour's detail. A file built by tour (detail.tours): that tour's files only. Not given: the tour
 * on screen (setActiveTour) on a phone, every tour on a computer. "all": every tour. A file built before the split: every
 * tour, one file a season (as before).
 * A phone loads only the newest seasons that fit in about 3.5 MB packed (about 30 MB unpacked): every season of a big file
 * was more than it could hold, and it reloaded the page. None fits: { players: null, why: "phone" }.
 */
export async function getFieldDetail(datasetId, uploadedAt, { onProgress = null, tour = undefined } = {}) {
  try {
    const snap = await getDoc(doc(db, "fieldStats", datasetId));
    const d = snap.exists() ? snap.data().detail : null;
    // (update 412) the cloud rebuild labelled its files format 1 by mistake (they're the same files): read those too
    if (!d || (d.format !== FORMAT && d.format !== 1) || !d.years?.length) return { players: null, why: "none" };
    if (uploadedAt && (d.sourceUploadedAt ?? 0) < uploadedAt) return { players: null, why: "stale" };
    // (update 296) one copy in memory, shared by every page that asks (Watchlist, Stats, Leaderboards, Cal, reports):
    // each used to unpack its own, and a phone ran out of memory and reloaded the page ("A problem repeatedly occurred")
    const phone = (() => { try { return matchMedia("(hover: none) and (pointer: coarse)").matches; } catch { return false; } })();
    const byYear = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    let want; // [{ tour, year, path, size }]
    if (d.tours && Object.keys(d.tours).length) {
      const tourList = Object.keys(d.tours);
      const sizeOfT = (t) => (d.tours[t] || []).reduce((n, y) => n + (d.sizes?.[`${t}|${y ?? ""}`] || 0), 0);
      const biggest = [...tourList].sort((a, b) => sizeOfT(b) - sizeOfT(a))[0];
      const pick = tour === "all" ? null : tour !== undefined && tour !== null && tourList.includes(String(tour)) ? String(tour) : phone ? (tourList.includes(activeTour()) ? activeTour() : biggest) : null;
      want = (pick == null ? tourList : [pick]).flatMap((t) => (d.tours[t] || []).map((y) => ({ tour: t, year: y, path: pathOfT(datasetId, t, y), size: d.sizes?.[`${t}|${y ?? ""}`] || 0 })));
      if (phone) {
        // the newest seasons first, while they fit
        const keep = [], newest = [...want].sort((a, b) => byYear(b.year, a.year));
        let tot = 0; for (const f of newest) { if (tot + f.size > PHONE_PACKED_MAX) break; keep.push(f); tot += f.size; }
        if (!keep.length) { const mb = (Math.min(...want.map((f) => f.size)) / 1048576).toFixed(1); bootLog(`detail skipped on this phone (${pick || "every tour"}: too big)`); return { players: null, why: "phone", reason: `tooBig|${pick || ""}|${mb}` }; }
        want = keep;
      }
      bootLog(`detail: ${pick ?? "every tour"} · ${want.map((f) => f.year).sort(byYear).join(", ")}`);
    } else {
      // (a file built before update 538: every tour in each season's file) a phone with a big file: none (update 537);
      // otherwise the newest two seasons (update 534)
      const bigFile = (() => { try { return localStorage.getItem("ta.bigData") === "1"; } catch { return false; } })();
      if (phone && bigFile) { bootLog("detail skipped on this phone (big file, not split by tour yet)"); return { players: null, why: "phone", reason: "notSplit" }; }
      const years = phone ? [...d.years].sort((a, b) => byYear(b, a)).slice(0, 2).sort(byYear) : d.years;
      want = years.map((y) => ({ tour: null, year: y, path: pathOf(datasetId, y), size: 0 }));
    }
    want.sort((a, b) => byYear(a.year, b.year) || String(a.tour).localeCompare(String(b.tour)));
    const allFiles = d.tours && Object.keys(d.tours).length ? Object.values(d.tours).reduce((n, ys) => n + ys.length, 0) : d.years.length;
    const partialLoad = want.length < allFiles;
    const tourOf = want.length && want.every((f) => f.tour != null && f.tour === want[0].tour) && Object.keys(d.tours || {}).length > 1 ? want[0].tour : null;
    const mk = `${datasetId}|${d.sourceUploadedAt}|${want.map((f) => f.path).join(",")}`;
    if (shared.key !== mk || !shared.promise) {
      shared.key = mk; shared.result = null; // (the previous copy, if any, is let go)
      shared.promise = (async () => {
        const lists = [];
        let paused = null;
        for (const [i, f] of want.entries()) {
          const year = f.year;
          const key = `${datasetId}|${f.tour == null ? year : `${tourSlug(f.tour)}~${year}`}|${d.sourceUploadedAt}`;
          let gz = await cacheGet(key);
          if (!gz) {
            paused ??= (await billingState()).paused;
            if (paused) return { players: null, why: "paused" };
            const { m, s: st } = await storage();
            gz = new Uint8Array(await m.getBytes(m.ref(st, f.path)));
            await cachePut(key, gz, datasetId);
          }
          bootLog(`detail ${f.tour ? `${f.tour} ` : ""}${year}: ${(gz.length / 1048576).toFixed(1)} MB packed, unpacking`); // (update 535)
          const raw = await gunzip(gz);
          bootLog(`detail ${year}: ${(raw.length / 1048576).toFixed(1)} MB unpacked, reading`);
          lists.push(decodeFieldDetail(raw));
          onProgress?.(i + 1, want.length);
        }
        const out = { players: mergeYears(lists), why: null, tour: tourOf, // (update 538: which tour; null: every tour)
          // (update 543) a phone's partial load: only some tours or seasons (each player's rounds there are only those)
          years: [...new Set(want.map((f) => String(f.year)))], partial: partialLoad };
        shared.result = out; // (update 325: for the admin's Performance readout)
        return out;
      })();
      shared.promise.then((r) => { if (!r.players && shared.key === mk) { shared.key = null; shared.promise = null; } }, () => { if (shared.key === mk) { shared.key = null; shared.promise = null; } });
    } else onProgress?.(want.length, want.length);
    return await shared.promise;
  } catch (err) {
    console.error("Couldn't load the field detail", err);
    return { players: null, why: err?.code === "storage/unauthorized" ? "paused" : "error" };
  }
}

/**
 * (update 543) A phone's partial detail (some seasons of one tour) with the summary: each player's rounds in the tour and
 * seasons the detail covers come from it (lie / distance), the rest from the summary (by category), so no season or tour
 * goes missing. A complete detail is returned as it is. summary: [{ key, rounds, … }]; res: what getFieldDetail gave.
 */
export function withSummary(summary, res, label = (p) => p) {
  const det = res?.players || [];
  if (!res?.partial) return det;
  const yrs = new Set((res.years || []).map(String)), t = res.tour ?? null;
  const yearOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const covered = (rd) => yrs.has(yearOf(rd)) && (t == null || (rd.tour || "") === t);
  const byKey = new Map(det.map((p) => [p.key, p]));
  const out = (summary || []).map((p) => { const dp = byKey.get(p.key); byKey.delete(p.key); const rest = p.rounds.filter((rd) => !covered(rd));
    return label({ ...p, rounds: dp ? [...rest, ...dp.rounds].sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)) : p.rounds }); });
  for (const p of byKey.values()) out.push(label(p));
  return out.filter((p) => p.rounds.length);
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
        const ok = d?.tours ? Object.entries(d.tours).flatMap(([t, ys]) => ys.map((y) => `${tourSlug(t)}~${y}`)) : (d?.years || []).map(String); // (update 538)
        const current = d && d.format === FORMAT && String(d.sourceUploadedAt) === src && ok.includes(year);
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
