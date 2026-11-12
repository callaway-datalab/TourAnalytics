/*
 * (update 700) Launch Monitor data: TrackMan (a report link, or its Excel export) and GCQuad (its CSV export), read into
 * one kind of shot, in yards, mph, degrees and rpm, whichever it came from.
 *
 *   practice/{owner}/lm/{id}  a session: { src: "trackman" | "gcquad", via: "link" | "excel" | "csv", name, date (YYYY-MM-DD),
 *                             key (to spot the same session twice), link?, player?, addedAt, addedBy, shots: [shot] }
 *   shot: { t (YYYY-MM-DDTHH:MM:SS), c (club, the bag's name: Driver, 3w, 6i, 50°…), m (model: TrackMan's tags, the Excel's Tags,
 *           GCQuad's Club ID; update 701)?, b (ball)?, x (excluded: "Use in stat" No)?,
 *           carry, total, side (carry side, + right), totalSide, height, ballSpeed, clubSpeed, smash, launch, launchDir,
 *           spin, spinAxis, attack, path, face, faceToPath, dynLoft, landAngle, hang,
 *           traj (TrackMan link only: the flight, flat [down, up, side, …] in yards; Firestore can't keep lists in lists) }
 */
import { normClub, sortClubs } from "./clubs.js";

const YD = 1.0936133, MPH = 2.2369363, DEG = 180 / Math.PI;
const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null; const t = String(v).trim().replace(/,/g, ""); if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.test(t)) return null; const n = parseFloat(t); return Number.isFinite(n) ? n : null; };
const r = (v, dp = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Every number a shot can carry: [key, label, short label, unit, decimals, higher is better (for colours) | null]. */
export const LM_METRICS = [
  ["carry", "Carry", "Carry", "yds", 1], ["total", "Total", "Total", "yds", 1], ["side", "Carry side", "Side", "yds", 1], ["totalSide", "Total side", "Tot. side", "yds", 1],
  ["height", "Peak height", "Height", "yds", 1], ["landAngle", "Landing angle", "Land ∠", "°", 1], ["hang", "Hang time", "Hang", "s", 1],
  ["ballSpeed", "Ball speed", "Ball spd", "mph", 1], ["clubSpeed", "Club speed", "Club spd", "mph", 1], ["smash", "Smash factor", "Smash", "", 2],
  ["launch", "Launch angle", "Launch", "°", 1], ["launchDir", "Launch direction", "Launch dir", "°", 1], ["spin", "Spin rate", "Spin", "rpm", 0], ["spinAxis", "Spin axis", "Spin axis", "°", 1],
  ["attack", "Attack angle", "Attack", "°", 1], ["path", "Club path", "Path", "°", 1], ["face", "Face angle", "Face", "°", 1], ["faceToPath", "Face to path", "F to P", "°", 1], ["dynLoft", "Dynamic loft", "Dyn loft", "°", 1],
];
export const LM = Object.fromEntries(LM_METRICS.map(([k, label, short, unit, dp]) => [k, { label, short, unit, dp }]));
const SIDE_KEYS = new Set(["side", "totalSide"]);
/** A value as shown: "283.4", "5.2 R", "2,349". */
export function fmtLM(k, v, { unit = false } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const m = LM[k] || { dp: 1, unit: "" };
  if (SIDE_KEYS.has(k)) return Math.abs(v) < 0.05 ? "0.0" : `${Math.abs(v).toFixed(m.dp)} ${v > 0 ? "R" : "L"}`;
  const t = k === "spin" ? Math.round(v).toLocaleString() : v.toFixed(m.dp);
  return unit && m.unit ? `${t}${m.unit === "°" ? "°" : ` ${m.unit}`}` : t;
}
export const clubName = (raw) => normClub(raw) || String(raw || "Unknown").trim() || "Unknown";

/* ---------------- TrackMan: a report link (the AI service fetches it: TrackMan only answers its own web page) ---------------- */
export const trackmanId = (link) => (/[?&](?:r|a)=([0-9a-f-]{20,})/i.exec(String(link || "")) || /^\s*([0-9a-f-]{20,})\s*$/i.exec(String(link || "")))?.[1] || null;
export function fromTrackmanJson(j, link = "") {
  const shots = [];
  let player = "";
  for (const g of j?.StrokeGroups || []) {
    player ||= String(g.Player?.Name || "").trim();
    for (const st of g.Strokes || []) {
      const m = st.Measurement || {}, t = new Date(st.Time || m.Time || g.Date);
      const traj = Array.isArray(m.BallTrajectory) && m.BallTrajectory.length > 2 ? (() => {
        const pts = m.BallTrajectory, step = Math.max(1, Math.ceil(pts.length / 28)), out = [];
        for (let i = 0; i < pts.length; i += step) out.push(r(pts[i].X * YD), r(pts[i].Y * YD), r(pts[i].Z * YD));
        const L = pts.at(-1); if ((pts.length - 1) % step) out.push(r(L.X * YD), r(L.Y * YD), r(L.Z * YD));
        return out;
      })() : null;
      const tags = [...(st.Tags || []), ...(g.Tags || [])].map((x) => String(x || "").trim()).filter(Boolean);
      shots.push(clean({ t: isNaN(t) ? null : isoLocal(t), c: clubName(st.Club || g.Club), m: [...new Set(tags)].join(", ") || null, b: st.Ball || g.Ball || null,
        carry: m.Carry * YD, total: m.Total * YD, side: m.CarrySide * YD, totalSide: m.TotalSide * YD, height: m.MaxHeight * YD, landAngle: m.LandingAngle, hang: m.HangTime,
        ballSpeed: m.BallSpeed * MPH, clubSpeed: m.ClubSpeed * MPH, smash: m.SmashFactor, launch: m.LaunchAngle, launchDir: m.LaunchDirection, spin: m.SpinRate, spinAxis: m.SpinAxis,
        attack: m.AttackAngle, path: m.ClubPath, face: m.FaceAngle, faceToPath: m.FaceToPath, dynLoft: m.DynamicLoft, traj }));
    }
  }
  return session({ src: "trackman", via: "link", link, player, key: `tm:${trackmanId(link) || j?.Id || ""}`, shots });
}

/* ---------------- a small .xlsx / .xlsm reader (no library: the zip's parts inflated by the browser) ---------------- */
async function unzip(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf instanceof ArrayBuffer ? buf : b.buffer);
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("not a zip");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files = new Map(), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    files.set(name, { method, csize, off });
    p += 46 + nl + xl + cl;
  }
  const read = async (name) => {
    const f = files.get(name); if (!f) return null;
    const ln = dv.getUint16(f.off + 26, true), lx = dv.getUint16(f.off + 28, true), data = b.subarray(f.off + 30 + ln + lx, f.off + 30 + ln + lx + f.csize);
    if (f.method === 0) return dec.decode(data);
    const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(s).text();
  };
  return { names: [...files.keys()], read };
}
const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ""); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
/** Every sheet of a workbook: [{ name, rows: [[cell]] }] (numbers as numbers, text as text). */
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const shared = []; { const t = await z.read("xl/sharedStrings.xml"); if (t) for (const si of xml(t).getElementsByTagName("si")) shared.push([...si.getElementsByTagName("t")].map((x) => x.textContent).join("")); }
  const wb = xml(await z.read("xl/workbook.xml")), rels = xml(await z.read("xl/_rels/workbook.xml.rels") || "<Relationships/>");
  const target = new Map([...rels.getElementsByTagName("Relationship")].map((x) => [x.getAttribute("Id"), x.getAttribute("Target")]));
  const out = [];
  for (const sh of wb.getElementsByTagName("sheet")) {
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let path = target.get(rid) || ""; path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
    const t = await z.read(path); if (!t) continue;
    const rows = [];
    for (const row of xml(t).getElementsByTagName("row")) {
      const ri = Number(row.getAttribute("r")) - 1, cells = [];
      for (const c of row.getElementsByTagName("c")) {
        const ty = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? null;
        let val = v;
        if (ty === "s") val = shared[Number(v)] ?? "";
        else if (ty === "inlineStr") val = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
        else if (ty === "b") val = v === "1";
        else if (ty !== "str" && ty !== "e" && v != null && v !== "") val = Number(v);
        cells[colIdx(c.getAttribute("r"))] = val;
      }
      rows[ri] = cells;
    }
    out.push({ name: sh.getAttribute("name"), rows: Array.from(rows, (x) => x || []) });
  }
  return out;
}
const excelDate = (v) => { if (typeof v === "number") { const ms = Math.round((v - 25569) * 864e5); const d = new Date(ms); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); } const d = new Date(v); return isNaN(d) ? null : d; };
const low = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** TrackMan's Excel export (TrackMan Live Excel Report): its Report sheet (yards, mph, degrees), else its Data sheet (metres, radians). */
export function fromTrackmanSheets(sheets, fileName = "") {
  const rep = sheets.find((s) => low(s.name) === "report"), dat = sheets.find((s) => low(s.name) === "data");
  let shots = [], player = "";
  if (rep) {
    const hi = rep.rows.findIndex((row) => row.some((c) => low(c) === "club") && row.some((c) => low(c) === "date"));
    if (hi >= 0) {
      const groups = []; let g = ""; const top = rep.rows[hi - 1] || [];
      for (let i = 0; i < rep.rows[hi].length; i++) { if (top[i] != null && String(top[i]).trim()) g = low(top[i]); groups[i] = g; }
      const col = (grp, re) => rep.rows[hi].findIndex((c, i) => re.test(low(c)) && (grp == null || grp.test(groups[i] || "")));
      const C = { date: col(null, /^date$/), club: col(null, /^club$/), tags: col(null, /^tags?$/), ball: col(/stroke/, /^ball$/), player: col(null, /^player$/), use: col(null, /^use in stat/),
        clubSpeed: col(null, /^club speed/), attack: col(null, /^attack angle/), path: col(null, /^club ?path/), dynLoft: col(null, /^dyn\.? ?loft/), face: col(null, /^face angle/),
        ballSpeed: col(/ball launch/, /^ball speed/), smash: col(null, /^smash/), launch: col(null, /^launch angle/), launchDir: col(null, /^launch direction/), spin: col(null, /^spin ?rate$/), spinAxis: col(null, /^spin axis/),
        height: col(/max height/, /^height/), carry: col(/carry/, /^length/), side: col(/carry/, /^side/), landAngle: col(/carry/, /^vert\.? angle/), hang: col(/carry/, /^flight time/),
        total: col(/total/, /^length/), totalSide: col(/total/, /^side/) };
      const units = rep.rows[hi + 1] || [], lowPt = (i) => (i >= 0 ? low(units[i]) : "");
      const sp = (i) => (/m\/s/.test(lowPt(i)) ? MPH : 1), ds = (i) => (/\[m\]/.test(lowPt(i)) ? YD : 1);
      for (const row of rep.rows.slice(hi + 1)) {
        const club = row[C.club], d = C.date >= 0 ? excelDate(row[C.date]) : null;
        if (!club || !d || num(row[C.carry]) == null && num(row[C.ballSpeed]) == null) continue;
        player ||= String(row[C.player] ?? "").trim();
        const v = (k, f = 1) => (C[k] >= 0 ? (num(row[C[k]]) ?? null) : null) == null ? null : num(row[C[k]]) * f;
        shots.push(clean({ t: isoLocal(d), c: clubName(club), m: C.tags >= 0 && row[C.tags] != null ? String(row[C.tags]).trim() || null : null, b: C.ball >= 0 ? row[C.ball] || null : null, x: C.use >= 0 && low(row[C.use]) === "no" ? 1 : null,
          carry: v("carry", ds(C.carry)), total: v("total", ds(C.total)), side: v("side", ds(C.side)), totalSide: v("totalSide", ds(C.totalSide)), height: v("height", ds(C.height)), landAngle: v("landAngle"), hang: v("hang"),
          ballSpeed: v("ballSpeed", sp(C.ballSpeed)), clubSpeed: v("clubSpeed", sp(C.clubSpeed)), smash: v("smash"), launch: v("launch"), launchDir: v("launchDir"), spin: v("spin"), spinAxis: v("spinAxis"),
          attack: v("attack"), path: v("path"), face: v("face"), dynLoft: v("dynLoft") }));
      }
    }
  }
  if (!shots.length && dat) {
    // the Data sheet: TrackMan's own names on the 4th header row (LaunchData.ballVelocity …), in metres, m/s, radians and Hz
    const hi = dat.rows.findIndex((row) => row.some((c) => /launchdata\./i.test(String(c ?? ""))));
    if (hi >= 0) {
      const h = dat.rows[hi].map((c) => String(c ?? "")), at = (name) => h.findIndex((c) => c.toLowerCase() === name.toLowerCase());
      const named = dat.rows[hi - 3] || [], dateCol = named.findIndex((c) => low(c) === "date"), clubCol = at("IdentifierData.ClubName"), ballCol = at("IdentifierData.BallType"), plCol = at("IdentifierData.PlayerName");
      for (const row of dat.rows.slice(hi + 1)) {
        const d = excelDate(row[dateCol >= 0 ? dateCol : 0]), club = row[clubCol];
        if (!club || !d) continue;
        player ||= String(row[plCol] ?? "").trim();
        const v = (name, f = 1) => { const i = at(name); const x = i >= 0 ? num(row[i]) : null; return x == null ? null : x * f; };
        const smash = v("LaunchData.smashFactor"), cs = v("LaunchData.clubVelocity", MPH), bs = v("LaunchData.ballVelocity", MPH);
        shots.push(clean({ t: isoLocal(d), c: clubName(club), b: row[ballCol] || null,
          carry: v("LandingData.flat.carry.x", YD), side: v("LandingData.flat.carry.z", YD), total: v("LandingData.total.carry.x", YD), totalSide: v("LandingData.total.carry.z", YD),
          height: v("FlightData.maxHeight.y", YD), landAngle: (() => { const a = v("LandingData.flat.verticalAngle", DEG); return a == null ? null : Math.abs(a); })(), hang: v("LandingData.flat.timeOfFlight"),
          ballSpeed: bs, clubSpeed: cs, smash: smash ?? (bs && cs ? bs / cs : null), launch: v("LaunchData.ballVerticalLaunchAngle", DEG), launchDir: v("LaunchData.ballHorizontalLaunchAngle", DEG),
          spin: v("LaunchData.spinRate", 60), spinAxis: v("LaunchData.SpinAxisVertical", DEG), attack: v("LaunchData.attackAngle", DEG), path: v("LaunchData.SwingPath", DEG), face: v("LaunchData.FaceAngle", DEG), dynLoft: v("LaunchData.DynamicLoft", DEG) }));
      }
    }
  }
  return session({ src: "trackman", via: "excel", name: fileName, player, shots });
}

