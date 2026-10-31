/*
 * (update 456) Strategy Maps: a course's hole images with the scoring zones drawn over them, from the admin's two uploads
 * on Upload Data:
 *   the scoring file (CSV): one row per zone (a shot cluster) and lie on a hole and pin:
 *     course, hole, par, pin_id, pin_x, pin_y, x, y, lie, distanceRange, scoring_avg, attempts
 *     (x, y: a cluster's centre in pixels on that hole's image, shotStartX/Y_projected_Hole; pin_x / pin_y: pinX/Y_projected_Hole;
 *     (update 457) no cluster labels or radii: the zones blend into each other, and stop where the lie changes on the image;
 *     scoring_avg: the hole score, or the score to par, of everyone who played from there; yards, category optional)
 *   the images (ZIP): a folder for each course, named as it shows on the site, with an image for each hole named by its
 *     number (1.png, Hole 1.png, 1/Hole.png …). A zip inside the zip, named for the course, works too.
 * Stored in Firestore like the reports (Cloud Storage would need billing): courseHeat/{id} (the course: holes, pars, image
 * sizes, chunk counts) and courseHeat/{id}/chunks/{file_i} (the data as JSON, each image as webp, in pieces).
 */
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

import { courseKey, sameCourse } from "./sg.js";

const CH = 900000; // characters a chunk
export const heatId = (name) => String(name || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "course";

/* ------------------------------------------------ storage ------------------------------------------------ */
let listCache = null;
/** Every course with strategy maps: [{ id, name, par, yards, holes: { "1": { w, h, chunks } }, dataChunks, … }] */
export async function listHeatCourses(fresh = false) {
  if (listCache && !fresh && Date.now() - listCache.at < 60000) return listCache.list;
  let list = [];
  try { const snap = await getDocs(collection(db, "courseHeat")); list = snap.docs.map((d) => ({ ...d.data(), id: d.id })); } catch (err) { console.warn("courseHeat", err); }
  listCache = { at: Date.now(), list };
  return list;
}
async function writeChunks(id, prefix, str, oldCount = 0) {
  const parts = []; for (let i = 0; i < str.length; i += CH) parts.push(str.slice(i, i + CH));
  for (let i = 0; i < parts.length; i++) await setDoc(doc(db, "courseHeat", id, "chunks", `${prefix}_${i}`), { data: parts[i] });
  for (let i = parts.length; i < oldCount; i++) await deleteDoc(doc(db, "courseHeat", id, "chunks", `${prefix}_${i}`)).catch(() => {});
  return parts.length;
}
async function readChunks(id, prefix, n) {
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, "courseHeat", id, "chunks", `${prefix}_${i}`))));
  return snaps.map((s) => (s.exists() ? s.data().data : "")).join("");
}
const dataMemo = new Map(), imgMemo = new Map();
/** The course's zones: { holes: { "1": { par, yards, pins: { id: { x, y, rows: [...] } } } } } */
export async function heatData(meta) {
  const k = `${meta.id}|${meta.dataAt?.toMillis?.() ?? meta.dataAt ?? ""}`;
  if (!dataMemo.has(k)) dataMemo.set(k, readChunks(meta.id, "data", meta.dataChunks || 0).then((s) => (s ? JSON.parse(s) : { holes: {} })));
  return dataMemo.get(k);
}
/** A hole's image, as a blob URL (kept for the visit). */
export async function heatImage(meta, hole) {
  const h = meta.holes?.[String(hole)];
  if (!h?.chunks) return null;
  const k = `${meta.id}|${hole}|${meta.imgAt?.toMillis?.() ?? ""}`;
  if (!imgMemo.has(k)) imgMemo.set(k, readChunks(meta.id, `h${hole}`, h.chunks).then((b64) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: h.type || "image/webp" }))));
  return imgMemo.get(k);
}
export async function deleteHeatCourse(id) {
  const snap = await getDocs(collection(db, "courseHeat", id, "chunks"));
  for (let i = 0; i < snap.docs.length; i += 400) { const b = writeBatch(db); snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
  await deleteDoc(doc(db, "courseHeat", id));
  listCache = null;
}

/* ------------------------------------------------ the scoring file ------------------------------------------------ */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLS = {
  course: ["course", "coursename", "tournamentcourse"], courseNum: ["coursenum", "coursenumber", "courseid", "coursecode"], hole: ["hole", "holenumber", "holeno"], par: ["par", "holepar"], yards: ["yards", "yardage", "holeyards"],
  pin: ["pinid", "pin", "pinlocation", "pinloc", "pinnumber"], pinX: ["pinx", "pinxprojectedhole"], pinY: ["piny", "pinyprojectedhole"],
  cluster: ["shotcluster", "cluster", "clusterid", "zone"], x: ["x", "clusterx", "centerx", "shotstartxprojectedhole"], y: ["y", "clustery", "centery", "shotstartyprojectedhole"],
  r: ["radius", "clusterradius", "r"], lie: ["lie", "clusterlie", "fromlocation"], dist: ["distancerange", "distancebin", "distancebins"], distN: ["distance", "distancetopin", "pindistance", "disttopin", "pindisttostart"], cat: ["category", "sgcategory"],
  v: ["scoringavg", "scoringaverage", "scoreavg", "avgscore", "scoring", "score", "avg"], n: ["attempts", "count", "n", "shots", "numshots"],
};
export function heatColumns(header) {
  const h = header.map(norm), out = {};
  for (const [k, names] of Object.entries(COLS)) { const i = names.map((nm) => h.indexOf(nm)).find((x) => x >= 0); if (i != null && i >= 0) out[k] = i; }
  return out;
}
/** The scoring file's rows → { [course name]: { holes } }. Throws with a plain message when columns are missing. */
export function heatFromRows(rows) {
  const ix = heatColumns(rows[0] || []);
  const need = ["course", "hole", "x", "y", "v"].filter((k) => ix[k] == null);
  if (need.length) throw new Error(`The scoring file is missing ${need.map((k) => ({ course: "course", hole: "hole", x: "x", y: "y", v: "scoring_avg" })[k]).join(", ")}.`);
  const num = (v) => { const t = String(v ?? "").trim(); if (t === "") return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
  const out = {};
  let used = 0;
  for (const r of rows.slice(1)) {
    const name = String(r[ix.course] ?? "").trim(), hole = num(r[ix.hole]), x = num(r[ix.x]), y = num(r[ix.y]), v = num(r[ix.v]);
    if (!name || !hole || x == null || y == null || v == null) continue;
    const c = (out[name] ||= { holes: {}, courseNum: null });
    if (ix.courseNum != null && String(r[ix.courseNum] ?? "").trim()) c.courseNum = String(num(r[ix.courseNum]) ?? String(r[ix.courseNum]).trim());
    const H = (c.holes[hole] ||= { par: null, yards: null, pins: {} });
    if (ix.par != null && num(r[ix.par])) H.par = num(r[ix.par]);
    if (ix.yards != null && num(r[ix.yards])) H.yards = num(r[ix.yards]);
    const pid = ix.pin != null ? String(r[ix.pin] ?? "1").trim() || "1" : "1";
    const P = (H.pins[pid] ||= { x: null, y: null, rows: [] });
    if (ix.pinX != null && num(r[ix.pinX]) != null) { P.x = num(r[ix.pinX]); P.y = num(r[ix.pinY]); }
    const lie = ix.lie != null ? String(r[ix.lie] ?? "").trim() : "";
    // (update 458) the distance from the pin as a number (yards; feet on the green), else a range ("150-175 yds")
    const dn = ix.distN != null ? num(r[ix.distN]) : null, onGreen = lieOf(lie) === "green";
    const d = ix.dist != null && String(r[ix.dist] ?? "").trim() ? String(r[ix.dist]).trim() : dn != null ? `${Math.round(dn)} ${onGreen ? "ft" : "yds"}` : "";
    P.rows.push({ c: ix.cluster != null ? String(r[ix.cluster] ?? "") : "", x, y, lie, d, dist: dn,
      cat: ix.cat != null ? String(r[ix.cat] ?? "").trim() : "", v, n: ix.n != null ? Math.max(0, num(r[ix.n]) || 0) : 1 });
    used++;
  }
  if (!used) throw new Error("No rows with a course, hole, x, y and scoring average in that file.");
  for (const c of Object.values(out)) {
    c.hasN = ix.n != null;
    // (update 458) strokes to hole out (about 2 from the green) or the hole score (par or so from the green)?
    const greens = Object.values(c.holes).flatMap((H) => Object.values(H.pins).flatMap((P) => P.rows.filter((q) => lieOf(q.lie) === "green").map((q) => q.v))).sort((a, b) => a - b);
    c.toGo = greens.length ? greens[Math.floor(greens.length / 2)] < 2.6 : true;
    for (const H of Object.values(c.holes)) {
      const tees = Object.values(H.pins).flatMap((P) => P.rows.filter((q) => lieOf(q.lie) === "tee"));
      if (!H.par && tees.length) H.par = Math.round(tees.reduce((t, q) => t + q.v, 0) / tees.length); // (no par column: the tee's scoring)
      const td = tees.map((q) => q.dist).filter((x) => x != null);
      if (!H.yards && td.length) H.yards = Math.round(td.reduce((t, x) => t + x, 0) / td.length);
    }
  }
  return out;
}
/** Admin: the scoring file. Each course in it replaces that course's zones (its images stay). */
export async function uploadHeatScoring(rows, onStatus = () => {}) {
  const byCourse = heatFromRows(rows);
  const existing = await listHeatCourses(true);
  const names = Object.keys(byCourse);
  for (const [i, name] of names.entries()) {
    onStatus(`Saving ${name} (${i + 1} of ${names.length})…`);
    const data = byCourse[name], cn = data.courseNum;
    // (update 458) the same course: its course number (images in a folder named for it), else its name
    const old = (cn != null && existing.find((c) => String(c.courseNum ?? "") === String(cn))) || existing.find((c) => sameCourse(c.name, name));
    const id = old?.id || (cn != null ? `c${heatId(String(cn))}` : heatId(name));
    const holes = Object.keys(data.holes).map(Number).sort((a, b) => a - b);
    const n = Math.max(holes.at(-1) || 0, Object.keys(old?.holes || {}).length);
    const par = Array.from({ length: n }, (_, k) => data.holes[k + 1]?.par || old?.par?.[k] || null);
    const yards = Array.from({ length: n }, (_, k) => data.holes[k + 1]?.yards || old?.yards?.[k] || null);
    const json = JSON.stringify(data), chunks = await writeChunks(id, "data", json, old?.dataChunks || 0);
    await setDoc(doc(db, "courseHeat", id), { name, ...(cn != null ? { courseNum: String(cn) } : {}), par, yards, dataChunks: chunks, dataBytes: json.length, /* (update 460: for Storage on Users) */ dataAt: serverTimestamp(), zones: Object.values(data.holes).reduce((t, h) => t + Object.values(h.pins).reduce((u, p) => u + p.rows.length, 0), 0) }, { merge: true });
  }
  listCache = null;
  return names;
}

/* ------------------------------------------------ the images (a zip) ------------------------------------------------ */
/** The files in a zip: [{ name, blob() }]. Stored and deflated entries (what every zip tool makes). */
export async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("That isn’t a zip file.");
  const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  if (p === 0xffffffff) throw new Error("That zip is too big to read here (over 4 GB). Split it into a few zips.");
  const dec = new TextDecoder();
  const out = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = u8.subarray(start, start + csize);
    out.push({ name, blob: async () => (method === 0 ? new Blob([raw]) : method === 8 ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : (() => { throw new Error(`${name}: an unsupported kind of zip compression`); })()) });
  }
  return out;
}
const IMG = /\.(png|jpe?g|webp)$/i;
/** The zip's files → { course name: { hole: entry } } (folders, or a zip per course). */
export async function imagesByCourse(entries) {
  const skip = (n) => /(^|\/)(__MACOSX|\.)/.test(n);
  const out = {};
  // (update 458) a hole: the image's own name (1.png, Hole 1.png) with its course the folder it's in, or a folder named for
  // the hole (1/Hole.png) with the course the folder above. The course folder: a course number or a course name.
  const place = (name, prefix = null) => {
    const parts = name.split("/"), file = parts.at(-1).replace(IMG, "");
    const m = file.match(/(\d{1,2})(?!.*\d)/);
    let hole = null, course = null;
    if (m && +m[1] >= 1 && +m[1] <= 18 && (parts.length >= 2 || prefix)) { hole = +m[1]; course = parts.length >= 2 ? parts.at(-2) : prefix; }
    else if (parts.length >= 2 && /^\d{1,2}$/.test(parts.at(-2)) && +parts.at(-2) >= 1 && +parts.at(-2) <= 18) { hole = +parts.at(-2); course = parts.length >= 3 ? parts.at(-3) : prefix; }
    return hole && course ? { hole, course: String(course).trim() } : null;
  };
  for (const z of entries.filter((x) => /\.zip$/i.test(x.name) && !skip(x.name))) {
    const course = z.name.split("/").pop().replace(/\.zip$/i, "");
    const inner = await unzip(await (await z.blob()).arrayBuffer());
    for (const x of inner.filter((q) => IMG.test(q.name) && !skip(q.name))) { const p = place(x.name, course); if (p) (out[p.course === course || p.course === "CourseImages" ? course : p.course] ||= {})[p.hole] = x; }
  }
  for (const x of entries.filter((q) => IMG.test(q.name) && !skip(q.name))) { const p = place(x.name); if (p) (out[p.course] ||= {})[p.hole] = x; }
  return out;
}
/** An image file → webp (the same size, up to 2400 wide), as base64, with its original size (the zones' pixels). */
async function toWebp(blob) {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height, s = Math.min(1, 2400 / w);
  const cv = document.createElement("canvas"); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const out = await new Promise((res) => cv.toBlob(res, "image/webp", 0.95));
  const type = out?.type === "image/webp" ? "image/webp" : "image/png";
  const b = out?.type === "image/webp" ? out : await new Promise((res) => cv.toBlob(res, "image/png"));
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b); });
  return { b64, w, h, type };
}
/** Admin: the images zip. Each course in it gets (or replaces) its hole images. */
export async function uploadHeatImages(file, onStatus = () => {}) {
  onStatus("Reading the zip…");
  const byCourse = await imagesByCourse(await unzip(await file.arrayBuffer()));
  const names = Object.keys(byCourse), shown = [];
  if (!names.length) throw new Error("No hole images found. Put each course in its own folder, with an image for each hole named by its number (1.png, 2.png …).");
  const existing = await listHeatCourses(true);
  for (const [ci, name] of names.entries()) {
    // (update 458) a folder named with a course number matches that number in the scoring file; else the course's name
    const isNum = /^\d+(\.0+)?$/.test(name), cn = isNum ? String(Number(name)) : null;
    const old = (cn != null ? existing.find((c) => String(c.courseNum ?? "") === cn) : null) || (!isNum ? existing.find((c) => sameCourse(c.name, name)) : null);
    const id = old?.id || (cn != null ? `c${heatId(cn)}` : heatId(name));
    const holes = { ...(old?.holes || {}) };
    const nums = Object.keys(byCourse[name]).map(Number).sort((a, b) => a - b);
    for (const [k, h] of nums.entries()) {
      onStatus(`${name}: hole ${h} (${k + 1} of ${nums.length}), course ${ci + 1} of ${names.length}…`);
      const img = await toWebp(await byCourse[name][h].blob());
      const chunks = await writeChunks(id, `h${h}`, img.b64, holes[h]?.chunks || 0);
      holes[h] = { w: img.w, h: img.h, chunks, type: img.type, bytes: img.b64.length };
    }
    const n = Math.max(...Object.keys(holes).map(Number));
    const par = Array.from({ length: n }, (_, k) => old?.par?.[k] || null);
    await setDoc(doc(db, "courseHeat", id), { name: old?.name || (isNum ? `Course ${cn}` : name), ...(cn != null ? { courseNum: cn } : {}), holes, par: old?.par?.length ? old.par : par, imgAt: serverTimestamp() }, { merge: true });
    shown.push(old?.name || (isNum ? `Course ${cn} (its name comes with the scoring file)` : name));
  }
  listCache = null;
  return shown;
}

