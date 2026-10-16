/*
 * Data import for Tour Analytics (update 146): upload a data file from Python, and the portal updates itself.
 *
 * A Cloud Run function triggered when a file lands in Cloud Storage under incoming/ (tour_upload.py puts it
 * there). It does exactly what the admin's Upload Data page does with a file — using the same code (js/data.js,
 * js/sg.js, js/fieldDetail.js are bundled in) — then deletes the file:
 *   1. splits the rows per player             -> datasets/{id}, clientData/{player}/datasets/{id}/chunks/*
 *   2. the rankings (strokes-gained files)     -> fieldStats/{id}/chunks/*
 *   3. the lie / distance detail               -> Storage fieldDetail/{id}/{year}.bin.gz
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
import { gunzipSync } from "node:zlib";
import { parseCsv, tableFromCsvRows, tableFromObjects, buildDataset, chunkRows, parseChunk, splitString, DOC_CHUNK_CHARS, isTeamKey } from "../../js/data.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../../js/sg.js";
import { encodeFieldDetail, gzip } from "../../js/fieldDetail.js";

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
const DETAIL_FORMAT = 1;
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
      detail = await publishFieldDetail(bucket, datasetId, players, Date.now());
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
 * rows are read back player by player (16 at a time) and each player's are turned into rounds straight away, so the
 * raw rows never all sit in memory at once.
 */
async function rebuild(bucket, file, meta) {
  const datasetId = String(meta.datasetId || ""), status = db.doc(`imports/${meta.statusId || `rebuild_${datasetId}`}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const beat = heartbeat(status);
  try {
    const dsSnap = await db.doc(`datasets/${datasetId}`).get();
    if (!dsSnap.exists) throw new Error("That data file isn't there any more.");
    const ds = dsSnap.data(), idx = detectColumns(ds.columns || []);
    let rankings = false, detail = null;
    if (isShotData(idx)) {
      await set({ step: "Updating rankings" });
      const labels = await playerLabels();
      const keys = ds.clientKeys || [], names = ds.playerNames || {}, players = [];
      let done = 0;
      const next = async () => {
        while (keys.length) {
          const key = keys.shift();
          const m = await db.doc(`clientData/${key}/datasets/${datasetId}`).get();
          const n = m.exists ? m.data().chunkCount || 0 : 0;
          const refs = Array.from({ length: n }, (_, i) => db.doc(`clientData/${key}/datasets/${datasetId}/chunks/${i}`));
          const snaps = refs.length ? await db.getAll(...refs) : [];
          const rows = snaps.flatMap((sn) => (sn.exists ? parseChunk(sn.data().data) : []));
          const rounds = prepare(rows, idx);
          for (const rd of rounds) for (const sh of rd.shots) delete sh.r; // (the raw row isn't needed from here)
          if (rounds.length) players.push({ key, name: labels.get(key) || names[key] || key.replace(/^c_/, ""), rounds });
          if (++done % 100 === 0) await set({ step: `Updating rankings (${done} of ${ds.clientKeys.length} players)` });
        }
      };
      await Promise.all(Array.from({ length: 16 }, next));
      await publishFieldStats(datasetId, buildFieldSummary(players), Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      detail = await publishFieldDetail(bucket, datasetId, players, Date.now());
    }
    await set({ status: "done", step: null, datasetId, rankings, detail: detail?.skipped || (detail ? "saved" : null), finishedAt: FieldValue.serverTimestamp() });
    console.log(`Rebuilt rankings for ${datasetId}`);
  } catch (err) {
    console.error("Rebuild failed", err);
    await set({ status: "error", step: null, message: `The rows are live, but the rankings couldn't be rebuilt: ${String(err?.message || err)}. Opening Analyze on a computer rebuilds them.`, finishedAt: FieldValue.serverTimestamp() });
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
  const snap = await col.get();
  await commitInChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
}

/** As uploadDataset in js/store.js: the same name replaces that data file. */
async function saveDataset(name, description, dataset) {
  const existing = await db.collection("datasets").where("name", "==", name).get();
  const datasetId = existing.empty ? db.collection("datasets").doc().id : existing.docs[0].id;
  const oldClientKeys = existing.empty ? [] : existing.docs[0].data().clientKeys || [];

  const pieces = new Map([...dataset.byClient].map(([k, g]) => [k, chunkRows(g.rows)]));
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
    chunks.forEach((data, i) => ops.push(sized((b) => b.set(db.doc(`clientData/${clientKey}/datasets/${datasetId}/chunks/${i}`), { data }), data.length * 2)));
  }
  await commitInChunks(ops);
  return { datasetId };
}

/** As publishFieldStats in js/store.js. */
async function publishFieldStats(datasetId, summary, sourceUploadedAt) {
  const ref = db.doc(`fieldStats/${datasetId}`);
  const old = await ref.get();
  const pieces = splitString(JSON.stringify(summary), DOC_CHUNK_CHARS);
  await commitInChunks(pieces.map((data, i) => sized((b) => b.set(ref.collection("chunks").doc(String(i)), { data }), data.length)));
  for (let i = pieces.length; i < (old.exists ? old.data().chunkCount || 0 : 0); i++) await ref.collection("chunks").doc(String(i)).delete();
  await ref.set({ chunkCount: pieces.length, sourceUploadedAt: sourceUploadedAt ?? null, publishedAt: FieldValue.serverTimestamp(), format: 3 });
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

const detailPath = (datasetId, year) => `fieldDetail/${datasetId}/${year || "none"}.bin.gz`;

async function publishFieldDetail(bucket, datasetId, players, sourceUploadedAt) {
  const billing = await db.doc("config/billing").get();
  if (billing.exists && billing.data().paused === true) return { skipped: "paused" };
  const files = encodeFieldDetail(players);
  let bytes = 0;
  for (const f of files) {
    const gz = await gzip(f.bytes);
    bytes += gz.length;
    await bucket.file(detailPath(datasetId, f.year)).save(Buffer.from(gz), { contentType: "application/octet-stream", resumable: false });
  }
  const years = files.map((f) => f.year);
  try {
    const [items] = await bucket.getFiles({ prefix: `fieldDetail/${datasetId}/` });
    for (const it of items) if (!years.some((y) => it.name === detailPath(datasetId, y))) await it.delete();
  } catch (err) { console.warn("Couldn't tidy old detail files", err?.message); }
  await db.doc(`fieldStats/${datasetId}`).set({ detail: { years, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: DETAIL_FORMAT, builtAt: FieldValue.serverTimestamp() } }, { merge: true });
  return { years, bytes };
}