/* ---------------- GCQuad's CSV export (and any other launch monitor CSV with its own column names) ---------------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split("\n").find((l) => l.split(",").filter(Boolean).length > 3) || text.split("\n")[0];
  const delim = (first.match(/\t/g) || []).length > 2 ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// [key, header pattern, not pattern]: GCQuad's names ("Ball Speed (mph)", "Offline (yards : + is right)") and the usual others
const CSV_COLS = [
  ["ballSpeed", /^ball ?speed/], ["clubSpeed", /^club ?(head )?speed/], ["smash", /^(efficiency|smash)/], ["launch", /^(launch angle|vla|vertical launch)/], ["launchDir", /^(side angle|launch direction|hla|horizontal launch)/],
  ["spin", /^(total spin|spin rate|spin \()/], ["backSpin", /^back ?spin/], ["sideSpin", /^side ?spin/], ["spinAxis", /^(tilt angle|spin axis)/], ["height", /^(peak height|max height|apex|height)/],
  ["carry", /^carry( dist(ance)?)?( |\(|$)/, /side|offline|lateral/], ["total", /^(range|total)( dist(ance)?)?( |\(|$)/, /side|spin|offline|ball/], ["side", /^(offline|carry side|side carry|lateral)/], ["totalSide", /^(total side|side total|total offline)/],
  ["landAngle", /^(descent angle|land(ing)? angle)/], ["hang", /^(hang|flight) time/], ["attack", /^(angle of attack|attack angle|aoa)/], ["path", /^club ?path/], ["face", /^(face to target|face angle)/],
  ["faceToPath", /^face to path/], ["dynLoft", /^(loft|dynamic loft|dyn\.? loft)( |\(|$)/],
];
export function fromCsv(text, fileName = "") {
  const rows = parseCsv(text);
  const hi = rows.findIndex((row) => row.some((c) => /^club/i.test(String(c).trim())) && row.some((c) => /carry|ball speed/i.test(String(c))));
  if (hi < 0) return session({ src: "gcquad", via: "csv", name: fileName, shots: [] });
  const h = rows[hi].map((c) => low(c));
  const gc = h.some((c) => /^shot id$/.test(c)) && h.some((c) => /^club type$/.test(c)); // GCQuad (FSX) export
  const find = (re, not) => h.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const C = Object.fromEntries(CSV_COLS.map(([k, re, not]) => [k, find(re, not)]));
  const club = find(/^club( type| name)?$/), model = find(/^(club id|club model|model|tags?)$/), sel = find(/^selected$/), dateC = find(/^date/), timeC = find(/^time$/), ball = find(/^(range ball|ball( type)?)$/), player = rows.slice(0, hi).find((r0) => /player'?s name/i.test(r0[0] || ""))?.[1] || "";
  const shots = [];
  for (const row of rows.slice(hi + 1)) {
    if (!row[club] || (num(row[C.carry]) == null && num(row[C.ballSpeed]) == null)) continue;
    if (sel >= 0 && low(row[sel]) === "no") continue;
    const d = (() => { const ds = String(row[dateC] ?? "").trim(), ts = String(timeC >= 0 ? row[timeC] ?? "" : "").trim().replace(/\s+[A-Z]{2,4}$/, "");
      const t = new Date(`${ds} ${ts}`.trim()); return isNaN(t) ? null : t; })();
    const v = (k) => (C[k] >= 0 ? num(row[C[k]]) : null);
    const side = v("side");
    shots.push(clean({ t: d ? isoLocal(d) : null, c: clubName(row[club]), m: model >= 0 && String(row[model] ?? "").trim() ? String(row[model]).trim() : null, b: ball >= 0 && low(row[ball]) === "yes" ? "Range" : null,
      carry: v("carry"), total: v("total"), side, totalSide: v("totalSide") ?? (gc ? side : null), height: v("height"), landAngle: v("landAngle"), hang: v("hang"),
      ballSpeed: v("ballSpeed"), clubSpeed: v("clubSpeed"), smash: v("smash"), launch: v("launch"), launchDir: v("launchDir"), spin: v("spin") ?? (v("backSpin") != null ? Math.hypot(v("backSpin"), v("sideSpin") || 0) : null), spinAxis: v("spinAxis"),
      attack: v("attack"), path: v("path"), face: v("face"), faceToPath: v("faceToPath"), dynLoft: v("dynLoft") }));
  }
  // a TrackMan CSV (its own names) is TrackMan's; everything else came from a GCQuad
  const tm = /trackman/i.test(fileName) || h.some((c) => /^tmd|spin loft|swing direction/.test(c));
  return session({ src: tm ? "trackman" : "gcquad", via: "csv", name: fileName, player: String(player || "").trim(), shots });
}

/** Any file: .xlsx / .xlsm (TrackMan's Excel), .csv (GCQuad, or another). */
export async function fromFile(file) {
  const name = file.name || "", ext = name.split(".").pop().toLowerCase();
  if (["xlsx", "xlsm", "xls"].includes(ext)) {
    if (ext === "xls") throw new Error("Old .xls files can't be read: save it as .xlsx first.");
    return fromTrackmanSheets(await readXlsx(await file.arrayBuffer()), name);
  }
  return fromCsv(await file.text(), name);
}

