// (update 956) Cal as a caddie on the course: the round in progress, run by talking (or typing) to Cal from any page.
//   Scores:   "I made a 5", "bogey on 7", "par", "put me down for a 4 on the 12th", "two-putt par", "5 on 7"
//   Edits:    "change hole 7 to a 4", "actually that was a bogey", "I had a 6 not a 5 on 12", "undo", "scratch that"
//   Shots:    "driver to the fairway, 150 left", "7 iron to the green, 20 feet", "made the putt" (saved as the next shots)
//   Round:    "next hole", "I'm on 9", "go back to hole 3", "finish my round", "read me my card", "how many putts today",
//             "what do I need to break 80", "what's the yardage / par / handicap of this hole"
//   Recall:   "what did I hit from 150 last time", "what do I usually hit from 150", "how have I putted from 10 feet",
//             "how did I play this hole last time", "what did I score on 7 here before", "my best score here",
//             "how far do I hit my 7 iron"
//   Advice:   "what club from 165", "what should I hit" (from what's left), "165 into the wind", "how should I play this hole",
//             "where should I miss" (Cal's Way, for this course and hole)
// Saved straight away when it's clear what was meant; asked first ("yes" / "no") when it isn't (replacing shots already
// entered, a score that looks wrong, finishing with holes still blank). Everything Cal saved can be undone.
// The pure parts (understanding what was said) are tested on their own; the saving goes through deps (Firestore in the app).
import { parseShots, golfFix, wordsToNumbers, clubIn } from "./voiceShots.js";
import { roundHoleScore, holeScore } from "./roundCalc.js";

