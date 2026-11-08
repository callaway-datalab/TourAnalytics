// (update 589) Cal's Read (AI Caddy): the strategy insights worked out at Rebuild maps (strategy.js), shown as Cal's card on
// Strategy Maps, Course Insights and in Cal's chat. In the chat Cal answers "give me the hole strategy on hole 2 at Torrey
// Pines South into a back left pin": the course (by name, else the last one asked about), the hole and the pin (by its
// name: Front / Back with Left / Center / Right, or a name the admin gave it), and links to that hole and pin on the map.
import { el, icon } from "./ui.js";

export const BRAND = "Cal’s Strategy", TAG = "AI CADDY"; // (update 602: was "Cal's Read")
export const KIND = { tee: "Off the tee", miss: "Approach", surprise: "Approach", layup: "Second shot" };
// (update 595) each tip's header: its part of the hole and what it is ("Off the tee \u2022 Aim"); a course built before 595
// has no h on its tips: worked out from the words
const hOf = (it) => it.h || (it.k === "tee" ? (/^(Aim for|Off the tee, )/.test(it.t) ? "Aim" : /^Stay out/.test(it.t) ? "Avoid" : "") : it.k === "surprise" ? "Surprise" : it.k === "layup" ? (/^Laying up, leave/.test(it.t) ? "Lay-up distance" : "Go or lay up") : "");
const kindOf = (it) => (it.k === "surprise" && /^Surprise: drives/.test(it.t) ? KIND.tee : KIND[it.k] || "");
export const headOf = (it) => [kindOf(it), hOf(it)].filter(Boolean).join(" \u2022 ");
// (update 591) the counts are samples (past shots from there), not rounds; a course built before 591 says "rounds": said here as samples
export const samples = (t) => String(t).replace(/\b(\d+\+?) rounds?\b/g, (_, n) => `${n} sample${n === "1" ? "" : "s"}`)
  .replace(/\b(long|short|Long|Short) (left|right)\b/g, "$1-$2"); // (update 604) a course built before 604: "short left" said "short-left"
// (update 597) a course built before 597 says more than the tip needs: trimmed to the value and the count, "(3.78, only 9
// samples)" (the list of every other place, "the best of the 6 places...", "Hitting the green: ..." dropped)
const tidy = (t) => samples(t)
  .replace(/, against .*?\.(?=\s|$)/, ".")
  .replace(/, the best of the \d+ places a miss finished \([^)]*\)/, "").replace(/, the best of the misses/, "").replace(/, the worst place drives finished/, "")
  .replace(/ Hitting the green: [\d.]+ \([^)]*\)\./, "")
  .replace(/(\d+) samples?, a small sample/g, "only $1 samples")
  .replace(/^(Aim for|Stay out of|Drives finishing in)(.*?): ([\d.]+) \(([^)]*)\)/, "$1$2 ($3, $4)");
const plain = (t) => tidy(String(t).replace(/^(Approach|Surprise): (.)/, (_, k, c) => c.toUpperCase()));
const nOnly = (n) => `${n < 15 ? "only " : ""}${n} samples`;

/** The read for a pin: its own (a combined pin: its member with the most rounds), else every pin on the hole together. */
// (update 615) a read built before 615 with a best and a 2nd best miss but no worst: the 2nd best is the worst (red)
const twoSpots = (r) => {
  if (!r?.items) return r;
  const has = (h) => r.items.some((it) => it.k === "miss" && it.h === h);
  if (!has("2nd best miss") || has("Worst miss")) return r;
  return { ...r, items: r.items.map((it) => (it.k === "miss" && it.h === "2nd best miss" ? { ...it, h: "Worst miss", t: String(it.t).replace(/^Second best:/, "Worst:"), at: (it.at || []).map((a) => { const b = [...a]; b[3] = "bad"; return b; }) } : it)) };
};
export function readFor(S0, ids) {
  const S = Object.fromEntries(Object.entries(S0 || {}).map(([k, r]) => [k, twoSpots(r)]));
  const r = (ids || []).map((id) => S[id]).filter(Boolean).sort((a, b) => b.n - a.n)[0];
  // (update 592) a pin too thin for its own tee read: the tee shot from every pin on the hole (it hardly depends on the pin)
  if (r) {
    const fromAll = r.items.some((it) => it.k === "tee") ? [] : (S["*"]?.items || []).filter((it) => it.k === "tee" || /^Surprise: drives/.test(it.t)).map((it) => ({ ...it, allPins: true }));
    return { r: fromAll.length ? { ...r, items: [...fromAll, ...r.items] } : r, all: false };
  }
  // (update 590) every pin together keeps only what doesn't depend on the pin: the tee shot and laying up
  const a = S["*"], items = (a?.items || []).filter((it) => it.k === "tee" || it.k === "layup" || /^Surprise: drives/.test(it.t));
  return items.length ? { r: { ...a, items }, all: true } : null;
}

