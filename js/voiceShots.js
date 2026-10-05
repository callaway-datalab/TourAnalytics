// Turning a spoken description of a hole into shots, e.g.
//   "I hit driver off the tee, I hit the fairway, I had 180 yds left, I hit my 6 iron for my second shot and
//    hit the green with 15 feet left, then I missed my putt and left myself with 3 feet and then made that putt"
// → [ Driver → Fairway, 180 yds left ] [ 6i → Green, 15 ft ] [ Putter → Green, 3 ft ] [ Putter → Holed ]
//
// Each shot gets what was said about it: the club, where it finished (Fairway, Rough, Bunker, Recovery,
// Green, Holed, Penalty) and how far was left. Where it started comes from the shot before (the first starts
// on the tee), as in Data Entry.

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Fix the usual mishearings of golf words: speech recognition hears "putt" as "pot" or "put".
 * ("I put it on the green" is left alone: only "the / my / first / two … put" become putt.)
 */
export function golfFix(text) {
  return String(text)
    .replace(/\bpotted\b/gi, "putted").replace(/\bpots\b/gi, "putts").replace(/\bpot\b/gi, "putt")
    .replace(/\b(the|a|my|that|this|first|second|third|1st|2nd|3rd|last|lag|tap|short|long|birdie|par|bogey|eagle|for|one|two|three|1|2|3)([\s-]+)put(s?)\b/gi, "$1$2putt$3")
    .replace(/\bput(s?)(?=\s+(?:from|for|of|left|missed|lipped|burned|short|long|past)\b)/gi, "putt$1")
    .replace(/\bputting it\b/gi, "putting it");
}

/** How golf-like a heard phrase is (to pick the best of the recognizer's guesses). */
export function golfScore(text) {
  const t = ` ${String(text).toLowerCase()} `;
  return (t.match(/\b(putt|putts|putted|putter|fairway|green|rough|bunker|sand|trap|driver|iron|wood|hybrid|wedge|tee|feet|foot|yards|yds|hole|made|missed|lag|chip|chipped|pitch|left|out|birdie|par|bogey|penalty|water|trees)\b/g) || []).length;
}

/** "one eighty" → 180, "a hundred and twenty five" → 125, "fifteen" → 15, digits stay as they are. */
export function wordsToNumbers(text) {
  let t = ` ${String(text).toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/-/g, " ")} `;
  t = t.replace(/\b(a|one) hundred\b/g, "100").replace(/\b(two|three|four|five|six|seven) hundred\b/g, (m, w) => String(NUM_WORDS[w] * 100));
  const W = Object.keys(NUM_WORDS).join("|");
  // tens + units ("forty five"), then "100 and 25" / "100 25"
  t = t.replace(new RegExp(`\\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine)\\b`, "g"), (m, a, b) => String(NUM_WORDS[a] + NUM_WORDS[b]));
  t = t.replace(new RegExp(`\\b(${W})\\b`, "g"), (m) => String(NUM_WORDS[m]));
  t = t.replace(/\b([1-9])00 (?:and )?(\d{1,2})\b/g, (m, h, r) => String(Number(h) * 100 + Number(r)));
  // "one eighty" → 1 80 → 180 ; "two ten" → 2 10 → 210 (only for yardages)
  t = t.replace(/\b([1-6]) ([1-9]0|[1-9]\d)\b(?=\s*(yards?|yds?|out|left|to go|from|in))/g, (m, h, r) => String(Number(h) * 100 + Number(r)));
  return t.trim();
}

// Clubs as you'd say them → { cat, type } (matched to your bag when possible)
function clubIn(t) {
  let m;
  if (/\bdriver\b/.test(t)) return { cat: "Driver" };
  if ((m = t.match(/\b(\d{1,2})\s*(?:wood|w)\b/))) return { cat: "Fairway Wood", type: `${m[1]}w` };
  if (/\b(fairway wood|wood)\b/.test(t)) return { cat: "Fairway Wood" };
  if ((m = t.match(/\b(\d)\s*(?:hybrid|h|rescue)\b/))) return { cat: "Hybrid", type: `${m[1]}H` };
  if (/\b(hybrid|rescue)\b/.test(t)) return { cat: "Hybrid" };
  if ((m = t.match(/\b([1-9])\s*(?:iron|i)\b/))) return { cat: "Iron", type: `${m[1]}i` };
  if (/\bpitching wedge\b|\bpw\b/.test(t)) return { cat: "Iron", type: "PW" };
  if (/\b(gap|approach) wedge\b|\baw\b|\bgw\b/.test(t)) return { cat: "Iron", type: "AW", alt: "50\u00b0" };
  if ((m = t.match(/\b(4[4-9]|5\d|6[0-4])\s*(?:degree|deg|°)?\s*(?:wedge)?\b/)) && /\b(degree|deg|°|wedge)\b/.test(t)) return { cat: "Wedge", type: `${m[1]}\u00b0` };
  if (/\bsand wedge\b|\bsw\b/.test(t)) return { cat: "Wedge", type: "56\u00b0" };
  if (/\blob wedge\b|\blw\b/.test(t)) return { cat: "Wedge", type: "60\u00b0" };
  if (/\bwedge\b/.test(t)) return { cat: "Wedge" };
  if (/\bputter\b/.test(t)) return { cat: "Putter", type: "Putter" };
  return null;
}

