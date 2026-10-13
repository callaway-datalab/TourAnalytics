/*
 * My Clubs launch data (update 152): every number a GCQuad (FSX) or TrackMan CSV export carries, per shot,
 * named the same way whichever monitor it came from.
 *
 *   readLaunchFile(text) -> { shots: [{ club?, m: { key: value } }], keys: [metric keys found] }
 *   A shot also keeps carry / total / offline / ball / spin / launch / height at the top level (the aim maps use them).
 */
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

/** The numbers, in the order they're shown: [key, label, unit, decimals, header pattern, not-pattern]. */
export const METRICS = [
  ["clubSpeed", "Club speed", "mph", 1, /club ?(head )?speed|clubhead speed/, /ball/],
  ["ballSpeed", "Ball speed", "mph", 1, /ball speed/, null],
  ["smash", "Smash factor", "", 2, /smash/, null],
  ["launch", "Launch angle", "°", 1, /launch angle|^launch( |\(|\[|$)|^vla|vertical launch|launch v\b/, /direction|horiz|hla/],
  ["launchDir", "Launch direction", "°", 1, /launch direction|^hla|horizontal launch|launch h\b|azimuth/, null],
  ["spin", "Spin rate", "rpm", 0, /total spin|^spin( rate)?( |\(|\[|$)|spin rate/, /axis|side|back|loft/],
  ["backSpin", "Back spin", "rpm", 0, /back ?spin/, null],
  ["sideSpin", "Side spin", "rpm", 0, /side ?spin/, null],
  ["spinAxis", "Spin axis", "°", 1, /spin axis|spin tilt/, null],
  ["attack", "Attack angle", "°", 1, /attack angle|angle of attack|^aoa/, null],
  ["path", "Club path", "°", 1, /club path|^path( |\(|\[|$)|swing path/, null],
  ["face", "Face angle", "°", 1, /face angle|face to target|^face( |\(|\[|$)/, /path/],
  ["faceToPath", "Face to path", "°", 1, /face to path/, null],
  ["dynLoft", "Dynamic loft", "°", 1, /dynamic loft|delivered loft/, null],
  ["swingPlane", "Swing plane", "°", 1, /swing plane/, null],
  ["impactH", "Impact offset", "mm", 0, /impact (offset|horiz)|horizontal impact|face impact h|impact location h|^offset/, null],
  ["impactV", "Impact height", "mm", 0, /impact (height|vert)|vertical impact|face impact v|impact location v/, null],
  ["height", "Peak height", "yds", 0, /peak height|^apex|max height|^height( |\(|\[|$)/, null],
  ["landAngle", "Descent angle", "°", 1, /land(ing)? angle|descent angle/, null],
  ["hang", "Hang time", "s", 1, /hang time|flight time/, null],
  ["carry", "Carry", "yds", 1, /^carry( dist(ance)?)?( |\(|\[|$)|carry dist/, /side|flat|time|lateral/],
  ["total", "Total", "yds", 1, /^total( dist(ance)?)?( |\(|\[|$)|total dist/, /side|spin|lateral/],
  ["offline", "Offline", "yds", 1, /total side|side total|^offline|total lateral|lateral total/, null],
  ["carrySide", "Carry offline", "yds", 1, /carry side|side carry|carry lateral|lateral carry|carry deviation/, null],
];
export const METRIC = Object.fromEntries(METRICS.map(([k, label, unit, dp]) => [k, { label, unit, dp }]));

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split("\n")[0];
  const delim = (first.match(/\t/g) || []).length > 1 ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
// "12.3 L" / "R 4.1" / "-3.2": left (and a left-pointing angle) is negative
const num = (v) => {
  if (v == null) return null;
  const t = String(v).trim(), m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/(^|[\s\d])(l|left)\b/i.test(t) && n > 0) n = -n;
  return n;
};

/** Every shot in a launch monitor CSV, with every number it has. */
export function readLaunchFile(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => r.some((c) => /carry|ball speed|total/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find the launch numbers (Ball Speed, Carry…) in that file. Export it as a CSV from your GCQuad or TrackMan.");
  const head = rows[hi].map((c) => c.trim().toLowerCase().replace(/\s+/g, " "));
  const used = new Set();
  const cols = [];
  for (const [key, , , , re, not] of METRICS) {
    const i = head.findIndex((h, j) => !used.has(j) && re.test(h) && !(not && not.test(h)));
    if (i >= 0) { used.add(i); cols.push([key, i, head[i]]); }
  }
  const iClub = head.findIndex((h) => /^club( |\(|\[|$)|club name|club type|^club$/.test(h) && !/speed|path|face|head|loft/.test(h));
  // heights in feet (some exports) → yards, so every file reads the same
  const feet = (key, h) => key === "height" && /\bft\b|feet/.test(h);
  const shots = [];
  for (const r of rows.slice(hi + 1)) {
    const m = {};
    for (const [key, i, h] of cols) { const v = num(r[i]); if (v != null && Number.isFinite(v)) m[key] = feet(key, h) ? v / 3 : v; }
    if (m.carry == null && m.ballSpeed == null && m.total == null) continue; // (a units row, an average row, a blank)
    if (m.smash == null && m.ballSpeed && m.clubSpeed) m.smash = m.ballSpeed / m.clubSpeed;
    const shot = { m, carry: m.carry ?? null, total: m.total ?? m.carry ?? null, offline: m.offline ?? m.carrySide ?? 0, ball: m.ballSpeed ?? null, spin: m.spin ?? m.backSpin ?? null, launch: m.launch ?? null, height: m.height ?? null };
    if (r.some((c) => /^(avg|average|mean|std\.? ?dev|deviation)\b/i.test(String(c).trim()))) continue; // (a summary row)
    if (iClub >= 0 && r[iClub]?.trim()) shot.club = r[iClub].trim();
    shots.push(shot);
  }
  if (!shots.length) throw new Error("No shots in that file.");
  const keys = METRICS.map(([k]) => k).filter((k) => shots.some((s) => s.m[k] != null));
  return { shots, keys };
}

/** Each number's average, spread and range over a club's shots: { key: { avg, sd, lo, hi, n } }. */
export function launchStats(shots) {
  const out = {};
  for (const [key] of METRICS) {
    const v = shots.map((s) => s.m?.[key]).filter((x) => x != null && Number.isFinite(x));
    if (v.length) out[key] = { avg: mean(v), sd: sd(v), lo: Math.min(...v), hi: Math.max(...v), n: v.length };
  }
  return out;
}

export const fmtMetric = (key, v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = METRIC[key]?.dp ?? 1;
  const s = (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
  const deg = METRIC[key]?.unit === "\u00b0" ? "\u00b0" : "";
  return ["offline", "carrySide", "launchDir", "path", "face", "faceToPath", "spinAxis"].includes(key) && Number(s) !== 0 ? `${s.replace("-", "")}${deg} ${v < 0 ? "L" : "R"}` : `${s}${deg}`;
};