/* ------------------------------------------------ the zones ------------------------------------------------ */
const lieOf = (s) => { const t = String(s || "").toLowerCase(); return /green/.test(t) && !/fringe/.test(t) ? "green" : /tee/.test(t) ? "tee" : /bunker|sand/.test(t) ? "bunker" : /fringe|fairway|fwy/.test(t) ? "fairway" : /rough|other|native|primary|intermediate/.test(t) ? "rough" : /water|drop/.test(t) ? "water" : t; };
const rangeOf = (s) => {
  const t = String(s || "").toLowerCase(), unit = /ft|feet/.test(t) ? "ft" : /yd|yard/.test(t) ? "yds" : /tee|driver|wood|iron/.test(t) ? "tee" : "";
  const ns = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (unit === "tee" || !ns.length) return { unit, lo: null, hi: null };
  if (/^\s*[<]|under|inside|less/.test(t)) return { unit, lo: 0, hi: ns[0] };
  if (/^\s*[>]|over|\+/.test(t)) return { unit, lo: ns[0], hi: ns[0] * 1.5 };
  return { unit, lo: ns[0], hi: ns[1] ?? ns[0] };
};
const catOf = (row) => {
  const c = String(row.cat || "").toLowerCase();
  if (c) return /tee/.test(c) ? "OTT" : /putt/.test(c) ? "PUTT" : /around|arg/.test(c) ? "ARG" : "APP";
  const lie = lieOf(row.lie), r = rangeOf(row.d);
  if (lie === "green" || r.unit === "ft") return "PUTT";
  if (lie === "tee" || r.unit === "tee") return "OTT";
  if (r.hi != null && r.hi <= 30) return "ARG";
  return "APP";
};
/** A player's strokes gained a shot, by part of the game, distance and lie (from their stats rounds), for the zones. */
export function skillIndex(rounds) {
  const m = new Map(), add = (k, sg, w) => { const a = m.get(k) || m.set(k, { sg: 0, w: 0 }).get(k); a.sg += sg; a.w += w; };
  const bands = new Map();
  for (const rd of rounds || []) for (const s of rd.shots || []) {
    if (!s.cat) continue;
    const w = s.w || 1, lie = lieOf(s.lie), d = s.dist || "";
    add(`${s.cat}|*|*`, s.sg, w); if (lie) add(`${s.cat}|*|${lie}`, s.sg, w);
    if (d) { add(`${s.cat}|${d}|*`, s.sg, w); if (lie) add(`${s.cat}|${d}|${lie}`, s.sg, w); (bands.get(s.cat) || bands.set(s.cat, new Set()).get(s.cat)).add(d); }
  }
  return { m, bands };
}
/** The player's edge from a zone row: strokes gained a shot there, pulled toward their wider numbers when there are few shots. */
export function skillFor(ix, row) {
  if (!ix) return null;
  const cat = catOf(row), lie = lieOf(row.lie), rr = rangeOf(row.d);
  let band = null;
  if (rr.lo != null) {
    let best = -1;
    for (const b of ix.bands.get(cat) || []) { const q = rangeOf(b); if (q.unit !== rr.unit || q.lo == null) continue; const ov = Math.min(q.hi, rr.hi) - Math.max(q.lo, rr.lo), mid = (rr.lo + rr.hi) / 2; const sc = ov > 0 ? ov : mid >= q.lo && mid <= q.hi ? 0.5 : -1; if (sc > best) { best = sc; band = b; } }
    if (best < 0) band = null;
  } else if (rr.unit === "tee" && row.d) band = [...(ix.bands.get(cat) || [])].find((b) => norm(b) === norm(row.d)) || null;
  const K = 25, get = (k) => ix.m.get(k);
  const chain = [`${cat}|*|*`, lie ? `${cat}|*|${lie}` : null, band ? `${cat}|${band}|*` : null, band && lie ? `${cat}|${band}|${lie}` : null].filter(Boolean);
  let est = 0, shots = 0;
  for (const k of chain) { const a = get(k); if (!a || !a.w) continue; const s = a.sg / a.w; est = (a.w * s + K * est) / (a.w + K); shots = a.w; }
  return { sg: est, shots, cat, band, lie };
}
/** A pin's zones: rows with the same cluster together, each with its scoring (to par; the player's too) and how it compares
 *  with zones the same distance from the pin (what makes a zone one to aim at or to stay away from). */
