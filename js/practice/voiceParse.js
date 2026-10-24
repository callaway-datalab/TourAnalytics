/*
 * Voice for the practice plan's drills (update 359): turn what was said into results, ignoring everything else.
 *
 *   parseDrillSpeech(text, { kind, reps, done })
 *     → { summary: { made } | { avg } | null,   // the whole set at once: "made 8 of the 10", "averaged 18 feet"
 *         events: [{ i, v }],                   // shot by shot: i = which shot (0-based) or null for the next one;
 *                                               //   v = 1 / 0 (made / missed), or feet for an approach drill
 *         cmd: "undo" | "redo" | "finish" | null }
 *
 * Examples it understands: "made the first putt", "missed the third one", "made it", "that's in", "missed",
 * "hit the fairway", "not up and down", "made eight out of ten", "8 for 10", "made them all", "missed them all",
 * "twelve feet", "the second one was 30 feet", "holed it", "averaged 18 feet", "undo", "next set", "finish".
 */
const NUM = { zero: 0, oh: 0, none: 0, one: 1, two: 2, to: null, too: null, three: 3, four: 4, for: null, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
const YES = new Set(["made", "make", "makes", "making", "holed", "hole", "holes", "sank", "sunk", "sink", "drained", "drain", "yes", "yep", "yeah", "good", "great", "hit", "fairway", "green", "inside", "got", "success", "up", "in", "dropped", "nailed"]);
const NO = new Set(["missed", "miss", "misses", "missing", "no", "nope", "lipped", "lip", "outside", "out", "short", "long", "pushed", "pulled", "fail", "failed", "rough", "bunker", "burned"]);
// describing words only count when no main word (made, missed, holed, fairway…) was said: "missed it left in the rough" is one miss
const DESCRIBE = new Set(["yes", "yep", "yeah", "good", "great", "no", "nope", "out", "short", "long", "pushed", "pulled", "rough", "bunker", "burned", "lip", "lipped", "in", "got", "dropped"]);
const NEG = new Set(["not", "didnt", "didn't", "don't", "dont", "never", "no"]);
const SHOT_WORDS = new Set(["putt", "putts", "shot", "shots", "one", "drive", "drives", "ball", "balls", "chip", "chips"]);

/** Words to tokens: lower case, digits kept ("1st" → ordinal 1, "8" → 8), punctuation dropped. */
function tokens(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "").replace(/(\d)\s*(?:ft|feet|foot)\b/g, "$1 feet").split(/[^a-z0-9.]+/).filter(Boolean);
}
const ordOf = (w) => ORD[w] ?? (/^(\d+)(st|nd|rd|th)$/.exec(w) ? Number(RegExp.$1) : null);
/** A number at token i ("12", "twelve", "twenty five", "two and a half"); returns { v, len } or null. */
function numAt(t, i) {
  const w = t[i];
  if (w == null) return null;
  let v = null, len = 1;
  if (/^\d+(\.\d+)?$/.test(w)) v = Number(w);
  else if (NUM[w] != null) {
    v = NUM[w];
    if (v >= 20 && v % 10 === 0 && v < 100 && NUM[t[i + 1]] != null && NUM[t[i + 1]] < 10) { v += NUM[t[i + 1]]; len = 2; }
  }
  if (v == null) return null;
  if (t[i + len] === "and" && t[i + len + 1] === "a" && t[i + len + 2] === "half") { v += 0.5; len += 3; }
  else if (t[i + len] === "point" && t[i + len + 1] != null && (NUM[t[i + len + 1]] != null || /^\d$/.test(t[i + len + 1]))) { v += Number(NUM[t[i + len + 1]] ?? t[i + len + 1]) / 10; len += 2; }
  return { v, len };
}