/** Cal's card: { r: { base, n, items }, all }. (update 594) the title names the pin where it's needed ("Cal's Read · Back
 *  Right pin"); the line under it is just the samples; collapsible: a tap on the header folds it (remembered). */
// (update 595) collapsible starts folded when asked (folded: true), and onFold(folded) is told each tap
// (update 600) under the title "AI Caddy" (not the samples); reads: { on, onToggle, can } puts a Strategy switch where the tag
// was (Cal's circles on the map, on or off; it works while the card is folded)
export function readCard(read, where = "", { compact = false, foot = null, collapsible = false, folded = false, onFold = null, reads = null } = {}) {
  const { r } = read;
  let sw = null;
  if (reads) {
    sw = el("button", { type: "button", class: `cal-read-sw${reads.on ? " on" : ""}`, "aria-pressed": String(!!reads.on), disabled: reads.can === false ? "" : null, title: reads.can === false ? "Nothing to circle for this shot" : "Show Cal\u2019s circles on the map" }, [el("i", { "aria-hidden": "true" }), "Targets"]);
    sw.addEventListener("click", (e) => { e.stopPropagation(); const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); sw.setAttribute("aria-pressed", String(on)); reads.onToggle?.(on); });
    sw.addEventListener("keydown", (e) => e.stopPropagation());
  }
  const head = el("div", { class: "cal-read-h" }, [el("span", { class: "cal-read-ava", "aria-hidden": "true" }, icon("robot")),
    el("div", { class: "cal-read-t" }, [el("strong", {}, where ? `${BRAND} \u00b7 ${where}` : BRAND), el("span", {}, "AI Caddy")]),
    sw, collapsible ? el("span", { class: "cal-read-chev", "aria-hidden": "true" }, "\u25BE") : null]);
  const body = el("div", { class: "cal-read-b" }, [
    el("ul", {}, r.items.map((it) => el("li", { class: `cal-read-${it.k}${hOf(it) === "Surprise" ? " cal-read-sur" : ""}` }, [el("span", { class: "cal-read-k" }, [headOf(it), it.allPins ? el("small", {}, "every pin") : it.mine ? el("small", {}, `for ${read.who}`) : null]),
      // (update 595) a ring in the colour of each circle it has on the map
      el("span", {}, [plain(it.t), ...(it.at || []).map((a) => el("i", { class: `cal-read-circ t-${a[3] || "ok"}`, title: "Circled on the map", "aria-label": "circled on the map" }))])]))),
    foot]);
  const card = el("div", { class: `cal-read${compact ? " compact" : ""}${collapsible ? " fold" : ""}` }, [head, body]);
  if (collapsible) {
    const set = (f) => { card.classList.toggle("folded", f); head.setAttribute("aria-expanded", String(!f)); };
    head.setAttribute("role", "button"); head.tabIndex = 0; set(!!folded);
    const flip = () => { const f = !card.classList.contains("folded"); set(f); onFold?.(f); };
    head.addEventListener("click", flip);
    head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  }
  return card;
}

/* ---------------------------------------------------------------- (update 594) a player's own aim */
// From their stats (the last 12 months): how far they drive (typical, and the most they can count on: their longer drives),
// and the approach distance they gain the most from. Their aim off the tee: the best fairway spot within their reach,
// leaving their best approach distance when one does; on a par 5, the lay-up distance in that range.
const yRange = (b) => { const t = String(b || "").toLowerCase(), ns = (t.match(/\d+(\.\d+)?/g) || []).map(Number); if (/ft|feet/.test(t) || !ns.length) return null;
  if (/^\s*[<]|under|inside|less/.test(t)) return { lo: 0, hi: ns[0] }; if (/^\s*[>]|over|\+/.test(t)) return { lo: ns[0], hi: ns[0] + 50 }; return { lo: ns[0], hi: ns[1] ?? ns[0] }; };
