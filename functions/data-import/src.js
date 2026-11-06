/*
 * Data import for Tour Analytics (update 146): upload a data file from Python, and the portal updates itself.
 *
 * A Cloud Run function triggered when a file lands in Cloud Storage under incoming/ (tour_upload.py puts it
 * there). It does exactly what the admin's Upload Data page does with a file — using the same code (js/data.js,
 * js/sg.js, js/fieldDetail.js are bundled in) — then deletes the file:
 *   1. splits the rows per player             -> datasets/{id}, clientData/{player}/datasets/{id}/chunks/*
 *   2. the rankings (strokes-gained files)     -> fieldStats/{id}/chunks/*
 *   3. the lie / distance detail               -> Storage fieldDetail/{id}/{tour}~{year}.bin.gz (update 538: by tour)
 * A file with the same name as an uploaded one replaces it, as on the Upload Data page.
 *
 * Progress and the result go to imports/{generation} (Python waits on it; Upload Data lists the latest).
 *
 * The file's settings ride on its Storage metadata: name, description, idColumn (default playerID).
 * Accepts .csv, .csv.gz and .parquet.
 *
 * (update 165) Big files: tour_upload.py now splits the rows per player on your computer and saves them itself
 * (no time or memory limit there), then drops a small marker in incoming/_rebuild/. For that marker this function
 * only rebuilds the rankings and the lie / distance detail, reading the saved rows player by player. A file too big
 * to read here in one go is turned away with that advice, and every step keeps a heartbeat (updatedAt), so a run
 * that's stopped for time or memory shows as stopped instead of "Reading the file" for ever.
 *
 * This is the source. index.js is this file bundled with the shared portal code (see build.sh); deploy index.js.
 * Deploy: see DEPLOY_PYTHON.md. Entry point: dataImport  Runtime: Node.js 22
 * Trigger: Cloud Storage, object finalized, bucket touranalytics-dd46e.firebasestorage.app
 */
import { createRequire } from "node:module";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseCsv, tableFromCsvRows, tableFromObjects, buildDataset, chunkRowsZ, readChunk, splitString, DOC_CHUNK_CHARS, isTeamKey } from "../../js/data.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../../js/sg.js";
import { detailBuilder, mergeDetailYears, gzip } from "../../js/fieldDetail.js";

// (loaded with require: these packages' ES-module builds don't all have the same exports, which stopped
// the first version from starting)
const require = createRequire(import.meta.url);
const functions = require("@google-cloud/functions-framework");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const db = new Firestore();
const gcs = new Storage();
const PREFIX = "incoming/";
const REBUILD = "incoming/_rebuild/";
const DETAIL_FORMAT = 2; // (update 412: as js/fieldStore.js expects; it said 1, so the site treated the cloud's detail as missing)
const MAX_DIRECT_BYTES = 40 * 1024 * 1024; // (bigger files: tour_upload.py splits them on your computer)

