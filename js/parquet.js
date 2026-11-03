import { UserError, tableFromObjects } from "./data.js";

// The Parquet reader (hyparquet, open source) loads from jsDelivr the first time it's needed. jsDelivr's "+esm"
// build comes first: it's one ready-to-run module. The package's own source files are the fallback.
const CORE = [
  "https://cdn.jsdelivr.net/npm/hyparquet@1/+esm",
  "https://cdn.jsdelivr.net/npm/hyparquet@1/src/index.js", // (update 459: the source's entry in newer versions)
  "https://cdn.jsdelivr.net/npm/hyparquet@1/src/hyparquet.js",
];
// zstd / gzip / brotli / lz4 files (snappy, pandas' default, needs nothing extra)
const EXTRA = [
  "https://cdn.jsdelivr.net/npm/hyparquet-compressors@1/+esm",
  "https://cdn.jsdelivr.net/npm/hyparquet-compressors@1/src/index.js",
];
async function firstThatLoads(urls) {
  let last = null;
  for (const u of urls) {
    try {
      const m = await import(u);
      if (m) return m;
    } catch (err) { last = err; console.warn("Parquet reader: couldn't load", u, err); }
  }
  throw last || new Error("no reader");
}
let cached = null;
function loadLib() {
  cached ||= Promise.all([firstThatLoads(CORE), firstThatLoads(EXTRA).catch(() => null)]).catch((err) => { cached = null; throw err; });
  return cached;
}

/** Reads a browser File (.parquet) entirely in memory and returns { columns, rows } like a CSV table. */
export async function readParquetFile(file) {
  let core, compressors;
  try {
    const [c, extra] = await loadLib();
    core = c.parquetReadObjects || c.parquetRead ? c : c.default || c;
    compressors = extra?.compressors || extra?.default?.compressors;
  } catch (err) {
    throw new UserError(`Couldn't load the Parquet reader from cdn.jsdelivr.net (${err?.message || err}). If you're on a work network or VPN that blocks it, try another connection, or upload a CSV instead.`);
  }
  const buffer = await file.arrayBuffer();
  let objects;
  try {
    if (core.parquetReadObjects) objects = await core.parquetReadObjects({ file: buffer, compressors });
    else objects = await new Promise((resolve, reject) => {
      // older versions: parquetRead with rows as objects
      core.parquetRead({ file: buffer, compressors, rowFormat: "object", onComplete: resolve }).catch(reject);
    });
  } catch (err) {
    throw new UserError(`Couldn't read that Parquet file: ${err?.message || err}`);
  }
  // BigInt columns (Parquet INT64) become ordinary numbers; dates become "2025-06-05" (with the time, if it has one)
  for (const o of objects) for (const k in o) {
    const v = o[k];
    if (typeof v === "bigint") o[k] = Number(v);
    else if (v instanceof Date) { const iso = isNaN(v) ? "" : v.toISOString(); o[k] = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso; }
  }
  return tableFromObjects(objects);
}

/**
 * (update 479) A big Parquet file a slice of rows at a time (so millions of rows don't all sit in memory as objects):
 * onChunk({ columns, rows }, done, total) for each slice, awaited. The column names come from the file's schema.
 */
export async function readParquetChunks(file, onChunk, size = 200000) {
  let core, compressors;
  try {
    const [c, extra] = await loadLib();
    core = c.parquetReadObjects || c.parquetRead ? c : c.default || c;
    compressors = extra?.compressors || extra?.default?.compressors;
  } catch (err) {
    throw new UserError(`Couldn't load the Parquet reader from cdn.jsdelivr.net (${err?.message || err}). If you're on a work network or VPN that blocks it, try another connection, or upload a CSV instead.`);
  }
  const buffer = await file.arrayBuffer();
  let total = null;
  try { const md = core.parquetMetadata ? core.parquetMetadata(buffer) : null; total = md ? Number(md.num_rows) : null; } catch { total = null; }
  if (!total || !core.parquetReadObjects) { const t = await readParquetFile(file); await onChunk(t, t.rows.length, t.rows.length); return; } // (an older reader: all at once)
  let columns = null;
  for (let start = 0; start < total; start += size) {
    let objects;
    try { objects = await core.parquetReadObjects({ file: buffer, compressors, rowStart: start, rowEnd: Math.min(total, start + size) }); }
    catch (err) { throw new UserError(`Couldn't read that Parquet file: ${err?.message || err}`); }
    if (!objects.length) continue;
    columns ||= Object.keys(objects[0]);
    const rows = objects.map((o) => columns.map((c) => { const v = o[c]; return typeof v === "bigint" ? Number(v) : v instanceof Date ? (isNaN(v) ? "" : v.toISOString().slice(0, 10)) : v; }));
    await onChunk({ columns, rows }, Math.min(total, start + size), total);
  }
}
