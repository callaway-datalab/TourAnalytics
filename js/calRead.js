// (update 589) Cal's Read (AI Caddy): the strategy insights worked out at Rebuild maps (strategy.js), shown as Cal's card on
// Strategy Maps, Course Insights and in Cal's chat. In the chat Cal answers "give me the hole strategy on hole 2 at Torrey
// Pines South into a back left pin": the course (by name, else the last one asked about), the hole and the pin (by its
// name: Front / Back with Left / Center / Right, or a name the admin gave it), and links to that hole and pin on the map.
import { el, icon } from "./ui.js";

export const BRAND = "Cal’s Read", TAG = "AI CADDY";
export const KIND = { tee: "Off the tee", miss: "Approach", surprise: "Surprise", layup: "Go or lay up" };
// (update 591) the counts are samples (past shots from there), not rounds; a course built before 591 says "rounds": said here as samples
export const samples = (t) => String(t).replace(/\b(\d+\+?) rounds?\b/g, (_, n) => `${n} sample${n === "1" ? "" : "s"}`);
const plain = (t) => samples(String(t).replace(/^(Approach|Surprise): (.)/, (_, k, c) => c.toUpperCase()));

/** The read for a pin: its own (a combined pin: its member with the most rounds), else every pin on the hole together. */
export function readFor(S, ids) {
  S = S || {};
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

/** Cal's card: { r: { base, n, items }, all }, with a line naming the hole and pin. */
export function readCard(read, where = "", { compact = false, foot = null } = {}) {
  const { r, all } = read;
  const sub = [where, all ? "every pin together" : null, `${r.n} samples`, `hole avg ${r.base.toFixed(2)}`].filter(Boolean).join(" · ");
  return el("div", { class: `cal-read${compact ? " compact" : ""}` }, [
    el("div", { class: "cal-read-h" }, [el("span", { class: "cal-read-ava", "aria-hidden": "true" }, icon("robot")),
      el("div", { class: "cal-read-t" }, [el("strong", {}, BRAND), el("span", {}, sub)]), el("span", { class: "cal-read-tag" }, TAG)]),
    el("ul", {}, r.items.map((it) => el("li", { class: `cal-read-${it.k}` }, [el("span", { class: "cal-read-k" }, [KIND[it.k] || "", it.allPins ? el("small", {}, "every pin") : null]),
      el("span", {}, [plain(it.t), it.at?.length ? el("i", { class: "cal-read-circ", title: "Circled on the map", "aria-label": "circled on the map" }) : null])]))),
    foot,
  ]);
}

/* ---------------------------------------------------------------- in Cal's chat */
export const STRAT_Q = /\b(strateg\w*|game ?plan|how (do|should|would) (i|you|we|he|she|they) play|how to play|where (do|should) (i|we) aim|cal'?s read|aim(ing)? (on|at|for)|play(ing)? hole)\b/i;
// (update 593) a question asked by voice: "whole two", "hole to", "the second", "number eleven" read as digits
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen"];
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth"];
const SFX = (n) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
export function spoken(q) {
  let t = String(q).replace(/\bwhole\b/gi, "hole").replace(/\bhole (to|too)\b/gi, "hole 2").replace(/\bhole (for|fore)\b/gi, "hole 4").replace(/\bhole won\b/gi, "hole 1").replace(/\bhole ate\b/gi, "hole 8");
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
  return top.length === 1 ? { c: top[0].c } : { many: top.map((x) => x.c) };
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
  if (!meta && found.many) return { text: `Which course: **${found.many.slice(0, 4).map((c) => c.name).join("**, **")}**? Ask again with its full name.` };
  if (!meta && lastCourse) meta = list.find((c) => c.id === lastCourse) || null;
  if (!meta) return { cant: true, text: "Which course? Put its name in the question, like “the hole strategy on hole 2 at Torrey Pines South into a back left pin”." };
  lastCourse = meta.id;
  const h = holeIn(question) || (askedPin && askedPin.course === meta.id ? askedPin.hole : null);
  askedPin = null;
  if (!h) return { text: `Which hole at **${meta.name}**? Ask like “hole 2 at ${meta.name}, back left pin”.` };
  const raw = await heatData(meta), data = withMerges(meta, raw), X = data?.insights?.holes?.[h];
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