functions.cloudEvent("dataImport", async (event) => {
  const obj = event.data || {};
  const path = String(obj.name || "");
  if (!path.startsWith(PREFIX) || path.endsWith("/")) return; // only files dropped in incoming/
  const bucket = gcs.bucket(obj.bucket);
  const file = bucket.file(path);
  const meta = obj.metadata || {};
  const fileName = path.slice(PREFIX.length);
  const name = String(meta.name || fileName.replace(/\.(csv\.gz|csv|parquet)$/i, "")).trim();
  if (path.startsWith(REBUILD)) return rebuild(bucket, file, meta);
  const status = db.doc(`imports/${obj.generation || Date.now()}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  // too big to read in one go here (the run would be stopped for time or memory part-way, silently)
  if (Number(obj.size) > MAX_DIRECT_BYTES) {
    await set({ file: fileName, name, status: "error", step: null, startedAt: FieldValue.serverTimestamp(), finishedAt: FieldValue.serverTimestamp(),
      message: `This file is ${Math.round(Number(obj.size) / 1048576)} MB, too big for the cloud to read in one go. Send it with the latest tour_upload.py (update 165 or later), which splits it on your computer first.` });
    await file.delete().catch(() => {});
    return;
  }

  // (a retried event for a file that's already been done: nothing to do)
  const prior = await status.get();
  if (prior.exists && prior.data().status === "done") return;
  await set({ file: fileName, name, status: "running", step: "Reading the file", startedAt: FieldValue.serverTimestamp() });
  console.log(`Importing ${path} as "${name}" (${obj.size} bytes)`);
  const beat = heartbeat(status);

  try {
    const [buf] = await file.download();
    const table = await readTable(buf, fileName);
    const dataset = buildDataset(table, String(meta.idColumn || "playerID").trim() || "playerID");
    const people = dataset.byClient.size;
    await set({ step: `Saving ${people} players' rows`, rows: dataset.rowCount, people });

    const { datasetId } = await saveDataset(name, String(meta.description || ""), dataset);

    let rankings = false, detail = null;
    const idx = detectColumns(dataset.columns);
    if (isShotData(idx)) {
      await set({ step: "Updating rankings" });
      const labels = await playerLabels();
      const players = [...dataset.byClient].map(([key, g]) => ({ key, name: labels.get(key) || g.name || g.label, rounds: prepare(g.rows, idx) }));
      await publishFieldStats(datasetId, buildFieldSummary(players), Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      const db0 = tourDetail(); for (const p of players) db0.add(p);
      detail = await publishFieldDetail(bucket, datasetId, db0.finish(), Date.now());
    }

    await set({
      status: "done", step: null, datasetId, rows: dataset.rowCount, people, blankIdRows: dataset.blankIdRows || 0,
      rankings, detail: detail?.skipped || (detail ? "saved" : null), finishedAt: FieldValue.serverTimestamp(),
    });
    console.log(`Done: "${name}", ${dataset.rowCount} rows for ${people} players`);
  } catch (err) {
    console.error("Import failed", err);
    await set({ status: "error", step: null, message: String(err?.message || err), finishedAt: FieldValue.serverTimestamp() });
  } finally {
    clearInterval(beat);
    await file.delete().catch((e) => console.warn("Couldn't delete the incoming file", e?.message));
  }
});

/** updatedAt every minute while a run is alive (a run stopped for time or memory then shows as stopped). */
const heartbeat = (ref) => setInterval(() => ref.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {}), 60000);

/*
 * (update 165) The rankings and the lie / distance detail for a data file tour_upload.py has already saved: its
 * rows are read back player by player and each player's are turned into rounds straight away, so the raw rows never
 * all sit in memory at once.
 * (update 403) Each player then goes straight into the rankings (their summary line) and the packed detail, and their
 * rounds are let go, so memory stays small however big the file. And a run stops taking players after about five and
 * a half minutes: it saves what it has (rebuildParts/ in Storage) and drops a marker for the next run, which carries on
 * from there. The last run joins the parts and publishes. So no file is too big for the 9-minute limit.
 */