export function parseDrillSpeech(text, { kind = "make", reps = 10 } = {}) {
  const t = tokens(text);
  const out = { summary: null, events: [], cmd: null };
  const s = ` ${t.join(" ")} `;
  // commands
  if (/ (undo|take that back|scratch that|delete that|go back) /.test(s)) out.cmd = "undo";
  else if (/ (redo|again|next set|one more|another set|go again|new set) /.test(s)) out.cmd = "redo";
  else if (/ (finish|finished|done|stop|end|that s it|thats it|im done) /.test(s)) out.cmd = "finish";
  if (out.cmd && t.length <= 6) return out;
  // the whole set: "made 8 of (the) 10", "8 out of 10", "8 for 10", "made them all", "missed them all"
  if (kind !== "prox") {
    if (/ (made|holed|hit|got|make) (them|em|all|every) ?(all|one|of them)? /.test(s) || / all (ten|10|of them) /.test(s) && !/ missed /.test(s)) { out.summary = { made: reps }; return out; }
    if (/ (missed|miss) (them|em|all|every) ?(all|one|of them)? /.test(s) || / (made|holed|hit) (none|nothing|zero) /.test(s)) { out.summary = { made: 0 }; return out; }
    for (let i = 0; i < t.length; i++) {
      const a = numAt(t, i);
      if (!a) continue;
      let j = i + a.len;
      if (t[j] === "out") j++;
      if (t[j] !== "of" && t[j] !== "for") continue;
      j++;
      if (t[j] === "the" || t[j] === "my") j++;
      const b = numAt(t, j);
      if (!b || b.v !== reps || a.v > b.v) continue;
      // missed 2 of 10 → made 8
      const before = t.slice(Math.max(0, i - 3), i);
      const missed = before.some((w) => NO.has(w) && !["no", "out"].includes(w));
      out.summary = { made: missed ? reps - a.v : a.v };
      return out;
    }
  } else {
    // approach: "averaged 18 feet", "average of 18"
    const avgAt = t.findIndex((w) => /^averag/.test(w));
    if (avgAt >= 0) { for (let i = avgAt + 1; i < Math.min(t.length, avgAt + 5); i++) { const a = numAt(t, i); if (a) { out.summary = { avg: a.v }; return out; } } }
  }
  // shot by shot
  const ordAround = (i) => { // the ordinal said with this result: just before ("the first one I made"), or just after ("made the first")
    for (let k = i + 1; k <= Math.min(t.length - 1, i + 4); k++) { const o = ordOf(t[k]); if (o) return o; if (YES.has(t[k]) || NO.has(t[k])) break; }
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) { const o = ordOf(t[k]); if (o) return o; if (YES.has(t[k]) || NO.has(t[k])) break; }
    return null;
  };
  if (kind === "prox") {
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "holed" || (t[i] === "in" && t[i - 1] === "it") || t[i] === "sank" || t[i] === "dropped") { const o = ordAround(i); out.events.push({ i: o ? o - 1 : null, v: 0 }); continue; }
      if (ordOf(t[i]) || (t[i - 1] && ordOf(t[i - 1]) && SHOT_WORDS.has(t[i]) && !numAt(t, i))) continue;
      const a = numAt(t, i);
      if (!a || a.v > 400) continue;
      // a number is a distance when it's said with feet, or on its own; not "one" meaning "the first one"
      const unit = t[i + a.len] === "feet" || t[i + a.len] === "foot" || t[i + a.len] === "ft";
      if (!unit && t[i] === "one") continue;
      let o = null; for (let k = i - 1; k >= Math.max(0, i - 4); k--) { const q = ordOf(t[k]); if (q) { o = q; break; } if (numAt(t, k) && t[k] !== "one") break; }
      out.events.push({ i: o ? o - 1 : null, v: a.v });
      i += a.len - 1 + (unit ? 1 : 0);
    }
    return out;
  }
  let last = -9, lastV = null;
  const hasMain = t.some((w) => (YES.has(w) || NO.has(w)) && !DESCRIBE.has(w));
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    let v = YES.has(w) ? 1 : NO.has(w) ? 0 : null;
    if (v == null) continue;
    if (hasMain && DESCRIBE.has(w)) continue;
    // "in" only counts as a make in "it's in", "that's in", "in the hole"
    if (w === "in" && !["its", "thats", "it", "was", "is", "went", "dropped", "fell"].includes(t[i - 1]) && !(t[i + 1] === "the" && t[i + 2] === "hole")) continue;
    if (w === "up" && t[i + 1] !== "and") continue;
    if ((w === "no" || w === "out") && t[i + 1] && YES.has(t[i + 1])) continue; // "no, made it" (the next word decides)
    if (v === 1 && NEG.has(t[i - 1])) v = 0; // "didn't make", "not up and down"
    if (v === 1 && t[i - 1] === "and" && t[i - 2] === "up") continue; // (the "down" of "up and down" isn't another)
    // one result per phrase: "hit the fairway", "made it in" are one shot
    if (i - last <= 2 && lastV === v && !ordOf(t[i - 1]) && !ordAround(i)) { last = i; continue; }
    const o = ordAround(i);
    out.events.push({ i: o ? o - 1 : null, v });
    last = i; lastV = v;
  }
  return out;
}
