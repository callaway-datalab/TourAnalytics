/*
 * Launch Data (update 138): each club's stock pattern — how far it carries, how much that varies, which way it misses
 * and how wide — from launch monitor files and shots you enter, and the gaps between clubs.
 *
 * A club shot: { club, carry, total, offline (− left / + right, yds), ball?, spin?, launch?, height?, at, source }
 * The patterns also feed the aim maps on Practice and rounds (your real spread for the club you'd hit).
 */
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

// The clubs, in bag order (the same names as WITB: Driver, 3w, 4H, 7i, PW, AW, 52°…)
export const CLUB_LIST = ["Driver", "2w", "3w", "4w", "5w", "7w", "9w", "2H", "3H", "4H", "5H", "6H", "7H", "1i", "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "AW", "GW",
  "44°", "46°", "48°", "50°", "52°", "54°", "56°", "58°", "60°", "62°", "64°", "SW", "LW"];
const rank = (c) => { const i = CLUB_LIST.indexOf(c); return i < 0 ? 999 : i; };
export const sortClubs = (list) => [...list].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));

/** Any club name ("Dr", "7 Iron", "7i", "PW", "52 deg", "3 Wood", "4 Hybrid", "Sand Wedge") → the bag's name, or null for a putter / unknown. */
export function normClub(raw) {
  const t = String(raw || "").trim().toLowerCase().replace(/[._-]+/g, " ");
  if (!t || /putt/.test(t)) return null;
  if (/^(dr|drv|driver|1w|1 w|1 wood)\b/.test(t) || /\bdriver\b/.test(t)) return "Driver";
  let m = t.match(/^(\d{2})\s*(°|deg|degree)?\s*(w|wedge)?$/) || t.match(/(\d{2})\s*(°|deg)/);
  if (m && Number(m[1]) >= 44 && Number(m[1]) <= 64) return `${Number(m[1])}°`;
  if (/^(pw|p|pitching|pitching wedge|p wedge)$/.test(t)) return "PW";
  if (/^(aw|approach|approach wedge|a wedge)$/.test(t)) return "AW";
  if (/^(gw|gap|gap wedge|g wedge|uw|utility wedge)$/.test(t)) return "GW";
  if (/^(sw|sand|sand wedge|s wedge)$/.test(t)) return "SW";
  if (/^(lw|lob|lob wedge|l wedge)$/.test(t)) return "LW";
  m = t.match(/^(\d)\s*(w|wd|wood|fw|fairway|fairway wood)$/) || t.match(/^(w|wood|fw)\s*(\d)$/);
  if (m) return `${m[1].match(/\d/) ? m[1] : m[2]}w`;
  m = t.match(/^(\d)\s*(h|hy|hyb|hybrid|r|rescue|ut|utility)$/) || t.match(/^(h|hy|hybrid)\s*(\d)$/);
  if (m) return `${m[1].match(/\d/) ? m[1] : m[2]}H`;
  m = t.match(/^(\d)\s*(i|ir|iron)?$/) || t.match(/^(i|iron)\s*(\d)$/);
  if (m) return `${m[1].match(/\d/) ? m[1] : m[2]}i`;
  return String(raw).trim().slice(0, 12) || null;
}

/** A club's pattern from its shots (the most recent `last`): carry and total, the spread, the miss. */
export function clubStats(shots, { last = 60 } = {}) {
  const list = shots.filter((s) => s.carry != null).slice(-last);
  if (!list.length) return null;
  const carry = list.map((s) => s.carry), total = list.map((s) => s.total ?? s.carry), off = list.map((s) => s.offline ?? 0);
  const n = list.length, sdC = sd(carry), sdO = sd(off), avgO = mean(off);
  return {
    n, carry: mean(carry), total: mean(total), carrySd: sdC, offline: avgO, offlineSd: sdO,
    carryLo: q(carry, 0.1), carryHi: q(carry, 0.9), leftPct: (100 * off.filter((v) => v < -1).length) / n, rightPct: (100 * off.filter((v) => v > 1).length) / n,
    // the width that holds 80% of shots, either side of their middle (for "80% inside X yds of your line")
    width80: q(off.map((v) => Math.abs(v - avgO)), 0.8),
    ball: mean(list.map((s) => s.ball).filter((v) => v != null)), spin: mean(list.map((s) => s.spin).filter((v) => v != null)),
    launch: mean(list.map((s) => s.launch).filter((v) => v != null)), height: mean(list.map((s) => s.height).filter((v) => v != null)),
  };
}

/** Every club's pattern from your Launch Data sessions: { club: stats } (clubs with at least `min` shots). */
export function bagPatterns(sessions, { min = 1 } = {}) {
  const by = new Map();
  for (const s of sessions) if (s.cat === "BAG") for (const x of s.shots || []) if (x.club) (by.get(x.club) || by.set(x.club, []).get(x.club)).push(x);
  const out = {};
  for (const [club, list] of by) { list.sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))); const st = clubStats(list); if (st && st.n >= min) out[club] = { ...st, shots: list }; }
  return out;
}

/** Gaps between clubs (carry), longest first: [{ from, to, gap, note }] — flags gaps over 18 yds and overlaps under 7. */
export function gapping(patterns) {
  const clubs = sortClubs(Object.keys(patterns)).filter((c) => patterns[c].n >= 3).sort((a, b) => patterns[b].carry - patterns[a].carry);
  const out = [];
  for (let i = 0; i < clubs.length - 1; i++) {
    const a = patterns[clubs[i]], b = patterns[clubs[i + 1]], gap = a.carry - b.carry;
    out.push({ from: clubs[i], to: clubs[i + 1], gap, note: gap > 18 ? "big gap" : gap < 7 ? "overlap" : "" });
  }
  return out;
}

/** The club you'd hit from a distance (carry closest to it), and its spread for the aim map — or null. */
export function clubFor(patterns, dist, { min = 8 } = {}) {
  let best = null;
  for (const [club, p] of Object.entries(patterns)) {
    if (club === "Driver" || p.n < min || p.carrySd == null) continue;
    const d = Math.abs(p.carry - dist);
    if (d <= 15 && (!best || d < best.d)) best = { club, d, p };
  }
  return best ? { club: best.club, sx: Math.max(2, best.p.offlineSd), sy: Math.max(2, best.p.carrySd), n: best.p.n } : null;
}