const RUN_MS = Number(process.env.REBUILD_RUN_MS) || 330000, MERGE_MS = Number(process.env.REBUILD_MERGE_MS) || 200000;
const partPath = (datasetId, runId, part, what) => `rebuildParts/${datasetId}/${runId}/${part}.${what}.gz`;
async function rebuild(bucket, file, meta) {
  const T0 = Date.now();
  const datasetId = String(meta.datasetId || ""), statusId = meta.statusId || `rebuild_${datasetId}`, status = db.doc(`imports/${statusId}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const beat = heartbeat(status);
  const start = Math.max(0, Number(meta.start) || 0), part = Math.max(0, Number(meta.part) || 0), runId = String(meta.runId || Date.now());
  try {
    if (!part) { const prior = await status.get(); if (!prior.exists) await set({ name: meta.name || null, status: "running", step: "Updating rankings", startedAt: FieldValue.serverTimestamp(), datasetId }); }
    const dsSnap = await db.doc(`datasets/${datasetId}`).get();
    if (!dsSnap.exists) throw new Error("That data file isn't there any more.");
    const ds = dsSnap.data(), idx = detectColumns(ds.columns || []);
    let rankings = false, detail = null;
    if (isShotData(idx)) {
      await set({ status: "running", step: start ? `Updating rankings (${start} of ${(ds.clientKeys || []).length} players)` : "Updating rankings" });
      const labels = await playerLabels();
      const all = ds.clientKeys || [], names = ds.playerNames || {};
      const keys = all.slice(start), summary = [], det = tourDetail();
      let taken = start, msRead = 0, msPrep = 0, nDone = 0;
      const next = async () => {
        while (keys.length && Date.now() - T0 < RUN_MS) {
          const key = keys.shift(); taken++;
          const m = await db.doc(`clientData/${key}/datasets/${datasetId}`).get();
          const n = m.exists ? m.data().chunkCount || 0 : 0;
          const refs = Array.from({ length: n }, (_, i) => db.doc(`clientData/${key}/datasets/${datasetId}/chunks/${i}`));
          const t1 = Date.now();
          const snaps = refs.length ? await db.getAll(...refs) : [];
          const rows = (await Promise.all(snaps.map((sn) => (sn.exists ? readChunk(sn.data()) : [])))).flat(); // (update 399: gzipped or not)
          const t2 = Date.now();
          const rounds = prepare(rows, idx);
          msRead += t2 - t1; msPrep += Date.now() - t2; nDone++;
          for (const rd of rounds) for (const sh of rd.shots) delete sh.r; // (the raw row isn't needed from here)
          if (rounds.length) {
            const pl = { key, name: labels.get(key) || names[key] || key.replace(/^c_/, ""), rounds };
            summary.push(buildFieldSummary([pl]).players[0]);
            det.add(pl);
          }
          if (taken % 100 === 0) await set({ step: `Updating rankings (${taken} of ${all.length} players)` });
        }
      };
      // (update 405) reading the rows is mostly waiting on the database, so many players are read at once
      await Promise.all(Array.from({ length: Number(process.env.REBUILD_PARALLEL) || 24 }, next));
      console.log(`Rebuild ${datasetId}: ${nDone} players this run in ${Math.round((Date.now() - T0) / 1000)}s; per player, reading ${Math.round(msRead / Math.max(1, nDone))} ms (waiting included), working out ${Math.round(msPrep / Math.max(1, nDone))} ms`);
      const files = det.finish();
      // not done yet (or done, but too little time left to join the parts): save this part and hand on to the next run
      if (keys.length || (part > 0 && Date.now() - T0 > MERGE_MS)) {
        await bucket.file(partPath(datasetId, runId, part, "summary.json")).save(gzipSync(JSON.stringify({ players: summary, files: files.map((f) => [f.tour, f.year]) })), { resumable: false });
        for (const f of files) await bucket.file(partPath(datasetId, runId, part, `${tourSlug(f.tour)}~${f.year || "none"}.bin`)).save(gzipSync(f.bytes), { resumable: false });
        await set({ step: `Updating rankings (${taken} of ${all.length} players, part ${part + 1} saved)` });
        const mk = bucket.file(`${REBUILD}${datasetId}.p${part + 1}.json`);
        await mk.save(JSON.stringify({ datasetId }), { resumable: false, contentType: "application/json", metadata: { metadata: { kind: "rebuild", datasetId, statusId, name: meta.name || "", start: String(taken), part: String(part + 1), runId } } });
        console.log(`Rebuild ${datasetId}: part ${part} saved (${taken} of ${all.length}), handing on`);
        return;
      }
      // the last run: the parts before this one, joined
      // (update 538) each tour's seasons apart: "tour\u0001year" -> [bytes, …]
      const tk = (t, y) => `${t || ""}\u0001${y ?? ""}`;
      let players = summary, yearsMap = new Map(files.map((f) => [tk(f.tour, f.year), [f.bytes]]));
      if (part > 0) {
        await set({ step: "Joining the parts" });
        players = [];
        for (let i = 0; i < part; i++) {
          const [buf] = await bucket.file(partPath(datasetId, runId, i, "summary.json")).download();
          const pj = JSON.parse(gunzipSync(buf).toString("utf8"));
          for (const p of pj.players) players.push(p);
          for (const [t, y] of pj.files || []) { const [b] = await bucket.file(partPath(datasetId, runId, i, `${tourSlug(t)}~${y || "none"}.bin`)).download(); const u = new Uint8Array(gunzipSync(b)); const k = tk(t, y); (yearsMap.get(k) || yearsMap.set(k, []).get(k)).unshift(u); }
        }
        for (const p of summary) players.push(p);
      }
      await publishFieldStats(datasetId, { players }, Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      const out = [...yearsMap].map(([k, list]) => { const [tour, year] = k.split("\u0001"); return { tour, year: year === "" ? null : year, bytes: mergeDetailYears(list) }; });
      yearsMap = null;
      detail = await publishFieldDetail(bucket, datasetId, out, Date.now());
      if (part > 0) { try { const [items] = await bucket.getFiles({ prefix: `rebuildParts/${datasetId}/` }); for (const it of items) await it.delete().catch(() => {}); } catch (e) { console.warn("Couldn't tidy the parts", e?.message); } }
    }
    await set({ status: "done", step: null, datasetId, rankings, detail: detail?.skipped || (detail ? "saved" : null), finishedAt: FieldValue.serverTimestamp(),
      ...(meta.statusId && !String(meta.statusId).startsWith("rebuild_") ? {} : { people: (ds.clientKeys || []).length }) }); // (update 408)
    console.log(`Rebuilt rankings for ${datasetId}`);
  } catch (err) {
    console.error("Rebuild failed", err);
    await set({ status: "error", step: null, message: `The rows are live, but the rankings couldn't be rebuilt: ${String(err?.message || err)}. Try "Rebuild rankings" on Upload Data.`, finishedAt: FieldValue.serverTimestamp() });
  } finally {
    clearInterval(beat);
    await file.delete().catch(() => {});
  }
}

