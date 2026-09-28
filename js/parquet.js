import { UserError, tableFromObjects } from "./data.js";

let cached = null;
async function loadLib() {
  if (!cached) {
    cached = Promise.all([
      import("https://cdn.jsdelivr.net/npm/hyparquet@1/src/hyparquet.min.js"),
      import("https://cdn.jsdelivr.net/npm/hyparquet-compressors@1/src/hyparquet-compressors.min.js").catch(() => null),
    ]);
  }
  return cached;
}

/** Reads a browser File (.parquet) entirely in-memory and returns { columns, rows } like a CSV table. */
export async function readParquetFile(file) {
  let parquetReadObjects, compressors;
  try {
    const [core, compat] = await loadLib();
    parquetReadObjects = core.parquetReadObjects;
    compressors = compat?.compressors;
  } catch {
    throw new UserError("Couldn't load the Parquet reader. Check your internet connection and try again.");
  }
  const buffer = await file.arrayBuffer();
  let objects;
  try {
    objects = await parquetReadObjects({ file: buffer, compressors });
  } catch (err) {
    throw new UserError(`Couldn't read that Parquet file: ${err.message || err}`);
  }
  return tableFromObjects(objects);
}