/* ---------------------------------------- words ---------------------------------------- */
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18 };
export function norm(q) {
  let t = ` ${String(q || "").toLowerCase().replace(/[‘’]/g, "'")} `;
  t = t.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth)\b/g, (m) => `${ORD[m]}th`);
  t = wordsToNumbers(golfFix(t)).replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1th");
  return ` ${t.replace(/[,!]/g, " ").replace(/\s+/g, " ").trim()} `;
}
const ME = /\b(i|i'm|im|i've|ive|i'd|my|me|we|we're|mine)\b/;
const SCORE_WORDS = [
  [/\b(hole[ -]in[ -]one|ace|aced)\b/, () => 1],
  [/\b(albatross|double eagle)\b/, (p) => p - 3],
  [/\beagle(d)?\b/, (p) => p - 2],
  [/\bbirdie(d)?\b/, (p) => p - 1],
  [/\b(quad(ruple)?( bogey)?)\b/, (p) => p + 4],
  [/\btriple( bogey|d)?\b/, (p) => p + 3],
  [/\b(double( bogey|d)?|dbl)\b/, (p) => p + 2],
  [/\bbogey(ed)?\b/, (p) => p + 1],
  [/\bsnowman\b/, () => 8],
  [/\bpar(red)?\b(?! \d)/, (p) => p],
];
const NOT_SCORE_AFTER = /^\s*(putt|try|chance|look|attempt|save|putts|footer|foot)\b/;
/** the hole a request names: { n } | { rel: "this" | "last" | "next" | "prev" } | null */
export function holeRef(t) {
  let m;
  if ((m = t.match(/\bhole (?:number )?(\d{1,2})\b/)) || (m = t.match(/\b(?:the )?(\d{1,2})th(?: hole| green| tee)?\b/)) || (m = t.match(/\b(?:on|for|at) (?:number )?(\d{1,2})\b(?! (?:yards?|yds|feet|ft|foot|putts?|over|under|strokes?)\b)/)) || (m = t.match(/\bnumber (\d{1,2})\b/))) {
    const n = Number(m[1]); if (n >= 1 && n <= 18) return { n };
  }
  if (/\b(last|previous|prior) hole\b|\bthe hole before\b/.test(t)) return { rel: "last" };
  if (/\bnext hole\b/.test(t)) return { rel: "next" };
  if (/\b(this|the current|current) hole\b|\bhere\b/.test(t)) return { rel: "this" };
  return null;
}
/** a score said: { score } or { word, fn } (needs the par), and putts */
export function scoreIn(t) {
  let m, out = null;
  for (const [re, fn] of SCORE_WORDS) { const mm = t.match(re); if (mm && !NOT_SCORE_AFTER.test(t.slice(mm.index + mm[0].length))) { out = { word: mm[0].trim(), fn }; break; } }
  if (!out) {
    const V = "made|make|got|get|had|have|shot|scored|carded|took|take|write(?: me)? down|put(?: me)? down|mark(?: me)? down|record|enter|log|give me|it was|that was|was|is|make it|make that|change it to|change that to|to|for|score(?: of| was| is)?";
    if ((m = t.match(new RegExp(`\\b(?:${V}) (?:a |an |another |a solid |an ugly )?(\\d{1,2})\\b(?! ?(?:yards?|yds|feet|ft|foot|footer|iron|wood|hybrid|degree|°|putts?|over|under|th\\b|percent|%|o'clock))`)))) out = { score: Number(m[1]) };
    else if ((m = t.match(/^\s*(?:a |an )?(\d{1,2})(?: on (?:hole |the |number )?\d{1,2}(?:th)?)?\s*$/))) out = { score: Number(m[1]) }; // "5", "a 5 on 7", "5 on 7"
    else if ((m = t.match(/\b(\d{1,2}) on (?:hole |the |number )?\d{1,2}(?:th)?\b/))) out = { score: Number(m[1]) };
  }
  if (!out) return null;
  if ((m = t.match(/\b(\d)[ -]?putt(?:s|ed)?\b/))) out.putts = Number(m[1]);
  else if (/\b(?:one|1)[ -]?putt/.test(t)) out.putts = 1;
  if (/\b(hit|found|in) the fairway\b|\bfairway hit\b/.test(t)) out.fwy = true; else if (/\bmissed the fairway\b/.test(t)) out.fwy = false;
  if (/\b(hit|on) the green in regulation\b|\bgir\b/.test(t)) out.gir = true; else if (/\bmissed the green\b/.test(t)) out.gir = false;
  return out;
}
const distIn = (t) => { const m = t.match(/\b(\d{1,3})\s*(yards?|yds?|y|feet|foot|ft|footer|')?\b/); if (!m) return null; const n = Number(m[1]); const ft = /^(feet|foot|ft|footer|')$/.test(m[2] || ""); if (!m[2] && (n < 30 || n > 330)) return null; return { d: n, unit: ft ? "ft" : "yds" }; };
const lieIn = (t) => (/\b(bunker|sand|trap)\b/.test(t) ? "Bunker" : /\brough\b/.test(t) ? "Rough" : /\bfairway\b/.test(t) ? "Fairway" : /\b(tee|off the tee|tee shot|drive)\b/.test(t) ? "Tee box" : /\b(green|putt|putts|putting|putted)\b/.test(t) ? "Green" : null);
const courseIn = (t) => { const m = t.match(/\b(?:at|on) ((?:the )?[a-z][a-z0-9'&. -]{2,40}?)(?= last time| before| previously| this| today| in| from| with|\?|\s*$)/); if (!m) return null; const c = m[1].trim(); return /^(the )?(green|fairway|tee|rough|bunker|hole|this|it|that|average|the course|my|par)\b/.test(c) || /^\d/.test(c) ? null : c.replace(/^the /, ""); };

/** What was said, as a caddie request (or null: not one). */
export function parseCaddie(q, { pending = false } = {}) {
  const raw = String(q || "").trim(), t = norm(raw), words = raw.split(/\s+/).filter(Boolean).length, isQ = /\?\s*$/.test(raw) || /^\s*(what|which|how|where|when|why|who|should|can|could|do|does|did|is|are|was|tell|show|give|read)\b/.test(t);
  if (pending && /^\s*(yes|yeah|yep|yup|sure|correct|right|do it|go ahead|confirm|that's right|ok|okay|please|affirmative|absolutely|y)\b/.test(t)) return { kind: "yes" };
  if (pending && /^\s*(no|nope|nah|cancel|don't|never ?mind|wrong|leave it|n)\b/.test(t)) return { kind: "no" };
  if (/^\s*(stop|quiet|shush|be quiet|stop talking|enough|silence)\s*$/.test(t)) return { kind: "hush" };
  if (/\b(undo|take (that|it) back|scratch that|delete (that|the last)|remove (that|the last)|that's wrong|that was wrong|never ?mind that|go back one|revert( that)?)\b/.test(t)) return { kind: "undo" };
  // finish
  if (/\b(finish|end|close|complete|wrap up|submit|sign) (my |the |this |out )?(round|card|scorecard)\b|\b(i'm|im|we're) (all )?done( for (the )?(day|today))?\s*$|\bthat's (the )?(round|it for today)\b|\bround (is )?(over|done|finished)\b/.test(t)) return { kind: "finish" };
  // which hole
  { let m;
    if (!isQ && (m = t.match(/\b(?:i'm|im|we're|i am|we are) (?:now )?(?:on|at|playing) (?:hole |the |number )?(\d{1,2})(?:th)?\b(?! (?:yards|feet))/) || t.match(/\b(?:go(?:ing)?|move|skip|jump|switch|head(?:ing)?|on) (?:on |back |ahead )?to (?:hole |the |number )?(\d{1,2})(?:th)?(?: hole)?\b/) || t.match(/\b(?:tee(?:ing)? off|start(?:ing)?) (?:on|at) (?:hole |the |number )?(\d{1,2})(?:th)?\b/))) { const n = Number(m[1]); if (n >= 1 && n <= 18) return { kind: "goHole", n }; }
    if (!isQ && /^\s*(next hole|on to the next( one| hole)?|onto the next( one)?|next one|moving on)\s*$/.test(t)) return { kind: "goHole", rel: "next" };
    if (!isQ && /\b(go )?back (a|one) hole\b|\bprevious hole\s*$/.test(t)) return { kind: "goHole", rel: "prev" };
  }
  // the round so far
  if (/\b(read|tell|give|show|what's|what are|go over) (me )?(my |the )?(card|scorecard|scores)\b|\bwhat did i (shoot|score|make|get) on each\b/.test(t)) return { kind: "card" };
  { const m = t.match(/\b(?:break|shoot|get to|for(?: a| an)?|card(?: a| an)?) (\d{2,3})\b/); if (m && /\b(need|have to|to break|to shoot|what do i|can i|chance)\b/.test(t)) return { kind: "need", target: Number(m[1]), brk: /\bbreak\b/.test(t) }; }
  if (/\bhow many (putts|fairways|greens|birdies|pars|bogeys|doubles|penalt(y|ies)|gir|3 putts|three putts)\b.*\b(today|so far|this round|have i|do i have|i have|i got|i've|ive)\b|\b(my )?(putts|fairways|greens|stats|numbers) (today|so far|this round)\b|\bhow (am i|i'm|im) (putting|driving|hitting it|striking it|chipping) (today|so far)\b|\bmy (round )?stats\b/.test(t)) return { kind: "stats" };
  // the hole: par, yards, handicap, distance
  if (isQ && /\b(par|yardage|yards|how long|how far|handicap|hcp|stroke index|distance|length)\b/.test(t) && /\b(hole|this one|this|it|here|the \d+th|number \d+|is \d{1,2})\b/.test(t) && !/\b(do|did|does) i\b|\bmy\b/.test(t)) return { kind: "holeInfo", ref: holeRef(t) || ((m0) => (m0 ? { n: Number(m0[1]) } : null))(t.match(/\bis (\d{1,2})\s*$/)) || { rel: "this" }, toPin: /\b(pin|flag|green|front|back|middle)\b/.test(t) };
  // advice: strategy for a hole
  if (/\b(what's the play|how (should|do|would) (i|we) play|how to play|game ?plan|strategy|where (should|do) (i|we) (aim|hit it|miss|go|lay up)|best miss|worst miss|where's the (trouble|miss)|what's the trouble|lay ?up or go|go for it or|should i go for|should i lay up|where to (aim|miss)|what should i (hit|do) off the tee|play (this|the) hole)\b/.test(t) && !/\b(last time|before|usually)\b/.test(t)) return { kind: "strategy", ref: holeRef(t) };
  // advice: a club for a distance
  { const d = distIn(t);
    if (/\b(what|which) (club|iron|wood|stick)\b|\bwhat (should|do|would) (i|you) (hit|use|take|play)\b|\bwhat to hit\b|\bclub (for|from)\b|\bwhat's the club\b/.test(t) && !/\b(last time|before|usually|normally|did i|have i)\b/.test(t)) return { kind: "club", d: d && d.unit === "yds" ? d.d : null, adj: adjOf(t) };
    if (!isQ && d && d.unit === "yds" && /\b(into the wind|downwind|down wind|helping wind|headwind|uphill|downhill|up ?hill|down ?hill)\b/.test(t)) return { kind: "club", d: d.d, adj: adjOf(t) };
  }
  // recall: how far a club goes
  { const c = clubIn(t);
    if (c && /\bhow far\b|\b(average|avg|typical|normal|stock|carry) (distance|yardage|carry)?\b|\bdistance\b|\byardage\b/.test(t) && ME.test(t) && !/\bfrom \d/.test(t)) return { kind: "clubDist", club: c, said: (t.match(/\b(driver|\d{1,2} ?(?:iron|wood|hybrid|h|i|w)|pitching wedge|gap wedge|sand wedge|lob wedge|pw|gw|aw|sw|lw|\d{2} ?degree|wedge|putter)\b/) || [])[0] || "that club" }; }
  // recall: a hole, or the course
  { const back = /\b(last time|before|previously|in the past|history|usually|normally|typically|ever|every time|each time)\b/.test(t), hr = holeRef(t), crs = courseIn(t);
    if (ME.test(t) && /\b(best|lowest|average|avg|worst|highest|typical) (score|round)\b/.test(t)) return { kind: "courseHist", course: crs, here: /\bhere\b|\bthis course\b/.test(t) || !crs };
    if (ME.test(t) && (back || /\bhow (do|have) i (usually )?(play|played|score|scored|done|do)\b/.test(t)) && (hr || /\b(this hole|here)\b/.test(t)) && !distIn(t) && !/\b(bunker|sand|trap|rough)\b/.test(t) && !(clubIn(t) && !/\b(off the tee|tee shot|drive)\b/.test(t))) return { kind: "holeHist", ref: hr || { rel: "this" }, course: crs, shot: /\b(off the tee|tee shot|drive|driver)\b/.test(t) ? 0 : null };
    const d = distIn(t), lie = lieIn(t), club = clubIn(t);
    if (ME.test(t) && (back || /\bhow (do|have|did) i (do|play|hit|putt|chip|perform)|\bwhat (do|did|have) i (usually |normally )?(hit|use|take|play)|\bmy (record|history|stats) (from|out of|on)\b/.test(t)) && (d || lie === "Bunker" || lie === "Rough" || club)) return { kind: "shotHist", d: d?.d ?? null, unit: d?.unit || (lie === "Green" ? "ft" : "yds"), lie, club, course: crs, here: /\bhere\b|\bthis course\b/.test(t) };
  }
  // a score
  if (!isQ || /^\s*(put|write|mark|record|enter|log|give|make|change)\b/.test(t)) {
    const sc = scoreIn(t), hr = holeRef(t), edit = /\b(change|fix|correct|actually|instead|not a|make (it|that)|should be|was really|meant)\b/.test(t);
    const shotWords = /\b(driver|iron|wood|hybrid|wedge|chip|chipped|pitch|pitched|fairway|rough|bunker|sand|green|feet|ft|yards|yds|left|short|long|missed)\b/.test(t);
    if (sc && (ME.test(t) || words <= 6 || edit) && !/\b(he|she|they|his|her|their)\b/.test(t) && !(nameLike(raw) && !ME.test(t)) && (!shotWords || /\b(made|got|had|carded|took|for|score|par|bogey|birdie|eagle|double|triple|change|fix|actually)\b/.test(t)) && !/\b(par \d|a par \d)\b/.test(t)) return { kind: "score", ...sc, ref: hr, edit };
  }
  // shots (the rest of Cal's own shot words: the round page's voice parser decides)
  if (!isQ && (ME.test(t) || /^\s*(hit|holed|made|missed|chipped|pitched|putted|drove|driver|\d|a |the |two|three|wedge|putter|tapped|lagged|sank|punched|then|and|pulled|pushed)/.test(t)) && !/\b(he|she|they|his|her|their)\b/.test(t) && /\b(hit|holed|made|missed|chipped|pitched|putted|drove|teed off|laid up|punched|bladed|topped|sank|duffed|lagged|tapped in|drained|lipped|blocked|pulled|pushed|hooked|sliced|flared|chunked|thinned|skulled)\b|\b(driver|\d{1,2} ?(iron|wood|hybrid)|wedge|putter)\b.*\b(fairway|rough|bunker|green|feet|yards|left|short|long|water|hole)\b/.test(t)) return { kind: "shot", text: raw, ref: holeRef(t) };
  return null;
}
// a player named ("Scheffler made a 5 on 7"): a capitalised word that isn't one of the ways a caddie request starts
const STARTS = new Set("put write mark record enter log give make change actually bogey par birdie double triple quad eagle ace albatross snowman hit made missed holed chipped pitched putted drove driver undo next finish end what how where which should can tell read show scratch take hole the a an that it it's my then and two three four five six seven eight nine ten one tapped lagged sank wedge putter pulled pushed iron".split(" "));
function nameLike(raw) { const ws = String(raw).replace(/[^A-Za-z' ]/g, " ").split(/\s+/).filter(Boolean); return ws.some((w, i) => /^[A-Z][a-z]{2,}$/.test(w) && (i > 0 || !STARTS.has(w.toLowerCase())) && !/^(I'm|I've|I'd)$/.test(w)); }
function adjOf(t) {
  const a = [];
  if (/\b(into the wind|headwind|into wind|in ?to the breeze)\b/.test(t)) a.push(["into the wind", 0.1]);
  if (/\b(downwind|down wind|helping wind|wind behind|with the wind)\b/.test(t)) a.push(["downwind", -0.08]);
  if (/\b(uphill|up ?hill|elevated green|up the hill)\b/.test(t)) a.push(["uphill", 0.05]);
  if (/\b(downhill|down ?hill|down the hill)\b/.test(t)) a.push(["downhill", -0.05]);
  return a;
}

/* ---------------------------------------- the round ---------------------------------------- */
const PTR = (id) => `cal.hole.${id}`;
const getPtr = (id) => { try { return Number(localStorage.getItem(PTR(id))) || null; } catch { return null; } };
const setPtr = (id, n) => { try { localStorage.setItem(PTR(id), String(n)); } catch { /* */ } };
const holes = (r) => (r.holes || []).slice().sort((a, b) => a.n - b.n);
const holeOf = (r, n) => holes(r).find((h) => h.n === n) || null;
const done = (r, h) => roundHoleScore(r, h).done;
const told = (st) => (st || []).filter((s) => s && (s.endLie || s.club));
/** the hole you're on: the one you moved to (unless it's finished), else the first not finished */
export function curHole(r) {
  const p = getPtr(r.id), hs = holes(r);
  if (p && holeOf(r, p) && !done(r, holeOf(r, p))) return p;
  const nx = hs.find((h) => !done(r, h)) || hs.at(-1);
  return nx?.n ?? 1;
}
const refN = (r, ref, last) => (!ref ? curHole(r) : ref.n ? ref.n : ref.rel === "last" ? (last && last.round === r.id ? last.n : Math.max(1, curHole(r) - 1)) : ref.rel === "next" ? Math.min(holes(r).length, curHole(r) + 1) : ref.rel === "prev" ? Math.max(1, curHole(r) - 1) : curHole(r));
const toParWord = (d) => (d === 0 ? "par" : d === -1 ? "birdie" : d === -2 ? "eagle" : d === -3 ? "albatross" : d === 1 ? "bogey" : d === 2 ? "double bogey" : d === 3 ? "triple bogey" : d > 0 ? `${d} over` : `${-d} under`);
const tpTxt = (d) => (d === 0 ? "even par" : d > 0 ? `${d} over par` : `${-d} under par`);
export function totals(r) {
  let strokes = 0, par = 0, n = 0; for (const h of holes(r)) { const s = roundHoleScore(r, h); if (s.done) { strokes += s.strokes; par += Number(h.par) || 0; n++; } }
  return { strokes, par, n, tp: strokes - par };
}
const runTxt = (r) => { const T = totals(r); return T.n ? `${T.strokes} through ${T.n}, ${tpTxt(T.tp)}.` : ""; };
const yd = (lie, d) => (d == null || d === "" ? null : lie === "Green" ? Number(d) / 3 : Number(d));
const unitOf = (lie) => (lie === "Green" ? "ft" : "yds");
const lieWord = (l) => ({ "Tee box": "the tee", Fairway: "the fairway", Rough: "the rough", Bunker: "a bunker", Green: "the green", Holed: "the hole", Penalty: "a penalty" })[l] || (l ? l.toLowerCase() : "?");
const shotTxt = (s) => `${s.club || (s.startLie === "Green" ? "Putter" : "Shot")}${s.startDist != null && s.startDist !== "" ? ` from ${Math.round(s.startDist)} ${unitOf(s.startLie)}` : ""} to ${s.endLie === "Holed" ? "the hole" : `${lieWord(s.endLie)}${s.endDist != null && s.endDist !== "" ? `, ${Math.round(s.endDist)} ${unitOf(s.endLie)} left` : ""}`}`;

let pending = null, last = null;
export const hasPending = () => !!pending && Date.now() - pending.at < 180000;
const ask = (text, run) => { pending = { text, run, at: Date.now() }; return { text: `${text} Say **yes** or **no**.`, toast: true, asking: true }; };

/** the next shots on a hole, the way the round page adds them (each club starts a shot where the last finished) */
export function addShotsTo(saved, parsed, h) {
  const strokes = told(saved).map((s) => ({ ...s }));
  const has = (x) => !!(x && x.endLie);
  let k = -1; strokes.forEach((x, i) => { if (has(x)) k = i; });
  const said = [...parsed];
  while (said.length && !said[0].club && !said[0].saidClub && said[0].endLie !== "Holed") {
    const p0 = said.shift(); if (k < 0) continue; const lastS = strokes[k];
    if (p0.endDist != null) lastS.endDist = p0.endDist;
    if (p0.endLie && (!lastS.endLie || lastS.endLie === p0.endLie || p0.endLie === "Green")) lastS.endLie = p0.endLie;
  }
  const news = said.map((p1) => ({ startLie: "", startDist: "", endLie: p1.endLie || "", endDist: p1.endDist ?? "", ...(p1.club ? { club: p1.club, clubMake: p1.clubMake, clubCat: p1.clubCat, ...(p1.clubId ? { clubId: p1.clubId } : {}) } : {}) }));
  said.forEach((p1, i) => { const prev = i ? news[i - 1] : strokes[k]; if (p1.startDist != null && prev && (prev.endDist === "" || prev.endDist == null)) prev.endDist = p1.startDist; });
  const all = [...strokes.slice(0, k + 1), ...news];
  if (all.length) { all[0].startLie = all[0].startLie || "Tee box"; if (all[0].startDist === "" || all[0].startDist == null) all[0].startDist = h?.yards ?? ""; }
  for (let i = 1; i < all.length; i++) { const p = all[i - 1], s = all[i]; if (s.manualStart) continue; if (p.endLie && p.endLie !== "Holed") { s.startLie = p.endLie === "Penalty" ? (s.startLie || "Rough") : p.endLie; s.startDist = p.endLie === "Penalty" ? (s.startDist || p.endDist || p.startDist) : p.endDist; } }
  const clean = all.map(({ startLie, startDist, endLie, endDist, club, clubMake, clubCat, clubId, manualStart }) => ({ ...(club ? { club } : {}), ...(club && clubMake ? { clubMake } : {}), ...(club && clubCat ? { clubCat } : {}), ...(club && clubId ? { clubId } : {}),
    startLie, startDist: startDist === "" || startDist == null ? null : Number(startDist), endLie, endDist: endLie === "Holed" ? 0 : endDist === "" || endDist == null ? null : Number(endDist), ...(manualStart ? { manualStart: true } : {}) }));
  return { strokes: clean, added: news.length, from: k + 1 };
}

/* ---------------------------------------- your history ---------------------------------------- */
const ckey = (n) => String(n || "").toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !["golf", "course", "club", "gc", "cc", "country", "the", "links", "resort", "and"].includes(w)).join(" ");
const sameCourse = (a, b) => { const x = ckey(a), y = ckey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const sameClub = (label, c) => { const k = clubIn(String(label || "").toLowerCase()); return !!k && k.cat === c.cat && (!c.type || !k.type || String(k.type).toLowerCase() === String(c.type).toLowerCase()); };
const dateTxt = (d) => { const x = new Date(`${d}T12:00:00`); return Number.isNaN(x.getTime()) ? String(d || "") : x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: x.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
function allShots(rounds) {
  const out = [];
  for (const r of rounds) for (const h of r.holes || []) { const st = told(r.shots?.[`h${h.n}`]); st.forEach((s, i) => out.push({ r, h, i, s })); }
  return out.sort((a, b) => String(b.r.date).localeCompare(String(a.r.date)));
}
const resultTxt = (s) => (s.endLie === "Holed" ? "holed it" : s.endLie === "Green" ? `on the green${s.endDist != null && s.endDist !== "" ? `, ${Math.round(s.endDist)} ft` : ""}` : s.endLie === "Penalty" ? "a penalty" : `${lieWord(s.endLie)}${s.endDist != null ? `, ${Math.round(s.endDist)} ${unitOf(s.endLie)} left` : ""}`);
export function shotHistory(rounds, { d, unit, lie, club, course }) {
  let xs = allShots(rounds).filter(({ s }) => s.startLie && s.startDist != null);
  if (course) xs = xs.filter((x) => sameCourse(x.r.course, course));
  if (lie && lie !== "Green") xs = xs.filter((x) => x.s.startLie === lie || (lie === "Tee box" && x.i === 0));
  if (unit === "ft" || lie === "Green") xs = xs.filter((x) => x.s.startLie === "Green"); else xs = xs.filter((x) => x.s.startLie !== "Green");
  if (d != null) { const tol = unit === "ft" ? Math.max(2, d * 0.2) : Math.max(6, d * 0.07); xs = xs.filter((x) => Math.abs(Number(x.s.startDist) - d) <= tol); }
  if (club) xs = xs.filter((x) => sameClub(x.s.club, club));
  if (!xs.length) return null;
  const n = xs.length, clubs = new Map(); for (const x of xs) if (x.s.club) clubs.set(x.s.club, (clubs.get(x.s.club) || 0) + 1);
  const top = [...clubs].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const green = xs.filter((x) => x.s.endLie === "Green" || x.s.endLie === "Holed").length, holed = xs.filter((x) => x.s.endLie === "Holed").length;
  const onG = xs.filter((x) => x.s.endLie === "Green" && x.s.endDist != null && x.s.endDist !== "").map((x) => Number(x.s.endDist)).filter(Number.isFinite), avgFt = onG.length ? onG.reduce((t, v) => t + v, 0) / onG.length : null;
  const L = xs[0];
  return { n, top, green, holed, avgFt, last: { date: L.r.date, course: L.r.course, hole: L.h.n, club: L.s.club || null, from: L.s.startDist, startLie: L.s.startLie, result: resultTxt(L.s) }, putts: xs[0].s.startLie === "Green" };
}
export function clubDistance(rounds, club) {
  const xs = allShots(rounds).filter(({ s }) => sameClub(s.club, club) && s.startLie !== "Green" && s.endLie && s.endLie !== "Penalty" && s.endLie !== "Holed" && s.startDist != null && s.endDist != null)
    .map(({ s }) => Number(s.startDist) - (yd(s.endLie, s.endDist) ?? 0)).filter((v) => v > 20 && v < 400).sort((a, b) => a - b);
  if (!xs.length) return null;
  const med = xs[Math.floor(xs.length / 2)], lo = xs[Math.floor(xs.length * 0.25)], hi = xs[Math.floor(xs.length * 0.75)];
  return { n: xs.length, med, lo, hi };
}
export function holeHistory(rounds, course, n, curId) {
  const rs = rounds.filter((r) => r.id !== curId && sameCourse(r.course, course)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const plays = []; for (const r of rs) { const h = holeOf(r, n); if (!h) continue; const sc = roundHoleScore(r, h); if (!sc.done) continue; plays.push({ r, h, score: sc.strokes, shots: told(r.shots?.[`h${n}`]) }); }
  if (!plays.length) return null;
  const avg = plays.reduce((t, p) => t + p.score, 0) / plays.length, best = Math.min(...plays.map((p) => p.score));
  return { plays, avg, best, par: plays[0].h.par };
}

/* ---------------------------------------- answering ---------------------------------------- */
/**
 * deps: { getRound(): Promise<round|null>, listRounds(): Promise<rounds>, getBag(): Promise<bag>, saveHole(pk, id, n, strokes),
 *         saveQuickHole(pk, id, n, q), updateRound(pk, id, fields), onRoundPage(round): boolean, sendToPage(round, text) }
 * returns null (not for the caddie) or { text, toast?, delegate?, q? }
 */
export async function caddieAnswer(q, deps) {
  const P = parseCaddie(q, { pending: hasPending() });
  if (!P) return null;
  if (P.kind === "hush") return { text: "", hush: true };
  if (P.kind === "yes") { const p = pending; pending = null; return p ? await p.run() : null; }
  if (P.kind === "no") { pending = null; return { text: "OK, left it as it was.", toast: true }; }
  // the advice that doesn't need a round
  if (P.kind === "clubDist") { const rs = await deps.listRounds(); const D = clubDistance(rs, P.club), bag = await deps.getBag().catch(() => []), b = bag.find((c) => sameClub(c.label, P.club) && c.yards);
    if (!D && !b) return { text: `I don’t have any ${P.said} shots on record yet, and no yardage for it in your bag (WITB). Enter a few rounds shot by shot and I’ll know.` };
    return { text: [D ? `Your **${P.said}** goes about **${Math.round(D.med)} yds** (half your shots between ${Math.round(D.lo)} and ${Math.round(D.hi)}; ${D.n} shot${D.n === 1 ? "" : "s"} on record, measured toward the pin).` : "", b ? `${D ? "Your bag (WITB) says" : "No shots on record yet; your bag (WITB) says"} ${Math.round(b.yards)} yds.` : ""].filter(Boolean).join(" ") }; }
  if (P.kind === "club" && P.d) return clubAdvice(P, null, deps); // (a distance said: no round needed)
  // (update 957) the round page on screen saves anything typed there first, so Cal works from the card as it is now
  if (["score", "shot", "undo", "goHole", "finish"].includes(P.kind)) await deps.beforeSave?.();
  const r = await deps.getRound().catch(() => null);
  if (P.kind === "shotHist") { const rs = await deps.listRounds(); const course = P.course || (P.here && r ? r.course : null); const H = shotHistory(rs, { ...P, course });
    const what = `${P.club ? `your ${clubName(P.club)} ` : ""}${P.d != null ? `from about ${P.d} ${P.unit}` : P.lie ? `from ${lieWord(P.lie)}` : ""}${course ? ` at ${course}` : ""}`.trim();
    if (!H) return { text: `I don’t have any shots ${what || "like that"} on record yet.` };
    const lastL = `Last time (${dateTxt(H.last.date)}, ${H.last.course || "a round"}, hole ${H.last.hole}): ${H.last.club ? `${H.last.club} ` : ""}from ${Math.round(H.last.from)} ${unitOf(H.last.startLie)}, ${H.last.result}.`;
    if (H.putts) return { text: `Putts ${what}: **${H.holed} of ${H.n} holed**${H.avgFt != null ? `; the misses left about ${H.avgFt.toFixed(0)} ft` : ""}. ${lastL}` };
    return { text: `${H.n} shot${H.n === 1 ? "" : "s"} ${what}. ${H.top.length ? `You’ve hit **${H.top.map(([c, k]) => `${c}${H.top.length > 1 || k < H.n ? ` (${k})` : ""}`).join("**, **")}**. ` : ""}On the green ${H.green} of ${H.n}${H.avgFt != null ? `, about ${H.avgFt.toFixed(0)} ft from the hole on average` : ""}. ${lastL}` }; }
  if (P.kind === "courseHist") { const rs = await deps.listRounds(); const course = P.course || r?.course; if (!course) return { text: "Which course? Ask like “my best score at Torrey Pines North”." };
    const full = rs.filter((x) => x.id !== r?.id && sameCourse(x.course, course)).map((x) => ({ x, T: totals(x), H: holes(x).length })).filter((o) => o.T.n === o.H && o.H);
    if (!full.length) return { text: `No finished rounds at **${course}** on record yet.` };
    const best = full.reduce((a, b) => (b.T.strokes < a.T.strokes ? b : a)), avg = full.reduce((t, o) => t + o.T.strokes, 0) / full.length, lastR = full.sort((a, b) => String(b.x.date).localeCompare(String(a.x.date)))[0];
    return { text: `At **${course}**: ${full.length} finished round${full.length === 1 ? "" : "s"}. Best **${best.T.strokes}** (${tpTxt(best.T.tp)}, ${dateTxt(best.x.date)}), average ${avg.toFixed(1)}, last time ${lastR.T.strokes} (${dateTxt(lastR.x.date)}).` }; }
  // the rest is about the round you're playing
  if (!r) {
    if (P.kind === "club" && P.d) return clubAdvice(P, null, deps);
    if (["score", "shot", "goHole", "finish", "card", "stats", "need", "holeInfo", "undo"].includes(P.kind)) return { text: "You don’t have a round in progress. Say “start a round at” and the course, or open **Enter New Round**.", go: { href: "#/entry/new", label: "Start a round →", nav: true } };
    if (P.kind === "holeHist" && P.course) { const rs = await deps.listRounds(); return holeHistAnswer(rs, P.course, P.ref?.n, null, P.shot); }
    if (P.kind === "strategy") return null; // (Cal's Way asks for the course)
    return null;
  }
  const pk = r.playerKey, id = r.id;
  if (P.kind === "undo") {
    if (!last || last.round !== id) return { text: "There’s nothing of mine to undo on this round.", toast: true };
    const L = last; last = null;
    if (L.quick !== undefined) await deps.saveQuickHole(pk, id, L.n, L.quick || { score: null, putts: null, fwy: null, gir: null });
    if (L.shots !== undefined) await deps.saveHole(pk, id, L.n, L.shots || []);
    if (L.status) await deps.updateRound(pk, id, { status: L.status });
    if (L.ptr != null) setPtr(id, L.ptr);
    if (L.n) deps.show?.(r, L.n);
    return { text: `Undone: ${L.what}.`, toast: true };
  }
  if (P.kind === "goHole") {
    const n = P.n || (P.rel === "next" ? Math.min(holes(r).length, curHole(r) + 1) : Math.max(1, curHole(r) - 1)), h = holeOf(r, n);
    if (!h) return { text: `This round doesn’t have a hole ${n}.`, toast: true };
    last = { round: id, n, ptr: getPtr(id) ?? curHole(r), what: `moving to hole ${n}` }; setPtr(id, n); deps.show?.(r, n);
    return { text: `Hole **${n}**: par ${h.par}${h.yards ? `, ${h.yards} yds` : ""}${h.hcp ? `, handicap ${h.hcp}` : ""}.${done(r, h) ? ` You’ve got a ${roundHoleScore(r, h).strokes} there already.` : ""}`, toast: true };
  }
  if (P.kind === "finish") {
    const blank = holes(r).filter((h) => !done(r, h)).map((h) => h.n);
    const run = async () => { last = { round: id, n: 0, status: r.status || "in-progress", what: "finishing the round" }; await deps.updateRound(pk, id, { status: "complete" }); const T = totals(r); return { text: `Round finished${r.course ? ` at **${r.course}**` : ""}: **${T.strokes}**${T.n ? `, ${tpTxt(T.tp)}` : ""}${blank.length ? ` (${blank.length} hole${blank.length === 1 ? "" : "s"} left blank)` : ""}. Nice work.`, toast: true }; };
    return blank.length ? ask(`Hole${blank.length === 1 ? "" : "s"} ${blank.join(", ")} ${blank.length === 1 ? "has" : "have"} no score yet. Finish the round anyway?`, run) : run();
  }
  if (P.kind === "card") {
    const rows = holes(r).map((h) => { const s = roundHoleScore(r, h); return s.done ? `${h.n}: ${s.strokes}` : null; }).filter(Boolean);
    return { text: rows.length ? `Your card${r.course ? ` at **${r.course}**` : ""}: ${rows.join(", ")}. ${runTxt(r)}` : "No scores on your card yet." };
  }
  if (P.kind === "stats") return { text: statsTxt(r) };
  if (P.kind === "need") {
    const T = totals(r), left = holes(r).filter((h) => !done(r, h)), parLeft = left.reduce((t, h) => t + (Number(h.par) || 0), 0), goal = P.brk ? P.target - 1 : P.target, need = goal - T.strokes;
    if (!left.length) return { text: `The round’s done: you shot ${T.strokes}.` };
    const d = need - parLeft;
    return { text: need < left.length ? `That’s out of reach now: ${T.strokes} through ${T.n}, with ${left.length} holes left.` : `To ${P.brk ? `break ${P.target}` : `shoot ${P.target}`}: **${need} or better** on the last ${left.length} (par ${parLeft}), so **${d === 0 ? "even par" : d > 0 ? `${d} over` : `${-d} under`}** from here.` };
  }
  if (P.kind === "holeInfo") {
    const n = refN(r, P.ref, last), h = holeOf(r, n); if (!h) return { text: `This round doesn’t have a hole ${n}.` };
    const st = told(r.shots?.[`h${n}`]), lastS = st.filter((s) => s.endLie && s.endLie !== "Holed").at(-1);
    return { text: `Hole **${n}**: par ${h.par}${h.yards ? `, **${h.yards} yds**${r.tees ? ` from the ${r.tees} tees` : ""}` : ""}${h.hcp ? `, handicap ${h.hcp}` : ""}.${P.toPin ? lastS?.endDist != null ? ` Your last shot left **${Math.round(lastS.endDist)} ${unitOf(lastS.endLie)}**.` : " I don’t have GPS yardages to the pin yet: tell me the number and I’ll pick a club." : ""}` };
  }
  if (P.kind === "strategy") { const n = refN(r, P.ref, last); return { delegate: "strategy", q: `${q.replace(/[?.!]+\s*$/, "")}${/\bhole\s*\d/i.test(q) ? "" : `, hole ${n}`}${r.course && !new RegExp(ckey(r.course).split(" ")[0], "i").test(q) ? ` at ${r.course}` : ""}` }; }
  if (P.kind === "holeHist") { const rs = await deps.listRounds(); return holeHistAnswer(rs, P.course || r.course, refN(r, P.ref, last), id, P.shot); }
  if (P.kind === "club") {
    let d = P.d;
    if (!d) { const n = curHole(r), st = told(r.shots?.[`h${n}`]), lastS = st.filter((s) => s.endLie && s.endLie !== "Holed").at(-1), h = holeOf(r, n);
      if (lastS?.endLie === "Green") return { text: `You’re on the green: putter (${Math.round(lastS.endDist ?? 0)} ft).` };
      d = lastS?.endDist != null ? Number(lastS.endDist) : !st.length && h?.par === 3 ? Number(h.yards) || null : null;
      if (!d) return { text: "How far is it? Say the number, like “what club from 165”." }; }
    return clubAdvice({ ...P, d }, r, deps);
  }
  if (P.kind === "score") {
    let n = refN(r, P.ref, last);
    if (P.edit && !P.ref && last && last.round === id && last.n) n = last.n; // ("actually that was a bogey": the hole just told)
    const h = holeOf(r, n); if (!h) return { text: `This round doesn’t have a hole ${n}.`, toast: true };
    const par = Number(h.par) || 4, score = P.score ?? P.fn(par), curHoleBefore = curHole(r);
    if (!(score >= 1)) return { text: "I didn’t catch the score. Say it like “a 5 on hole 7”.", toast: true };
    const save = async () => {
      const prevQ = r.quick?.[`h${n}`] ?? null, prevS = r.shots?.[`h${n}`] ?? null, hadShots = told(prevS).length > 0;
      const qv = { ...(prevQ || {}), score, ...(P.putts != null ? { putts: P.putts } : {}), ...(P.fwy != null ? { fwy: P.fwy } : {}), ...(P.gir != null ? { gir: P.gir } : {}) };
      if (qv.putts != null && P.gir == null) qv.gir = score - qv.putts <= par - 2;
      const clean = { score: qv.score, putts: qv.putts ?? null, fwy: qv.fwy ?? null, gir: qv.gir ?? null };
      if (hadShots && r.mode !== "quick") await deps.saveHole(pk, id, n, []);
      await deps.saveQuickHole(pk, id, n, clean);
      const ptr = getPtr(id); last = { round: id, n, quick: prevQ, ...(hadShots ? { shots: prevS } : {}), ptr, what: `the ${score} on hole ${n}` };
      r.quick = { ...(r.quick || {}), [`h${n}`]: clean }; if (hadShots) r.shots = { ...(r.shots || {}), [`h${n}`]: [] };
      const nx = holes(r).find((x) => x.n > n && !done(r, x)); if (nx) setPtr(id, nx.n);
      deps.show?.(r, nx && n === curHoleBefore ? nx.n : n); // (the page: on to the next hole when this was the one you were on)
      return { text: `Hole ${n}: **${score}** (${toParWord(score - par)}${P.putts != null ? `, ${P.putts} putt${P.putts === 1 ? "" : "s"}` : ""}). ${runTxt(r)}${nx && nx.n !== n + 0 ? ` Next: hole ${nx.n}, par ${nx.par}${nx.yards ? `, ${nx.yards} yds` : ""}.` : ""}`, toast: true };
    };
    const st = told(r.shots?.[`h${n}`]), cur = roundHoleScore(r, h);
    if (r.mode !== "quick" && st.length) {
      if (cur.done && cur.strokes === score && P.putts == null) return { text: `Hole ${n} is already a ${score} from the shots you entered.`, toast: true };
      return ask(`Hole ${n} has ${st.length} shot${st.length === 1 ? "" : "s"} entered${cur.done ? ` (a ${cur.strokes})` : ""}. Replace them with a score of ${score}?`, save);
    }
    if (score > par + 5 || (score === 1 && par > 3 && !/\b(ace|hole in one)\b/.test(String(q).toLowerCase()))) return ask(`A ${score} on hole ${n} (par ${par})?`, save);
    if (cur.done && cur.quick && !P.edit && !P.ref && Number(r.quick?.[`h${n}`]?.score) !== score) return ask(`Hole ${n} already has a ${cur.strokes}. Change it to ${score}?`, save);
    return save();
  }
  if (P.kind === "shot") {
    if (r.mode === "quick") { const sc = scoreIn(norm(q)); return { text: `This is a scores-only round, so I keep the score, not each shot.${sc ? "" : " Tell me the score when you finish the hole, like “a 5”."}`, toast: true }; }
    const bag = await deps.getBag().catch(() => []);
    const parsed = parseShots(golfFix(q), { bag });
    if (!parsed.shots.length || !parsed.shots.some((x) => x.endLie || x.club || x.saidClub)) return null;
    let n = P.ref?.n || curHole(r); let h = holeOf(r, n);
    if (!P.ref?.n && done(r, h)) { const nx = holes(r).find((x) => x.n > n && !done(r, x)); if (nx) { n = nx.n; h = nx; } }
    const prev = r.shots?.[`h${n}`] ?? null, A = addShotsTo(prev, parsed.shots, h);
    await deps.saveHole(pk, id, n, A.strokes);
    last = { round: id, n, shots: prev, ptr: getPtr(id), what: `${A.added === 1 ? "that shot" : "those shots"} on hole ${n}` };
    r.shots = { ...(r.shots || {}), [`h${n}`]: A.strokes };
    const newOnes = A.strokes.slice(A.from), holed = A.strokes.some((s) => s.endLie === "Holed"), sc = holed ? holeScore(A.strokes).strokes : null;
    if (holed) { const nx = holes(r).find((x) => x.n > n && !done(r, x)); if (nx) setPtr(id, nx.n); deps.show?.(r, n); } else { setPtr(id, n); deps.show?.(r, n); }
    const lines = newOnes.map((s, i) => `shot ${A.from + i + 1}: ${shotTxt(s)}`);
    return { text: `Hole ${n}, ${lines.join("; ") || "updated the last shot"}.${holed ? ` **${sc}** (${toParWord(sc - (Number(h.par) || 4))}). ${runTxt(r)}` : ""}${newOnes.some((s) => s.endLie === "Green" && (s.endDist == null || s.endDist === "")) && !holed ? " How far did that leave you?" : ""}`, toast: true };
  }
  return null;
}
const clubName = (c) => (c.type ? `${c.type}`.replace(/^(\d+)i$/, "$1 iron").replace(/^(\d+)w$/, "$1 wood").replace(/^(\d+)H$/, "$1 hybrid") : c.cat.toLowerCase());
function statsTxt(r) {
  let putts = 0, puttN = 0, fw = 0, fwN = 0, gir = 0, girN = 0, pen = 0; const by = { birdie: 0, par: 0, bogey: 0, worse: 0 };
  for (const h of holes(r)) { const sc = roundHoleScore(r, h); if (!sc.done) continue; const par = Number(h.par) || 4, d = sc.strokes - par;
    if (d < 0) by.birdie++; else if (d === 0) by.par++; else if (d === 1) by.bogey++; else by.worse++;
    const st = told(r.shots?.[`h${h.n}`]), q = r.quick?.[`h${h.n}`];
    if (st.length) { putts += st.filter((s) => s.startLie === "Green").length; puttN++; pen += st.filter((s) => s.endLie === "Penalty").length;
      if (par >= 4) { fwN++; if (st[0]?.endLie === "Fairway") fw++; }
      girN++; const k = st.findIndex((s) => s.endLie === "Green" || s.endLie === "Holed"); if (k >= 0 && k + 1 <= par - 2) gir++; }
    else if (q) { if (q.putts != null) { putts += Number(q.putts); puttN++; } if (par >= 4 && q.fwy != null) { fwN++; if (q.fwy) fw++; } if (q.gir != null) { girN++; if (q.gir) gir++; } } }
  const T = totals(r); if (!T.n) return "No finished holes yet.";
  return [`Through ${T.n}: **${T.strokes}** (${tpTxt(T.tp)}).`, puttN ? `Putts ${putts} (${(putts / puttN).toFixed(1)} a hole).` : "", fwN ? `Fairways ${fw} of ${fwN}.` : "", girN ? `Greens in regulation ${gir} of ${girN}.` : "", `${by.birdie} birdie${by.birdie === 1 ? "" : "s"} or better, ${by.par} par${by.par === 1 ? "" : "s"}, ${by.bogey} bogey${by.bogey === 1 ? "" : "s"}, ${by.worse} worse.`, pen ? `${pen} penalt${pen === 1 ? "y" : "ies"}.` : ""].filter(Boolean).join(" ");
}
function holeHistAnswer(rs, course, n, curId, shot) {
  if (!course) return { text: "Which course? Ask like “how did I play hole 7 at Torrey Pines North last time”." };
  const H = holeHistory(rs, course, n, curId);
  if (!H) return { text: `I don’t have hole ${n} at **${course}** from any of your rounds yet.` };
  const p = H.plays[0], st = p.shots;
  const how = st.length ? (shot === 0 ? `off the tee: ${shotTxt(st[0])}` : st.map((s) => shotTxt(s)).join("; ")) : "scores only (no shots entered)";
  return { text: `Hole **${n}** at **${course}** (par ${H.par}). Last time (${dateTxt(p.r.date)}): **${p.score}** (${toParWord(p.score - (Number(H.par) || 4))}), ${how}. ${H.plays.length > 1 ? `Over ${H.plays.length} rounds: average ${H.avg.toFixed(2)}, best ${H.best}.` : ""}` };
}
async function clubAdvice(P, r, deps) {
  const plays = Math.round(P.d * (1 + P.adj.reduce((t, a) => t + a[1], 0)));
  const rs = await deps.listRounds().catch(() => []), bag = (await deps.getBag().catch(() => [])).filter((c) => c.label && !/putter/i.test(c.label));
  const opts = bag.map((c) => { const k = clubIn(String(c.label).toLowerCase()), D = k ? clubDistance(rs, k) : null; return { c, D, yards: D && D.n >= 4 ? D.med : Number(c.yards) || (D ? D.med : null) }; }).filter((o) => o.yards);
  if (!opts.length) return { text: `${P.adj.length ? `${P.d} plays like about **${plays} yds** (${P.adj.map((a) => a[0]).join(", ")}). ` : ""}I don’t know your distances yet: add your clubs’ yardages in WITB, or enter rounds shot by shot.` };
  // the shortest club that gets there (within 3 yds), unless that's a big jump past it: then simply the closest
  const reach = opts.filter((o) => o.yards >= plays - 3).sort((a, b) => a.yards - b.yards)[0], near = [...opts].sort((a, b) => Math.abs(a.yards - plays) - Math.abs(b.yards - plays))[0];
  const pick = reach && reach.yards - plays <= 12 ? reach : near;
  const alt = opts.filter((o) => o !== pick).sort((a, b) => Math.abs(a.yards - plays) - Math.abs(b.yards - plays))[0];
  const H = shotHistory(rs, { d: P.d, unit: "yds" });
  return { text: `${P.adj.length ? `${P.d} plays like about **${plays} yds** (${P.adj.map((a) => `${a[0]} ${a[1] > 0 ? "+" : "−"}${Math.round(Math.abs(a[1]) * 100)}%`).join(", ")}). ` : ""}**${pick.c.label}**: ${pick.D && pick.D.n >= 4 ? `you hit it about ${Math.round(pick.D.med)} (${pick.D.n} shots on record)` : `${Math.round(pick.yards)} in your bag`}.${alt ? ` ${alt.c.label} goes about ${Math.round(alt.yards)}.` : ""}${H ? ` From about ${P.d} before: ${H.top.length ? `mostly ${H.top[0][0]}, ` : ""}on the green ${H.green} of ${H.n}; last time ${H.last.club ? `${H.last.club}, ` : ""}${H.last.result}.` : ""}` };
}

/* ---------------------------------------- speaking ---------------------------------------- */
/** Cal says it out loud (the phone's own voice): plain words, no markdown */
export function speak(text) {
  try {
    const ss = window.speechSynthesis; if (!ss || !text) return;
    ss.cancel();
    const plain = String(text).replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/→/g, "").replace(/\byds\b/g, "yards").replace(/\bft\b/g, "feet").replace(/\s+/g, " ").trim();
    const u = new SpeechSynthesisUtterance(plain); u.lang = navigator.language || "en-US"; u.rate = 1.02;
    ss.speak(u);
  } catch { /* no voice: the screen still shows it */ }
}
export const hush = () => { try { window.speechSynthesis?.cancel(); } catch { /* */ } };
/** the small note at the bottom of the screen: what Cal just did, gone after a few seconds */
export function toast(text, ms = 4500) {
  try {
    document.querySelector(".cal-toast")?.remove();
    const d = document.createElement("div"); d.className = "cal-toast"; d.setAttribute("role", "status");
    d.innerHTML = String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    d.addEventListener("click", () => d.remove());
    document.body.appendChild(d);
    setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 400); }, ms);
  } catch { /* */ }
}