/* ---------------------------------------------------------------- reading ---------------------------------------------------------------- */

async function readTable(buf, fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".parquet")) {
    const { parquetReadObjects } = await import("hyparquet");
    let compressors;
    try { ({ compressors } = await import("hyparquet-compressors")); } catch { compressors = undefined; }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const objects = await parquetReadObjects({ file: ab, compressors });
    // as the portal's reader: INT64 -> numbers, dates -> "2025-06-05"
    for (const o of objects) for (const k in o) {
      const v = o[k];
      if (typeof v === "bigint") o[k] = Number(v);
      else if (v instanceof Date) { const iso = isNaN(v) ? "" : v.toISOString(); o[k] = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso; }
    }
    return tableFromObjects(objects);
  }
  const text = (lower.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
  return tableFromCsvRows(parseCsv(text));
}

/* ---------------------------------------------------------------- Firestore writes (as js/store.js) ---------------------------------------------------------------- */

const BATCH_LIMIT = 450, BATCH_BYTES = 4 * 1024 * 1024;
const sized = (op, bytes) => Object.assign(op, { bytes });

async function commitInChunks(ops) {
  let batch = db.batch(), count = 0, bytes = 0;
  for (const op of ops) {
    const b = op.bytes || 1000;
    if (count && (count >= BATCH_LIMIT || bytes + b > BATCH_BYTES)) { await batch.commit(); batch = db.batch(); count = 0; bytes = 0; }
    op(batch); count++; bytes += b;
  }
  if (count) await batch.commit();
}

async function deleteCollection(col) {
  const refs = await col.listDocuments(); // (update 400: just the names, not the stored rows)
  await commitInChunks(refs.map((r) => (b) => b.delete(r)));
}

