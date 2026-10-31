/*
 * (update 456) Strategy Maps: a course's hole images with the scoring zones drawn over them, from the admin's two uploads
 * on Upload Data:
 *   the scoring file (CSV): one row per zone (a shot cluster) and lie on a hole and pin:
 *     course, hole, par, pin_id, pin_x, pin_y, shotcluster, x, y, radius, lie, distanceRange, scoring_avg, attempts
 *     (x, y and radius in pixels on that hole's image: shotStartX/Y_projected_Hole; pin_x / pin_y: pinX/Y_projected_Hole;
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
  course: ["course", "coursename", "tournamentcourse"], hole: ["hole", "holenumber", "holeno"], par: ["par", "holepar"], yards: ["yards", "yardage", "holeyards"],
  pin: ["pinid", "pin", "pinlocation", "pinloc", "pinnumber"], pinX: ["pinx", "pinxprojectedhole"], pinY: ["piny", "pinyprojectedhole"],
  cluster: ["shotcluster", "cluster", "clusterid", "zone"], x: ["x", "clusterx", "centerx", "shotstartxprojectedhole"], y: ["y", "clustery", "centery", "shotstartyprojectedhole"],
  r: ["radius", "clusterradius", "r"], lie: ["lie", "clusterlie", "fromlocation"], dist: ["distancerange", "distance", "distancebin", "distancebins"], cat: ["category", "sgcategory"],
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
  const need = ["course", "hole", "pin", "cluster", "x", "y", "v"].filter((k) => ix[k] == null);
  if (need.length) throw new Error(`The scoring file is missing ${need.map((k) => ({ course: "course", hole: "hole", pin: "pin_id", cluster: "shotcluster", x: "x", y: "y", v: "scoring_avg" })[k]).join(", ")}.`);
  const num = (v) => { const x = Number(String(v ?? "").trim()); return Number.isFinite(x) ? x : null; };
  const out = {};
  let used = 0;
  for (const r of rows.slice(1)) {
    const name = String(r[ix.course] ?? "").trim(), hole = num(r[ix.hole]), x = num(r[ix.x]), y = num(r[ix.y]), v = num(r[ix.v]);
    if (!name || !hole || x == null || y == null || v == null) continue;
    const c = (out[name] ||= { holes: {} }), H = (c.holes[hole] ||= { par: null, yards: null, pins: {} });
    if (ix.par != null && num(r[ix.par])) H.par = num(r[ix.par]);
    if (ix.yards != null && num(r[ix.yards])) H.yards = num(r[ix.yards]);
    const pid = String(r[ix.pin] ?? "1").trim() || "1";
    const P = (H.pins[pid] ||= { x: null, y: null, rows: [] });
    if (ix.pinX != null && num(r[ix.pinX]) != null) { P.x = num(r[ix.pinX]); P.y = num(r[ix.pinY]); }
    P.rows.push({ c: String(r[ix.cluster] ?? ""), x, y, r: ix.r != null ? num(r[ix.r]) || 0 : 0, lie: ix.lie != null ? String(r[ix.lie] ?? "").trim() : "", d: ix.dist != null ? String(r[ix.dist] ?? "").trim() : "",
      cat: ix.cat != null ? String(r[ix.cat] ?? "").trim() : "", v, n: ix.n != null ? Math.max(0, num(r[ix.n]) || 0) : 1 });
    used++;
  }
  if (!used) throw new Error("No rows with a course, hole, x, y and scoring average in that file.");
  return out;
}
/** Admin: the scoring file. Each course in it replaces that course's zones (its images stay). */
export async function uploadHeatScoring(rows, onStatus = () => {}) {
  const byCourse = heatFromRows(rows);
  const existing = await listHeatCourses(true);
  const names = Object.keys(byCourse);
  for (const [i, name] of names.entries()) {
    onStatus(`Saving ${name} (${i + 1} of ${names.length})…`);
    const old = existing.find((c) => sameCourse(c.name, name));
    const id = old?.id || heatId(name);
    const data = byCourse[name];
    const holes = Object.keys(data.holes).map(Number).sort((a, b) => a - b);
    const n = Math.max(holes.at(-1) || 0, Object.keys(old?.holes || {}).length);
    const par = Array.from({ length: n }, (_, k) => data.holes[k + 1]?.par || old?.par?.[k] || null);
    const yards = Array.from({ length: n }, (_, k) => data.holes[k + 1]?.yards || old?.yards?.[k] || null);
    const chunks = await writeChunks(id, "data", JSON.stringify(data), old?.dataChunks || 0);
    await setDoc(doc(db, "courseHeat", id), { name: old?.name || name, par, yards, dataChunks: chunks, dataAt: serverTimestamp(), zones: Object.values(data.holes).reduce((t, h) => t + Object.values(h.pins).reduce((u, p) => u + p.rows.length, 0), 0) }, { merge: true });
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
  const ok = entries.filter((x) => !/(^|\/)(__MACOSX|\.)/.test(x.name));
  const out = {};
  const holeOf = (parts) => { for (let i = parts.length - 1; i >= 0; i--) { const m = String(parts[i]).replace(IMG, "").match(/(\d{1,2})(?!.*\d)/); if (m && +m[1] >= 1 && +m[1] <= 18) return +m[1]; } return null; };
  for (const z of ok.filter((x) => /\.zip$/i.test(x.name))) {
    const course = z.name.split("/").pop().replace(/\.zip$/i, "");
    const inner = await unzip(await (await z.blob()).arrayBuffer());
    for (const x of inner.filter((q) => IMG.test(q.name) && !/(^|\/)(__MACOSX|\.)/.test(q.name))) { const h = holeOf(x.name.split("/")); if (h) (out[course] ||= {})[h] = x; }
  }
  let imgs = ok.filter((x) => IMG.test(x.name)).map((x) => ({ x, parts: x.name.split("/") }));
  // one folder around everything (the zip of a folder of courses): the course is the next folder down
  while (imgs.length && imgs.every((q) => q.parts.length > 2 && q.parts[0] === imgs[0].parts[0]) && new Set(imgs.map((q) => q.parts[1])).size > 1 && !imgs.every((q) => /^\d+$/.test(q.parts[1]))) imgs = imgs.map((q) => ({ ...q, parts: q.parts.slice(1) }));
  for (const { x, parts } of imgs) { if (parts.length < 2) continue; const h = holeOf(parts.slice(1)); if (h) (out[parts[0]] ||= {})[h] = x; }
  return out;
}
/** An image file → webp (the same size, up to 2400 wide), as base64, with its original size (the zones' pixels). */
async function toWebp(blob) {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height, s = Math.min(1, 2400 / w);
  const cv = document.createElement("canvas"); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const out = await new Promise((res) => cv.toBlob(res, "image/webp", 0.86));
  const type = out?.type === "image/webp" ? "image/webp" : "image/png";
  const b = out?.type === "image/webp" ? out : await new Promise((res) => cv.toBlob(res, "image/png"));
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b); });
  return { b64, w, h, type };
}
/** Admin: the images zip. Each course in it gets (or replaces) its hole images. */
export async function uploadHeatImages(file, onStatus = () => {}) {
  onStatus("Reading the zip…");
  const byCourse = await imagesByCourse(await unzip(await file.arrayBuffer()));
  const names = Object.keys(byCourse);
  if (!names.length) throw new Error("No hole images found. Put each course in its own folder, with an image for each hole named by its number (1.png, 2.png …).");
  const existing = await listHeatCourses(true);
  for (const [ci, name] of names.entries()) {
    const old = existing.find((c) => sameCourse(c.name, name));
    const id = old?.id || heatId(name);
    const holes = { ...(old?.holes || {}) };
    const nums = Object.keys(byCourse[name]).map(Number).sort((a, b) => a - b);
    for (const [k, h] of nums.entries()) {
      onStatus(`${name}: hole ${h} (${k + 1} of ${nums.length}), course ${ci + 1} of ${names.length}…`);
      const img = await toWebp(await byCourse[name][h].blob());
      const chunks = await writeChunks(id, `h${h}`, img.b64, holes[h]?.chunks || 0);
      holes[h] = { w: img.w, h: img.h, chunks, type: img.type };
    }
    const n = Math.max(...Object.keys(holes).map(Number));
    const par = Array.from({ length: n }, (_, k) => old?.par?.[k] || null);
    await setDoc(doc(db, "courseHeat", id), { name, holes, par: old?.par?.length ? old.par : par, imgAt: serverTimestamp() }, { merge: true });
  }
  listCache = null;
  return names;
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
export function zonesOf(pin, par, ix = null) {
  const toPar = (v) => (v >= 1.5 ? v - par : v);
  const by = new Map();
  for (const r of pin.rows) { const z = by.get(r.c) || by.set(r.c, { id: r.c, rows: [], sx: 0, sy: 0, sr: 0, n: 0, k: 0 }).get(r.c); z.rows.push(r); const w = r.n || 1; z.sx += r.x * w; z.sy += r.y * w; z.sr += (r.r || 0) * w; z.k += w; z.n += r.n || 0; }
  const zs = [...by.values()].map((z) => {
    const rows = z.rows.map((r) => { const f = toPar(r.v), sk = ix ? skillFor(ix, r) : null; return { ...r, f, p: sk ? f - sk.sg : null, sk }; });
    const W = rows.reduce((t, r) => t + (r.n || 1), 0) || 1;
    const field = rows.reduce((t, r) => t + r.f * (r.n || 1), 0) / W, player = ix ? rows.reduce((t, r) => t + r.p * (r.n || 1), 0) / W : null;
    return { id: z.id, x: z.sx / z.k, y: z.sy / z.k, r: z.sr / z.k, n: z.n, rows, field, player };
  });
  // a zone's radius when the file has none: about half the distance to its nearest neighbour
  for (const z of zs) if (!(z.r > 0)) { let nn = Infinity; for (const o of zs) if (o !== z) nn = Math.min(nn, Math.hypot(o.x - z.x, o.y - z.y)); z.r = Number.isFinite(nn) ? nn * 0.6 : 30; }
  // how far each zone's colour spreads: its radius, or more where the zones are far apart (so neighbours blend into one
  // general area instead of a dot each)
  for (const z of zs) { let nn = Infinity; for (const o of zs) if (o !== z) nn = Math.min(nn, Math.hypot(o.x - z.x, o.y - z.y)); z.rk = Math.max(z.r, Number.isFinite(nn) ? nn * 0.85 : z.r); }
  const hasPin = pin.x != null && pin.y != null;
  for (const z of zs) z.dp = hasPin ? Math.hypot(z.x - pin.x, z.y - pin.y) : 0;
  const total = zs.reduce((t, z) => t + (z.n || 1), 0);
  return { zones: zs, total, hasPin };
}
/** Each zone against the zones about as far from the pin (the field's or the player's scoring), and the key ones. */
export function keyZones({ zones, total, hasPin }, usePlayer = false) {
  const val = (z) => (usePlayer && z.player != null ? z.player : z.field);
  const avgAll = zones.reduce((t, z) => t + val(z) * (z.n || 1), 0) / (total || 1);
  for (const z of zones) {
    let s = 0, w = 0;
    for (const o of zones) { if (o === z) continue; const near = hasPin ? Math.abs(o.dp - z.dp) <= Math.max(0.18 * z.dp, z.r) : true; if (near) { s += val(o) * (o.n || 1); w += o.n || 1; } }
    z.ref = w ? s / w : avgAll; z.diff = val(z) - z.ref; z.v = val(z);
  }
  const minN = Math.max(3, 0.01 * total);
  const sig = (z) => Math.abs(z.diff) * Math.sqrt(Math.min(z.n || 1, 200));
  const pick = (f) => zones.filter((z) => (z.n || 1) >= minN && f(z)).sort((a, b) => sig(b) - sig(a)).slice(0, 3);
  const target = pick((z) => z.diff <= -0.05), avoid = pick((z) => z.diff >= 0.05);
  for (const z of zones) z.key = null;
  target.forEach((z, i) => { z.key = { kind: "target", n: i + 1 }; });
  avoid.forEach((z, i) => { z.key = { kind: "avoid", n: i + 1 }; });
  return { target, avoid };
}

/* ------------------------------------------------ drawing ------------------------------------------------ */
// matplotlib's RdBu_r (blue: birdie, white: par, red: bogey)
const RDBU = [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]];
const rdbu = (t) => { const x = Math.max(0, Math.min(1, t)) * (RDBU.length - 1), i = Math.min(RDBU.length - 2, Math.floor(x)), f = x - i; return RDBU[i].map((c, k) => Math.round(c + (RDBU[i + 1][k] - c) * f)); };
/** As in the course report: par 3s and 4s from −0.5 to +0.5, par 5s from −1 to +0.5 (par in the middle of each). */
export const scoreT = (v, par) => (par >= 5 ? (v < -0.5 ? 0.5 * (v + 1) / 0.5 : 0.5 + 0.5 * (v + 0.5) / 1) : 0.5 + v);
/** The zones over an image: mode "zones" (aim / avoid against zones as far out) or "score" (the scoring itself). */
// (rot: turned upright for phones, tee at the bottom: the image's (x, y) shows at (y, W − x))
export const toDisp = (x, y, W, rot) => (rot ? [y, W - x] : [x, y]);
export const toImg = (dx, dy, W, rot) => (rot ? [W - dy, dx] : [dx, dy]);
/** The hole image itself on a canvas (turned when rot). */
export function paintBase(canvas, img, { W, H, rot = false }) {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(box.width * dpr)), ch = Math.max(1, Math.round(box.height * dpr));
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, cw, ch);
  if (!img?.naturalWidth) return;
  ctx.imageSmoothingQuality = "high";
  if (rot) { ctx.save(); ctx.translate(0, ch); ctx.rotate(-Math.PI / 2); ctx.drawImage(img, 0, 0, ch, cw); ctx.restore(); }
  else ctx.drawImage(img, 0, 0, cw, ch);
}
export function paintHeat(canvas, { zones }, { W, H, par, mode = "zones", pin = null, rot = false }) {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(box.width * dpr)), chh = Math.max(1, Math.round(box.height * dpr));
  canvas.width = cw; canvas.height = chh;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, cw, chh);
  if (!zones.length || !W || !H) return;
  const DW = rot ? H : W, DH = rot ? W : H, sx = cw / DW, sy = chh / DH;
  // the field, worked out on a coarse grid then smoothed up to size
  const gw = Math.min(360, Math.max(60, Math.round(cw / 5))), gh = Math.max(1, Math.round(gw * chh / cw));
  const off = document.createElement("canvas"); off.width = gw; off.height = gh;
  const g = off.getContext("2d"), im = g.createImageData(gw, gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const [x, y] = toImg(((i + 0.5) / gw) * DW, ((j + 0.5) / gh) * DH, W, rot);
    let s = 0, w = 0, cov = 0;
    for (const z of zones) { const d = Math.hypot(x - z.x, y - z.y) / (z.rk || z.r || 1); if (d > 2.2) continue; const k = Math.exp(-0.9 * d * d); const kw = k * Math.sqrt(z.n || 1); s += kw * (mode === "zones" ? z.diff : z.v); w += kw; cov += k; }
    cov = 1 - Math.exp(-1.8 * cov); // (how covered: from every zone nearby, so the edges fade evenly)
    if (!w) continue;
    const v = s / w, o = (j * gw + i) * 4;
    let rgb, a;
    if (mode === "zones") { const t = Math.min(1, Math.abs(v) / 0.25); rgb = v < 0 ? [48, 209, 88] : [255, 69, 58]; a = (0.12 + 0.68 * t) * cov; }
    else { rgb = rdbu(scoreT(v, par)); a = 0.72 * cov; }
    im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2]; im.data[o + 3] = Math.round(255 * Math.min(0.85, a));
  }
  g.putImageData(im, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0, cw, chh);
  // the key zones: a ring and a label (A1 aim, X1 avoid)
  const fs = Math.max(10, Math.round(11 * dpr));
  ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const z of zones) {
    if (!z.key) continue;
    const [zx, zy] = toDisp(z.x, z.y, W, rot), cx = zx * sx, cy = zy * sy, rr = Math.max(8 * dpr, z.r * Math.min(sx, sy));
    const col = z.key.kind === "target" ? "#30d158" : "#ff453a";
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = col; ctx.setLineDash(z.key.kind === "avoid" ? [5 * dpr, 4 * dpr] : []);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const lab = `${z.key.kind === "target" ? "✓" : "✕"}${z.key.n}`, lw = ctx.measureText(lab).width + 8 * dpr;
    ctx.fillStyle = "rgba(10,10,12,0.82)"; ctx.fillRect(cx - lw / 2, cy - rr - fs - 4 * dpr, lw, fs + 4 * dpr);
    ctx.fillStyle = col; ctx.fillText(lab, cx, cy - rr - fs / 2 - 2 * dpr);
  }
  if (pin && pin.x != null) { // the pin: a gold diamond
    const [qx, qy] = toDisp(pin.x, pin.y, W, rot), px = qx * sx, py = qy * sy, s = 5 * dpr;
    ctx.fillStyle = "#ffd60a"; ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}
/** The zone under a point (image pixels): inside its radius, the closest by radius; else the nearest within 1.5 radii. */
export function zoneAt(zones, x, y) {
  let best = null, bd = Infinity;
  for (const z of zones) { const d = Math.hypot(x - z.x, y - z.y) / (z.r || 1); if (d < bd) { bd = d; best = z; } }
  return best && bd <= 1.5 ? best : null;
}
export const fmtPar = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0.005 ? "+" : v < -0.005 ? "−" : ""}${Math.abs(v).toFixed(2)}`);
