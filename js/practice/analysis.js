/*
 * Practice numbers (update 136): a session's summary, all your sessions together, your on-course strokes gained by
 * the same buckets (from the Stats data), your own shot pattern for the aim maps, and reading results from a
 * launch monitor file or from what you said.
 */
import { BUCKETS, teeResult, greenResult, scoreShot } from "./model.js";
import { wordsToNumbers, golfFix } from "../voiceShots.js";

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const pct = (k, n) => (n ? (100 * k) / n : null);

/** Shots with a result, each with its strokes gained. */
export const scored = (shots) => shots.filter((s) => s.result).map((s) => ({ ...s, sg: s.sg ?? scoreShot(s) }));

/** One set of shots (a session, or every session) summed up: totals, per bucket, and the category's key numbers. */
export function summarize(cat, shots) {
  const done = scored(shots);
  const sg = done.reduce((t, s) => t + (s.sg || 0), 0);
  const byBucket = BUCKETS[cat].map((b) => {
    const list = done.filter((s) => s.bucket === b.id);
    return { id: b.id, label: b.label, n: list.length, sg: list.reduce((t, s) => t + s.sg, 0), sgPer: list.length ? list.reduce((t, s) => t + s.sg, 0) / list.length : null, ...keyNumbers(cat, list) };
  });
  return { n: done.length, sg, sgPer: done.length ? sg / done.length : null, ...keyNumbers(cat, done), byBucket };
}

/** The numbers that matter for each category. */
export function keyNumbers(cat, done) {
  const n = done.length;
  if (!n) return {};
  if (cat === "OTT") {
    const fw = done.filter((s) => s.result.lie === "Fairway").length, pen = done.filter((s) => s.result.penalty).length;
    const off = done.map((s) => s.result.offline).filter((v) => v != null), tot = done.map((s) => s.result.total).filter((v) => v != null);
    return { fairwayPct: pct(fw, n), penaltyPct: pct(pen, n), avgTotal: mean(tot), avgOffline: mean(off.map(Math.abs)), leftPct: pct(off.filter((v) => v < -0.5).length, off.length), sdOffline: sd(off), sdTotal: sd(tot) };
  }
  if (cat === "PUTT") {
    const made = done.filter((s) => s.result.lie === "Holed").length, miss = done.filter((s) => s.result.lie !== "Holed");
    const leave = miss.map((s) => s.result.dist).filter((v) => v != null);
    const long = miss.filter((s) => s.result.y != null && s.result.y > 0).length, withY = miss.filter((s) => s.result.y != null).length;
    // the "pro side": a breaking putt that misses on the high side (above the hole)
    const brk = miss.filter((s) => s.breakDir !== "straight" && s.result.x != null);
    const high = brk.filter((s) => (s.breakDir === "lr" ? s.result.x < 0 : s.result.x > 0)).length;
    return { makePct: pct(made, n), avgLeave: mean(leave), within3Pct: pct(miss.filter((s) => s.result.dist <= 3).length, miss.length), longPct: pct(long, withY), proSidePct: pct(high, brk.length) };
  }
  // approach / around the green: proximity (ft), greens hit, the pattern round the pin
  const prox = done.map((s) => (s.result.lie === "Holed" ? 0 : s.result.unit === "ft" ? s.result.dist : s.result.dist * 3)).filter((v) => v != null);
  const green = done.filter((s) => s.result.lie === "Green" || s.result.lie === "Holed").length;
  const pts = done.filter((s) => s.result.x != null);
  const dx = pts.map((s) => s.result.x - s.pin.x), dy = pts.map((s) => s.result.y - s.pin.y);
  return { greenPct: pct(green, n), avgProx: mean(prox), medProx: prox.length ? [...prox].sort((a, b) => a - b)[Math.floor(prox.length / 2)] : null,
    penaltyPct: pct(done.filter((s) => s.result.penalty).length, n), longPct: pct(dy.filter((v) => v > 0).length, dy.length), rightPct: pct(dx.filter((v) => v > 0).length, dx.length),
    holed: done.filter((s) => s.result.lie === "Holed").length };
}

