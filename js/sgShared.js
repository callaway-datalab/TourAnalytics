// (sgDashboard split) The Stats page's shared helpers and imports: the top of the old sgDashboard.js, so every
// section module (sgHero.js, sgPath.js …) and sgDashboard.js itself use the same ones.
// The strokes-gained dashboard, shared by the admin's Data → Analyze page and every player's My Data
// page (and coaches viewing a player). Styled after the original player site.
//
//   Stat Type (update 95): every stat found in the data (Strokes Gained, Hit Green %, Putts / Round ...). The
//   tables and charts follow what that stat has: split by category, distance and lie where it can be.
//   Filters: span · year · tournament · round · lie · distance, and category pills
//   "Your selection": SG / round, attempts / round, SG / attempt and rank for exactly that slice
//   SG cards (Total, T2G, OTT, APP, ARG, PUTT), category visuals, trends, rankings
//
// Strokes gained per round = sum over the slice of (SG per attempt × attempts) ÷ rounds in the slice.
// Players only ever see other players' numbers in the Rankings table, which comes from the published
// per-round, per-category summary, so player rankings follow year/tournament/round/category filters
// (not lie or distance).
import { careerBlocks } from "./careerBlocks.js";
import { statBlocks as statBlocksCmp } from "./compareData.js"; // (update 227: the full stats table)
import { getState } from "./auth.js";
import { drillFor, drillLine, practiceOpen, goalStatsFor, isMine } from "./practice/plan.js"; // (update 342)
// (update 353) the four levels, named for what they mean on Tour
const LEVELS = { 1: "Best on Tour", 10: "Contender", 25: "Tour Championship level", 50: "Signature event level" };
const PLAN_ADDED = new Set(); // drills in the player's practice plan (update 387: read from the plan itself)
const PLAN_SEEN = { key: null, at: 0, busy: false };
/* (update 345) Per shot or how often? A difference in strokes gained a round for a part of the game and distance splits
 * exactly in two (update 348: weighed by their usual per-shot level, U, over the whole time frame, so a strength or a weakness
 * is the same whichever rounds are compared):
 *    A attempts x (A per shot - U) - B attempts x (B per shot - U)   [playing it better]
 *  + (A attempts - B attempts) x U                                     [facing it more or less often]
 * So elite rounds can look better at something just because they had fewer of their weak shots (or more of their strong
 * ones): that's strategy (or the shot before), not practice. */
