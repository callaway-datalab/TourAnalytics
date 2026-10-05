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
  const win = Math.max(3, Math.min(x, Math.floor(rs.length / 2)));
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
    out.push({ key, level, cat, dist: dist || null, label: level === "total" ? "SG Total" : level === "cat" ? CAT[cat] || cat : `${CAT[cat] || cat}, ${dist}`, worst, best, now, win });
  }
  const lv = { total: 0, cat: 1, skill: 2 };
  return out.sort((a, b) => lv[a.level] - lv[b.level] || ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || distOrder(a.dist) - distOrder(b.dist));
}
const distOrder = (d) => { const m = String(d ?? "").match(/\d+/); return m ? Number(m[0]) : 9999; };

export const watchGoals = (playerKey, cb) => onSnapshot(doc(db, "goals", playerKey), (s) => cb(s.exists() ? s.data() : null), () => cb(null));
export const saveGoals = (playerKey, skills, deadline, by) => setDoc(doc(db, "goals", playerKey), { skills, deadline: deadline || null, by: by || "", updatedAt: serverTimestamp() });