/* ---------------- the session ---------------- */
function clean(s) { const o = {}; for (const [k, v] of Object.entries(s)) { if (v == null || (typeof v === "number" && !Number.isFinite(v))) continue; o[k] = typeof v === "number" ? r(v, k === "smash" ? 3 : k === "spin" ? 0 : 2) : v; } return o; }
function session({ src, via, name = "", link = "", player = "", key = "", shots }) {
  const ts = shots.map((s) => s.t).filter(Boolean).sort();
  return { src, via, name, link: link || null, player: player || null, date: (ts[0] || "").slice(0, 10) || new Date().toISOString().slice(0, 10), dateTo: (ts.at(-1) || "").slice(0, 10) || null,
    key: key || `${src}:${ts[0] || ""}:${ts.at(-1) || ""}:${shots.length}`, shots };
}

/* ---------------- numbers for the page ---------------- */
/** (update 701) each shot's row: its club, and its model too when that club was hit with more than one model. */
export function withGroups(shots) {
  const models = new Map();
  for (const s of shots) (models.get(s.c) || models.set(s.c, new Set()).get(s.c)).add(s.m || "");
  return shots.map((s) => ({ ...s, g: models.get(s.c).size > 1 ? (s.m ? `${s.c} · ${s.m}` : `${s.c} · no model`) : s.c }));
}
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
const vals = (shots, k) => shots.map((s) => s[k]).filter((v) => v != null && Number.isFinite(v));
/** Each club's averages (and the spread of carry and side), in bag order. */
export function byClub(shots) {
  // (update 701) a club with more than one model (TrackMan tags, GCQuad Club ID) is a row for each: "Driver · Paradym TD 8.5"
  const m = new Map(), clubOf = new Map();
  for (const s of shots) { const g = s.g || s.c; (m.get(g) || m.set(g, []).get(g)).push(s); clubOf.set(g, s.c); }
  const order = sortClubs([...new Set(clubOf.values())]);
  return [...m.keys()].sort((a, b) => order.indexOf(clubOf.get(a)) - order.indexOf(clubOf.get(b)) || String(a).localeCompare(String(b))).map((c) => { const ss = m.get(c); return { club: c, shots: ss, n: ss.length, avg: Object.fromEntries(LM_METRICS.map(([k]) => [k, mean(vals(ss, k))])), sd: { carry: sd(vals(ss, "carry")), side: sd(vals(ss, "side")), total: sd(vals(ss, "total")), totalSide: sd(vals(ss, "totalSide")) } }; });
}
/** A club's spread on the dispersion map: the middle, the two axes' half lengths (k standard deviations) and the angle. */
export function ellipse(pts, k = 2) {
  if (pts.length < 3) return null;
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let a = 0, b = 0, c = 0; for (const [x, y] of pts) { a += (x - mx) ** 2; b += (x - mx) * (y - my); c += (y - my) ** 2; }
  a /= pts.length - 1; b /= pts.length - 1; c /= pts.length - 1;
  const tr = (a + c) / 2, det = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b)), l1 = tr + det, l2 = Math.max(0, tr - det);
  const ang = Math.abs(b) < 1e-12 ? (a >= c ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  return { cx: mx, cy: my, rx: k * Math.sqrt(l1), ry: k * Math.sqrt(l2), ang };
}