/** Your own shot pattern from past sessions, for the aim maps (null until there are enough shots). */
export function personalSpread(cat, sessions, club = null) {
  const shots = sessions.filter((s) => s.cat === cat && s.status === "done").flatMap((s) => scored(s.shots || []));
  if (cat === "OTT") {
    const mine = shots.filter((s) => !club || s.club === club).map((s) => s.result).filter((r) => r.offline != null && r.total != null);
    if (mine.length < 12) return null;
    return { sx: Math.max(5, sd(mine.map((r) => r.offline))), sy: Math.max(5, sd(mine.map((r) => r.total))), n: mine.length };
  }
  if (cat === "PUTT") return null;
  const pts = shots.filter((s) => s.result.x != null && s.startDist);
  if (pts.length < 12) return null;
  // as a share of the distance, so it scales from 60 yds to 220
  const fx = sd(pts.map((s) => (s.result.x - s.pin.x) / s.startDist)), fy = sd(pts.map((s) => (s.result.y - s.pin.y) / s.startDist));
  return { fx, fy, n: pts.length };
}

/* --------------------------------------------- on course: the Stats data, by the same buckets --------------------------------------------- */
const midOf = (label) => {
  const t = String(label || ""), nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  if (/^\s*(<|under)/i.test(t)) return nums[0] - 1;
  if (/\+|>|over/i.test(t) && nums.length === 1) return nums[0] + 5;
  return nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
};
/**
 * Your strokes gained per shot on the course, by practice bucket: { bucketId: { sgPer, n } }.
 * rounds: prepared rounds (the Tour Events file and your entered rounds).
 */
export function courseByBucket(cat, rounds) {
  const out = {};
  const add = (id, sg, w) => { const o = (out[id] ||= { sg: 0, n: 0 }); o.sg += sg; o.n += w; };
  for (const rd of rounds) for (const s of rd.shots || []) {
    if (s.cat !== cat || s.sg == null) continue;
    const w = s.w || 1;
    if (cat === "OTT") {
      const label = String(s.dist || s.club || "");
      if (/non/i.test(label)) { add("wood", s.sg, w); add("iron", s.sg, w); }
      else if (/driver/i.test(label) || /driver/i.test(s.clubCat || "")) add("driver", s.sg, w);
      else if (/wood/i.test(s.clubCat || "")) add("wood", s.sg, w);
      else if (s.clubCat) add("iron", s.sg, w);
      else add("driver", s.sg, w); // (a tee shot with nothing said about the club: most are drivers)
      continue;
    }
    const m = midOf(s.dist);
    if (m == null) continue;
    const b = BUCKETS[cat].find((x) => m >= x.lo && m < x.hi) || (m >= BUCKETS[cat].at(-1).hi ? BUCKETS[cat].at(-1) : null);
    if (b) add(b.id, s.sg, w);
  }
  for (const k of Object.keys(out)) out[k].sgPer = out[k].n ? out[k].sg / out[k].n : null;
  return out;
}