/** As uploadDataset in js/store.js: the same name replaces that data file. */
async function saveDataset(name, description, dataset) {
  const existing = await db.collection("datasets").where("name", "==", name).get();
  const datasetId = existing.empty ? db.collection("datasets").doc().id : existing.docs[0].id;
  const oldClientKeys = existing.empty ? [] : existing.docs[0].data().clientKeys || [];

  const pieces = new Map(); // (update 399: gzipped; 401: one player at a time, to keep memory down)
  for (const [k, g] of dataset.byClient) pieces.set(k, await chunkRowsZ(g.rows));
  const storedBytes = [...pieces.values()].flat().reduce((n, d) => n + d.length, 0);
  const newClientKeys = [...dataset.byClient.keys()];
  for (const key of new Set([...oldClientKeys, ...newClientKeys])) {
    await deleteCollection(db.collection(`clientData/${key}/datasets/${datasetId}/chunks`));
  }

  const ops = [];
  ops.push((b) => b.set(db.doc(`datasets/${datasetId}`), {
    storedBytes,
    name, description, idColumn: dataset.idColumn, columns: dataset.columns,
    rowCount: dataset.rowCount, blankIdRows: dataset.blankIdRows, clientKeys: newClientKeys,
    playerNames: Object.fromEntries([...dataset.byClient].filter(([, g]) => g.name).map(([k, g]) => [k, g.name])),
    uploadedAt: FieldValue.serverTimestamp(), source: "python",
  }));
  for (const key of oldClientKeys.filter((k) => !newClientKeys.includes(k))) {
    ops.push((b) => b.delete(db.doc(`clientData/${key}/datasets/${datasetId}`)));
  }
  for (const [clientKey, group] of dataset.byClient) {
    const chunks = pieces.get(clientKey);
    ops.push((b) => b.set(db.doc(`clientData/${clientKey}/datasets/${datasetId}`), {
      name, description, idColumn: dataset.idColumn, columns: dataset.columns,
      clientLabel: group.label, playerName: group.name || null, rowCount: group.rows.length, chunkCount: chunks.length, uploadedAt: FieldValue.serverTimestamp(),
    }));
    chunks.forEach((z, i) => ops.push(sized((b) => b.set(db.doc(`clientData/${clientKey}/datasets/${datasetId}/chunks/${i}`), { z: Buffer.from(z) }), z.length + 200)));
  }
  await commitInChunks(ops);
  return { datasetId };
}

/** As publishFieldStats in js/store.js. */
async function publishFieldStats(datasetId, summary, sourceUploadedAt) {
  const ref = db.doc(`fieldStats/${datasetId}`);
  const old = await ref.get();
  // (update 406) new pieces under new names, then the pointer, then the old ones go (readers never get half of each)
  const pieces = splitString(JSON.stringify(summary), DOC_CHUNK_CHARS), prefix = `${Date.now()}_`;
  await commitInChunks(pieces.map((data, i) => sized((b) => b.set(ref.collection("chunks").doc(`${prefix}${i}`), { data }), data.length)));
  await ref.set({ chunkCount: pieces.length, chunkPrefix: prefix, sourceUploadedAt: sourceUploadedAt ?? null, publishedAt: FieldValue.serverTimestamp(), format: 3 });
  const op = old.exists ? old.data().chunkPrefix || "" : null;
  if (op !== null) for (let i = 0; i < (old.data().chunkCount || 0); i++) await ref.collection("chunks").doc(`${op}${i}`).delete().catch(() => {});
}

