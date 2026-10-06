// Goals, at three levels: SG Total, each category, and each skill (category + distance). Each has the
// player's worst and best x-round average (the slider's two ends) and where they are now (their last x
// rounds). Stored per player at goals/{playerKey}:
//   { skills: { "TOTAL" | "APP" | "APP|150-175 yds": { value, start, label, setAt } }, deadline: "YYYY-MM-DD", updatedAt, by }
import { doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { CATEGORIES } from "./sg.js";

const CAT = Object.fromEntries(CATEGORIES);
const ORDER = CATEGORIES.map(([k]) => k);
const mean = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);
const byDate = (rounds) => [...rounds].sort((a, b) => String(a.date).localeCompare(String(b.date)));

/**
 * The goal levels, each with the slider's ends (worst and best x-round average) and where the player is now
 * (their last x rounds): SG Total (every shot), each category, and each skill (category + distance).
 *   [{ key: "TOTAL" | "APP" | "APP|150-175 yds", level: "total" | "cat" | "skill", cat, dist, label, worst, best, now, win }]
 * x = the run of rounds averaged (10, or fewer when there aren't enough rounds).
 */
export function goalLevels(me, { x = 10 } = {}) {
  const rs = byDate(me.rounds);
  if (rs.length < 3) return [];
  const win = Math.max(1, Math.min(x, rs.length));
  const series = new Map(), shots = new Map();
  const add = (k, i, v) => { if (!series.has(k)) series.set(k, new Array(rs.length).fill(0)); series.get(k)[i] += v; };
  rs.forEach((rd, i) => {
    add("TOTAL", i, 0);
    for (const sh of rd.shots) {
      add("TOTAL", i, sh.sg);
      if (!sh.cat) continue;
      add(sh.cat, i, sh.sg); shots.set(sh.cat, (shots.get(sh.cat) || 0) + (sh.w || 1));
      if (sh.dist) { const k = `${sh.cat}|${sh.dist}`; add(k, i, sh.sg); shots.set(k, (shots.get(k) || 0) + (sh.w || 1)); }
    }
  });
  const out = [];
  for (const [key, vals] of series) {
    const level = key === "TOTAL" ? "total" : key.includes("|") ? "skill" : "cat";
    if (level !== "total" && (shots.get(key) || 0) < win) continue;
    const rolls = [];
    for (let i = 0; i + win <= vals.length; i++) rolls.push(mean(vals.slice(i, i + win)));
    let worst = Math.min(...rolls), best = Math.max(...rolls);
    const now = mean(vals.slice(-win));
    if (best - worst < 0.04) { worst -= 0.05; best += 0.05; }
    const [cat, dist] = level === "total" ? [null, null] : key.split("|");
    out.push({ key, level, cat, dist: dist || null, label: level === "total" ? "SG Total" : level === "cat" ? CAT[cat] || cat : `${CAT[cat] || cat}, ${dist}`, worst, best, now, win,
      rounds: rs.map((rd, i) => ({ date: rd.date, event: rd.event || "", roundNo: rd.roundNo || "", v: vals[i] })) });
  }
  const lv = { total: 0, cat: 1, skill: 2 };
  return out.sort((a, b) => lv[a.level] - lv[b.level] || ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || distOrder(a.dist) - distOrder(b.dist));
}
const distOrder = (d) => { const m = String(d ?? "").match(/\d+/); return m ? Number(m[0]) : 9999; };

export const watchGoals = (playerKey, cb) => onSnapshot(doc(db, "goals", playerKey), (s) => cb(s.exists() ? s.data() : null), () => cb(null));
export const saveGoals = (playerKey, skills, deadline, by) => setDoc(doc(db, "goals", playerKey), { skills, deadline: deadline || null, by: by || "", updatedAt: serverTimestamp() });
/** Several goal sets ("challenges"), each with its own name, deadline and goals. */
export const saveGoalSets = (playerKey, sets, by) => setDoc(doc(db, "goals", playerKey), { sets, by: by || "", updatedAt: serverTimestamp() }, { merge: true });
/** Quick challenges ("Hit 70% fairways in my next round"), kept beside the goal sets. */
export const saveChallenges = (playerKey, challenges, by) => setDoc(doc(db, "goals", playerKey), { challenges, by: by || "", updatedAt: serverTimestamp() }, { merge: true });