export async function playerProfile(rounds, ix, label) {
  if (!rounds?.length) return null;
  const { statRounds } = await import("./sg.js");
  const vals = statRounds(rounds, "drive").flatMap((rd) => rd.shots.map((o) => o.v)).filter((v) => v >= 150 && v <= 420).sort((a, b) => a - b);
  const pct = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
  const drive = vals.length >= 10 ? { typical: Math.round(pct(0.5)), reach: Math.round(pct(0.85)), n: vals.length }
    : vals.length ? (() => { const a = vals.reduce((t, v) => t + v, 0) / vals.length; return { typical: Math.round(a), reach: Math.round(a + 12), n: vals.length }; })() : null;
  let best = null; const app = [];
  for (const b of ix?.bands?.get("APP") || []) {
    const a = ix.m.get(`APP|${b}|*`), rg = yRange(b); if (!a || a.w < 15 || !rg || rg.lo < 50 || rg.hi > 300) continue;
    const sg = a.sg / a.w, o = { ...rg, band: b, sg, n: Math.round(a.w) }; app.push(o); if (!best || sg > best.sg) best = o;
  }
  return drive || best ? { label, first: String(label || "").split(" ")[0] || label, drive, best, app } : null;
}
/** The same from a player's whole stats file: their last 12 months (none: their latest 12 months), as Strategy Maps does. */
export async function playerProfileFrom(rounds, label) {
  if (!rounds?.length) return null;
  const { skillIndex } = await import("./courseHeat.js");
  const dayMs = (rd) => Date.parse(String(rd.date || "").slice(0, 10)) || 0, YEAR = 365.25 * 864e5;
  const latest = Math.max(0, ...rounds.map(dayMs)), from = Date.now() - YEAR;
  const lvl = rounds.filter((rd) => dayMs(rd) >= (latest >= from ? from : latest - YEAR));
  return lvl.length ? playerProfile(lvl, skillIndex(lvl), label) : null;
}
// (update 628) how they play from the distance a spot leaves (their own approach band).
// (update 629) the aim is the spot with the lowest scoring average in their reach; their approach play there is only a
// highlight when it's good, never what picks the spot.
const appAt = (yds, P) => yds == null ? null : (P.app || []).find((b) => yds >= b.lo && yds < b.hi + (b.hi === b.lo ? 1 : 0)) || null;
const goodAt = (yds, P) => { const b = appAt(yds, P); return b && b.sg > 0 ? b : null; };
const gainTxt = (b, P) => `${b === P.best ? "your best approach range: " : "a good distance for you: "}you gain ${b.sg.toFixed(2)} a shot from ${b.lo}-${b.hi} yds (${b.n} shots)`;
export function playerAim(read, P) {
  if (!read?.r || !P) return read;
  const r = read.r, items = [...r.items], f2 = (v) => v.toFixed(2);
  let changed = false;
  // off the tee: the field's aim, swapped for the lowest-scoring spot within their reach
  if (r.teeOpts?.length && P.drive) {
    const reach = P.drive.reach + 10, ok = r.teeOpts.filter((o) => o.len <= reach);
    if (ok.length) {
      const pick = [...ok].sort((a, b) => a.avg - b.avg || b.n - a.n)[0];
      let t = `Aim for ${pick.z} around ${pick.len} yds off the tee (${f2(pick.avg)}, ${nOnly(pick.n)}). Within your reach (about ${P.drive.typical}, up to ${P.drive.reach})`;
      if (pick.left != null) { const b = goodAt(pick.left, P); t += `; leaves about ${Math.round(pick.left)} yds${b ? `, ${gainTxt(b, P)}` : ""}.`; } else t += ".";
      const i = items.findIndex((it) => it.k === "tee" && (it.h === "Aim" || /^Aim for/.test(it.t)));
      const mine = { k: "tee", h: "Aim", t, at: pick.at ? [pick.at] : [], mine: true };
      if (i >= 0) items[i] = mine; else items.unshift(mine);
      changed = true;
    } else {
      items.unshift({ k: "tee", h: "Aim", t: `Every fairway spot here with enough samples is beyond your reach (you drive it about ${P.drive.typical}, up to about ${P.drive.reach}): the field's aim doesn't fit your game.`, mine: true });
      changed = true;
    }
  }
  // a par 5's lay-up: the field's (lowest-scoring) lay-up distance stays; a note for them when it's a good distance for them
  const lay = r.layOpts?.length ? [...r.layOpts].sort((a, b) => a.avg - b.avg || b.n - a.n)[0] : null, lb = lay && goodAt(lay.left + 10, P);
  const li = lb ? items.findIndex((it) => it.k === "layup") : -1;
  if (li >= 0) { items[li] = { ...items[li], t: `${items[li].t} For ${P.first}, ${gainTxt(lb, P)}.` }; changed = true; }
  return changed ? { ...read, r: { ...r, items }, who: P.first } : read;
}