// Where a shot finished
function resultIn(t) {
  if (/\b(made|make|makes|sank|sink|holed|drained|in the (hole|cup)|went in|holed out|tap in|tapped in|chipped in|holeinone|ace)\b/.test(t) && !/\b(missed|miss|lipped out)\b/.test(t)) return "Holed";
  if (/\b(water|out of bounds|ob|o\.b\.|lost ball|hazard|penalty|unplayable)\b/.test(t)) return "Penalty";
  if (/\b(bunker|sand|trap|beach)\b/.test(t)) return "Bunker";
  if (/\b(trees?|woods|behind|blocked|recovery|pine straw|stuck)\b/.test(t)) return "Rough"; // (no "Recovery" lie: trouble counts as rough)
  if (/\b(rough|thick stuff|long grass|first cut)\b/.test(t)) return "Rough";
  if (/\b(green|on in|on the dance floor|putting surface)\b/.test(t)) return "Green";
  if (/\b(fairway|short grass|fringe|collar|apron|down the middle|middle|center|centre|split the fairway)\b/.test(t)) return "Fairway";
  return null;
}

// A distance said in the clause: { value, unit, left } (left = how far was left after the shot)
function distanceIn(t) {
  const m = t.match(/(\d{1,3})\s*(feet|foot|ft|yards|yard|yds|yd|meters|metres|m)?\b/);
  if (!m) return null;
  const unit = /^f/.test(m[2] || "") ? "ft" : /^y/.test(m[2] || "") ? "yds" : /^m/.test(m[2] || "") ? "m" : null;
  // "from 160" is where the shot started; anything else ("180 left", "with 15 feet", "to 3 feet") is what was left
  const from = new RegExp(`\\bfrom\\s+${m[1]}`).test(t);
  return { value: Number(m[1]), unit, left: !from };
}

// Club names and putt counts taken out of a clause before looking for distances and lies, so "7 iron" isn't
// 7 yards and "sand wedge" isn't the sand.
const stripClubs = (c) => c
  .replace(/\bhole in (one|1)\b/g, " holeinone ")
  .replace(/\b\d{1,2}\s*(?:iron|i|wood|w|hybrid|h|rescue)\b/g, " ")
  .replace(/\b\d{2}\s*(?:degree|deg|°)(?:\s*wedge)?\b/g, " ")
  .replace(/\b(sand|lob|gap|approach|pitching)\s+wedge\b/g, " ")
  .replace(/\b(two|2|three|3|one|1)[\s-]?putt\w*/g, " ")
  .replace(/\b(took a drop|dropped|drop)\b/g, " ");

const PUTT = /\b(putt|putts|putted|putting|lag|lagged|lags)\b/;
const NEW_SHOT = /\b(teed off|tee shot|off the tee|drove|second shot|third shot|fourth shot|fifth shot|approach|chip|chipped|pitch|pitched|punch(ed)?|laid up|lay(ed)? up|layup|blast(ed)?|flop(ped)?|next shot)\b/;

/**
 * Parse what you said into shots.
 *   options.bag: your WITB clubs [{ label, model, cat, type }] (to pick the right club); options.par
 * Returns { shots: [{ club, clubMake, clubCat, endLie, endDist, startDist? }], notes: [] }
 */