// keyed part of the game | distance (update 348: not split by lie, so the per-shot numbers shown are the ones split)
function bucketsOf(rs, pred = () => true) {
  const m = new Map();
  for (const rd of rs) for (const x of rd.shots) if (x.cat && pred(x)) { const k = `${x.cat}|${x.dist || ""}|`; const o = m.get(k) || m.set(k, { sg: 0, n: 0 }).get(k); o.sg += x.sg; o.n += x.w || 1; }
  return m;
}
/** The split for a group (every lie of "APP|100-140 yds", or every distance of "APP"), added up from its finest pieces. */
function groupSplit(bA, nA, bB, nB, match, bU = null) {
  const keys = [...new Set([...bA.keys(), ...bB.keys()])].filter(match);
  const t = sumSplit(keys.map((k) => splitOf(bA.get(k), nA, bB.get(k), nB, bU?.get(k))));
  const agg = (b) => keys.reduce((o, k) => { const x = b.get(k); if (x) { o.sg += x.sg; o.n += x.n; } return o; }, { sg: 0, n: 0 });
  const A = agg(bA), B = agg(bB);
  const U = bU ? agg(bU) : { sg: A.sg + B.sg, n: A.n + B.n };
  return { ...t, ae: A.n / nA, ab: B.n / nB, pe: A.n ? A.sg / A.n : 0, pb: B.n ? B.sg / B.n : 0, pu: U.n ? U.sg / U.n : 0 };
}
/** (update 356) one labelled line: a small label on the left, the value beside it */
const kv = (k, v, cls = "") => el("div", { class: `bs-kv ${cls}`.trim() }, [el("span", { class: "bs-k" }, k), el("span", { class: "bs-v" }, v)]);
const sgn2 = (v) => (Math.abs(v) < 0.005 ? "+0.00" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
function splitOf(a, nA, b, nB, u = null) {
  const ae = a ? a.n / nA : 0, ab = b ? b.n / nB : 0;
  const pe = a && a.n ? a.sg / a.n : 0, pb = b && b.n ? b.sg / b.n : 0;
  // their usual level on this shot (every round in the time frame), else the two sets together
  const pu = u && u.n ? u.sg / u.n : (a?.n || 0) + (b?.n || 0) ? ((a?.sg || 0) + (b?.sg || 0)) / ((a?.n || 0) + (b?.n || 0)) : 0;
  const mix = (ae - ab) * pu;
  // (update 346) "how often" in two: a shot they usually gain on (a strength) faced more or less often, or one they usually lose on
  return { ae, ab, pe, pb, pu, skill: ae * (pe - pu) - ab * (pb - pu), mix, strong: pu > 0 ? mix : 0, weak: pu < 0 ? mix : 0, total: ae * pe - ab * pb };
}
const sumSplit = (list) => list.reduce((t, x) => ({ skill: t.skill + x.skill, mix: t.mix + x.mix, strong: t.strong + x.strong, weak: t.weak + x.weak, total: t.total + x.total }), { skill: 0, mix: 0, strong: 0, weak: 0, total: 0 });
/** "+0.10 from more of their strong shots, +0.40 from fewer of their weak ones" (each part only when it counts). */
function mixWords(x, sgn) {
  const parts = [];
  if (Math.abs(x.strong) >= 0.01) parts.push(`${sgn(x.strong)} from ${x.strong >= 0 ? "more" : "fewer"} of their strong shots`);
  if (Math.abs(x.weak) >= 0.01) parts.push(`${sgn(x.weak)} from ${x.weak >= 0 ? "fewer" : "more"} of their weak ones`);
  return parts.join(", ");
}
/** Which side of "how often" leads: "fewer weak shots" or "more strong shots". */
const mixLead = (x) => (Math.abs(x.weak) >= Math.abs(x.strong) ? (x.weak >= 0 ? "fewer of their weak shots" : "more of their weak shots") : (x.strong >= 0 ? "more of their strong shots" : "fewer of their strong shots"));
/** Why facing a shot more or less often happens, by part of the game: a strategy question, or the shot before. */
const MIX_CAUSE = {
  OTT: "That\u2019s club choice off the tee (and the courses\u2019 par 3s and 5s): strategy more than practice.",
  APP: "That\u2019s where the tee shots leave them (club and line off the tee, or the courses): strategy more than practice.",
  ARG: "That comes from the approach play (how often greens are missed, and where), not the short game itself.",
  PUTT: "That comes from the shots before (how close approaches and chips finish), not the putting itself.",
};
import { favoriteKeys } from "./watchlist.js";
import { el, mount, loadScript, infoTip } from "./ui.js";
import {
  CATEGORIES, applyFilters, roundFilter, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate,
  missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG, defaultMinRounds,
  statRounds, statAgg, statDef, fmtStat, statsIn, groupObs, gearInfo, gearLabel, gearList, distLead,
  localDay,
} from "./sg.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
// Span (update 159): months back from today ("Last Month" on 10/15 looks back to 9/15)
const SPANS = [["0", "All"], ["1", "Last Month"], ["3", "Last 3 Months"], ["6", "Last 6 Months"], ["12", "Last 12 Months"], ["18", "Last 18 Months"]];
const SUMMARY = [["TOTAL", "SG: Total"], ["T2G", "SG: Tee to Green"], ["OTT", "SG: Off-the-Tee"], ["APP", "SG: Approach"], ["ARG", "SG: Around-the-Green"], ["PUTT", "SG: Putting"]];
const BREAKDOWNS = {
  OTT: [["distanceRange", "SG by Club"], ["lie", "SG by Lie"], ["dogleg", "SG by Dogleg"]],
  APP: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"], ["pin", "SG by Pin Location"]],
  ARG: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"]],
  PUTT: [["distanceRange", "SG by Distance"], ["puttBreak", "SG by Break"]],
};
const LEAVE_SCALE = { APP: 60, ARG: 20 };
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || "All categories";

/**
 * opts: {
 *   me:     { key, label, rounds } | null     the player on screen (full detail)
 *   field:  [{ key, label, rounds, summaryOnly? }]   every player, for rankings and "All players"
 *   idx:    column map from detectColumns()
 *   mode:   "admin" | "player"
 *   state:  optional shared object so filters survive re-renders (e.g. switching players)
 * }
 */
/** (update 283) The Personal Peak's note: when it was (first to last date), then each of its rounds. */
function peakNote(peak, me, cat, peakN, tn, onRange = null) {
  const day = (rd) => { const d = new Date(`${String(rd.date || "").slice(0, 10)}T12:00:00`); return isNaN(d) ? String(rd.date || "") : d; };
  const md = (d) => (d instanceof Date ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : d);
  const mdy = (d) => (d instanceof Date ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : d);
  const rs = [...peak.rounds].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const a = day(rs[0]), b = day(rs.at(-1));
  const span = a instanceof Date && b instanceof Date && a.getTime() === b.getTime() ? mdy(a) : a instanceof Date && b instanceof Date && a.getFullYear() === b.getFullYear() ? `${md(a)} \u2013 ${mdy(b)}` : `${mdy(a)} \u2013 ${mdy(b)}`;
  const by = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
  // (update 319) by tournament: "4 rounds at THE PLAYERS Championship, 4 rounds at the Valspar Championship and the
  // first 2 rounds of The Masters" (all of their rounds there, or the first / last few)
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const evKey = (rd) => `${rd.event || "?"}|${yrOf(rd)}`;
  const groups = [];
  for (const rd of rs) { const k = evKey(rd); const g = groups.at(-1); if (g && g.k === k) g.rs.push(rd); else groups.push({ k, name: rd.event || "an event", rs: [rd] }); }
  const allAt = (k) => (me?.rounds || []).filter((rd) => evKey(rd) === k && !rd.eventLevel);
  const nums = (x) => x.map((rd) => Number(rd.roundNo)).filter((n) => Number.isFinite(n));
  const words = ["", "", "2", "3", "4", "5", "6"];
  const part = (g) => {
    const n = g.rs.length, all = allAt(g.k), mine = nums(g.rs), theirs = [...new Set(nums(all))];
    const rds = (k) => (k === 1 ? "round" : `${words[k] || k} rounds`);
    if (n >= 4 || n >= Math.max(theirs.length, 1) || !mine.length || !theirs.length) return `${n} ${n === 1 ? "round" : "rounds"} at ${g.name}`;
    if (Math.min(...mine) === Math.min(...theirs)) return `the first ${rds(n)} of ${g.name}`;
    if (Math.max(...mine) === Math.max(...theirs)) return n === 1 ? `the final round of ${g.name}` : `the last ${rds(n)} of ${g.name}`;
    return `${n} ${n === 1 ? "round" : "rounds"} at ${g.name}`;
  };
  const parts = groups.map(part);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
  // (update 322) the first sentence: bold, and a tap filters the page to those dates
  const head = `Best ${peakN} ${peakN === 1 ? "round" : "rounds in a row"} by ${by}: ${span}`; // (update 330)
  const link = el("a", { href: "#", class: "peak-range", title: "Show just these dates" }, head);
  link.addEventListener("click", (e) => { e.preventDefault(); onRange?.({ from: String(rs[0].date || "").slice(0, 10), to: String(rs.at(-1).date || "").slice(0, 10), label: span }); });
  return [link, el("span", {}, ` \u00b7 ${list.charAt(0).toUpperCase()}${list.slice(1)}.`)];
}

// (update 371) before drills go into a practice plan: what's being added, with the shots a set, the goal a set, how many
// sets to meet it in, and the goal in real rounds, each changeable. onOk gets the edited list.
function planEditor(list, whose, onOk, intro = null) {
  const dlg = el("dialog", { class: "dp-dialog" });
  document.body.appendChild(dlg);
  const num = (v, attrs = {}) => el("input", { type: "number", inputmode: "decimal", class: "dp-num", value: v == null ? "" : String(v), ...attrs });
  const rows = list.map((x) => {
    const d = x.drill, prox = d.kind === "prox";
    const reps = num(d.reps, { min: "1", max: "50", step: "1", "aria-label": "Shots a set" });
    const proxLab = d.higher ? `Average (${d.unit || "yds"})` : "Average inside (ft)"; // (update 447: driving distance, higher is better)
    const goal = num(d.goal, { min: prox ? "0.5" : "1", step: prox ? (d.higher ? "1" : "0.5") : "1", placeholder: "Beat your best", "aria-label": prox ? proxLab : "Successes a set" });
    const sets = num(d.setsAim || 3, { min: "1", max: "20", step: "1", "aria-label": "Sets to meet the goal" });
    const rg = x.goal && x.goal.target != null ? num(x.goal.target, { step: "any", "aria-label": "Goal in rounds" }) : null;
    const node = el("div", { class: "dp-ed" }, [
      el("p", { class: "dp-ed-t" }, [el("strong", {}, d.title), el("span", { class: "muted small" }, ` \u00b7 ${d.what}`)]),
      el("div", { class: "dp-ed-grid" }, [
        el("label", {}, [el("span", { class: "muted small" }, "Shots a set"), reps]),
        el("label", {}, [el("span", { class: "muted small" }, prox ? proxLab : "Successes needed"), goal]),
        el("label", {}, [el("span", { class: "muted small" }, "Sets to meet it"), sets]),
        rg ? el("label", {}, [el("span", { class: "muted small" }, `In rounds: ${x.goal.label || "goal"}${x.goal.unit === "%" ? (/%/.test(x.goal.label || "") ? "" : " (%)") : x.goal.unit ? ` (${x.goal.unit.trim()})` : ""}`), rg]) : null,
      ]),
    ]);
    const value = () => {
      const r = Math.max(1, Math.min(50, Math.round(Number(reps.value)) || d.reps));
      const gRaw = goal.value.trim() === "" ? null : Number(goal.value);
      const gv = gRaw == null || !Number.isFinite(gRaw) ? null : prox ? Math.max(0.5, gRaw) : Math.max(1, Math.min(r, Math.round(gRaw)));
      const changed = gv !== d.goal || r !== d.reps;
      const nd = { ...d, reps: r, goal: gv, setsAim: Math.max(1, Math.min(20, Math.round(Number(sets.value)) || 3)), ...(changed ? { goalFrom: gv == null ? null : "set" } : {}) };
      const tg = rg ? Number(rg.value) : null;
      return { ...x, drill: nd, goal: x.goal ? { ...x.goal, ...(rg && Number.isFinite(tg) ? { target: tg } : {}) } : x.goal };
    };
    return { node, value };
  });
  const close = () => { try { dlg.close(); } catch { /* */ } dlg.remove(); };
  const ok = el("button", { type: "button", class: "btn" }, `Add to ${whose} plan`);
  ok.addEventListener("click", () => { const out = rows.map((r) => r.value()); close(); onOk(out); });
  const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  cancel.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  mount(dlg, [
    el("h3", {}, list.length === 1 ? `Add to ${whose} practice plan` : `Add ${list.length} drills to ${whose} practice plan`),
    intro,
    el("p", { class: "muted small" }, "Change anything before it\u2019s added: the shots in a set, the goal for a set (leave it empty to beat your best), how many sets should meet it, and the goal in real rounds."),
    el("div", { class: "dp-ed-list" }, rows.map((r) => r.node)),
    el("div", { class: "thread-actions" }, [ok, cancel]),
  ]);
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}

export { careerBlocks, statBlocksCmp, getState, drillFor, drillLine, practiceOpen, goalStatsFor, isMine, favoriteKeys, el, mount, loadScript, infoTip, CATEGORIES, applyFilters, roundFilter, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate, missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG, defaultMinRounds, statRounds, statAgg, statDef, fmtStat, statsIn, groupObs, gearInfo, gearLabel, gearList, distLead, localDay, LEVELS, PLAN_ADDED, PLAN_SEEN, bucketsOf, groupSplit, kv, sgn2, splitOf, sumSplit, mixWords, mixLead, MIX_CAUSE, CHART_JS, SPANS, SUMMARY, BREAKDOWNS, LEAVE_SCALE, nf1, catName, peakNote, planEditor };