export function zonesOf(pin, par, ix = null, { toGo = false, yards = null } = {}) {
  const toPar = (v) => (v >= 1.5 ? v - par : v);
  // (update 458) strokes to hole out from a spot (the scoring file's usual kind): the hole score from there is the shots
  // already played plus those, taken as in regulation: none from the tee, one from where tee shots finish, on a par 5 two
  // from the lay-up range, and par less two from the green and around it (within 30 yards)
  const yd = (r) => (r.dist == null ? null : lieOf(r.lie) === "green" ? r.dist / 3 : r.dist);
  const shotsIn = (r) => { const L = lieOf(r.lie), d = yd(r); if (L === "tee") return 0; if (par <= 3) return 1; if (L === "green" || (d != null && d <= 30)) return par - 2; if (par >= 5 && d != null && yards && d < yards - 320) return 2; return 1; };
  // (update 457) a zone: a cluster centre and its lie (rows at the same centre and lie, at different distances, together)
  const by = new Map();
  for (const r of pin.rows) { const L = lieOf(r.lie) || "any", k = `${r.c}|${Math.round(r.x)}|${Math.round(r.y)}|${L}`; const z = by.get(k) || by.set(k, { id: k, L, rows: [], sx: 0, sy: 0, n: 0, k: 0 }).get(k); z.rows.push(r); const w = r.n || 1; z.sx += r.x * w; z.sy += r.y * w; z.k += w; z.n += r.n || 0; }
  const zs = [...by.values()].map((z) => {
    const rows = z.rows.map((r) => { const k = toGo ? shotsIn(r) : null, f = toGo ? r.v + k - par : toPar(r.v), sk = ix ? skillFor(ix, r) : null; return { ...r, k, f, p: sk ? f - sk.sg : null, sk }; });
    const W = rows.reduce((t, r) => t + (r.n || 1), 0) || 1, avg = (g) => rows.reduce((t, r) => t + g(r) * (r.n || 1), 0) / W;
    const field = avg((r) => r.f), player = ix ? avg((r) => r.p) : null;
    // what zones are compared on: strokes to hole out (or the score, when that's what the file has), and the yards out
    const raw = toGo ? avg((r) => r.v) : field, rawP = ix ? raw - (field - player) : null;
    const ds = rows.map(yd).filter((x) => x != null), dy = ds.length ? ds.reduce((t, x) => t + x, 0) / ds.length : null;
    return { id: z.id, L: z.L, x: z.sx / z.k, y: z.sy / z.k, n: z.n, rows, field, player, raw, rawP, dy, toGo, k: toGo ? Math.round(avg((r) => r.k)) : null };
  });
  // how far a zone's colour reaches: past its nearest neighbour (so the zones blend smoothly into each other), and at
  // least the usual spacing between zones on this pin
  const nnOf = (z) => { let nn = Infinity; for (const o of zs) if (o !== z) nn = Math.min(nn, Math.hypot(o.x - z.x, o.y - z.y)); return nn; };
  const nns = zs.map(nnOf).filter(Number.isFinite).sort((a, b) => a - b), med = nns.length ? nns[Math.floor(nns.length / 2)] : 40;
  zs.forEach((z, i) => { const nn = nnOf(z); z.rk = Math.max(med * 1.4, Number.isFinite(nn) ? nn * 1.25 : med * 1.4, 6); z.r = Math.min(z.rk * 0.5, med * 0.7); });
  const hasPin = pin.x != null && pin.y != null;
  // how far from the pin: the file's distance in yards, else measured on the image (pixels, the same for every zone)
  const pxPerYd = (() => { const q = zs.filter((z) => z.dy > 20 && hasPin); if (!q.length) return null; const r = q.map((z) => Math.hypot(z.x - pin.x, z.y - pin.y) / z.dy).sort((a, b) => a - b); return r[Math.floor(r.length / 2)]; })();
  for (const z of zs) z.dp = z.dy != null ? z.dy : hasPin ? Math.hypot(z.x - pin.x, z.y - pin.y) / (pxPerYd || 1) : 0;
  const total = zs.reduce((t, z) => t + (z.n || 1), 0);
  return { zones: zs, total, hasPin: hasPin || zs.some((z) => z.dy != null), hasN: zs.some((z) => (z.n || 0) > 1) };
}
/** Each zone against the zones about as far from the pin (the field's or the player's scoring), and the key ones. */
export function keyZones({ zones, total, hasPin, hasN }, usePlayer = false) {
  // (update 458) each zone against the zones about as far from the pin (within 12%, or 4 yards close in) on strokes to hole
  // out: better than them is somewhere to aim, worse somewhere to stay away from. The tee isn't a zone to aim at.
  const raw = (z) => (usePlayer && z.rawP != null ? z.rawP : z.raw ?? z.field);
  const play = zones.filter((z) => z.L !== "tee");
  const avgAll = play.reduce((t, z) => t + raw(z), 0) / (play.length || 1);
  for (const z of zones) {
    z.v = usePlayer && z.player != null ? z.player : z.field;
    if (z.L === "tee") { z.diff = 0; z.ref = raw(z); continue; }
    let s = 0, w = 0;
    for (const o of play) { if (o === z) continue; const near = hasPin ? Math.abs(o.dp - z.dp) <= Math.max(0.12 * z.dp, 4) : true; if (near) { s += raw(o) * (o.n || 1); w += o.n || 1; } }
    z.ref = w ? s / w : avgAll; z.diff = raw(z) - z.ref;
  }
  const ns = play.map((z) => z.n || 1).sort((a, b) => a - b), minN = hasN ? Math.max(3, 0.25 * (ns[Math.floor(ns.length / 2)] || 0)) : 0; // (enough shots: a quarter of the usual zone's)
  const sig = (z) => Math.abs(z.diff) * (hasN ? Math.sqrt(Math.min(z.n || 1, 200)) : 1);
  const pick = (f) => play.filter((z) => (z.n || 1) >= minN && f(z)).sort((a, b) => sig(b) - sig(a)).slice(0, 3);
  const target = pick((z) => z.diff <= -0.05), avoid = pick((z) => z.diff >= 0.05);
  for (const z of zones) z.key = null;
  target.forEach((z, i) => { z.key = { kind: "target", n: i + 1 }; });
  avoid.forEach((z, i) => { z.key = { kind: "avoid", n: i + 1 }; });
  return { target, avoid };
}