/* ---------------- quick challenges ----------------
   { id, stat, target, measure: "round" | "total" (strokes gained), when: "next" | "nextN" | "week" | "month" | "date",
     n, date, start: "YYYY-MM-DD" (when it was set: only rounds from then count) } */
const per = (c, n, f) => (n ? f : null);
export const CH_STATS = [
  { key: "sg", label: "Strokes gained", short: "SG", kind: "sg", cat: null, higher: true },
  { key: "sgOTT", label: "Off-the-Tee strokes gained", short: "Off-the-Tee", kind: "sg", cat: "OTT", higher: true },
  { key: "sgAPP", label: "Approach strokes gained", short: "Approach", kind: "sg", cat: "APP", higher: true },
  { key: "sgARG", label: "Around-the-Green strokes gained", short: "Around-the-Green", kind: "sg", cat: "ARG", higher: true },
  { key: "sgPUTT", label: "Putting strokes gained", short: "Putting", kind: "sg", cat: "PUTT", higher: true },
  { key: "fwy", label: "Fairways hit", short: "fairways", kind: "basic", unit: "%", higher: true, get: (c) => (c.fwyN ? (c.fwy / c.fwyN) * 100 : null) },
  { key: "gir", label: "Greens in regulation", short: "greens in regulation", kind: "basic", unit: "%", higher: true, get: (c) => (c.holes ? (c.gir / c.holes) * 100 : null) },
  { key: "ud", label: "Up & down", short: "up & down", kind: "basic", unit: "%", higher: true, get: (c) => (c.udN ? (c.ud / c.udN) * 100 : null) },
  { key: "threePutt", label: "3-putt avoidance", short: "3-putt avoidance", kind: "basic", unit: "%", higher: true, get: (c) => (c.puttHoles ? (1 - c.threePutts / c.puttHoles) * 100 : null) },
  { key: "putts", label: "Putts per round", short: "putts a round", kind: "basic", unit: "", higher: false, get: (c) => (c.puttHoles ? (c.putts / c.puttHoles) * 18 : null) },
  { key: "score", label: "Score (per 18 holes)", short: "score", kind: "basic", unit: "", higher: false, get: (c) => (c.holes ? (c.score / c.holes) * 18 : null) },
  { key: "birdies", label: "Birdies per round", short: "birdies a round", kind: "basic", unit: "", higher: true, get: (c, n) => per(c, n, c.birdies / n) },
];
export const CH_WHEN = [["next", "my next round"], ["nextN", "my next … rounds"], ["week", "this week"], ["month", "this month"], ["date", "by a date"]];
const dayOf = (d) => String(d || "").slice(0, 10);
function windowOf(ch) {
  const s = new Date(`${ch.start}T12:00:00`);
  if (ch.when === "week") { const m = new Date(s); m.setDate(s.getDate() - ((s.getDay() + 6) % 7)); const e = new Date(m); e.setDate(m.getDate() + 6); return { from: dayOf(m.toISOString()), to: dayOf(e.toISOString()) }; }
  if (ch.when === "month") { const e = new Date(s.getFullYear(), s.getMonth() + 1, 0, 12); return { from: `${ch.start.slice(0, 7)}-01`, to: dayOf(e.toISOString()) }; }
  if (ch.when === "date") return { from: ch.start, to: ch.date || ch.start };
  return { from: ch.start, to: null, count: ch.when === "next" ? 1 : Math.max(1, ch.n || 3) };
}
/** A challenge's sentence: "Hit at least 70% fairways in my next round". */
export function challengeText(ch) {
  const st = CH_STATS.find((x) => x.key === ch.stat) || CH_STATS[0];
  const when = ch.when === "nextN" ? `in my next ${ch.n} rounds` : ch.when === "next" ? "in my next round" : ch.when === "week" ? "this week" : ch.when === "month" ? "this month" : `by ${new Date(`${ch.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const t = Number(ch.target);
  if (st.kind === "sg") return `Gain ${t >= 0 ? "+" : "\u2212"}${Math.abs(t).toFixed(2)} ${st.short === "SG" ? "strokes" : `${st.short} strokes`}${ch.measure === "total" ? " in total" : " a round"} ${when}`;
  const v = st.unit === "%" ? `${t}%` : String(t);
  return st.higher ? `Hit ${v} ${st.short} or better ${when}` : `Average ${v} ${st.short} or fewer ${when}`;
}
/**
 * How a challenge stands: { status: "waiting" | "progress" | "done" | "missed", value, rounds, needs }.
 * sgRounds: prepared rounds (tour and entered); basicRounds: entered rounds (with their traditional counts).
 */
export function challengeStatus(ch, sgRounds, basicRounds, today = new Date()) {
  const st = CH_STATS.find((x) => x.key === ch.stat) || CH_STATS[0];
  const pool = (st.kind === "sg" ? sgRounds : basicRounds).filter((r) => dayOf(r.date) >= ch.start).sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)));
  const w = windowOf(ch), todayS = dayOf(today.toISOString());
  const rs = w.count ? pool.slice(0, w.count) : pool.filter((r) => dayOf(r.date) >= w.from && dayOf(r.date) <= w.to);
  const closed = w.count ? rs.length >= w.count : todayS > w.to;
  let value = null;
  if (rs.length) {
    if (st.kind === "sg") {
      const tot = rs.reduce((t, r) => t + r.shots.reduce((u, x) => u + (!st.cat || x.cat === st.cat ? x.sg : 0), 0), 0);
      value = ch.measure === "total" ? tot : tot / rs.length;
    } else {
      const c = {}; for (const r of rs) for (const [k, v] of Object.entries(r.basic || {})) c[k] = (c[k] || 0) + v;
      value = st.get(c, rs.length);
    }
  }
  const t = Number(ch.target);
  const met = value != null && (st.higher ? value >= t - 1e-9 : value <= t + 1e-9);
  // a running total (e.g. "+1 putting strokes this week") is done the moment it's reached
  const early = met && st.kind === "sg" && ch.measure === "total" && t > 0;
  const status = !rs.length ? (closed ? "missed" : "waiting") : closed || early ? (met ? "done" : "missed") : "progress";
  // each counted round's own value (for the round-by-round pop-up)
  const each = rs.map((r) => {
    let v = null;
    if (st.kind === "sg") v = r.shots.reduce((u, x) => u + (!st.cat || x.cat === st.cat ? x.sg : 0), 0);
    else v = st.get(r.basic || {}, 1);
    return { date: r.date, event: r.event || r.course || "", roundNo: r.roundNo || "", v };
  });
  // when it finished (a finished goal): the round that settled it, or the end of its week / month / date
  const lastDay = rs.length ? dayOf(rs[rs.length - 1].date) : null;
  const ended = status === "done" || status === "missed" ? (w.count || early ? lastDay : w.to) || ch.start : null;
  return { status, value, rounds: rs.length, met, needs: st.kind === "basic" ? "entered" : null, window: w, each, ended };
}
/** The goal sets in a saved document (an older single set reads as one). */
export function setsOf(d) {
  if (!d) return [];
  if (Array.isArray(d.sets)) return d.sets;
  return d.skills && Object.keys(d.skills).length ? [{ id: "g1", name: "My goals", skills: d.skills, deadline: d.deadline || null }] : [];
}
