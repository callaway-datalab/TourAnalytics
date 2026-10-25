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
 * Every drill is 10 shots. The goal is the player's own number from their elite rounds (update 349: never a Tour figure);
 * with no stat for it, "beat your best": the first set sets the mark and every later session has to beat it.
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
/**
 * (update 371) May the person looking send drills to this player's practice plan? The admin (not in a portal they're
 * previewing) to anyone; a team member with Allow coaching to the players they work with. Without a player: the admin.
 */
export const practiceOpen = (playerKey = null) => !!window.__taCanPractice
  || (!!playerKey && playerKey === window.__taSelfKey) // (update 372: your own stats, into your own plan)
  || (!!playerKey && !!window.__taCoach && (window.__taTeamKeys || []).includes(playerKey));
/** Is this player the person looking (their own stats)? */
export const isMine = (playerKey) => !!playerKey && playerKey === window.__taSelfKey;
/** (update 371) Whose plan a drill goes to: your own (your own stats), else that player's (practice/{playerKey}/plan). */
export const planOwnerFor = (state, playerKey) => (!playerKey || isMine(playerKey) ? planOwner(state) : playerKey);

/** The middle of a distance band ("15-20 ft" → 17.5, "<5 ft" → 4, "25+ ft" → 30). */
export function midOf(d) {
  const n = String(d || "").match(/\d+(\.\d+)?/g)?.map(Number) || [];
  if (!n.length) return null;
  if (/^\s*</.test(d)) return n[0] * 0.8;
  if (n.length === 1) return /\+|>/.test(d) ? n[0] * 1.2 : n[0];
  return (n[0] + n[1]) / 2;
}
const ofReps = (pct, reps) => Math.max(1, Math.min(reps, Math.ceil((pct / 100) * reps - 1e-9))); // (update 371: rounded up: 75% of 10 is 8)

/**
 * A drill for a part of the game and distance. t: the target from Path back to Elite ({ k, def, ve, vr } from the
 * player's elite rounds, or null). lie: for the "what hurts" drills (rough, bunker, recovery).
 */