/* ------------------------------------------------ drawing ------------------------------------------------ */
// matplotlib's RdBu_r (blue: birdie, white: par, red: bogey)
const RDBU = [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]];
const rdbu = (t) => { const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5)) * (RDBU.length - 1), i = Math.min(RDBU.length - 2, Math.floor(x)), f = x - i; return RDBU[i].map((c, k) => Math.round(c + (RDBU[i + 1][k] - c) * f)); };
/** As in the course report: par 3s and 4s from −0.5 to +0.5, par 5s from −1 to +0.5 (par in the middle of each). */
export const scoreT = (v, par) => (par >= 5 ? (v < -0.5 ? 0.5 * (v + 1) / 0.5 : 0.5 + 0.5 * (v + 0.5) / 1) : 0.5 + v);
/** The zones over an image: mode "zones" (aim / avoid against zones as far out) or "score" (the scoring itself). */
// (update 461) a canvas as big as it shows (zoomed in too, so it stays sharp), kept under what phones allow (~16 MP)
const sizeOf = (canvas) => { const box = canvas.getBoundingClientRect(); let k = Math.min(2, window.devicePixelRatio || 1); const a = box.width * box.height * k * k; if (a > 14e6) k *= Math.sqrt(14e6 / a); return { cw: Math.max(1, Math.round(box.width * k)), ch: Math.max(1, Math.round(box.height * k)), k }; };
// (rot: turned upright for phones, tee at the bottom: the image's (x, y) shows at (y, W − x))
export const toDisp = (x, y, W, rot) => (rot ? [y, W - x] : [x, y]);
export const toImg = (dx, dy, W, rot) => (rot ? [W - dy, dx] : [dx, dy]);
/** The hole image itself on a canvas (turned when rot). */
export function paintBase(canvas, img, { W, H, rot = false }) {
  const { cw, ch } = sizeOf(canvas);
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, cw, ch);
  if (!img?.naturalWidth) return;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  // (update 461) shrunk in halves to near the size shown, then the last step: a big drop in one go leaves jagged edges
  const tw = rot ? ch : cw, th = rot ? cw : ch;
  let src = img, sw = img.naturalWidth, sh = img.naturalHeight;
  while (sw / 2 >= tw * 1.05 && sh / 2 >= th * 1.05) { const c = document.createElement("canvas"); c.width = Math.round(sw / 2); c.height = Math.round(sh / 2); const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height; }
  if (rot) { ctx.save(); ctx.translate(0, ch); ctx.rotate(-Math.PI / 2); ctx.drawImage(src, 0, 0, ch, cw); ctx.restore(); }
  else ctx.drawImage(src, 0, 0, cw, ch);
}
/*
 * (update 457) The lie on the image: every zone's centre shows what its lie looks like on this hole (a few pixels around
 * it: fairway stripes, rough, sand, green…). Each pixel takes the lie of the zone centre it looks most like; pixels that
 * look like none of them (trees, water, paths…) take none. A zone only colours pixels of its own lie, so the colour
 * stops at the edge of the fairway and the rough's starts on the other side.
 */