export function parseShots(text, { bag = [] } = {}) {
  const notes = [];
  const t = wordsToNumbers(golfFix(text)).replace(/\bi\b/g, "I").toLowerCase();
  // clauses: "then", "and then", "after that", commas / full stops, and " and " before a new action
  const clauses = t.split(/\s*(?:[.;,!?]|\band then\b|\bthen\b|\bafter that\b|\bnext\b|\band (?=(?:I |then )?(?:hit|made|make|missed|miss|putted|chipped|pitched|left|had|drained|sank|(?:one|two|three|1|2|3)[\s-]?putt|tapped|holed|punched|laid|blasted|went|ended|found|got|leaving)))\s*/).map((c) => c.trim()).filter(Boolean);
  const shots = [];
  const cur = () => shots[shots.length - 1];
  const start = () => { shots.push({}); return cur(); };

  for (const c of clauses) {
    let m;
    // "two putted" / "three putt": that many putts, the last one holed
    if ((m = c.match(/\b(two|2|three|3)[\s-]?putt(ed|s)?\b/))) {
      const n = /two|2/.test(m[1]) ? 2 : 3;
      if (cur() && !cur().endLie && /green/.test(c) === false) cur().endLie = "Green";
      for (let i = 0; i < n; i++) shots.push({ putt: true, endLie: i === n - 1 ? "Holed" : "Green" });
      notes.push(`"${m[0]}": added ${n} putts; say how far the first one left you to fill in that distance.`);
      continue;
    }
    if ((m = c.match(/\b(one|1)[\s-]?putt(ed|s)?\b/))) { shots.push({ putt: true, endLie: "Holed" }); continue; }
    const plain = stripClubs(c);
    const club = clubIn(c), result = resultIn(plain), dist = distanceIn(plain);
    const isPutt = PUTT.test(c) || (club && club.cat === "Putter");
    const s0 = cur();
    // A clause starts a new shot when it names a club, a putt or another shot, or when it says where a ball
    // finished but the current shot already has its finish ("…then made that putt").
    const startsNew = !s0 || !!club || isPutt || NEW_SHOT.test(c)
      || (result && s0.endLie && !(result === s0.endLie))
      || (result === "Holed" && s0.endLie && s0.endLie !== "Holed");
    const s = startsNew && !(s0 && !s0.endLie && !s0.club && !s0.putt && !club && !isPutt) ? start() : s0;
    if (club) s.clubSaid = club;
    if (isPutt) s.putt = true;
    if (result) s.endLie = result;
    else if (isPutt && /\b(missed|miss|lipped|burned|left it|short|long|past|by)\b/.test(c)) s.endLie = "Green"; // a missed putt stays on the green
    if (dist) {
      if (dist.left) s.endDist = dist.value; else s.startDist = dist.value;
      if (dist.unit) s.unit = dist.unit;
      if (!s.endLie && dist.left && s.unit === "ft") s.endLie = "Green"; // "to 15 feet" = on the green
    }
  }
  // tidy up: a shot that only says where it finished after a putt is that putt's result, etc.
  const out = [];
  for (const s of shots) {
    if (!s.endLie && s.putt && s.endDist != null) s.endLie = "Green";
    if (!s.endLie && s.endDist != null) s.endLie = s.unit === "ft" ? "Green" : null;
    out.push(s);
  }
  // clubs: match to your bag ("6 iron" → your 6i; a putt → your putter)
  const findBag = (said) => {
    if (!said) return null;
    const byType = said.type && bag.find((c) => c.type === said.type || c.label === said.type || (said.alt && c.type === said.alt));
    return byType || bag.find((c) => c.cat === said.cat) || null;
  };
  out.forEach((s, i) => { if (!s.clubSaid && !s.putt && i > 0 && out[i - 1].endLie === "Green") s.putt = true; });
  const shotsOut = out.map((s) => {
    const said = s.clubSaid || (s.putt ? { cat: "Putter", type: "Putter" } : null);
    const b = findBag(said);
    if (said && !b && bag.length) notes.push(`No ${said.type || said.cat} in your WITB, so that club was left blank.`);
    return {
      endLie: s.endLie || null,
      endDist: s.endLie === "Holed" ? 0 : s.endDist ?? null,
      ...(s.startDist != null ? { startDist: s.startDist } : {}),
      ...(b ? { club: b.label, clubMake: b.model || undefined, clubCat: b.cat } : {}),
      saidClub: said ? (said.type || said.cat) : null,
    };
  });
  if (!shotsOut.length) notes.push("Couldn't make out any shots. Try something like: \u201cDriver to the fairway, 150 left, 8 iron on the green 20 feet, two putts.\u201d");
  return { shots: shotsOut, notes };
}
