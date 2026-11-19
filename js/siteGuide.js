// (update 873) Cal's guide to the site: what's on each page and where, so "where / how do I find …" gets a real answer
// (the closest places, how to get there, and an offer to look again), even when there's no exact page for it.
// Each feature: where it is (page › part), what it shows, the words people use for it, and how to open it there:
//   view: a Stats view (full, results, fit, compare, bag, practice); href: any other page; head / sel: the part to scroll to.
export const FEATURES = [
  { name: "Elite Round Share", where: "Player Stats", view: "full", sel: ".sg-full-top",
    what: "the boxes above the stats table: Best on Tour (#1 level), Contender, Tour Champ. and Signature. Tap “Best on Tour” for the player's best stretch: the longest run of rounds in a row at a #1 level, when it was and what was working",
    keys: "peak prime best stretch best stretches best run hot streak hottest elite elite rounds elite round share #1 level number one level best on tour top form career best when were they best best form purple patch" },
  { name: "Best & worst tournaments", where: "Player Stats", view: "full", head: "Best & worst tournaments",
    what: "the player's best and worst events, with the course and the strokes gained each week",
    keys: "best tournament best event best week worst tournament worst event peak career best best finish" },
  { name: "SG Trends", where: "Player Stats", view: "full", head: "SG Trends",
    what: "strokes gained over time, event by event, for each part of the game: where the line is highest is when they peaked",
    keys: "trend over time progression improving declining getting better getting worse history peak timeline form chart" },
  { name: "Getting better or worse?", where: "Player Stats", view: "full", head: "Getting better or worse?",
    what: "their recent form against their usual, in each part of the game",
    keys: "form recent form trending hot cold improving declining momentum last 12 rounds" },
  { name: "SG Trends by Product", where: "Player Stats", view: "full", head: "SG Trends by Product",
    what: "strokes gained with each club or ball they've used, so you can see what changed with a switch",
    keys: "equipment club ball driver irons putter switch new driver gear product change model performance" },
  { name: "Ability vs Consistency", where: "Player Stats", view: "full", head: "Ability vs Consistency",
    what: "how good and how steady they are in each part of the game, against the tour",
    keys: "consistency steady steadiness variance volatile streaky reliable ability" },
  { name: "Tournaments", where: "Player Stats", view: "full", head: "Tournaments",
    what: "every event on record with their strokes gained in each part of the game",
    keys: "events tournament history schedule results by event every event" },
  { name: "Where you stand", where: "Player Stats", view: "full", head: "Where you stand",
    what: "their ranks on tour in each part of the game and distance",
    keys: "rank ranking where do they rank tour rank standing percentile compared to tour" },
  { name: "Rankings", where: "Leaderboards › Historical", href: "#/leaderboards", adminHref: "#/admin/analyze", head: "Rankings",
    what: "every player ranked in any part of the game, distance, lie or season (pick the stat at the top; “Elite Stretches” ranks everyone by their best stretch)",
    keys: "leaderboard rankings who leads best player top players best on tour leaders who is the best elite stretches ranked" },
  { name: "Live", where: "Leaderboards › Live", href: "#/live", what: "the event in progress, live",
    keys: "live scores this week right now current tournament live leaderboard event feed" },
  { name: "Tournament Results", where: "Stats › Tournament Results", view: "results", head: "Tournament results",
    what: "any event's leaderboard and each player's scorecard and strokes gained that week",
    keys: "leaderboard finish finished result results scorecard won win winner who won last week who won last week's event past event final leaderboard how did they finish" },
  { name: "Course Fit", where: "Stats › Course Fit", view: "fit", what: "every tournament ranked by how well the player's game suits it, with why (the parts of the game, misses and blow-up holes)",
    keys: "course fit suit suits best courses which courses where should they play schedule fit misses" },
  { name: "Comparisons", where: "Stats › Comparisons", view: "compare", what: "two or more players side by side in any part of the game",
    keys: "compare comparison versus vs head to head side by side against" },
  { name: "Scouting", where: "Stats › Scouting", view: "scout", what: "scouting reports: grades on the 20-80 scale (now, next season, ceiling, each part of the game), odds of a top-10 / 25 / 50 season next year, comps (the most similar past seasons and what came next), fast risers, and every player's career trajectory: year-end strokes-gained rank each season and the change, seasons improving in a row, the rolling rank over the last 24 rounds now and a year ago, OWGR when the stats file has it; tap a player for their career chart and seasons",
    keys: "comps comparables similar players potential ceiling grade grades 20-80 odds tier projection breakout fast risers riser scouting scout sign signing career trajectory trend improving year over year end of year rank rolling rank rising star prospect owgr world ranking development" },
  { name: "What's in the Bag", where: "Play › What's in the Bag", view: "bag", what: "every club and ball on record, what's in the bag now and how each has done",
    keys: "witb bag clubs equipment driver irons wedges putter ball setup what are they using" },
  { name: "Practice & Goals", where: "Play › Practice & Goals", view: "practice", what: "recommended practice from the player's leaks, drills and goals",
    keys: "practice drills goals improve work on training plan what should i practice" },
  { name: "Course Prep", where: "Play › Course Prep", href: "#/course-prep", what: "pick a course for Course Insights & History (scores to beat, shots you'll face, hole by hole, a player's history there) and Strategy Maps (Cal's targets, where to miss, past shots)",
    keys: "course insights course history strategy maps hole strategy targets where to aim where to miss pins hole by hole scores to beat course prep shots you'll face heat map past shots" },
  { name: "Enter New Round", where: "Play › Enter New Round", href: "#/entry", what: "score a round shot by shot (or quickly), including the tour's courses with Tour tees",
    keys: "enter round new round log a round record scorecard input my round" },
  { name: "Your Tour Report", where: "Your Report", href: "#/home", what: "the front page: your players' stories, Ranks and Best Week for one player, the next event's course strategy and Did You Know",
    keys: "home front page report best week did you know ranks spotlight where to improve course strategy talking points aggressiveness blow-up holes" },
  { name: "Best Week", where: "Your Report (one player picked)", href: "#/home", head: "Best Week",
    what: "the player's best week of the season in each part of the game and distance",
    keys: "best week peak week best event season best career week" },
  { name: "Chat & support", where: "☰ menu › Chat", href: "#/questions", adminHref: "#/admin/questions", what: "ask a person, report a problem or request something",
    keys: "help support contact person analyst bug problem request feature" },
];

