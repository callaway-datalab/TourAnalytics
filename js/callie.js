// (update 258) Callie: the portal's assistant (the robot in the header). Ask anything about a player's data.
// (update 259) Callie doesn't have the AI write answers any more. The AI service only READS the question into a plan
// (who, what, which period, how to split it, a ranking across the field, or a comparison), on the small model (a few
// hundredths of a cent a question); when it's not there or out of budget, the same is read here, for free. The
// portal then works out the answer from the data itself and shows the findings: a sentence or two and a table.
//   intent "player":  one to three players' numbers, by season, event, round, part of the game, distance, lie or club
//   intent "field":   who leads (or trails) a tour in strokes gained or a stat, over a period, with enough rounds
//   intent "compare": set up in Compare (the plan goes with it, so there's no second AI call)
import { el, mount, icon } from "./ui.js";
import { getState } from "./auth.js";
import { effectiveTeam } from "./preview.js";
import { teamLabels, plainName } from "./names.js";
import { readAsk, productGroups, matchEvents } from "./compareAsk.js";
import { CATEGORIES, statRounds, statAgg, statDef, fmtStat, distLead } from "./sg.js";

const MAX_PLAYERS = 3;
const chat = []; // [{ who: "me" | "callie", text, table?, note?, err? }] (kept while the portal is open)
let pending = null; // (update 261) Callie asked which range: { plan, ps, missing, options }
let lastPlayers = [], busy = false, panel = null, playersP = null, exList = [];
const roundsCache = new Map(); // player key → their rounds (full detail)

/* ---------------------------------------------------------------- what can be asked about */
const SG_METRICS = { sg_total: [null, "SG: Total"], sg_ott: ["OTT", "SG: Off-the-Tee"], sg_app: ["APP", "SG: Approach"], sg_arg: ["ARG", "SG: Around-the-Green"], sg_putt: ["PUTT", "SG: Putting"], sg_t2g: ["T2G", "SG: Tee-to-Green"] };
const STAT_KEYS = ["scoring", "par3", "par4", "par5", "eagles", "birdiesRd", "parsRd", "bogeysRd", "dblBogeysRd", "birdie", "parOrBetter", "bogey", "gir", "scramble", "putts", "fwy", "drive", "hitGreen", "pinHigh", "onLine", "prox", "ud", "make", "goodLag", "threePutt"];
const metricOf = (key) => {
  if (SG_METRICS[key]) { const [cat, label] = SG_METRICS[key]; return { key, sg: true, cat, label, higher: true }; }
  if (STAT_KEYS.includes(key)) { const d = statDef(key); return { key, sg: false, label: d.label, higher: d.higher, def: d }; }
  return null;
};
const PART_OF = { OTT: "sg_ott", APP: "sg_app", ARG: "sg_arg", PUTT: "sg_putt" };
const BREAKDOWNS = ["season", "event", "round", "category", "distance", "lie", "club", "ball"];

function playersYouCanSee() {
  return (playersP ||= (async () => {
    const state = getState(), team = effectiveTeam(state), pc = window.__previewClient;
    if (pc?.key) return [[pc.key, plainName(pc.label || pc.key)]];
    if (state.isAdmin && !team.preview) {
      try { return [...(await (await import("./store.js")).adminAllClients()).labels].map(([k, l]) => [k, plainName(l)]); } catch { return []; }
    }
    if (team.isTeam) return [...teamLabels(team.teamAccess)];
    return state.profile?.clientKey ? [[state.profile.clientKey, state.profile.name || "Me"]] : [];
  })());
}
function roundsOf(key, label) {
  if (!roundsCache.has(key)) {
    roundsCache.set(key, (async () => {
      const { loadSource } = await import("./reportGen.js");
      const res = await loadSource("tour", key, label, { detail: false });
      return res?.me?.rounds || [];
    })().catch(() => []));
  }
  return roundsCache.get(key);
}

/* ---------------------------------------------------------------- reading a question here (free; also the fallback) */
const PRONOUN = /\b(he|his|him|she|her|they|their|them)\b/i;
function readLocal(question, list) {
  const t = question.toLowerCase();
  const players = readAsk(question, { players: list }).players.map((p) => p.label);
  const ra = readAsk(question, { players: [], maxYear: new Date().getFullYear() });
  const has = (re) => re.test(t);
  let metric = null;
  for (const [re, k] of [[/\bputt(s|ing|er)?\b|\bon the greens?\b/, "sg_putt"], [/\bapproach|iron play|irons?\b/, "sg_app"], [/\baround[- ]the[- ]green|short game|chipping|pitching|bunker/, "sg_arg"],
    [/\btee[- ]to[- ]green|ball[- ]?strik/, "sg_t2g"], [/\boff[- ]the[- ]tee|\bdriving\b(?! distance)|\bdriver\b|tee shots?/, "sg_ott"]]) if (has(re)) { metric = k; break; }
  for (const [re, k] of [[/driving distance|longest|how far|distance off the tee/, "drive"], [/fairways?( hit)?|driving accuracy|most accurate/, "fwy"], [/greens in regulation|\bgir\b/, "gir"],
    [/proximity|closest to the (hole|pin)/, "prox"], [/scrambl/, "scramble"], [/up[- ]and[- ]down/, "ud"], [/3[- ]putt|three[- ]putt/, "threePutt"], [/putts per round|putts a round|fewest putts/, "putts"],
    [/birdies?/, "birdiesRd"], [/bogeys? (avoid|free)|bogey avoidance/, "bogey"], [/double bogey/, "dblBogeysRd"], [/\bbogeys?\b/, "bogeysRd"], [/eagles?/, "eagles"], [/scoring average|scoring avg|lowest scor/, "scoring"]])
    if (has(re)) { metric = k; break; }
  if (!metric && has(/\b(overall|best player|total|strokes gained)\b/)) metric = "sg_total";
  const breakdown = has(/\b(where|which part|what part)\b.*\b(lose|gain|lost|gained|strength|weak)|\bby category|parts? of (his|her|their|the) game\b/) ? "category"
    : has(/\bby distance|\bfrom \d+|\bdistances?\b|\byards?\b|\bfeet\b|\bft\b/) ? "distance" : has(/\bby lie|\blies?\b|\brough\b|\bfairway lie|\bsand\b/) ? "lie"
    : has(/\b(model|club|clubs|which (driver|putter|irons?|wedge))\b/) ? "club" : has(/\bball\b/) ? "ball"
    : has(/\b(tournament|event)s?\b/) ? "event" : has(/\brounds?\b/) && has(/\b(best|worst|lowest|highest)\b/) && !ra.last ? "round"
    : has(/\b(year by year|by season|each season|every season|by year|each year)\b/) ? "season" : null;
  // (update 260) a distance or a lie to narrow to: "inside 10 ft", "from 150-200 yards", "outside 20 feet", "from the rough"
  const U = "(ft|feet|foot|'|yds?|yards?)";
  const unitOf = (u) => (/^(ft|feet|foot|')$/.test(u) ? "ft" : "yds");
  let distance = null;
  const rg = new RegExp(`\\b(?:from\\s+|between\\s+)?(\\d+)\\s*(?:-|to|and)\\s*(\\d+)\\s*${U}`).exec(t);
  const mx = new RegExp(`\\b(?:inside|within|under|less than|shorter than|closer than|in)\\s+(\\d+)\\s*${U}`).exec(t);
  const mn = new RegExp(`\\b(?:outside|over|beyond|more than|longer than|further than|from beyond|past)\\s+(\\d+)\\s*${U}`).exec(t);
  if (rg) distance = { min: Number(rg[1]), max: Number(rg[2]), unit: unitOf(rg[3]) };
  else if (mx) distance = { min: null, max: Number(mx[1]), unit: unitOf(mx[2]) };
  else if (mn) distance = { min: Number(mn[1]), max: null, unit: unitOf(mn[2]) };
  const lm = /\b(?:from|out of|in|off) the (rough|fairway|sand|bunker|fringe|first cut|primary rough|intermediate rough|recovery|tee)\b/.exec(t);
  const lie = lm ? lm[1] : null;
  const part = distance || lie ? (metric && SG_METRICS[metric]?.[0] && !["T2G"].includes(SG_METRICS[metric][0]) ? SG_METRICS[metric][0] : has(/putt/) ? "PUTT" : has(/chip|around|short game/) ? "ARG" : has(/driv|off the tee/) ? "OTT" : distance?.unit === "ft" ? "PUTT" : "APP") : breakdown === "distance" || breakdown === "lie" || breakdown === "club" ? (metric && SG_METRICS[metric]?.[0] && SG_METRICS[metric][0] !== "T2G" ? SG_METRICS[metric][0] : has(/putt/) ? "PUTT" : has(/chip|around/) ? "ARG" : has(/driv|tee/) ? "OTT" : "APP") : null;
  const period = {};
  if (ra.since) period.from = ra.since.from; else if (ra.years.length) period.years = ra.years;
  if (ra.last) period[ra.last.unit === "events" ? "last_events" : "last"] = ra.last.n;
  else if (has(/\b(lately|recently|recent form|current form)\b/)) period.last = 20;
  const compare = has(/\b(vs\.?|versus|compare[ds]?|comparing|compared|against)\b/) && !has(/\bagainst the (field|tour)\b/);
  const field = !players.length && !(PRONOUN.test(t) && lastPlayers.length) && (has(/\b(who|whose|which players?|tour|field|rank|ranks|ranked|ranking|leaders?|leads?|top \d+|everyone|anyone)\b/) || list.length > 1);
  const lim = /\btop (\d+)\b|\b(\d+) (best|worst)\b/.exec(t);
  return {
    intent: compare ? "compare" : field ? "field" : "player",
    players, tour: has(/korn ferry/) ? "Korn Ferry Tour" : has(/\bpga\b/) ? "PGA TOUR" : null,
    metric, period, breakdown: (distance && breakdown === "distance") || (lie && breakdown === "lie") ? null : breakdown, part, distance, lie, order: has(/\b(worst|lowest|least|bottom|weakest)\b/) && !has(/lowest scor|fewest putts/) ? "worst" : "best",
    limit: lim ? Number(lim[1] || lim[2]) : null, compare: null, unsupported: null, local: true,
  };
}
/** The AI's plan (or null when it isn't there / out of budget / unreadable). */
async function aiPlan(question) {
  const url = window.PORTAL_CONFIG?.insightsUrl;
  if (!url) return null;
  try {
    const token = await getState().user?.getIdToken?.();
    const history = chat.filter((m) => m.who === "me").slice(-3).map((m) => m.text);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ callie: { question, history, today: new Date().toISOString().slice(0, 10) } }) });
    if (!res.ok) return null;
    const out = await res.json();
    return out?.plan && typeof out.plan === "object" ? out.plan : null;
  } catch { return null; }
}
/** A plan, checked: only what the portal can do. */
function cleanPlan(p, local) {
  const int = (v, hi = 200) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= hi ? n : null; };
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  const pr = p.period && typeof p.period === "object" ? p.period : {};
  const period = {};
  const ys = (Array.isArray(pr.years) ? pr.years : []).map(String).filter((y) => /^20\d\d$/.test(y)); if (ys.length) period.years = ys;
  if (day(pr.from)) period.from = day(pr.from); if (day(pr.to)) period.to = day(pr.to);
  if (int(pr.last, 500)) period.last = int(pr.last, 500); if (int(pr.last_events, 100)) period.last_events = int(pr.last_events, 100);
  return {
    intent: ["player", "field", "compare", "unsupported"].includes(p.intent) ? p.intent : local.intent,
    players: (Array.isArray(p.players) ? p.players : []).filter((x) => typeof x === "string" && x.trim()).slice(0, 4),
    tour: typeof p.tour === "string" && p.tour.trim() ? p.tour.trim() : null,
    metric: metricOf(p.metric) ? p.metric : null,
    period, breakdown: BREAKDOWNS.includes(p.breakdown) ? p.breakdown : null,
    part: ["OTT", "APP", "ARG", "PUTT"].includes(p.part) ? p.part : null,
    distance: (() => { const d = p.distance; if (!d || typeof d !== "object") return null; const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null); const o = { min: n(d.min), max: n(d.max), unit: /y/i.test(String(d.unit || "")) ? "yds" : "ft" }; return o.min == null && o.max == null ? null : o; })(),
    lie: typeof p.lie === "string" && p.lie.trim() ? p.lie.trim().slice(0, 40) : null,
    order: p.order === "worst" ? "worst" : "best", limit: int(p.limit, 25), min_rounds: int(p.min_rounds, 200),
    compare: p.compare && typeof p.compare === "object" && Array.isArray(p.compare.groups) && p.compare.groups.length ? p.compare : null,
    unsupported: typeof p.unsupported === "string" && p.unsupported.trim() ? p.unsupported.trim().slice(0, 300) : null,
  };
}

