/*
 * (update 496) A course's raw shots, kept on the site so its maps can be rebuilt here whenever the analysis changes
 * (Upload Data › Strategy Maps › Rebuild maps), with no re-upload. Each map (a courseNum, or a course name without one)
 * keeps its shots in courseHeat/{id}/chunks/raw_{i}: packed, gzipped rows, as the stats files are kept. On the course:
 * rawChunks, rawRows, rawBytes, rawCols, rawAt and needsBuild; builtVersion and builtAt once built.
 * course_upload.py (Python) only sends these. Every number on the maps (zones, history, past shots, Course Insights) is
 * worked out here, in the browser, by courseShots.js.
 */
import { doc, getDoc, setDoc, deleteDoc, Bytes } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { chunkRowsZ, readChunk } from "./data.js";
import { listHeatCourses, resetHeatList } from "./courseHeat.js";
import { shotColumns, shotAggregator, uploadShotCourses, mapIdFor } from "./courseShots.js";

/** Bumped when the analysis changes: maps built by an older version are offered a rebuild. */
export const BUILD_VERSION = 718; // (718: targets of 10+ shots when possible, ranked on the circle nudged 3 yds each way so a cluster just outside it counts; 717: strategy circles only 8, 10, 15 or 20 yds; 716: the strategy fast enough for a whole course (a grid, a sample to search, exact counts) and worked out a hole at a time; 715: tee aim and avoid within the 25th-75th percentile of drive lengths (a player: their 10th-90th, from the circles kept); circles counted from the centre as drawn; 714: every strategy circle a size the circle tool has (5-50 yds); the tee aim and avoid are circles, said with the drives inside them; approach spots also tried right on a miss, 5-20 yds; 683: a miss spot sits on the misses of its lie and must be mostly that lie (60%+); 658: a miss spot counts only the lie in its name; 657: a miss spot is the circle drawn (8 to 15 yds), counting every miss inside it; 656: approach miss spots 8 to 15 yds too; 655: tee targets (aim, avoid) 8 to 15 yds across each way from the middle; 635: a lucky lie or unsafe spot only in front of a bunker (the bunker behind it, farther from the green); 634: lucky lies and unsafe spots by a bunker judged more narrowly; 631: each miss spot one patch (misses within 5 yds of each other); tighter target outlines; 625: spots at every circle size; ranked with small samples pulled toward the average; 619: spots stay on one side of the green; lucky lies by a bunker left out; 618: a best or 2nd best miss must be safe to aim at (not a sliver by a bunker); 617: miss spots from each cluster's centre, judged on all its misses; 616: rounded oval targets; thin strips by a bunker left out; 614: target outlines round the shots; a worst miss from a smaller spot; green vs miss always; 610: miss spots as circles (10-15 yds, re-centred), each with a lie and 8+ samples; 604: surprises against the best fairway miss; directions hyphenated; 602: the fringe found from the green's outline; 601: Cal's Read leaves out misses to the fringe right by the green; 597: Cal's Read tips: just the value and the count, "(3.78, only 9 samples)"; 595: going for it or laying up from the shot itself; Cal's Read tips each with its own header and value; 594: Cal's Read: each fairway spot by distance and each lay-up distance, for a player's own aim; 592: Cal's Read: an approach read for every pin with 3+ samples, and its spots to circle on the map; 590: Cal's Read: every place against every other, and an approach read always; 588: strategy insights for every hole and pin; 561: each pin named from where it sits on the green; 560: each drive miss's side from the fairway beside it; one side empty: the fairway drives farthest apart; 559: the up & down line from the drive misses: the nearer half, the innermost left and right; 558: the up & down line from halfway between where the left and right misses were hit from; 557: the up & down line also from the fairway short of the green; 555: 555: the up & down line from the fairway nearest the green; 537: 537: strokes gained and distances by true_distance; 526: each past shot's true_distance; 512: the distance_range column, each shot's skill; 502: up & down along the line fairway centre → pin; 503: its middle square 40 x 40 ft; 508: each pin's own scoring, values and widths)
/** The columns kept, in order (also what course_upload.py sends). */
export const RAW_COLS = ["year", "courseNum", "course", "player", "playerID", "round", "hole", "par", "pin_id", "lie", "strokes", "shot_for", "hole_out", "x", "y", "scoring_avg", "pin_x", "pin_y", "distance", "tournament", "distance_range", "true_distance"];
const KEYS = ["year", "courseNum", "course", "player", "playerID", "round", "hole", "par", "pin", "lie", "strokes", "shotFor", "holeOut", "x", "y", "v", "pinX", "pinY", "dist", "event", "skill", "trueDist"];
const clean = (v) => { if (v == null || v === "") return null; if (typeof v === "bigint") return Number(v); if (typeof v === "number") return Number.isFinite(v) ? v : null; const t = String(v).trim(); return t === "" ? null : t; };
const cnOf = (v) => { const c = clean(v); if (c == null) return null; const n = Number(c); return Number.isFinite(n) ? String(n) : String(c); };