const STOP = new Set("a an the i to of in on for and or is are was were be do does did can could would should how where what which when who find see look get show me my their his her its this that there here want need it at by with on site page".split(" "));
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9#&' ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");

/** the features that best fit a question, best first: [{ f, score }] */
export function matchFeatures(q, extra = []) {
  const qs = words(q).map(stem); if (!qs.length) return [];
  const all = [...FEATURES, ...extra];
  return all.map((f) => { const ks = new Set(words(`${f.keys || ""} ${f.name}`).map(stem)), nm = words(f.name).map(stem);
    let s = 0; for (const w of qs) { if (ks.has(w)) s += 2; else if ([...ks].some((k) => k.length > 3 && (k.startsWith(w) || w.startsWith(k)))) s += 1; }
    for (const w of nm) if (qs.includes(w)) s += 1; // (its name said)
    const phrase = String(f.keys || "").toLowerCase(); for (const p of String(q).toLowerCase().match(/[a-z#' ]{6,}/g) || []) if (phrase.includes(p.trim()) && p.trim().split(" ").length > 1) s += 2;
    return { f, score: s }; }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
}

/** "where / how do I find …", "is there a way to see …", "where can I …": a question about the site, not the numbers */
export const GUIDE_Q = /\b(where|how)\b[^?]{0,40}\b(find|see|look|get|check|view|access|open|go|locate|track|tell)\b|\bwhere (is|are|can|do|does|would)\b|\bis there (a|any)\b[^?]{0,30}\b(way|page|place|section|spot|tab|chart|view)\b|\bwhat page\b|\bwhich page\b|\bwhere on (the|this) (site|app)\b|\bon this (site|app)\b/i;