export function drillFor(cat, dist, t = null, lie = null) {
  // (update 349) every drill is 10 shots, and the goal comes only from the player's own elite rounds (t: { k, def, ve },
  // the elite rounds' value of the stat that fits the drill). No stat to go on: beat your best.
  const ok = t && !t.thin ? t : null, is = (re) => !!(ok && re.test(ok.k));
  const at = dist ? ` from ${dist}` : "";
  const R = 10;
  const pctGoal = () => ({ goal: ofReps(ok.ve, R), goalFrom: "elite", stat: ok.def.label, statV: ok.ve, pct: ok.ve, whole: ok.exact === false });
  if (lie) {
    if (/sand|bunker/i.test(lie)) return { kind: "bunker", cat: "ARG", lie, reps: R, goal: null, title: "Bunker shots", what: "Bunker shots from different lies", tap: ["Inside 10 ft", "Outside"] };
    if (/recover|tree|other/i.test(lie)) return { kind: "green", cat: "APP", lie, reps: R, goal: null, title: "Recovery shots", what: "Punch-outs and low runners to a fairway-sized target", tap: ["In play", "Not"] };
    return { kind: "green", cat: "APP", lie, reps: R, goal: null, title: `Approaches from the ${String(lie).toLowerCase()}`, what: `Approaches from light and heavy ${String(lie).toLowerCase()} to a green-sized target`, tap: ["On the green", "Missed"] };
  }
  if (cat === "PUTT") {
    const ft = midOf(dist) ?? 5;
    if (ft > 20) return { kind: "lag", cat, dist, reps: R, ...(is(/^goodLag/) ? pctGoal() : { goal: null }), title: `Lag putting${at}`, what: `Long putts${at}`, tap: ["Inside 3 ft", "Outside"] };
    return { kind: "make", cat, dist, reps: R, ...(is(/^make/) ? pctGoal() : { goal: null }), title: `${ft <= 8 ? "Short putts" : "Putting"}${at}`, what: `Putts${at}, all round the hole`, tap: ["Holed", "Missed"] };
  }
  if (cat === "APP") {
    if (is(/^hitGreen|^gir/)) return { kind: "green", cat, dist, reps: R, ...pctGoal(), title: `Approach${at}`, what: `Approaches${at} to a green`, tap: ["On the green", "Missed"] };
    const g = is(/^prox/) ? { goal: Math.round(ok.ve * 10) / 10, goalFrom: "elite", stat: ok.def.label, statV: ok.ve, whole: ok.exact === false } : { goal: null };
    return { kind: "prox", cat, dist, reps: R, ...g, title: `Approach${at}`, what: `Approaches${at} to a pin, measuring how far each finishes from the hole`, unit: "ft" };
  }
  if (cat === "ARG") return { kind: "updown", cat, dist, reps: R, ...(is(/^ud|^scramble/) ? pctGoal() : { goal: null }), title: `Short game${at}`, what: `Chips and pitches${at}, then hole out`, tap: ["Up and down", "Not"] };
  if (cat === "OTT") {
    // (update 369) the club the gap is with: driver, or a wood or iron off the tee
    const club = /iron/i.test(dist || "") ? "iron" : /wood/i.test(dist || "") ? "wood" : null;
    return { kind: "fairway", cat: "OTT", dist: null, reps: R, ...(is(/^fwy|fairway/) ? pctGoal() : { goal: null }), title: club ? `Tee shots with a ${club}` : "Driving", what: club ? `Tee shots with a ${club} to a target 30 yards wide, about a tour fairway` : "Drives to a target 30 yards wide, about a tour fairway", tap: ["Fairway", "Missed"] };
  }
  return null;
}
/** (update 349) Which stat sets each drill's goal (from the elite rounds), by part of the game and distance. */
export function goalStatsFor(cat, dist) {
  if (cat === "PUTT") return (midOf(dist) ?? 5) > 20 ? [/^goodLag$/] : [/^make$/];
  if (cat === "APP") return [/^prox$/, /^hitGreen$/, /^gir$/];
  if (cat === "ARG") return [/^ud$/, /^scramble$/];
  if (cat === "OTT") return [/^fwy$/];
  return [];
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
  if (d.goalFrom === "elite") return `their ${d.from || "kept rounds"}\u2019 ${d.stat}${d.whole && d.dist ? ` (all ${({ PUTT: "putts", APP: "approaches", ARG: "short-game shots" })[d.cat] || "shots"})` : ""}: ${Math.round((d.pct ?? d.statV) * 10) / 10}${d.kind === "prox" ? " ft" : "%"}`;
  return null;
}
/** The drill as one line of text (Stats shows this to everyone). */
export const nounOf = (d) => ({ make: "putts", lag: "putts", fairway: /^Tee shots/.test(d.title || "") ? "tee shots" : "drives", updown: "shots", bunker: "shots", green: "shots" }[d.kind] || "balls");
export function drillLine(d) {
  const src = goalSource(d);
  return `${d.what} (${d.reps} ${nounOf(d)}). Goal: ${goalText(d)}${src ? ` (${src})` : ` (no stat for this in their ${d.from || "kept rounds"} to set it from)`}. Aim for ${d.setsAim || 3} sets that reach it.`;
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
  const owner = planOwnerFor(state, playerKey); // (update 371: the player's own plan, not the sender's)
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const goals = items.map((x) => x.goal).filter(Boolean).map((g, i) => ({ ...g, id: `c${Date.now().toString(36)}${i}`, start: today, from: "plan" }));
  if (goals.length && playerKey) {
    const { getDoc, doc, db } = await fsP();
    const ref = doc(db, "goals", playerKey);
    const cur = await getDoc(ref).then((s) => (s.exists() ? s.data().challenges || [] : [])).catch(() => []);
    const same = (a, b) => a.stat === b.stat && (a.statKey || "") === (b.statKey || "") && (a.cat || "") === (b.cat || "") && (a.dist || "") === (b.dist || "") && (a.lie || "") === (b.lie || "");
    // (update 361) adding a drill again replaces the goal it made before (from the practice plan, same stat), so the goal
    // always matches the drill; goals set by hand in Goals are left alone
    const { saveChallenges, challengeText } = await import("../goals.js");
    const keep = cur.filter((c) => !(c.from === "plan" && goals.some((g) => same(c, g))));
    await saveChallenges(playerKey, [...keep, ...goals], state.user.uid);
    goals.forEach((g, i) => { const x = items.filter((y) => y.goal)[i]; if (x) { x.goalId = g.id; x.goalText = challengeText(g); } });
  }
  const existing = await listPlan(owner);
  let n = 0;
  for (const x of items) {
    const d = x.drill;
    const dup = existing.find((p) => p.kind === d.kind && (p.dist || "") === (d.dist || "") && (p.lie || "") === (d.lie || "") && p.playerKey === playerKey);
    const item = { ...(dup || {}), ...d, id: dup?.id || newPlanId(), player: playerLabel || "", playerKey: playerKey || "",
      sentBy: owner === planOwner(state) ? null : { uid: state.user?.uid || null, name: state.profile?.name || (state.isAdmin ? "Callaway" : "") }, addedAt: dup?.addedAt || now, updatedAt: now, goalId: x.goalId || dup?.goalId || null, goalText: x.goalText || dup?.goalText || null };
    await savePlanItem(owner, item);
    n++;
  }
  return n;
}
