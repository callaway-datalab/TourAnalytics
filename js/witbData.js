// (update 828) What's in the Bag from the stats data: the clubs a player hit at their latest events (the shot data's own
// club, e.g. "7 Iron", with the brand and model hit most with it there) and their ball. WITB shows it for every player
// (one who has never signed in too), and fills an empty bag with it (their own, or as their caddie).
import * as PI from "./playerInsights.js";
import { gearInfo } from "./sg.js";
// (the club order as bag.js sorts it: driver, woods, hybrids, irons, wedges, putter; kept here so this needs no database)
function clubRank(label) { const t = String(label), n = parseFloat(t.replace(/[^\d.]/g, "")) || 0;
  if (/^driver/i.test(t)) return n / 100; if (/^\d+w$/i.test(t)) return 1 + n / 100; if (/^\d+H$/.test(t)) return 2 + n / 100; if (/^\d+i$/i.test(t)) return 3 + n / 100;
  if (/^PW$/i.test(t)) return 3.98; if (/^AW$/i.test(t)) return 3.99; if (/wedge/i.test(t)) return 4 + n / 1000; if (/putter/i.test(t)) return 5; return 6; }

const deg = (n) => `${n}°`;
const DRIVER_LOFTS = [7, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12], WEDGE_LOFTS = [44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64];
const near = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
/** the shot data's club name, and its kind from the model ("Iron|…"), as a WITB club { cat, type } (null: can't tell which) */
export function witbClub(label, kind) {
  const t = String(label || "").toLowerCase().replace(/[-_]/g, " ").trim(), num = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  if (!t && !kind) return null;
  if (/putt/.test(t) || kind === "Putter") return { cat: "Putter", type: "Putter" };
  if (/driver|^dr$|^1w$/.test(t) || (kind === "Driver" && !/wood|\dw\b/.test(t))) { const l = num(/(\d+(?:\.\d+)?)\s*(?:°|deg)/); return { cat: "Driver", type: l ? deg(near(DRIVER_LOFTS, l)) : "Driver" }; }
  const w = num(/^(\d+)\s*(?:w|wood|fw|fairway)\b/) ?? num(/(\d+)\s*wood/); if (w) return { cat: "Fairway Wood", type: `${w}w` };
  const h = num(/^(\d+)\s*(?:h|hy|hyb|hybrid|rescue)\b/) ?? num(/(\d+)\s*hybrid/); if (h) return { cat: "Hybrid", type: `${h}H` };
  if (/^(pw|p|pitching)/.test(t)) return { cat: "Iron", type: "PW" };
  if (/^(aw|gw|uw|approach|gap)/.test(t)) return { cat: "Iron", type: "AW" };
  const i = num(/^(\d+)\s*(?:i|iron)\b/) ?? num(/(\d+)\s*iron/); if (i) return { cat: "Iron", type: `${i}i` };
  const l = num(/(\d{2})\s*(?:°|deg|degree)?\s*(?:wedge|w)?$/) ?? num(/(\d{2})\s*(?:°|deg)/); if (l && l >= 40 && l <= 66) return { cat: "Wedge", type: deg(near(WEDGE_LOFTS, l)) };
  if (/^(sw|sand)/.test(t)) return { cat: "Wedge", type: "Wedge" };
  if (/^(lw|lob)/.test(t)) return { cat: "Wedge", type: "Wedge" };
  return null;
}

/** { year, tour, events: [names], clubs: [{ label, cat, type, brand, model, rounds, sg }], ball } from the last 3 events */
export async function tourBag(key, name) {
  if (!key) return null;
  const rounds = await PI.loadShots(key, name).catch(() => []); if (!rounds.length) return null;
  const tour = [...new Set(rounds.map((r) => r.tour).filter(Boolean))].sort((a, b) => rounds.filter((r) => r.tour === b).length - rounds.filter((r) => r.tour === a).length)[0] || null;
  const mine = rounds.filter((r) => !tour || r.tour === tour), year = [...new Set(mine.map(PI.yrOf))].sort().at(-1), rs = mine.filter((r) => PI.yrOf(r) === year);
  // the clubs hit at the last 5 events (a club that comes out now and then, a 3-wood or a 60°, still shows); each club's
  // model: the one hit most with it at the latest of those events it was used at
  const evs = PI.eventsOf(rs), recent = evs.slice(-5), recentRs = recent.flatMap((e) => e.rs);
  const by = new Map(); // club label → the latest event's { gear → shots }
  for (const e of recent) for (const r of e.rs) for (const s of r.shots || []) { const lbl = s.club || null; if (!lbl) continue;
    let o = by.get(lbl); if (!o || o.ev !== e) { if (!o || evs.indexOf(e) >= evs.indexOf(o.ev)) { o = { ev: e, m: o?.ev === e ? o.m : new Map() }; by.set(lbl, o); } else continue; }
    const g = s.gear || ""; o.m.set(g, (o.m.get(g) || 0) + (s.w || 1)); }
  const clubs = [];
  for (const [lbl, { m }] of by) { const g = [...m].sort((a, b) => b[1] - a[1])[0][0], gi = g ? gearInfo(g) : {}, kind = g ? String(g).split("|")[0] : null, w = witbClub(lbl, kind);
    const used = rs.filter((r) => (r.shots || []).some((s) => s.club === lbl)), sg = used.reduce((t, r) => t + (r.shots || []).reduce((u, s) => u + (s.club === lbl ? s.sg || 0 : 0), 0), 0);
    clubs.push({ label: lbl, cat: w?.cat || null, type: w?.type || null, brand: gi.brand || "", model: gi.model || "", rounds: used.length, sg: used.length ? sg / used.length : null }); }
  clubs.sort((a, b) => clubRank(a.type && a.cat ? (a.cat === "Driver" ? `Driver ${a.type}` : a.cat === "Wedge" ? `${a.type} wedge` : a.type) : a.label) - clubRank(b.type && b.cat ? (b.cat === "Driver" ? `Driver ${b.type}` : b.cat === "Wedge" ? `${b.type} wedge` : b.type) : b.label));
  const bm = new Map(); for (const r of recentRs) for (const s of r.shots || []) if (s.ball) bm.set(s.ball, (bm.get(s.ball) || 0) + 1);
  const ball = [...bm].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { year, tour, events: recent.map((e) => `${PI.evName(e.event)} ${e.year}`), clubs, ball };
}