/* ---------------------------------------------------------------- in Cal's chat */
export const STRAT_Q = /\b(strateg\w*|game ?plan|how (do|should|would) (i|you|we|he|she|they) play|how to play|where (do|should) (i|we) aim|cal'?s read|aim(ing)? (on|at|for)|play(ing)? hole)\b/i;
// (update 593) a question asked by voice: "whole two", "hole to", "the second", "number eleven" read as digits
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen"];
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth"];
const SFX = (n) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
export function spoken(q) {
  // (update 598) what speech to text hears for "hole" before a number: "hold two", "hall 7", "whole 3", "hole's 4"
  const NW = "(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|to|too|for|fore|won|ate)\\b";
  let t = String(q).replace(new RegExp(`\\b(?:hold|holds|hall|haul|hol|hole's|holes|whole|hoe)\\s+(?=${NW})`, "gi"), "hole ").replace(/\bwhole\b/gi, "hole").replace(/\bhole (to|too)\b/gi, "hole 2").replace(/\bhole (for|fore)\b/gi, "hole 4").replace(/\bhole won\b/gi, "hole 1").replace(/\bhole ate\b/gi, "hole 8");
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)\b/gi, (w) => String(NUM.indexOf(w.toLowerCase())));
  t = t.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth)\b/gi, (w) => { const n = ORD.indexOf(w.toLowerCase()); return `${n}${SFX(n)}`; });
  return t.replace(/\bnumber (\d{1,2})\b/gi, "hole $1");
}
export const isStrategyQ = (q0) => { const q = spoken(q0); return STRAT_Q.test(q) && /\bhole\b|\b\d{1,2}(st|nd|rd|th)\b/i.test(q); };
let lastCourse = null, askedPin = null; // (update 590) askedPin: { course, hole } when Cal asked "which pin?"
/** "back left" (or "the back left pin") straight after Cal asked which pin */
export const isPinReply = (q) => !!askedPin && /^\s*(the\s+)?((front|back|middle|center|centre|left|right)[\s,-]*){1,3}(pin)?\s*[.!?]*\s*$/i.test(q);
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["golf", "club", "course", "country", "the", "gc", "cc", "links", "resort", "and", "at", "of", "tpc"]);

