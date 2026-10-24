/*
 * Practice plan (update 342): drills added from Stats (Path back to Elite), waiting in Practice › Plan, each a small
 * challenge you repeat until you meet it, with one tap per attempt. Adding a drill also sets a goal on the same stat in
 * real rounds (Goals).
 *
 *   practice/{owner}/plan/{id}   { kind, cat, dist, lie, reps, goal, goalFrom, title, player, playerKey, addedAt, goalId }
 *   practice/{owner}/sessions/{id}  a drill session: { mode: "drill", drillId, drill, status, startedAt, endedAt,
 *                                    sets: [{ marks: [{ v, at }], score, met }], metIn, secs }
 *
 * Drill kinds (what you tap for each attempt):
 *   make     putts up to 20 ft: Holed / Missed; goal: makes out of reps
 *   lag      putts over 20 ft: Inside 3 ft (or holed) / Outside; goal: how many inside
 *   prox     approach: type how many feet from the hole; goal: an average inside N ft
 *   updown   short game: Up and down / Not; goal: how many
 *   fairway  driving: Fairway / Missed; goal: how many
 *   green    approach from the rough, recovery: On the green / Missed; goal: how many
 *   bunker   bunker: Inside 10 ft / Outside; goal: how many
 * The goal is the player's own number from their elite rounds when there's a trusted one, else the Tour average where
 * that's well known (make rates by distance, fairways, up and downs, approach proximity), else "beat your best": the first
 * set sets the mark and every later session has to beat it.
 */
// (Firestore loads only when something is saved or listed, so Stats can show the drills without it)
const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("../firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));

const clean = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.id; return c; };
export const newPlanId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------------- storage ---------------- */
export async function listPlan(owner) {
  if (!owner) return [];
  try { const { getDocs, collection, db } = await fsP(); const snap = await getDocs(collection(db, "practice", owner, "plan")); return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || ""))); } catch { return []; }
}
export async function savePlanItem(owner, item) { const { setDoc, doc, db } = await fsP(); return setDoc(doc(db, "practice", owner, "plan", item.id), clean(item)); }
export async function deletePlanItem(owner, id) { const { deleteDoc, doc, db } = await fsP(); return deleteDoc(doc(db, "practice", owner, "plan", id)); }

/** Where the signed-in person's practice lives (the same as practice/store.js, without loading it). */
export function planOwner(state) {
  const key = state.profile?.clientKey;
  return !state.isAdmin && !state.isTeam && key ? key : state.user?.uid;
}
/** Is Practice open to the person looking? (The admin's only for now, and not in a portal they're previewing.) */
export const practiceOpen = () => !!window.__taCanPractice;

/* ---------------- Tour references (well known averages) ---------------- */
// make rate by distance (Broadie, PGA Tour): ft -> %
const MAKE = [[2, 99], [3, 96], [4, 88], [5, 77], [6, 66], [7, 58], [8, 50], [10, 40], [15, 23], [20, 14], [25, 10], [30, 7]];
// approach proximity by distance: yds -> ft (about the Tour average)
const PROX = [[50, 15], [75, 17], [100, 19], [125, 22], [150, 26], [175, 31], [200, 36], [225, 42], [250, 50]];
const interp = (tbl, x) => {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) { const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return tbl.at(-1)[1];
};
/** The middle of a distance band ("15-20 ft" → 17.5, "<5 ft" → 4, "25+ ft" → 30). */
export function midOf(d) {
  const n = String(d || "").match(/\d+(\.\d+)?/g)?.map(Number) || [];
  if (!n.length) return null;
  if (/^\s*</.test(d)) return n[0] * 0.8;
  if (n.length === 1) return /\+|>/.test(d) ? n[0] * 1.2 : n[0];
  return (n[0] + n[1]) / 2;
}
const ofReps = (pct, reps) => Math.max(1, Math.min(reps, Math.round((pct / 100) * reps)));

/**
 * A drill for a part of the game and distance. t: the target from Path back to Elite ({ k, def, ve, vr } from the
 * player's elite rounds, or null). lie: for the "what hurts" drills (rough, bunker, recovery).
 */