/* ---------------------------------------------------------------- the maths (the portal's own numbers) */
const dk = (rd) => String(rd.date || "").slice(0, 10);
const yr = (rd) => String(rd.year || dk(rd).slice(0, 4));
const evOf = (rd) => `${rd.event}|${yr(rd)}`;
const sgOf = (rd, cat) => rd.shots.reduce((t, s) => t + (!cat || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg || 0 : 0), 0);
const sgRds = (rs) => rs.filter((rd) => rd.shots?.length && !rd.eventLevel).sort((a, b) => dk(a).localeCompare(dk(b)) || String(a.roundNo || "").localeCompare(String(b.roundNo || "")));
const isoBack = (months) => { const d = new Date(); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); };
const dateTxt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "");
const sq = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tourIs = (rdTour, want) => { if (!want) return true; const a = sq(rdTour), b = sq(want); return !!a && (a.includes(b) || b.includes(a) || (b.includes("korn") ? a.includes("korn") : b.includes("pga") ? a.includes("pga") && !a.includes("korn") : false)); };

/** The rounds a period means, and how to say it. defMonths: the default when none is given (null = all). */
function inPeriod(rs, period, defMonths) {
  let out = sgRds(rs), label;
  const p = period || {};
  if (p.years?.length) { out = out.filter((rd) => p.years.includes(yr(rd))); label = p.years.length === 1 ? `in ${p.years[0]}` : `in ${p.years[0]}–${p.years.at(-1)}`; }
  if (p.from || p.to) { out = out.filter((rd) => (!p.from || dk(rd) >= p.from) && (!p.to || dk(rd) <= p.to)); label = `${p.from ? `since ${dateTxt(p.from)}` : ""}${p.to ? ` to ${dateTxt(p.to)}` : ""}`.trim(); }
  if (!label && !p.last && !p.last_events && defMonths) { const from = isoBack(defMonths); out = out.filter((rd) => dk(rd) >= from); label = `over the past ${defMonths} months`; }
  if (p.last) { out = out.slice(-p.last); label = `over the last ${p.last} rounds${label ? ` (${label})` : ""}`; }
  if (p.last_events) { const evs = [...new Set(out.map(evOf))].slice(-p.last_events); out = out.filter((rd) => evs.includes(evOf(rd))); label = `over the last ${p.last_events} events`; }
  return { rounds: out, label: label || "across all their data" };
}
/* (update 260) Narrowing to a distance and/or a lie. The data's distance buckets ("<5 ft", "5-10 ft", "150-200 yds",
   "30+ ft") are read as ranges; a question's range takes every bucket that lies inside it ("inside 10 ft" = "<5 ft" + "5-10 ft"). */