function courseIn(q, list) {
  const words = new Set(norm(q).split(" "));
  const scored = list.map((c) => {
    const toks = norm(c.name).split(" ").filter((t) => t && !STOP.has(t));
    const hit = toks.filter((t) => words.has(t)).length;
    return { c, hit, all: toks.length && hit === toks.length, frac: toks.length ? hit / toks.length : 0 };
  }).filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit || b.frac - a.frac);
  if (!scored.length) return { none: true };
  const top = scored.filter((x) => x.hit === scored[0].hit && x.frac === scored[0].frac);
  if (top.length === 1) return { c: top[0].c, same: [top[0].c] };
  // (update 600) two uploads under the very same name (another year, another course number): one course to the question,
  // the biggest and newest first (the rest tried in turn when the first has no read for the hole)
  if (new Set(top.map((x) => norm(x.c.name))).size === 1) {
    const ms = (c) => c.dataAt?.toMillis?.() ?? (Date.parse(c.dataAt) || 0);
    const same = top.map((x) => x.c).sort((a, b) => (b.dataBytes || 0) - (a.dataBytes || 0) || ms(b) - ms(a));
    return { c: same[0], same };
  }
  return { many: top.map((x) => x.c) };
}
const holeIn = (q) => { const m = /\bhole\s*(?:no\.?|number|#)?\s*(\d{1,2})\b/i.exec(q) || /\b(\d{1,2})(?:st|nd|rd|th)\s+hole\b/i.exec(q) || /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(q); return m ? Number(m[1]) : null; };
function pinIn(q, pins) {
  const t = norm(q).replace(/\bmiddle\b/g, "center").replace(/\bcentre\b/g, "center");
  const want = ["front", "back", "left", "right", "center"].filter((w) => new RegExp(`\\b${w}\\b`).test(t));
  let best = null, bestN = 0;
  for (const p of pins) {
    const lw = norm(p.label).split(" ");
    const n = want.filter((w) => lw.includes(w)).length + lw.filter((w) => w.length > 3 && !["front", "back", "left", "right", "center", "pin"].includes(w) && t.includes(w)).length;
    const miss = want.filter((w) => !lw.includes(w)).length;
    if (n > bestN || (n === bestN && n && miss < (best?.miss ?? 9))) { best = { ...p, miss }; bestN = n; }
  }
  return best && bestN ? best : null;
}

/** Cal's answer: { text, read?, go? } */
export async function answerStrategy(question0) {
  const question = spoken(question0);
  const { listHeatCourses, heatData, withMerges, pinsOn, pinLabel } = await import("./courseHeat.js");
  const list = (await listHeatCourses()).filter((c) => c.name);
  const found = courseIn(question, list);
  let meta = found.c || null;
  if (!meta && found.many) return { text: `Which course: **${[...new Set(found.many.map((c) => c.name))].slice(0, 4).join("**, **")}**? Ask again with its name, like \u201cTorrey Pines South\u201d.` };
  if (!meta && lastCourse) meta = list.find((c) => c.id === lastCourse) || null;
  if (!meta) return { cant: true, text: "Which course? Put its name in the question, like “the hole strategy on hole 2 at Torrey Pines South into a back left pin”." };
  lastCourse = meta.id;
  const h = holeIn(question) || (askedPin && askedPin.course === meta.id ? askedPin.hole : null);
  askedPin = null;
  if (!h) return { text: `Which hole at **${meta.name}**? Ask like “hole 2 at ${meta.name}, back left pin”.` };
  // (update 600) same-named uploads: the first with a read for this hole
  let raw = await heatData(meta), data = withMerges(meta, raw), X = data?.insights?.holes?.[h];
  for (const alt of (found.same || []).slice(1)) {
    if (X?.strategy && Object.keys(X.strategy).length) break;
    const r2 = await heatData(alt).catch(() => null), d2 = r2 ? withMerges(alt, r2) : null, X2 = d2?.insights?.holes?.[h];
    if (X2?.strategy && Object.keys(X2.strategy).length) { meta = alt; raw = r2; data = d2; X = X2; lastCourse = alt.id; }
  }
  if (!data?.holes?.[h] && !X) return { cant: true, text: `I don’t have a hole ${h} at **${meta.name}**.` };
  const S = X?.strategy;
  if (!S || !Object.keys(S).length) return { cant: true, text: `My read for **${meta.name}** isn’t worked out yet${X && !X.strategy ? ": the course needs **Rebuild maps** on Upload Data" : `: there aren’t enough samples on hole ${h} yet`}.` };
  const pins = pinsOn(meta, data, h).map((id) => ({ id, label: pinLabel(meta, h, id) }));
  const asked = /\b(front|back|left|right|middle|center|centre)\b/i.test(question) || /\bpin\b/i.test(question);
  const pin = pins.length === 1 ? pins[0] : pinIn(question, pins);
  const ids = pin ? data.holes?.[h]?.pins?.[pin.id]?.merged || [pin.id] : [];
  if (!pin && pins.length > 1) askedPin = { course: meta.id, hole: h };
  if (!pin && pins.length > 1) return { text: `**Hole ${h} at ${meta.name}.** Which pin? ${asked ? "I couldn\u2019t match that one. " : ""}The pins here: **${pins.map((p) => p.label).join("**, **")}**. Ask like \u201chole ${h} at ${meta.name}, ${pins[0].label.toLowerCase()} pin\u201d.` };
  const read = pin ? readFor(S, ids) : readFor(S, []);
  if (!read) return { cant: true, text: `I don’t have enough samples on hole ${h} at **${meta.name}** for a read yet (it needs at least 8).` };
  const par = X?.par ? ` (par ${X.par})` : "";
  let text = `**Hole ${h}${par} at ${meta.name}${pin ? `, ${pin.label} pin` : ""}.**`;
  if (read.all) text += ` Too few samples to ${pin ? "that pin" : "any one pin"} for an approach read (it needs 8), so this is the tee shot from every pin on the hole together.`;
  const where = `Hole ${h}${pin ? ` · ${pin.label}` : ""}`;
  return { text, read: { ...read, where }, go: { href: "#/course-prep", label: `Open hole ${h} on Strategy Maps →`, open: { heat: meta.id, hole: h, pin: pin?.id || null } } };
}