/** Gathers a shot file's rows (a slice at a time) by map: a courseNum each (a course name when there's none). */
export function rawCollector() {
  const groups = new Map();
  let ix = null, n = 0;
  return {
    get rows() { return n; },
    add({ columns, rows }) {
      ix ||= shotColumns(columns);
      const need = ["course", "hole", "x", "y", "strokes", "holeOut"].filter((k) => ix[k] == null);
      if (need.length) throw new Error(`The shot file is missing ${need.join(", ")}.`);
      for (const r of rows) {
        const name = String(r[ix.course] ?? "").trim(); if (!name) continue;
        const cn = ix.courseNum != null ? cnOf(r[ix.courseNum]) : null, key = cn ? `#${cn}` : `@${name.toLowerCase()}`;
        const g = groups.get(key) || groups.set(key, { courseNum: cn, names: new Map(), rows: [] }).get(key);
        g.names.set(name, (g.names.get(name) || 0) + 1);
        g.rows.push(KEYS.map((k) => (ix[k] != null ? clean(r[ix[k]]) : null)));
        n++;
      }
    },
    get courses() { return [...groups.values()].map((g) => ({ courseNum: g.courseNum, name: [...g.names].sort((a, b) => b[1] - a[1])[0][0], rows: g.rows })); },
  };
}

/** Saves a map's raw shots (replacing what it had) and marks it for building. Returns its id. */
export async function saveRaw(c, onStatus = () => {}) {
  const existing = await listHeatCourses(true);
  const { old, id } = mapIdFor(c.courseNum, c.name, existing);
  onStatus(`Packing ${c.name}’s ${c.rows.length.toLocaleString()} shots…`);
  const chunks = await chunkRowsZ(c.rows);
  for (const [i, z] of chunks.entries()) {
    onStatus(`Saving ${c.name}’s shots (${i + 1} of ${chunks.length})…`);
    await setDoc(doc(db, "courseHeat", id, "chunks", `raw_${i}`), { z: Bytes.fromUint8Array(z) });
  }
  for (let i = chunks.length; i < (old?.rawChunks || 0); i++) await deleteDoc(doc(db, "courseHeat", id, "chunks", `raw_${i}`)).catch(() => {});
  await setDoc(doc(db, "courseHeat", id), { name: c.name, ...(c.courseNum != null ? { courseNum: String(c.courseNum) } : {}), rawChunks: chunks.length, rawRows: c.rows.length, rawBytes: chunks.reduce((t, z) => t + z.length, 0), rawCols: RAW_COLS, rawAt: new Date(), needsBuild: true }, { merge: true });
  resetHeatList();
  return id;
}

/** A map's raw shots back (rows in RAW_COLS order). */
export async function loadRaw(meta) {
  const snaps = await Promise.all(Array.from({ length: meta.rawChunks || 0 }, (_, i) => getDoc(doc(db, "courseHeat", meta.id, "chunks", `raw_${i}`))));
  const out = [];
  for (const s of snaps) { if (!s.exists()) continue; for (const r of await readChunk(s.data())) out.push(r); }
  return out;
}

/** Does a map need building (raw shots newer than its maps, or maps from an older version of the analysis)? */
export const needsBuild = (c) => !!c.rawChunks && (!!c.needsBuild || c.builtVersion !== BUILD_VERSION);

/** Builds one map from its raw shots: the zones, history, past shots and Course Insights, saved on it. */
export async function buildCourse(meta, onStatus = () => {}) {
  onStatus(`Reading ${meta.name}’s shots…`);
  const rows = await loadRaw(meta);
  if (!rows.length) throw new Error(`No shots saved for ${meta.name}: upload them again.`);
  onStatus(`Working out ${meta.name} (${rows.length.toLocaleString()} shots)…`);
  await new Promise((r) => setTimeout(r, 20));
  const agg = shotAggregator(), cols = meta.rawCols || RAW_COLS;
  for (let i = 0; i < rows.length; i += 100000) agg.add({ columns: cols, rows: rows.slice(i, i + 100000) });
  const list = agg.finish().sort((a, b) => b.players.size - a.players.size);
  if (!list.length) throw new Error(`No usable shots for ${meta.name}.`);
  const [name] = await uploadShotCourses(list.slice(0, 1), onStatus, { into: meta.id });
  await setDoc(doc(db, "courseHeat", meta.id), { builtVersion: BUILD_VERSION, builtAt: new Date(), needsBuild: false }, { merge: true });
  resetHeatList();
  return name;
}

/** Builds every map that needs it (or all, with force), one after another. Returns their names. */
export async function buildAll(onStatus = () => {}, { force = false } = {}) {
  const todo = (await listHeatCourses(true)).filter((c) => c.rawChunks && (force || needsBuild(c)));
  const done = [];
  for (const [i, c] of todo.entries()) done.push(await buildCourse(c, (t) => onStatus(`${i + 1} of ${todo.length}: ${t}`)));
  return done;
}