export function drillFor(cat, dist, t = null, lie = null) {
  const ok = t && !t.thin ? t : null, is = (re) => !!(ok && re.test(ok.k));
  const at = dist ? ` from ${dist}` : "";
  const mine = (pct) => ({ goalFrom: "elite", stat: ok.def.label, statV: ok.ve, pct });
  if (lie) {
    if (/sand|bunker/i.test(lie)) return { kind: "bunker", cat: "ARG", lie, reps: 10, goal: null, title: "Bunker shots", what: "Bunker shots from different lies", tap: ["Inside 10 ft", "Outside"] };
    if (/recover|tree|other/i.test(lie)) return { kind: "green", cat: "APP", lie, reps: 10, goal: null, title: "Recovery shots", what: "Punch-outs and low runners to a fairway-sized target", tap: ["In play", "Not"] };
    return { kind: "green", cat: "APP", lie, reps: 10, goal: null, title: `Approaches from the ${String(lie).toLowerCase()}`, what: `Approaches from light and heavy ${String(lie).toLowerCase()} to a green-sized target`, tap: ["On the green", "Missed"] };
  }
  if (cat === "PUTT") {
    const ft = midOf(dist) ?? 5;
    if (ft > 20) {
      const g = is(/goodLag/) ? { goal: ofReps(ok.ve, 10), ...mine(ok.ve) } : { goal: null };
      return { kind: "lag", cat, dist, reps: 10, ...g, title: `Lag putting${at}`, what: `Long putts${at}`, tap: ["Inside 3 ft", "Outside"] };
    }
    const g = is(/^make/) ? { goal: ofReps(ok.ve, 10), ...mine(ok.ve) } : { goal: ofReps(interp(MAKE, ft), 10), goalFrom: "tour", pct: interp(MAKE, ft) };
    return { kind: "make", cat, dist, reps: 10, ...g, title: `${ft <= 8 ? "Short putts" : "Putting"}${at}`, what: `Putts${at}, all round the hole`, tap: ["Holed", "Missed"] };
  }
  if (cat === "APP") {
    const yds = midOf(dist) ?? 150;
    const g = is(/^prox/) ? { goal: Math.round(ok.ve * 10) / 10, ...mine(null) } : { goal: Math.round(interp(PROX, yds)), goalFrom: "tour" };
    return { kind: "prox", cat, dist, reps: 10, ...g, title: `Approach${at}`, what: `Approaches${at} to a pin, measuring how far each finishes from the hole`, unit: "ft" };
  }
  if (cat === "ARG") {
    const g = is(/^ud|scramble/) ? { goal: ofReps(ok.ve, 10), ...mine(ok.ve) } : { goal: 6, goalFrom: "tour", pct: 60 };
    return { kind: "updown", cat, dist, reps: 10, ...g, title: `Short game${at}`, what: `Chips and pitches${at}, then hole out`, tap: ["Up and down", "Not"] };
  }
  if (cat === "OTT") {
    const g = is(/^fwy|fairway/) ? { goal: ofReps(ok.ve, 14), ...mine(ok.ve) } : { goal: 8, goalFrom: "tour", pct: 60 };
    return { kind: "fairway", cat: "OTT", dist: null, reps: 14, ...g, title: "Driving", what: "Drives to a target 30 yards wide, about a tour fairway", tap: ["Fairway", "Missed"] };
  }
  return null;
}

/** The goal in words: "Hole 3 of 10", "Average inside 22 ft", "Beat your best". */
export function goalText(d, best = null) {
  if (d.goal == null) return best == null ? "Set your mark, then beat it" : `Beat your best: ${best}${d.kind === "prox" ? " ft" : ` of ${d.reps}`}`;
  if (d.kind === "prox") return `Average inside ${d.goal} ft`;
  const verb = { make: "Hole", lag: "Leave", updown: "Get up and down", fairway: "Hit", green: "Hit", bunker: "Leave" }[d.kind] || "Get";
  const tail = { lag: " inside 3 ft", fairway: " fairways", green: " greens", bunker: " inside 10 ft" }[d.kind] || "";
  return `${verb} ${d.goal} of ${d.reps}${tail}`;
}
/** Where the goal comes from, in words. */
export function goalSource(d) {
  if (d.goalFrom === "elite") return `their elite rounds${d.pct != null ? `, ${d.stat} ${Math.round(d.pct * 10) / 10}%` : d.statV != null ? `, ${d.stat} ${Math.round(d.statV * 10) / 10}${d.kind === "prox" ? " ft" : ""}` : ""}`;
  if (d.goalFrom === "tour") return d.kind === "prox" ? "about the Tour average from there" : `the Tour average, ${Math.round(d.pct)}%`;
  return null;
}
/** The drill as one line of text (Stats shows this to everyone). */
export const nounOf = (d) => ({ make: "putts", lag: "putts", fairway: "drives", updown: "shots", bunker: "shots", green: "shots" }[d.kind] || "balls");
export function drillLine(d) {
  const src = goalSource(d);
  return `${d.what} (${d.reps} ${nounOf(d)}). Goal: ${goalText(d)}${src ? ` (${src})` : ""}. Repeat sets until you reach it.`;
}