function bucketRange(label) {
  const t = String(label || "").toLowerCase().replace(/\s+/g, "");
  const unit = /ft|feet|'/.test(t) ? "ft" : /yd|yard/.test(t) ? "yds" : null;
  if (!unit) return null;
  const n = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0])), k = unit === "yds" ? 3 : 1;
  if (!n.length) return null;
  if (/^(<|under|inside|lessthan)/.test(t)) return { lo: 0, hi: n[0] * k };
  if (/^(>|over|outside)/.test(t) || /\+/.test(t)) return { lo: n[0] * k, hi: Infinity };
  return n.length >= 2 ? { lo: n[0] * k, hi: n[1] * k } : null;
}
/** What to narrow shots to: { test(shot), label, part } (null = nothing to narrow); { err } when nothing in the data fits. */
function narrowFor(plan, m, rounds) {
  if (!plan.distance && !plan.lie) return null;
  const part = plan.part || (m.sg && m.cat && m.cat !== "T2G" ? m.cat : plan.distance?.unit === "ft" ? "PUTT" : "APP");
  const partName = CATEGORIES.find(([c]) => c === part)?.[1] || "";
  const seen = new Map(), lies = new Set();
  for (const rd of rounds) for (const s of rd.shots) if (s.cat === part) { if (s.dist) seen.set(s.dist, bucketRange(s.dist)); if (s.lie) lies.add(s.lie); }
  let dists = null, distTxt = "", range = "";
  if (plan.distance) {
    // (update 261) the bands that fit the question exactly; when they don't, ask which way to go (the bands inside
    // the range, or the ones that reach past it), and say the range the data really covers, not just the one asked for
    const u = plan.distance.unit, k = u === "yds" ? 3 : 1, lo = (plan.distance.min ?? 0) * k, hi = plan.distance.max == null ? Infinity : plan.distance.max * k;
    const near = (a, b) => (a === Infinity || b === Infinity ? a === b : Math.abs(a - b) < 1e-6);
    const bands = [...seen].filter(([, r]) => r).map(([d, r]) => ({ d, ...r })).sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    const want = rangeTxt(lo, hi, u, k);
    const inside = bands.filter((x) => x.lo >= lo - 1e-6 && x.hi <= hi + 1e-6);
    const touch = bands.filter((x) => x.hi > lo + 1e-6 && x.lo < hi - 1e-6);
    const spanOf = (list) => ({ lo: Math.min(...list.map((x) => x.lo)), hi: Math.max(...list.map((x) => x.hi)) });
    const joined = (list) => list.every((x, i) => !i || near(x.lo, list[i - 1].hi));
    const exact = inside.length && joined(inside) && near(spanOf(inside).lo, lo) && near(spanOf(inside).hi, hi);
    if (!exact) {
      // (update 262) the choices: every run of bands in a row that reaches into the range, the closest first, by how far
      // each end is from the question's ("155-175": 160-180 is 5 + 5 off, 140-180 is 15 + 5, 140-160 is 15 + 15)
      const off = (a, b) => (a === Infinity && b === Infinity ? 0 : a === Infinity || b === Infinity ? 1e6 : Math.abs(a - b));
      const runs = [];
      for (let i = 0; i < bands.length; i++) for (let j = i; j < bands.length; j++) {
        const list = bands.slice(i, j + 1);
        if (!joined(list)) break;
        const sp = spanOf(list);
        if (!(sp.hi > lo + 1e-6 && sp.lo < hi - 1e-6)) continue; // (has to reach into the range)
        runs.push({ list, sp, score: off(sp.lo, lo) + off(sp.hi, hi) });
      }
      runs.sort((a, b) => a.score - b.score || (a.sp.hi - a.sp.lo) - (b.sp.hi - b.sp.lo));
      const opts = [];
      for (const r of runs) {
        if (opts.length === 2 || (opts.length && r.score > Math.max(runs[0].score * 3, runs[0].score + 3 * k))) break; // (a second choice only when it's nearly as close)
        const label = rangeTxt(r.sp.lo, r.sp.hi, u, k);
        if (opts.some((o) => o.label === label)) continue;
        opts.push({ label, bands: r.list.map((x) => x.d), distance: { min: r.sp.lo ? r.sp.lo / k : null, max: r.sp.hi === Infinity ? null : r.sp.hi / k, unit: u } });
      }
      void inside; void touch;
      if (!opts.length) return { err: `There\u2019s no ${partName.toLowerCase()} distance band ${want} in the data${bands.length ? `: it has ${bands.map((x) => x.d).join(", ")}` : " (it needs shot-level detail)"}.` };
      // where the bands don't line up with the question ("don't split at 150")
      const at = [lo > 0 && !bands.some((x) => near(x.lo, lo)) ? lo / k : null, hi !== Infinity && !bands.some((x) => near(x.hi, hi)) ? hi / k : null].filter((x) => x != null);
      const why = `Your data\u2019s ${partName.toLowerCase()} bands ${at.length ? `don\u2019t split at ${at.join(" or ")} ${u}` : `don\u2019t cover ${want} exactly`}`;
      const text = opts.length > 1 ? `${why}. Would you like to look at **${opts[0].label}** or **${opts[1].label}**?` : `${why}. The closest is **${opts[0].label}**. Would you like to look at that?`;
      return { ask: { text, note: `Its bands: ${bands.map((x) => x.d).join(", ")}.`, options: opts } };
    }
    const list = inside.map((x) => x.d);
    dists = new Set(list);
    range = want;
    distTxt = `${/^\d/.test(want) ? "from " : ""}${want}${list.length > 1 ? ` (${list.join(" + ")})` : !want.endsWith(list[0]) && list[0] !== want ? ` (${list[0]})` : ""}`;
  }
  let lieSet = null;
  if (plan.lie) {
    const w = sq(plan.lie).replace(/^the/, "").replace(/bunker/, "sand");
    lieSet = new Set([...lies].filter((l) => { const x = sq(l).replace(/bunker/, "sand"); return x.includes(w) || w.includes(x); }));
    if (!lieSet.size) return { err: `There\u2019s no \u201c${plan.lie}\u201d lie for ${partName.toLowerCase()} in the data${lies.size ? `: it has ${[...lies].join(", ")}` : ""}.` };
  }
  const test = (s) => s.cat === part && (!dists || dists.has(s.dist)) && (!lieSet || lieSet.has(s.lie));
  const lieTxt = lieSet ? `from the ${[...lieSet].join(" / ").toLowerCase()}` : "";
  return { test, part, partName, label: [distTxt, lieTxt].filter(Boolean).join(" "), short: [range, lieTxt].filter(Boolean).join(", ") };
}
/** (update 261) A range in the question's unit: "inside 10 ft", "160-200 yds", "20+ ft". (lo, hi in feet; k: feet per unit) */
function rangeTxt(lo, hi, u, k) {
  const f = (x) => String(Math.round((x / k) * 10) / 10);
  return lo <= 1e-6 ? (hi === Infinity ? `any distance` : `inside ${f(hi)} ${u}`) : hi === Infinity ? `${f(lo)}+ ${u}` : `${f(lo)}-${f(hi)} ${u}`;
}
/** A metric over some rounds: { v, n (rounds), w (attempts / shots), per (SG a shot, narrowed) } */
function valueOf(rs, m, nar = null) {
  if (m.sg) {
    const r = rs.filter((rd) => rd.shots.length);
    if (!nar) return { v: r.length ? r.reduce((t, rd) => t + sgOf(rd, m.cat), 0) / r.length : null, n: r.length };
    let sg = 0, w = 0;
    for (const rd of r) for (const sh of rd.shots) if (nar.test(sh)) { sg += sh.sg || 0; w += sh.w || 1; }
    return { v: r.length && w ? sg / r.length : null, n: r.length, w: Math.round(w), per: w ? sg / w : null };
  }
  if (!nar) { const a = statAgg(statRounds(rs, m.key)); return { v: a.value, n: a.rounds, w: a.w }; }
  const rs2 = rs.map((rd) => ({ ...rd, obs: (rd.obs || []).filter((o) => o.k === m.key && nar.test(o)) }));
  const a = statAgg(statRounds(rs2, m.key), true);
  return { v: a.value, n: a.rounds, w: a.w };
}
const fmtM = (m, v) => { if (v == null) return "\u2014"; if (!m.sg) return fmtStat(m.def, v); const r = Math.round(v * 100) / 100; return `${r > 0 ? "+" : r < 0 ? "\u2212" : ""}${Math.abs(r).toFixed(2)}`; };
const better = (m, order) => { const hi = m.higher !== false; return order === "worst" ? !hi : hi; }; // true: sort highest first
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Every player in the field with a value for a metric over a period on a tour, best first (by the metric's direction). */
async function fieldTable(plan, m) {
  const { currentField, currentFieldDetail } = await import("./fieldSummary.js");
  // (update 260) narrowed to a distance or a lie: the field's shot detail (the summary only has each part of the game)
  const narrowed = !!(plan.distance || plan.lie);
  const cur = narrowed ? await currentFieldDetail() : await currentField();
  if (narrowed && !cur?.field) return { err: { nofile: "There\u2019s no field data to rank yet (it comes with an uploaded stats file).", paused: "The field\u2019s shot detail is switched off right now (the monthly storage budget was reached), so I can\u2019t rank by distance or lie until it\u2019s back on.", stale: "The field\u2019s shot detail is from an older upload. It\u2019s rebuilt when an admin opens Analyze on a computer; then I can rank by distance or lie." }[cur?.why] || "The field\u2019s shot detail (distances and lies) hasn\u2019t been built yet. It\u2019s built when an admin opens Analyze on a computer; then I can rank by distance or lie." };
  if (!cur?.field?.length) return { err: "There’s no field data to rank yet (it comes with an uploaded stats file)." };
  const nar = narrowed ? narrowFor(plan, m, cur.field.slice(0, 200).flatMap((p) => p.rounds.slice(-60))) : null;
  if (nar?.err) return { err: nar.err };
  if (nar?.ask) return { ask: nar.ask }; // (update 261)
  // the tour: as asked, else the one with the most rounds
  const count = new Map();
  for (const p of cur.field) for (const rd of p.rounds) if (rd.tour) count.set(rd.tour, (count.get(rd.tour) || 0) + 1);
  const tours = [...count].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const tour = plan.tour ? tours.find((t) => tourIs(t, plan.tour)) || null : tours[0] || null;
  if (plan.tour && !tour) return { err: `There’s no ${plan.tour} data in the latest file${tours.length ? ` (it has ${tours.join(" and ")})` : ""}.` };
  let label = "";
  const rows = [];
  for (const p of cur.field) {
    const mine = p.rounds.filter((rd) => !tour || tourIs(rd.tour, tour));
    const per = inPeriod(mine, plan.period, 12);
    label = per.label;
    if (!per.rounds.length) continue;
    const x = valueOf(per.rounds, m, nar);
    if (x.v == null) continue;
    rows.push({ key: p.key, name: p.name, ...x });
  }
  if (!rows.length) return { err: `No one has ${m.label} ${label} on ${tour || "the tour"} in the data.` };
  // enough rounds to count: as asked, else 40% of what the busiest players played (8 to 30)
  const ns = rows.map((r) => r.n).sort((a, b) => a - b), p90 = ns[Math.floor(ns.length * 0.9)] || ns.at(-1);
  const minR = plan.min_rounds || Math.max(plan.period?.last ? Math.min(plan.period.last, 8) : 8, Math.min(30, Math.round(p90 * 0.4)));
  const hiFirst = better(m, plan.order);
  const all = rows.filter((r) => r.n >= minR).sort((a, b) => (hiFirst ? b.v - a.v : a.v - b.v));
  return { all, rows, minR, tour, label, nar, uploadedAt: cur.uploadedAt };
}

/* ---------------------------------------------------------------- the answers */
async function answerField(plan) {
  const m = metricOf(plan.metric || "sg_total");
  const f = await fieldTable(plan, m);
  if (f.err) return { text: f.err };
  if (f.ask) return { ask: f.ask };
  const { all, minR, tour, label, nar } = f;
  if (nar) return answerFieldNarrowed(plan, m, f);
  if (!all.length) return { text: `No one has ${minR}+ rounds ${label}${tour ? ` on ${tour}` : ""}, so there’s no fair ranking. Try a longer period.` };
  const n = Math.min(plan.limit || 10, 25), top = all.slice(0, n), lead = top[0];
  const word = plan.order === "worst" ? (m.higher === false ? "the highest" : "the lowest") : m.higher === false ? "the lowest" : m.higher == null ? "the most" : "the best";
  const lines = [`**${lead.name}** has ${word} ${m.label} ${tour ? `on ${tour} ` : ""}${label}: **${fmtM(m, lead.v)}**${m.sg ? " a round" : ""} over ${plural(lead.n, "round")}.`];
  if (top.length > 1) lines.push(`Then ${top.slice(1, 4).map((r) => `${r.name} ${fmtM(m, r.v)}`).join(", ")}.`);
  // where the players they named stand
  const named = plan.players.map((nm) => { const k = sq(nm); return f.rows.find((r) => sq(r.name) === k || sq(r.name).endsWith(k)); }).filter(Boolean);
  for (const r of named) { // (placed best-first, whichever way the list runs)
    const at = all.findIndex((x) => x.key === r.key), place = plan.order === "worst" ? all.length - at : at + 1;
    lines.push(at >= 0 ? `${r.name}: ${fmtM(m, r.v)} (${plural(r.n, "round")}), ranks ${ordinal(place)} of ${all.length}.` : `${r.name}: ${fmtM(m, r.v)} over ${plural(r.n, "round")}, under the ${minR}-round minimum, so not ranked.`);
  }
  return {
    text: lines.join("\n\n"),
    table: { head: ["#", "Player", m.label, "Rounds"], num: [0, 2, 3], rows: top.map((r, i) => [String(i + 1), r.name, fmtM(m, r.v), String(r.n)]), mark: new Set(named.map((r) => top.findIndex((x) => x.key === r.key)).filter((i) => i >= 0)) },
    note: `Players with ${minR}+ rounds ${label}${tour ? ` on ${tour}` : ""} (${all.length} qualify). ${m.sg ? "Strokes gained a round." : m.def?.help || ""}`,
  };
}

/** (update 260) A ranking narrowed to a distance / lie: strokes gained a round from those shots, and a shot. */
function answerFieldNarrowed(plan, m, f) {
  const { all, minR, tour, label, nar } = f;
  if (!all.length) return { text: `No one has ${minR}+ rounds ${label}${tour ? ` on ${tour}` : ""}, so there\u2019s no fair ranking. Try a longer period.` };
  const n = Math.min(plan.limit || 10, 25), top = all.slice(0, n), lead = top[0];
  const what = m.sg ? `${nar.partName} ${nar.label}` : `${m.label} ${nar.label}`;
  const f3 = (v) => (v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`);
  const shotWord = nar.part === "PUTT" ? "putt" : "shot";
  const best = plan.order === "worst" ? "the least" : "the most";
  const lines = [m.sg
    ? `**${lead.name}** gains ${best} on ${what.toLowerCase().replace(/^putting/, "putts")} ${tour ? `on ${tour} ` : ""}${label}: **${fmtM(m, lead.v)}** a round (${f3(lead.per)} a ${shotWord} over ${lead.w} ${shotWord}s, ${plural(lead.n, "round")}).`
    : `**${lead.name}** has ${plan.order === "worst" ? "the lowest" : "the best"} ${what} ${tour ? `on ${tour} ` : ""}${label}: **${fmtM(m, lead.v)}** (${Math.round(lead.w)} attempts).`];
  if (top.length > 1) lines.push(`Then ${top.slice(1, 4).map((r) => `${r.name} ${fmtM(m, r.v)}`).join(", ")}.`);
  const named = plan.players.map((nm) => { const k = sq(nm); return f.rows.find((r) => sq(r.name) === k || sq(r.name).endsWith(k)); }).filter(Boolean);
  for (const r of named) { const at = all.findIndex((x) => x.key === r.key), place = plan.order === "worst" ? all.length - at : at + 1; lines.push(at >= 0 ? `${r.name}: ${fmtM(m, r.v)}, ranks ${ordinal(place)} of ${all.length}.` : `${r.name}: ${fmtM(m, r.v)} over ${plural(r.n, "round")}, under the ${minR}-round minimum, so not ranked.`); }
  return {
    text: lines.join("\n\n"),
    table: m.sg ? { head: ["#", "Player", `SG a round, ${nar.short}`, `SG a ${shotWord}`, `${shotWord[0].toUpperCase()}${shotWord.slice(1)}s`, "Rounds"], num: [0, 2, 3, 4, 5], rows: top.map((r, i) => [String(i + 1), r.name, fmtM(m, r.v), f3(r.per), String(r.w), String(r.n)]), mark: new Set(named.map((r) => top.findIndex((x) => x.key === r.key)).filter((i) => i >= 0)) }
      : { head: ["#", "Player", `${m.label}, ${nar.short}`, "Attempts", "Rounds"], num: [0, 2, 3, 4], rows: top.map((r, i) => [String(i + 1), r.name, fmtM(m, r.v), String(Math.round(r.w || 0)), String(r.n)]) },
    note: `${nar.partName} shots ${nar.label}, ${label}${tour ? ` on ${tour}` : ""}: players with ${minR}+ rounds (${all.length} qualify). SG a round: those shots\u2019 strokes gained, spread over every round played.`,
  };
}

async function answerPlayer(plan, ps) {
  const out = [];
  const datas = await Promise.all(ps.map(async (p) => ({ p, rounds: await roundsOf(p.key, p.label) })));
  const withData = datas.filter((d) => sgRds(d.rounds).length);
  if (!withData.length) return [{ text: `I couldn’t find any strokes-gained rounds for ${ps.map((p) => p.label).join(" or ")}.` }];
  const bd = plan.breakdown || (!plan.metric && !plan.distance && !plan.lie ? "category" : null);
  // several players, one number or the parts of the game: one table, a row each
  if (withData.length > 1 && (!bd || bd === "category")) {
    const ms = bd === "category" ? ["sg_total", "sg_ott", "sg_app", "sg_arg", "sg_putt"].map(metricOf) : [metricOf(plan.metric)];
    let label = "";
    let narErr = null, narLabel = "", narAsk = null;
    const rows = withData.map(({ p, rounds }) => { const per = inPeriod(rounds, plan.period, 12); label = per.label;
      return { name: p.label, n: per.rounds.length, vals: ms.map((m) => { const nar = narrowFor(plan, m, per.rounds); if (nar?.err) { narErr = nar.err; return null; } if (nar?.ask) { narAsk = nar.ask; return null; } if (nar) narLabel = ` ${nar.label}`; return valueOf(per.rounds, m, nar).v; }) }; });
    if (rows.every((r) => !r.n)) return [{ text: `None of them have rounds ${label}.` }];
    if (narAsk) return [{ ask: narAsk }];
    if (narErr && rows.every((r) => r.vals.every((v) => v == null))) return [{ text: narErr }];
    if (narLabel) label = `${label}, ${narLabel.trim()}`;
    const m0 = ms[0], hiFirst = better(m0, "best");
    const lead = [...rows].filter((r) => r.vals[0] != null).sort((a, b) => (hiFirst ? b.vals[0] - a.vals[0] : a.vals[0] - b.vals[0]))[0];
    out.push({ text: lead ? `${label.charAt(0).toUpperCase()}${label.slice(1)}, **${lead.name}** leads on ${m0.label}: **${fmtM(m0, lead.vals[0])}**.` : "None of them have those numbers.",
      table: { head: ["Player", ...ms.map((m) => m.label.replace(/^SG: /, "")), "Rounds"], num: ms.map((_, i) => i + 1).concat(ms.length + 1), rows: rows.map((r) => [r.name, ...r.vals.map((v, i) => fmtM(ms[i], v)), String(r.n)]) } });
    return out;
  }
  for (const { p, rounds } of withData) out.push(await onePlayer(plan, p, rounds, bd));
  return out;
}

async function onePlayer(plan, p, rounds, bd) {
  const name = p.label, m = metricOf(plan.metric || (plan.part ? PART_OF[plan.part] : "sg_total"));
  const per = inPeriod(rounds, plan.period, bd === "season" ? null : 12);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (!per.rounds.length) return { text: `${name} has no rounds ${per.label}.` };
  // (update 260) narrowed to a distance / lie ("inside 10 ft"): every number below counts only those shots
  const nar = narrowFor(plan, m, per.rounds);
  if (nar?.err) return { text: nar.err };
  if (nar?.ask) return { ask: nar.ask }; // (update 261)
  if (nar && (bd === "distance" || bd === "lie" || bd === "category")) bd = null;
  const narTxt = nar ? ` ${nar.label}` : "";
  const few = (n) => (n < 10 ? ` That’s only ${plural(n, "round")}, so treat it as a hint.` : "");
  if (bd === "category") {
    const cats = CATEGORIES.map(([c, l]) => ({ l, v: per.rounds.reduce((t, rd) => t + sgOf(rd, c), 0) / per.rounds.length, car: sgRds(rounds).reduce((t, rd) => t + sgOf(rd, c), 0) / sgRds(rounds).length }));
    const s = [...cats].sort((a, b) => b.v - a.v), tot = cats.reduce((t, c) => t + c.v, 0);
    return { text: `${cap(per.label)}, ${name} gains the most on **${s[0].l}** (**${fmtM(m, s[0].v)}** a round) and ${s.at(-1).v < 0 ? "loses the most" : "gains the least"} on **${s.at(-1).l}** (${fmtM(m, s.at(-1).v)}). Total ${fmtM(m, tot)} a round over ${plural(per.rounds.length, "round")}.${few(per.rounds.length)}`,
      table: { head: ["Part of the game", per.label.replace(/^over the |^in /, ""), "All their data"], num: [1, 2], rows: s.map((c) => [c.l, fmtM(m, c.v), fmtM(m, c.car)]) } };
  }
  if (bd === "season") {
    const ys = [...new Set(per.rounds.map(yr))].sort().reverse();
    const rows = ys.map((y) => { const x = valueOf(per.rounds.filter((rd) => yr(rd) === y), m, nar); return { y, ...x }; }).filter((r) => r.v != null);
    const best = [...rows].sort((a, b) => (better(m, "best") ? b.v - a.v : a.v - b.v))[0];
    return { text: best ? `${name}’s best season for ${m.label}${narTxt} is **${best.y}**: **${fmtM(m, best.v)}** over ${plural(best.n, "round")}.` : `${name} has no ${m.label} by season.`,
      table: { head: ["Season", m.label, "Rounds"], num: [1, 2], rows: rows.map((r) => [r.y, fmtM(m, r.v), String(r.n)]) } };
  }
  if (bd === "event" || bd === "round") {
    const groups = new Map();
    for (const rd of per.rounds) { const k = bd === "event" ? evOf(rd) : rd; (groups.get(k) || groups.set(k, []).get(k)).push(rd); }
    const rows = [...groups.values()].map((rs) => ({ rs, ...valueOf(rs, m, nar) })).filter((r) => r.v != null && (bd === "round" || r.n >= 2 || groups.size < 4));
    const hiFirst = better(m, plan.order);
    rows.sort((a, b) => (hiFirst ? b.v - a.v : a.v - b.v));
    const top = rows.slice(0, Math.min(plan.limit || 8, 25));
    if (!top.length) return { text: `${name} has no ${m.label} ${per.label}.` };
    const r0 = top[0].rs[0], what = bd === "event" ? `${r0.event} (${yr(r0)})` : `${r0.event} R${r0.roundNo || "?"}, ${dateTxt(dk(r0))}`;
    return { text: `${name}’s ${plan.order === "worst" ? "worst" : "best"} ${bd} for ${m.label}${narTxt} ${per.label} was **${what}**: **${fmtM(m, top[0].v)}**${m.sg ? " a round" : ""}${bd === "event" ? ` over ${plural(top[0].n, "round")}` : ""}.`,
      table: bd === "event" ? { head: ["Tournament", "Dates", m.label + (m.sg ? " / rd" : ""), "Rounds"], num: [2, 3], rows: top.map((r) => [`${r.rs[0].event} ${yr(r.rs[0])}`, `${dateTxt(dk(r.rs[0]))}`, fmtM(m, r.v), String(r.n)]) }
        : { head: ["Date", "Tournament", "Round", m.label], num: [2, 3], rows: top.map((r) => [dateTxt(dk(r.rs[0])), r.rs[0].event, String(r.rs[0].roundNo || "–"), fmtM(m, r.v)]) } };
  }
  if (bd === "distance" || bd === "lie" || bd === "club" || bd === "ball") {
    const part = plan.part || (m.sg && m.cat && m.cat !== "T2G" ? m.cat : bd === "ball" ? null : "APP");
    const partName = part ? CATEGORIES.find(([c]) => c === part)?.[1] : "all shots";
    const keyOf = { distance: (s) => s.dist, lie: (s) => s.lie, club: (s) => (s.gear ? String(s.gear).split("|").pop() : null), ball: (s) => s.ball || null }[bd];
    const g = new Map();
    for (const rd of per.rounds) for (const s of rd.shots) {
      if (part && s.cat !== part) continue;
      const k = keyOf(s);
      if (k == null || k === "" || /^(none|null|na)$/i.test(String(k))) continue;
      const x = g.get(k) || g.set(k, { sg: 0, w: 0, rds: new Set() }).get(k);
      x.sg += s.sg || 0; x.w += s.w || 1; x.rds.add(rd);
    }
    let rows = [...g].map(([k, x]) => ({ k: String(k), per: x.sg / x.w, w: Math.round(x.w), rds: x.rds.size, perRd: x.sg / per.rounds.length })).filter((r) => r.w >= 5);
    if (!rows.length) return { text: `There’s no ${bd} detail for ${name}’s ${partName.toLowerCase()} ${per.label}. (It needs shot-level data in the uploaded file.)` };
    const s = [...rows].filter((r) => r.w >= 15).sort((a, b) => b.per - a.per);
    if (bd === "distance") rows.sort((a, b) => distLead(a.k) - distLead(b.k) || a.k.localeCompare(b.k)); else rows.sort((a, b) => b.w - a.w);
    const f3 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`;
    const head = { distance: "Distance", lie: "Lie", club: "Club", ball: "Ball" }[bd];
    return { text: s.length === 1 ? `${cap(per.label)}, ${name}\u2019s ${partName.toLowerCase()} ${bd === "distance" ? "from" : "with"} **${s[0].k}**: **${f3(s[0].per)}** a shot over ${s[0].w} shots.` : s.length ? `${cap(per.label)}, ${name}’s ${partName.toLowerCase()} is best ${bd === "distance" ? "from" : "with"} **${s[0].k}** (**${f3(s[0].per)}** a shot) and ${s.at(-1).per < 0 ? "loses the most" : "weakest"} ${bd === "distance" ? "from" : "with"} **${s.at(-1).k}** (${f3(s.at(-1).per)} a shot).` : `${cap(per.label)}, here’s ${name}’s ${partName.toLowerCase()} by ${bd}. None has many shots yet, so treat it as a hint.`,
      table: { head: [head, "SG a shot", "Shots", "SG a round"], num: [1, 2, 3], rows: rows.map((r) => [r.k, f3(r.per), String(r.w), fmtM({ sg: true }, r.perRd)]) },
      note: `${partName} shots ${per.label} (${plural(per.rounds.length, "round")}). SG a round: what those shots add up to, spread over every round.` };
  }
  // one number: the period, their whole data, and where they rank in the field over the same period (on one tour, the
  // one asked about or the one they played most, so their number is the same one the ranking uses)
  const tourCount = new Map(); for (const rd of per.rounds) if (rd.tour) tourCount.set(rd.tour, (tourCount.get(rd.tour) || 0) + 1);
  const mainTour = plan.tour ? [...tourCount.keys()].find((t) => tourIs(t, plan.tour)) || plan.tour : [...tourCount].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const onTour = (rs) => (mainTour ? rs.filter((rd) => tourIs(rd.tour, mainTour)) : rs);
  const per2 = inPeriod(onTour(rounds), plan.period, 12);
  if (per2.rounds.length) per.rounds = per2.rounds;
  const x = valueOf(per.rounds, m, nar), car = valueOf(sgRds(onTour(rounds)), m, nar);
  const what = nar && m.sg ? `${nar.partName}${narTxt}` : `${m.label}${narTxt}`;
  const perShot = nar && m.sg && x.per != null ? ` (${x.per >= 0 ? "+" : "\u2212"}${Math.abs(x.per).toFixed(3)} a ${nar.part === "PUTT" ? "putt" : "shot"} over ${x.w})` : "";
  const lines = [`${cap(per.label)}${mainTour && tourCount.size > 1 ? ` on ${mainTour}` : ""}, ${name}\u2019s ${what} is **${fmtM(m, x.v)}**${m.sg ? " a round" : ""}${perShot} over ${plural(x.n, "round")}${x.w && !m.sg && (m.def?.pct || m.key === "prox") ? ` (${Math.round(x.w)} attempts)` : ""}. Across all their data: ${fmtM(m, car.v)}.${few(x.n)}`];
  let table = null;
  try {
    const f = await fieldTable({ ...plan, tour: mainTour, order: "best", players: [] }, m);
    const at = f.all ? f.all.findIndex((r) => r.key === p.key) : -1;
    if (at >= 0) lines.push(`That ranks **${ordinal(at + 1)} of ${f.all.length}** on ${f.tour || "the tour"} ${f.label} (players with ${f.minR}+ rounds).`);
    if (f.all?.length) { const top = f.all.slice(0, 5); table = { head: ["#", "Player", nar ? `${what} / rd` : m.label, "Rounds"], num: [0, 2, 3], rows: [...top.map((r, i) => [String(i + 1), r.name, fmtM(m, r.v), String(r.n)]), ...(at >= 5 ? [[String(at + 1), f.all[at].name, fmtM(m, f.all[at].v), String(f.all[at].n)]] : [])], mark: new Set([at < 5 ? at : 5]) }; }
  } catch { /* the field isn't there: just their numbers */ }
  return { text: lines.join("\n\n"), table };
}

/* ---------------------------------------------------------------- (update 264) comparisons, answered here */
// A Compare plan (the AI's, or one read here) worked out with Compare's own maths, for a short answer in the chat; the
// full comparison is a tap away ("Open in Compare"). Everyone in the data (the whole field pooled) stays in Compare.
const SGCOLS = [["TOTAL", "Total"], ["OTT", "OTT"], ["APP", "APP"], ["ARG", "ARG"], ["PUTT", "PUTT"]];
function compareFilters(cp) {
  const int = (v, hi = 999) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= hi ? n : null; };
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  const parts = (Array.isArray(cp.parts) ? cp.parts : []).filter((c) => ["OTT", "APP", "ARG", "PUTT"].includes(c));
  const groups = (Array.isArray(cp.groups) ? cp.groups : []).slice(0, 8).map((g, i) => {
    const r = g?.rounds && typeof g.rounds === "object" ? g.rounds : {}, f = {};
    const ys = (Array.isArray(r.years) ? r.years : []).map(String).filter((y) => /^20\d\d$/.test(y)); if (ys.length) f.years = ys;
    if (day(r.from)) f.from = day(r.from); if (day(r.to)) f.to = day(r.to);
    for (const [k, to] of [["last", "last"], ["before_last", "prev"], ["last_events", "lastEv"], ["before_last_events", "prevEv"], ["best", "top"], ["worst", "bottom"]]) if (int(r[k])) f[to] = int(r[k]);
    if (int(r.best_pct, 99)) f.topPct = int(r.best_pct, 99); if (int(r.worst_pct, 99)) f.bottomPct = int(r.worst_pct, 99);
    if (int(r.best_stretch)) f.stretch = { n: int(r.best_stretch), ...(parts.length === 1 ? { cat: parts[0] } : {}) };
    else if (int(r.worst_stretch)) f.stretch = { n: int(r.worst_stretch), worst: true, ...(parts.length === 1 ? { cat: parts[0] } : {}) };
    const ex = Number(r.except_group);
    return { label: String(g?.label || `Group ${i + 1}`).slice(0, 40), f, gear: typeof g?.gear === "string" ? g.gear.trim() : "", except: Number.isInteger(ex) && ex !== i ? ex : null };
  });
  groups.forEach((g, i) => { if (g.except != null && groups[g.except]) groups[i].f = { ...g.f, except: { ...groups[g.except].f, except: null } }; });
  return { groups, parts, each: cp.each === true };
}
/** A plan read here, for the plain shapes (seasons, recent form, a stretch, the past N months); null for anything else. */
function localCompare(question, list) {
  const a = readAsk(question, { players: list, maxYear: new Date().getFullYear() });
  if (a.kinds.length || a.everyone) return null; // (clubs, balls and the whole field: Compare reads those itself)
  const g = (label, rounds) => ({ label, rounds });
  let groups = null;
  if (a.stretch) groups = [g(`${a.stretch.worst ? "Worst" : "Best"} ${a.stretch.n}-round stretch`, { ...(a.since ? { from: a.since.from } : {}), [a.stretch.worst ? "worst_stretch" : "best_stretch"]: a.stretch.n }), a.last ? g(`Last ${a.last.n} rounds`, { last: a.last.n }) : g("Every round", a.since ? { from: a.since.from } : {})];
  else if (a.years.length >= 2) groups = a.years.slice().reverse().slice(0, 4).map((y) => g(y, { years: [y] }));
  else if (a.last) groups = a.last.unit === "events" ? [g(`Last ${a.last.n} events`, { last_events: a.last.n }), g(`The ${a.last.n} events before`, { before_last_events: a.last.n })] : [g(`Last ${a.last.n} rounds`, { last: a.last.n }), g(`The ${a.last.n} rounds before`, { before_last: a.last.n })];
  else if (a.since) { const from = new Date(a.since.from), days = Math.round((Date.now() - from) / 864e5), before = new Date(from.getTime() - days * 864e5).toISOString().slice(0, 10), to0 = new Date(from.getTime() - 864e5).toISOString().slice(0, 10); groups = [g(a.since.label.replace(/^the p/, "P"), { from: a.since.from }), g("The same stretch before", { from: before, to: to0 })]; }
  if (!groups) return null;
  return { players: a.players.map((p) => p.label), everyone: false, parts: a.cats, exclude: { events: a.excl, rounds: a.exclRounds }, groups, each: false };
}
async function answerCompare(cp, question, list) {
  if (cp.everyone) return null;
  const match = (nm) => readAsk(nm, { players: list }).players[0] || null;
  let ps = [...new Map((cp.players || []).map(match).filter(Boolean).map((p) => [p.key, p])).values()];
  if (!ps.length && PRONOUN.test(question) && lastPlayers.length) ps = lastPlayers;
  if (!ps.length && list.length === 1) ps = [{ key: list[0][0], label: list[0][1] }];
  if (!ps.length) return null;
  ps = ps.slice(0, 3); lastPlayers = ps;
  const { roundsFor, includeShots, summarize, products } = await import("./compareData.js");
  const { gearInfo } = await import("./sg.js");
  const plan = compareFilters(cp);
  if (!plan.groups.length) return null;
  const cats = plan.parts.length ? new Set(plan.parts) : null;
  const rows = [], skipped = [];
  for (const p of ps) {
    let rounds = await roundsOf(p.key, p.label);
    // what to leave out
    const evs = new Map(); for (const rd of rounds) if (rd.event) { const k = `${rd.event}|${yr(rd)}`; if (!evs.has(k)) evs.set(k, { k, event: rd.event, year: yr(rd) }); }
    const out = matchEvents(cp.exclude?.events || [], [...evs.values()]), outR = new Set((cp.exclude?.rounds || []).map(String));
    if (out.size || outR.size) rounds = rounds.filter((rd) => !out.has(`${rd.event}|${yr(rd)}`) && !outR.has(String(rd.roundNo || "")));
    // the groups: clubs and balls matched to this player's (as Compare does), the rest as they are
    const gearIdx = plan.groups.map((g, i) => (g.gear ? i : -1)).filter((i) => i >= 0);
    const byIdx = new Map();
    if (gearIdx.length) {
      const catalog = products(rounds).map((k) => ({ ...k, items: k.items.map((o) => ({ ...o, ...gearInfo(o.value) })) }));
      const sides = gearIdx.map((i) => plan.groups[i].gear.toLowerCase());
      for (const x of productGroups({ text: sides.join(" vs "), sides, together: !(plan.each && sides.length === 1), years: [] }, catalog)) { const i = gearIdx[x.side ?? 0]; (byIdx.get(i) || byIdx.set(i, []).get(i)).push(x); }
    }
    plan.groups.forEach((g, i) => {
      const list0 = g.gear ? (byIdx.get(i) || []).map((x) => ({ label: (byIdx.get(i).length > 1 ? x.name.replace(/ \u00b7 .*$/, "") : g.label), f: { ...x.f, ...g.f } })) : [{ label: g.label, f: g.f }];
      if (g.gear && !list0.length) { skipped.push(`${g.label} (no \u201c${g.gear}\u201d in ${p.label}\u2019s rounds)`); return; }
      for (const x of list0) {
        let rs = roundsFor(rounds, x.f);
        if (cats) rs = includeShots(rs, { cats });
        const s = summarize(rs);
        if (!s.n) { skipped.push(`${ps.length > 1 ? `${p.label} \u00b7 ` : ""}${x.label} (no rounds)`); continue; }
        const used = new Set(rs.flatMap((rd) => rd.shots.map((sh) => sh.cat))); // (the parts of the game these rounds have shots in: a driver's are all off the tee)
        rows.push({ label: ps.length > 1 ? `${p.label} \u00b7 ${x.label}` : x.label, s, used, stretch: !!x.f.stretch });
      }
    });
  }
  if (!rows.length) return { text: `None of that had any rounds${skipped.length ? `: ${skipped.join(", ")}` : ""}.` };
  const partsTxt = plan.parts.length ? `${plan.parts.map((c) => CATEGORIES.find(([k]) => k === c)?.[1]).join(" + ")} only: ` : "";
  const f2 = (v) => fmtM({ sg: true }, v);
  const mid = (t) => String(t).replace(/^(The|Every|All) /, (w) => w.toLowerCase()).replace(/^(Last|Best|Worst|Most) /, (w) => `the ${w.toLowerCase()}`); // ("against +0.80 for the 12 rounds before")
  const lines = [];
  if (rows.length === 1) lines.push(`${partsTxt}**${rows[0].label}**: **${f2(rows[0].s.sg.TOTAL)}** strokes gained a round over ${plural(rows[0].s.n, "round")}. There\u2019s nothing to compare it with${skipped.length ? ` (${skipped.join(", ")})` : ""}.`);
  else {
    const o = [...rows].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL), a = o[0], b = o[1], d = a.s.sg.TOTAL - b.s.sg.TOTAL;
    lines.push(`${partsTxt}**${a.label}** comes out ahead: **${f2(a.s.sg.TOTAL)}** a round over ${plural(a.s.n, "round")}, against ${f2(b.s.sg.TOTAL)} for ${mid(b.label)} (${plural(b.s.n, "round")}), **${Math.abs(d).toFixed(2)}** a round apart.${o.length > 2 ? ` Then ${o.slice(2).map((x) => `${x.label} ${f2(x.s.sg.TOTAL)}`).join(", ")}.` : ""}`);
    const used = new Set(rows.flatMap((r) => [...r.used]));
    const catsShown = SGCOLS.slice(1).filter(([k]) => (!cats || cats.has(k)) && used.has(k));
    if (catsShown.length > 1) { const ds = catsShown.map(([k]) => ({ l: CATEGORIES.find(([c]) => c === k)?.[1] || k, d: (a.s.sg[k] ?? 0) - (b.s.sg[k] ?? 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)); lines.push(`The biggest difference is **${ds[0].l}** (${f2(ds[0].d)} a round${ds[0].d >= 0 ? ` for ${a.label}` : ` against ${a.label}`}).`); }
    // a run of rounds in a row: when it was
    for (const r of rows.filter((x) => x.stretch && x.s.from)) lines.push(`${r.label}: ${dateTxt(dk({ date: r.s.from }))} to ${dateTxt(dk({ date: r.s.to }))}.`);
    if (a.s.n < 10 || b.s.n < 10) lines.push("Few rounds on one side, so treat it as a hint.");
    if (skipped.length) lines.push(`(Not in this: ${skipped.join(", ")}.)`);
  }
  // the columns: the parts of the game that were used (and Total only when there's more than one of them)
  const usedAll = new Set(rows.flatMap((r) => [...r.used]));
  const partCols = SGCOLS.slice(1).filter(([k]) => (!cats || cats.has(k)) && usedAll.has(k));
  const cols = partCols.length > 1 ? [SGCOLS[0], ...partCols] : partCols.length ? partCols : [SGCOLS[0]];
  return { text: lines.join("\n\n"), table: { head: ["", ...cols.map(([, l]) => l), "Rounds"], num: cols.map((_, i) => i + 1).concat(cols.length + 1), rows: rows.map((r) => [r.label, ...cols.map(([k]) => f2(r.s.sg[k])), String(r.s.n)]) } };
}

/* ---------------------------------------------------------------- asking */
/** (update 261) Work out a plan's answer and show it; when Callie needs to ask which range first, ask and wait. */
async function respond(plan, ps, missing = []) {
  const answers = plan.intent === "field" ? [await answerField(plan)] : await answerPlayer(plan, ps);
  const q = answers.find((a) => a.ask);
  if (q) { pending = { plan, ps, missing, options: q.ask.options }; chat.push({ who: "callie", text: q.ask.text, note: q.ask.note, choices: q.ask.options }); busy = false; draw(); return; }
  pending = null;
  answers.forEach((a, i) => {
    const extra = i === answers.length - 1 ? [missing.length ? `(Couldn\u2019t find ${missing.join(", ")}.)` : null, plan.unsupported ? `(Not in this answer: ${plan.unsupported})` : null] : [];
    chat.push({ who: "callie", ...a, text: [a.text, ...extra].filter(Boolean).join("\n\n") });
  });
  busy = false; draw();
}
/** (update 261) The answer to Callie's question ("160-200 yds"): a tap on a choice, or typed ("the first", "160", "140-200"). */
function pickedOption(text) {
  if (!pending) return null;
  const t = text.toLowerCase(), opts = pending.options;
  if (/\b(first|former|1st|option 1)\b/.test(t)) return opts[0];
  if (/\b(second|latter|2nd|option 2)\b/.test(t) && opts[1]) return opts[1];
  if (/^\s*(yes|yeah|yep|sure|ok|okay|that|do that|please)\b/.test(t) && opts.length === 1) return opts[0];
  const nums = (x) => (x.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const tn = nums(t);
  if (!tn.length || tn.length > 2 || t.length > 40) return null;
  const hit = opts.filter((o) => { const on = nums(o.label); return tn.every((n) => on.includes(n)); });
  return hit.length === 1 ? hit[0] : null;
}
async function choose(opt, typed = null) {
  const p = pending;
  if (!p || busy) return;
  chat.push({ who: "me", text: typed || opt.label });
  for (const m of chat) delete m.choices; // (the question is answered)
  busy = true; draw();
  try { await respond({ ...p.plan, distance: opt.distance }, p.ps, p.missing); }
  catch (err) { console.error(err); pending = null; chat.push({ who: "callie", text: "Something went wrong working that out. Try asking another way.", err: true }); busy = false; draw(); }
}

async function ask(question) {
  const picked = pickedOption(question);
  if (picked) return choose(picked, question);
  // (update 262) "yes" / "either" when there are two choices: ask again which one (not a new question)
  if (pending && /^\s*(yes|yeah|yep|sure|ok|okay|either|both|whichever|any|either one|that one)\b[\s.!?]*$/i.test(question)) {
    if (/^\s*(either|whichever|any|either one)\b/i.test(question)) return choose(pending.options[0], question);
    chat.push({ who: "me", text: question });
    for (const m of chat) delete m.choices;
    chat.push({ who: "callie", text: `Which one: **${pending.options.map((o) => o.label).join("** or **")}**?`, choices: pending.options });
    draw(); return;
  }
  if (pending) { pending = null; for (const m of chat) delete m.choices; }
  chat.push({ who: "me", text: question });
  busy = true; draw();
  const reply = (o) => { chat.push({ who: "callie", ...o }); busy = false; draw(); };
  try {
    const list = await playersYouCanSee();
    const local = readLocal(question, list);
    const ai = await aiPlan(question);
    const plan = ai ? cleanPlan(ai, local) : local;
    if (ai && !plan.metric && local.metric && plan.intent !== "compare") plan.metric = local.metric;
    // players: the names the plan gives, matched to the players you can see
    const match = (nm) => readAsk(nm, { players: list }).players[0] || null;
    let ps = [...new Map(plan.players.map(match).filter(Boolean).map((p) => [p.key, p])).values()];
    const missing = plan.players.filter((nm) => !match(nm));
    if (plan.intent === "compare") {
      // (update 264) worked out here, in short, with the full comparison a tap away
      const cp = plan.compare || localCompare(question, list);
      const href = `#/comparisons?ask=${encodeURIComponent(question)}${cp ? "&plan=1" : ""}`;
      const a = cp ? await answerCompare(cp, question, list).catch((err) => { console.error(err); return null; }) : null;
      if (a) return reply({ ...a, go: { href, label: "Open in Compare for more details \u2192", plan: cp } });
      return reply({ text: cp?.everyone ? "That one pools everyone in the data, so it\u2019s best seen in **Compare**." : "That\u2019s a comparison I\u2019ll leave to **Compare**.", go: { href, label: "Open it in Compare \u2192", plan: cp } });
    }
    if (plan.intent === "unsupported") return reply({ text: plan.unsupported ? `I can\u2019t work that out from the data: ${plan.unsupported}` : "I can\u2019t work that out from the data. Ask about strokes gained or a stat for a player, a tournament or a period, or who leads the tour in something." });
    if (plan.intent !== "field") {
      if (!ps.length && PRONOUN.test(question) && lastPlayers.length) ps = lastPlayers;
      if (!ps.length && list.length === 1) ps = [{ key: list[0][0], label: list[0][1] }];
      if (!ps.length) return reply({ text: missing.length ? `I couldn\u2019t find ${missing.join(", ")} among the players you can see.` : "Which player? Put their name in the question, or ask who leads the tour in something." });
      ps = ps.slice(0, MAX_PLAYERS); lastPlayers = ps;
    }
    await respond(plan, ps, missing);
  } catch (err) {
    console.error(err);
    reply({ text: "Something went wrong working that out. Try asking another way.", err: true });
  }
}

/* ---------------------------------------------------------------- the panel */
// **bold** and paragraphs, built as elements (never as HTML)
const rich = (text) => String(text).split(/\n\s*\n/).map((para) => el("p", {}, para.split(/\*\*/).map((p, i) => (i % 2 ? el("strong", {}, p) : p))));
function tableOf(t) {
  return el("div", { class: "cal-tw" }, el("table", { class: "cal-table" }, [
    el("thead", {}, el("tr", {}, t.head.map((h, i) => el("th", { class: t.num?.includes(i) ? "num" : null }, h)))),
    el("tbody", {}, t.rows.map((r, ri) => el("tr", { class: t.mark?.has(ri) ? "on" : null }, r.map((c, i) => el("td", { class: t.num?.includes(i) ? "num" : null }, c))))),
  ]));
}
function examples(list) {
  const n = list.length === 1 ? list[0][1] : list.find(([, l]) => /schauffele/i.test(l))?.[1] || list[0]?.[1] || "Xander Schauffele";
  const last = n.split(" ").pop();
  return list.length > 1
    ? ["Who putts best on Tour?", `Where does ${last} gain and lose strokes this season?`, `What was ${last}’s best tournament this year?`, `How does ${last} do on approach shots by distance?`, `Compare ${last} 2026 vs 2025`]
    : [`Where do I gain and lose strokes this season?`, "What was my best tournament this year?", "How is my putting over my last 10 rounds?", "Who putts best on Tour?"];
}
function draw() {
  if (!panel) return;
  const log = panel.querySelector(".cal-log"), input = panel.querySelector(".cal-in"), send = panel.querySelector(".cal-send");
  const items = [];
  if (!chat.length) {
    items.push(el("div", { class: "cal-msg callie" }, [el("p", {}, "Hi, I’m Cal,"), el("p", {}, "You can ask me anything about the data. For example, you could ask about a player’s stats over a specific stretch of time, who leads the tour in a certain category, or how two products compare."), el("p", {}, "What would you like to know first?"),
      el("p", { class: "muted small" }, "Every number I show is worked out from the data available on this site.")])); // (update 290)
    items.push(el("div", { class: "cal-ex" }, exList.map((t) => { const b = el("button", { type: "button", class: "cmp-chip small" }, t); b.addEventListener("click", () => { if (!busy) ask(t); }); return b; })));
  }
  for (const m of chat) {
    if (m.who === "me") { items.push(el("div", { class: "cal-msg me" }, el("p", {}, m.text))); continue; }
    const go = m.go ? el("a", { class: "link small cal-go", href: m.go.href }, m.go.label) : null;
    if (go && m.go.plan) go.addEventListener("click", () => { try { sessionStorage.setItem("callie.plan", JSON.stringify(m.go.plan)); } catch { /* */ } }); // (update 264: Compare opens with this plan, no second AI call)
    const choices = m.choices?.length ? el("div", { class: "cal-choices" }, m.choices.map((o) => { const b = el("button", { type: "button", class: "cmp-chip small cal-choice", title: o.bands.join(" + ") }, [o.label, o.bands.join(" + ") !== o.label ? el("span", { class: "cmp-chip-n" }, o.bands.join(" + ")) : null]); b.addEventListener("click", () => choose(o)); return b; })) : null;
    items.push(el("div", { class: `cal-msg callie${m.err ? " err" : ""}${m.table ? " wide" : ""}` }, [...rich(m.text), choices, m.table ? tableOf(m.table) : null, m.note ? el("p", { class: "muted small cal-based" }, m.note) : null, go]));
  }
  if (busy) items.push(el("div", { class: "cal-msg callie cal-typing", "aria-label": "Cal is working it out" }, [el("i"), el("i"), el("i")]));
  mount(log, items);
  log.scrollTop = log.scrollHeight;
  input.disabled = busy; send.disabled = busy;
  if (!busy) input.focus();
}
export async function openCallie() {
  if (!panel) {
    const input = el("textarea", { class: "cal-in", rows: 2, placeholder: "Ask Cal…", "aria-label": "Your question" });
    const send = el("button", { type: "button", class: "btn cal-send", "aria-label": "Send" }, "Ask");
    const go = () => { const t = input.value.trim(); if (!t || busy) return; input.value = ""; ask(t); };
    send.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close Cal" }, "✕");
    close.addEventListener("click", closeCallie);
    const fresh = el("button", { type: "button", class: "link small" }, "New chat");
    fresh.addEventListener("click", () => { chat.length = 0; lastPlayers = []; pending = null; busy = false; draw(); });
    panel = el("div", { class: "cal-wrap", hidden: true }, [
      el("div", { class: "cal-back" }),
      el("section", { class: "cal", role: "dialog", "aria-modal": "true", "aria-label": "Cal, your data assistant" }, [
        el("header", { class: "cal-head" }, [el("span", { class: "cal-ava" }, icon("robot")), el("div", {}, [el("strong", {}, "Cal"), el("span", { class: "muted small" }, "Your AI data caddy")]), fresh, close]),
        el("div", { class: "cal-log", "aria-live": "polite" }),
        el("div", { class: "cal-foot" }, [input, send]),
      ]),
    ]);
    panel.querySelector(".cal-back").addEventListener("click", closeCallie);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCallie(); });
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  document.documentElement.classList.add("cal-open");
  exList = examples(await playersYouCanSee());
  draw();
}
export function closeCallie() {
  if (!panel) return;
  panel.hidden = true;
  document.documentElement.classList.remove("cal-open");
  document.querySelector(".callie-link")?.focus();
}
window.addEventListener("hashchange", () => { if (panel && !panel.hidden && /#\/comparisons\?ask=/.test(location.hash)) closeCallie(); });