/** Player names as the admin sees them (as adminAllClients in js/store.js). */
async function playerLabels() {
  const [users, invites, datasets] = await Promise.all([db.collection("users").get(), db.collection("invites").get(), db.collection("datasets").get()]);
  const labels = new Map();
  users.forEach((d) => { if (!isTeamKey(d.data().clientKey)) labels.set(d.data().clientKey, d.data().clientLabel); });
  invites.forEach((d) => { const k = d.data().clientKey; if (!isTeamKey(k) && !labels.has(k)) labels.set(k, d.data().clientLabel); });
  datasets.forEach((d) => (d.data().clientKeys || []).forEach((k) => { if (!labels.has(k)) labels.set(k, k.replace(/^c_/, "")); }));
  const ids = new Map(labels), names = new Map(), count = new Map();
  datasets.forEach((d) => Object.entries(d.data().playerNames || {}).forEach(([k, n]) => { if (n) names.set(k, n); }));
  for (const [k] of labels) if (names.has(k)) count.set(names.get(k).toLowerCase(), (count.get(names.get(k).toLowerCase()) || 0) + 1);
  for (const [k, id] of ids) { const n = names.get(k); if (n) labels.set(k, count.get(n.toLowerCase()) > 1 ? `${n} (${id})` : n); }
  return labels;
}

/* ---------------------------------------------------------------- Storage: the lie / distance detail (as js/fieldStore.js) ---------------------------------------------------------------- */

/*
 * (update 538) The lie / distance detail, split by tour: one file for each tour and season
 * (fieldDetail/{id}/{tour}~{year}.bin.gz), so the site loads only the tour on screen (a phone could no longer hold
 * every tour's season at once). The file's record says which tours have which seasons, and each file's size:
 *   detail: { years (every season), tours: { "PGA TOUR": ["2025", "2026"], … }, sizes: { "PGA TOUR|2026": bytes }, … }
 * The site still reads a file built before this (no tours: one file a season, every tour in it).
 */
const tourSlug = (t) => String(t || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "none";
const detailPath = (datasetId, tour, year) => `fieldDetail/${datasetId}/${tourSlug(tour)}~${year || "none"}.bin.gz`;
/** A detail builder for each tour: each player's rounds go to their own tour's. finish(): [{ tour, year, bytes }]. */
function tourDetail() {
  const by = new Map();
  return {
    add(pl) {
      const rs = new Map();
      for (const rd of pl.rounds) { const t = rd.tour || ""; (rs.get(t) || rs.set(t, []).get(t)).push(rd); }
      for (const [t, rounds] of rs) (by.get(t) || by.set(t, detailBuilder()).get(t)).add({ ...pl, rounds });
    },
    finish() { const out = []; for (const [t, b] of by) for (const f of b.finish()) out.push({ tour: t, year: f.year, bytes: f.bytes }); return out; },
  };
}

async function publishFieldDetail(bucket, datasetId, files, sourceUploadedAt) {
  const billing = await db.doc("config/billing").get();
  if (billing.exists && billing.data().paused === true) return { skipped: "paused" };
  let bytes = 0;
  const tours = {}, sizes = {}, paths = new Set();
  for (const f of files) {
    const gz = await gzip(f.bytes);
    bytes += gz.length;
    const path = detailPath(datasetId, f.tour, f.year); paths.add(path);
    await bucket.file(path).save(Buffer.from(gz), { contentType: "application/octet-stream", resumable: false });
    const t = f.tour || "";
    (tours[t] ||= []).push(f.year);
    sizes[`${t}|${f.year ?? ""}`] = gz.length;
  }
  for (const t of Object.keys(tours)) tours[t].sort();
  const years = [...new Set(files.map((f) => f.year))].sort();
  try {
    const [items] = await bucket.getFiles({ prefix: `fieldDetail/${datasetId}/` });
    for (const it of items) if (!paths.has(it.name)) await it.delete(); // (the old files: before the split, or a season gone)
  } catch (err) { console.warn("Couldn't tidy old detail files", err?.message); }
  await db.doc(`fieldStats/${datasetId}`).set({ detail: { years, tours, sizes, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: DETAIL_FORMAT, builtAt: FieldValue.serverTimestamp() } }, { merge: true });
  return { years, bytes };
}