/* ---------------- a set's score ---------------- */
/** The score for a set: how many successes (tap 0), or the average feet (prox). */
export function setScore(d, marks) {
  if (!marks.length) return null;
  if (d.kind === "prox") return Math.round((marks.reduce((t, m) => t + Number(m.v || 0), 0) / marks.length) * 10) / 10;
  return marks.filter((m) => m.v === 1).length;
}
/** Did a finished set meet the goal (or beat the best, for a beat-your-best drill)? */
export function setMet(d, score, best) {
  const goal = d.goal ?? best;
  if (goal == null) return true; // the first ever set sets the mark
  return d.kind === "prox" ? score <= goal : d.goal != null ? score >= goal : score > goal;
}
/** The best set so far for a drill, across its sessions. */
export function bestOf(d, sessions) {
  const scores = sessions.filter((s) => s.mode === "drill" && s.drillId === d.id).flatMap((s) => (s.sets || []).filter((x) => x.marks?.length === d.reps).map((x) => x.score));
  if (!scores.length) return null;
  return d.kind === "prox" ? Math.min(...scores) : Math.max(...scores);
}
/** Time spent: the gaps between taps, each capped at 2 minutes (so walking off for lunch doesn't count). */
export function activeSecs(s, now = null) {
  const ts = [Date.parse(s.startedAt), ...(s.sets || []).flatMap((x) => (x.marks || []).map((m) => Date.parse(m.at)))].filter(Number.isFinite).sort((a, b) => a - b);
  if (now != null && ts.length) ts.push(now);
  let t = 0; for (let i = 1; i < ts.length; i++) t += Math.min(120000, ts[i] - ts[i - 1]);
  return Math.round(t / 1000);
}
export const mmss = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

/* ---------------- goals in real rounds ---------------- */
/**
 * Add drills to the plan, and a goal on the same stat in real rounds for each. items: [{ drill, goal }] where goal is
 * a challenge (goals.js) or null. Returns how many were added.
 */
export async function addToPlan(state, { items, playerKey, playerLabel }) {
  const owner = planOwner(state);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const goals = items.map((x) => x.goal).filter(Boolean).map((g, i) => ({ ...g, id: `c${Date.now().toString(36)}${i}`, start: today, from: "plan" }));
  if (goals.length && playerKey) {
    const { getDoc, doc, db } = await fsP();
    const ref = doc(db, "goals", playerKey);
    const cur = await getDoc(ref).then((s) => (s.exists() ? s.data().challenges || [] : [])).catch(() => []);
    // the same goal already there (same stat, still going): keep that one
    const same = (a, b) => a.stat === b.stat && (a.statKey || "") === (b.statKey || "") && (a.cat || "") === (b.cat || "") && (a.dist || "") === (b.dist || "") && (a.lie || "") === (b.lie || "");
    const fresh = goals.filter((g) => !cur.some((c) => same(c, g) && c.start >= today));
    const { saveChallenges, challengeText } = await import("../goals.js");
    if (fresh.length) await saveChallenges(playerKey, [...cur, ...fresh], state.user.uid);
    goals.forEach((g, i) => { const x = items.filter((y) => y.goal)[i]; if (x) { const kept = cur.find((c) => same(c, g) && c.start >= today); x.goalId = (kept || g).id; x.goalText = challengeText(kept || g); } });
  }
  const existing = await listPlan(owner);
  let n = 0;
  for (const x of items) {
    const d = x.drill;
    const dup = existing.find((p) => p.kind === d.kind && (p.dist || "") === (d.dist || "") && (p.lie || "") === (d.lie || "") && p.playerKey === playerKey);
    const item = { ...(dup || {}), ...d, id: dup?.id || newPlanId(), player: playerLabel || "", playerKey: playerKey || "", addedAt: dup?.addedAt || now, updatedAt: now, goalId: x.goalId || dup?.goalId || null, goalText: x.goalText || dup?.goalText || null };
    await savePlanItem(owner, item);
    n++;
  }
  return n;
}