/* --------------------------------------------- a launch monitor file (CSV) --------------------------------------------- */
function parseCsv(text) {
  const delim = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
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
/** Shots from a launch monitor's CSV export: [{ carry, total, offline }] (offline: − left, + right; yds). */
export function readLaunchMonitor(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => r.some((c) => /carry|total/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find Carry / Total columns in that file.");
  const head = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re, not = null) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iCarry = col(/^carry( |\(|\[|$)|carry dist|carry distance/, /side|flat|time/), iTotal = col(/^total( |\(|\[|$)|total dist|total distance/, /side|spin/);
  const iSide = [col(/total side|side total/), col(/^offline|offline/), col(/carry side|side carry/), col(/^side( |\(|\[|$)|lateral/)].find((i) => i >= 0) ?? -1;
  const num = (v) => {
    if (v == null) return null;
    const t = String(v).trim(), m = t.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    let n = Number(m[0]);
    if (/l\b|left/i.test(t) && n > 0) n = -n; // "12.3 L"
    return n;
  };
  const iClub = col(/^club( |\(|\[|$)|club name|club type|^club$/, /speed|path|face|head/);
  const iBall = col(/ball speed/), iSpin = col(/total spin|^spin( |\(|\[|$)|spin rate|back spin|backspin/, /axis|side spin|sidespin/), iLaunch = col(/launch angle|^launch( |\(|\[|$)|vla|vertical launch/, /direction|hla|horizontal/);
  const iHeight = col(/^height|apex|peak height|max height/);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const carry = iCarry >= 0 ? num(r[iCarry]) : null, total = iTotal >= 0 ? num(r[iTotal]) : null;
    if (carry == null && total == null) continue; // (a units row, or a blank)
    const o = { carry, total: total ?? carry, offline: iSide >= 0 ? num(r[iSide]) ?? 0 : 0 };
    if (iClub >= 0 && r[iClub]?.trim()) o.club = r[iClub].trim();
    if (iBall >= 0) o.ball = num(r[iBall]);
    if (iSpin >= 0) o.spin = num(r[iSpin]);
    if (iLaunch >= 0) o.launch = num(r[iLaunch]);
    if (iHeight >= 0) o.height = num(r[iHeight]);
    out.push(o);
  }
  if (!out.length) throw new Error("No shots in that file.");
  return out;
}
/** Turn a launch monitor shot into this shot's result (tee shots and approaches). */
export function resultFromMonitor(shot, m) {
  if (shot.kind === "tee") return { ...teeResult(shot, Math.round(m.total), Math.round(m.offline)), total: Math.round(m.total), offline: Math.round(m.offline), source: "monitor" };
  // along the line from where you played to the pin, then off it
  const sx = shot.from.x, sy = shot.from.y, d = Math.hypot(shot.pin.x - sx, shot.pin.y - sy) || 1;
  const ux = (shot.pin.x - sx) / d, uy = (shot.pin.y - sy) / d;
  const x = sx + ux * m.total + uy * m.offline, y = sy + uy * m.total - ux * m.offline;
  return { ...greenResult(shot, x, y), source: "monitor" };
}

/* --------------------------------------------- what you said ("285, 12 left", "14 feet short", "made it") --------------------------------------------- */
export function resultFromSpeech(shot, said) {
  let t = ` ${wordsToNumbers(golfFix(said)).toLowerCase()} `;
  // "two eighty five" comes out as "2 85": a drive's distance said the golf way
  if (shot.kind === "tee") t = t.replace(/\b([1-3]) (\d{2})\b/, (m, h, r) => String(Number(h) * 100 + Number(r)));
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => ({ v: Number(m[1]), at: m.index }));
  const has = (re) => re.test(t);
  if (shot.kind === "tee") {
    const total = nums.find((n) => n.v >= 100)?.v;
    if (!total) return null;
    let off = 0;
    const side = has(/\bleft\b/) ? -1 : has(/\bright\b/) ? 1 : 0;
    const o = nums.find((n) => n.v < 100);
    if (side && o) off = side * o.v;
    else if (side && has(/\b(water|ob|out of bounds|hazard)\b/)) off = side * (shot.width / 2 + shot.sides[side < 0 ? "left" : "right"].at + 3);
    else if (side && has(/\brough\b/)) off = side * (shot.width / 2 + 5);
    return { ...teeResult(shot, total, off), total, offline: off, source: "voice" };
  }
  if (has(/\b(holed|made|make|in the hole|in the cup|drained|sank|went in|chipped in)\b/) && !has(/\bmiss/)) return { lie: "Holed", dist: 0, unit: "ft", x: shot.kind === "putt" ? 0 : shot.pin.x, y: shot.kind === "putt" ? 0 : shot.pin.y, source: "voice" };
  if (shot.kind !== "putt" && has(/\b(water|wet|hazard)\b/) && !nums.length) return { lie: "Penalty", penalty: "water", dist: Math.max(5, Math.round(shot.startDist / 4)), unit: "yds", source: "voice" };
  const n = nums[0]?.v;
  if (n == null) return null;
  const feet = has(/\b(feet|foot|ft)\b/) || shot.kind === "putt";
  const yards = has(/\b(yards?|yds?)\b/);
  // which way it missed (for the pattern): short / long / left / right
  let dx = (has(/\bleft\b/) ? -1 : 0) + (has(/\bright\b/) ? 1 : 0), dy = (has(/\b(long|past|by)\b/) ? 1 : 0) + (has(/\bshort\b/) ? -1 : 0);
  if (shot.kind === "putt") {
    const k = Math.hypot(dx, dy) || 0;
    return { lie: "Green", dist: n, unit: "ft", ...(k ? { x: (dx / k) * n, y: (dy / k) * n } : {}), source: "voice" };
  }
  let lie = has(/\b(water|wet|hazard)\b/) ? "Penalty" : has(/\b(bunker|sand|trap)\b/) ? "Bunker" : has(/\brough\b/) ? "Rough" : has(/\b(fringe|collar|apron)\b/) ? "Fringe" : has(/\bgreen\b/) ? "Green" : feet && !yards ? "Green" : "Rough";
  const unit = lie === "Green" || lie === "Fringe" ? "ft" : "yds";
  const dist = unit === "ft" ? (yards ? n * 3 : n) : (feet && !yards ? Math.round(n / 3) : n);
  const k = Math.hypot(dx, dy), r = unit === "ft" ? dist / 3 : dist;
  const pos = k ? { x: shot.pin.x + (dx / k) * r, y: shot.pin.y + (dy / k) * r } : {};
  return { lie, dist, unit, ...(lie === "Penalty" ? { penalty: "water" } : {}), ...pos, source: "voice" };
}