const pixMemo = new WeakMap();
function pixelsOf(img, gw, gh) {
  const m = pixMemo.get(img);
  if (m && m.gw === gw && m.src === img.src) return m.data;
  const c = document.createElement("canvas"); c.width = gw; c.height = gh;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, gw, gh);
  let data = null; try { data = g.getImageData(0, 0, gw, gh).data; } catch { data = null; }
  pixMemo.set(img, { gw, src: img.src, data });
  return data;
}
function lieMap(img, zones, W, gw, gh) {
  const px = img?.naturalWidth ? pixelsOf(img, gw, gh) : null;
  const lies = [...new Set(zones.map((z) => z.L))];
  if (!px || lies.length < 2) return null; // (one lie, or no picture to read: no edges to find)
  const s = gw / W, at = (i, j) => { const o = (j * gw + i) * 4; return [px[o], px[o + 1], px[o + 2]]; };
  // the look of each zone centre: the average of the pixels close around it
  let samples = zones.map((z) => { const ci = Math.round(z.x * s), cj = Math.round(z.y * s); let r = 0, g = 0, b = 0, n = 0;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (i >= 0 && j >= 0 && i < gw && j < gh) { const c = at(i, j); r += c[0]; g += c[1]; b += c[2]; n++; }
    return n ? { L: lies.indexOf(z.L), c: [r / n, g / n, b / n] } : null; }).filter(Boolean);
  // a centre right on an edge can look like the lie next door: dropped when it's nearer another lie's usual look
  const med = lies.map((_, li) => { const cs = samples.filter((q) => q.L === li).map((q) => q.c); if (!cs.length) return null; return [0, 1, 2].map((k) => cs.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(cs.length / 2)]); });
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  samples = samples.filter((q) => { const own = d2(q.c, med[q.L]); return !med.some((m, li) => m && li !== q.L && d2(q.c, m) + 300 < own); });
  if (!samples.length) return null;
  // the spread of each lie's own look (how far a pixel can be from it and still count)
  const tol = 55 * 55;
  const cls = new Int8Array(gw * gh).fill(-1);
  const cache = new Map();
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const o = (j * gw + i) * 4, key = ((px[o] >> 2) << 12) | ((px[o + 1] >> 2) << 6) | (px[o + 2] >> 2);
    let L = cache.get(key);
    if (L === undefined) { let bd = Infinity; L = -1; const c = [px[o], px[o + 1], px[o + 2]]; for (const q of samples) { const d = d2(c, q.c); if (d < bd) { bd = d; L = q.L; } } if (bd > tol) L = -1; cache.set(key, L); }
    cls[j * gw + i] = L;
  }
  // tidy: a pixel takes the lie most of its neighbours have (mowing stripes and specks don't make edges)
  const out = new Int8Array(cls.length), cnt = new Int16Array(lies.length + 1);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    cnt.fill(0);
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= gw || y >= gh) continue; cnt[cls[y * gw + x] + 1]++; }
    let best = 0; for (let k = 1; k < cnt.length; k++) if (cnt[k] > cnt[best]) best = k;
    out[j * gw + i] = cnt[best] >= 4 ? best - 1 : cls[j * gw + i];
  }
  return { cls: out, lies };
}
/** The zones as a picture the size of the hole image (worked out once per pin and view; turned and scaled when drawn). */
export function buildOverlay(img, { zones }, { W, H, par, mode = "zones", res = 2400 }) {
  const gw = Math.max(40, Math.min(res, Math.round(W))), gh = Math.max(1, Math.round(H * gw / W)), s = gw / W;
  const off = document.createElement("canvas"); off.width = gw; off.height = gh;
  if (!zones.length) return { canvas: off, map: null, s };
  const map = lieMap(img, zones, W, gw, gh);
  const N = gw * gh, sum = new Float32Array(N), wt = new Float32Array(N), cov = new Float32Array(N);
  for (const z of zones) {
    const zl = map ? map.lies.indexOf(z.L) : -1, R = z.rk * 2.2 * s, cx = z.x * s, cy = z.y * s, rk = z.rk * s;
    const val = mode === "zones" ? z.diff : z.v, nw = Math.sqrt(z.n || 1);
    const i0 = Math.max(0, Math.floor(cx - R)), i1 = Math.min(gw - 1, Math.ceil(cx + R)), j0 = Math.max(0, Math.floor(cy - R)), j1 = Math.min(gh - 1, Math.ceil(cy + R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * gw + i;
      if (map && map.cls[k] !== zl) continue; // (only its own lie)
      const d = Math.hypot(i - cx, j - cy) / rk; if (d > 2.2) continue;
      const e = Math.exp(-0.9 * d * d);
      sum[k] += e * nw * val; wt[k] += e * nw; cov[k] += e;
    }
  }
  const g = off.getContext("2d"), im = g.createImageData(gw, gh);
  for (let k = 0; k < N; k++) {
    if (!wt[k]) continue;
    const v = sum[k] / wt[k], c = 1 - Math.exp(-1.8 * cov[k]), o = k * 4;
    let rgb, a;
    if (mode === "zones") { const t = Math.min(1, Math.abs(v) / 0.25); rgb = v < 0 ? [48, 209, 88] : [255, 69, 58]; a = (0.12 + 0.68 * t) * c; }
    else { rgb = rdbu(scoreT(v, par)); a = 0.72 * c; }
    im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2]; im.data[o + 3] = Math.round(255 * Math.min(0.85, a));
  }
  g.putImageData(im, 0, 0);
  return { canvas: off, map, s, gw, gh };
}
/** The overlay over the image (turned when rot), then the key zones' rings and labels and the pin. */
export function paintHeat(canvas, { zones }, ov, { W, H, pin = null, rot = false }) {
  const { cw, ch: chh, k: dpr } = sizeOf(canvas);
  canvas.width = cw; canvas.height = chh;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, cw, chh);
  if (!zones.length || !W || !H || !ov) return;
  const DW = rot ? H : W, DH = rot ? W : H, sx = cw / DW, sy = chh / DH;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  let src = ov.canvas, sw = src.width, sh = src.height; const tw = rot ? chh : cw, th = rot ? cw : chh;
  while (sw / 2 >= tw * 1.05 && sh / 2 >= th * 1.05) { const c = document.createElement("canvas"); c.width = Math.round(sw / 2); c.height = Math.round(sh / 2); const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height; }
  if (rot) { ctx.save(); ctx.translate(0, chh); ctx.rotate(-Math.PI / 2); ctx.drawImage(src, 0, 0, chh, cw); ctx.restore(); }
  else ctx.drawImage(src, 0, 0, cw, chh);
  if (pin && pin.x != null) { // the pin: a gold diamond (the same size on screen however far in)
    const z = Math.max(1, canvas.getBoundingClientRect().width / (canvas.offsetWidth || 1));
    const [qx, qy] = toDisp(pin.x, pin.y, W, rot), px = qx * sx, py = qy * sy, s = (5 * dpr) * Math.min(z, 2);
    ctx.fillStyle = "#ffd60a"; ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}
/** The zone under a point (image pixels): the nearest zone of the lie under it (from the overlay's lie map), else the nearest. */
export function zoneAt(zones, x, y, ov = null) {
  let L = null;
  if (ov?.map) { const i = Math.round(x * ov.s), j = Math.round(y * ov.s); if (i >= 0 && j >= 0 && i < ov.gw && j < ov.gh) { const c = ov.map.cls[j * ov.gw + i]; L = c >= 0 ? ov.map.lies[c] : "none"; } }
  let best = null, bd = Infinity;
  for (const z of zones) { if (L && L !== "none" && z.L !== L) continue; const d = Math.hypot(x - z.x, y - z.y) / (z.rk || 1); if (d < bd) { bd = d; best = z; } }
  return best && bd <= (L === "none" ? 0.6 : 2.2) ? best : null;
}
export const fmtPar = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0.005 ? "+" : v < -0.005 ? "−" : ""}${Math.abs(v).toFixed(2)}`);
