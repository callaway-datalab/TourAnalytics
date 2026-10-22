// The portal's AI service (optional). The portal works out every number itself; this only:
//   - "Ask AI" (Compare): turns a request in someone's own words into a plan (JSON) of what to compare (update 254);
//   - Callie (update 258, the robot in the header): reads a question into a plan; the portal works out and shows the answer (update 259);
//   - "Generate AI Report" (Compare) and the performance reports: a short plain-English summary.
// When it isn't deployed, can't be reached, or has used up its budget, the portal carries on without it
// (Ask AI reads requests itself; reports use their own written summary).
//
// (update 251) A spending cap: every answer's cost (from the tokens Anthropic reports) is added up in Firestore
// (config/aiSpend). Once the next answer could take it past AI_CAP_USD (default $1.00), it stops calling the AI
// and answers 402, so the portal falls back to the built-in versions. Raise the cap (or reset the total in
// Firestore) to switch it back on.
//
// Deploy: see DEPLOY_BLAZE.md, "4. The AI service" (Cloud Run → Write a function, like budget-pause).
// Settings (Cloud Run → the service → Edit & deploy new revision → Variables & secrets):
//   ANTHROPIC_API_KEY   (a secret: Secret Manager, "Reference a secret", exposed as an environment variable)
//   FIREBASE_PROJECT_ID your Firebase project id (the same as in config.js)
//   AI_CAP_USD          optional, default 1   (the most it will ever spend, in US dollars)
//   AI_CAP_PERIOD       optional, "total" (default: the cap is for good) or "month" (it starts again each month)
//   ASK_MODEL           optional, default claude-sonnet-5-5: Compare's plans (about $0.005 a question since update 254)
//   CALLIE_MODEL        optional, default claude-haiku-5-5: Callie's plans (about $0.0003 a question)
//   INSIGHTS_MODEL      optional, default claude-haiku-5-5: written summaries (the portal doesn't ask for these since update 253)
// Prompts are capped at 12,000 characters.
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");

admin.initializeApp(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : undefined);
const db = admin.firestore();

const MODEL = process.env.INSIGHTS_MODEL || "claude-haiku-5-5";
const ASK_MODEL = process.env.ASK_MODEL || "claude-sonnet-5-5"; // (update 253: the good one, for Ask AI)
const CALLIE_MODEL = process.env.CALLIE_MODEL || "claude-haiku-5-5"; // (update 259: Callie only reads the question, so the small model does)
const CAP = Number(process.env.AI_CAP_USD || 1);
const PERIOD = process.env.AI_CAP_PERIOD === "month" ? "month" : "total";
// US dollars per million tokens [input, output] (Anthropic's price list; Haiku 5.5: prompts under 100k tokens)
const PRICES = { "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-opus-5-5": [5, 25] };
const priceOf = (m) => PRICES[m] || [5, 25]; // (an unknown model: counted at the dearest, to be safe)
// the most one answer can cost (its prompt and its longest reply): it only goes ahead if this still fits the cap
const worstCase = (m, inTok, maxOut) => (inTok * priceOf(m)[0] + maxOut * priceOf(m)[1]) / 1e6;
const spendDoc = () => db.collection("config").doc("aiSpend");
const periodKey = () => (PERIOD === "month" ? new Date().toISOString().slice(0, 7) : "total");

async function spentSoFar() {
  const snap = await spendDoc().get();
  const d = snap.exists ? snap.data() : {};
  return d.period === periodKey() ? Number(d.usd || 0) : 0;
}
async function addSpend(usd) {
  await db.runTransaction(async (tx) => {
    const ref = spendDoc(), snap = await tx.get(ref), d = snap.exists ? snap.data() : {};
    const same = d.period === periodKey();
    tx.set(ref, { period: periodKey(), usd: (same ? Number(d.usd || 0) : 0) + usd, calls: (same ? Number(d.calls || 0) : 0) + 1,
      cap: CAP, model: MODEL, askModel: ASK_MODEL, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}

// (update 259) Compare's plan: what can go in it. Shared by Compare and Callie (who hands comparisons to Compare).
const compareSpec = (today) => { const y = String(today || "").slice(0, 4); return `{
  "players": [player names exactly as written in the request; [] if none],
  "everyone": true only if they ask about the whole field / all players,
  "parts": [any of "OTT","APP","ARG","PUTT"] only if they limit it to part of the game (off the tee, approach, around the green, putting), else [],
  "exclude": { "events": ["tournament names with year, as written, e.g. 2025 Masters"], "rounds": [round numbers 1-4 to leave out] },
  "groups": [ { "label": "short name shown to the user", "rounds": { ...see below... }, "gear": "clubs or balls as written, or omit" } ],
  "each": true only when ONE gear group should be split into each model and ranked ("which Callaway driver was best"),
  "unsupported": null, or one short plain sentence naming any part of the request this plan cannot express
}

"rounds" keys (all optional, combine freely; {} = every round). The same groups are used for every player.
  "years": ["2025"]                 calendar seasons
  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"   a date range ("the past 24 months": from = today minus 24 months)
  "last": N                         the player's latest N rounds ("most recent 12 rounds", "last 12 rounds", "current form")
  "before_last": N                  the N rounds just before their latest N
  "last_events": N, "before_last_events": N   the same, counted in tournaments
  "best": N or "best_pct": P        their N (or P%) best single rounds by strokes gained, wherever they fall
  "worst": N or "worst_pct": P      their N (or P%) worst single rounds
  "best_stretch": N                 their best run of N CONSECUTIVE rounds ("best 12-round stretch", "hottest 10 rounds in a row")
  "worst_stretch": N                their worst run of N consecutive rounds
  "except_group": i                 every round matching the other keys, minus the rounds of group i (0-based): "the rest", "his other rounds"
A set (best, worst, best_stretch, worst_stretch) is chosen from within the other keys of the same group, e.g. "best 12-round stretch in the last
24 months" = {"from": <24 months ago>, "best_stretch": 12}. "last" and "before_last" ignore other date keys.

"gear": brand / model / kind words as the user wrote them, e.g. "Callaway drivers", "TRTL putters", "Chrome Tour balls", "all the other putters".
Put any years for a gear group in its "rounds", not in "gear".

Examples:
"Xander 2026 vs 2025" -> groups [{"label":"2026","rounds":{"years":["2026"]}},{"label":"2025","rounds":{"years":["2025"]}}]
"Sam Burns' last 12 rounds compared with the 12 before" -> [{"label":"Last 12 rounds","rounds":{"last":12}},{"label":"The 12 rounds before that","rounds":{"before_last":12}}]
"his best 25% of rounds this year vs the rest" -> [{"label":"Best 25% of rounds","rounds":{"years":["${y}"],"best_pct":25}},{"label":"The other rounds","rounds":{"years":["${y}"],"except_group":0}}]
"which Callaway driver has Xander been best with since 2024" -> "each": true, groups [{"label":"Callaway drivers","gear":"Callaway drivers","rounds":{"years":["2024","2025","2026"]}}]
"TRTL putters vs all the other putters for everyone" -> "everyone": true, groups [{"label":"TRTL putters","gear":"TRTL putters"},{"label":"All other putters","gear":"all the other putters"}]

Labels: plain, capitalised, under 40 characters (e.g. "Best 12-round stretch", "Last 12 rounds"). Use 2 groups for an "A vs B" request,
more only if they ask for more (at most 8). Never swap in a different question: if something can't be expressed with these keys
(a stat other than strokes gained or the stats the portal already shows, a course condition, a tee time, a weather filter, a different period for
each player…), still plan what you can and say what you left out in "unsupported". If nothing in it can be planned, give "groups": [] and say why.`; };

async function claude(prompt, maxTokens, model = MODEL, cap = 12000) {
  prompt = prompt.slice(0, cap); // (update 258: Callie's prompts carry the player's numbers, so hers can be longer)
  const inTok = Math.ceil(prompt.length / 3) + 50; // (a generous guess at the prompt's tokens, for the check)
  if ((await spentSoFar()) + worstCase(model, inTok, maxTokens) > CAP) return { capped: true };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) return { error: true };
  const data = await r.json();
  const u = data.usage || {};
  const usd = ((u.input_tokens || inTok) * priceOf(model)[0] + (u.output_tokens || maxTokens) * priceOf(model)[1]) / 1e6;
  await addSpend(usd);
  return { text: (data.content || []).map((c) => c.text || "").join("").trim(), usd };
}

functions.http("insights", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("POST only");
  // only signed-in portal users
  let who;
  try { who = await admin.auth().verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer /, "")); }
  catch { return res.status(401).send("Sign in first"); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).send("No API key set");

  const body = req.body || {};
  let prompt, maxTokens;
  // Compare's "Ask AI": the request in the plain form the portal reads
  let model = MODEL, cap = 12000;
  if (body.callie?.question) {
    // (update 259) Callie reads the question into a plan; the portal works out the answer itself and shows it, so the
    // AI never writes the numbers (and a question costs a few hundredths of a cent on the small model, not ~1 cent).
    const c = body.callie;
    maxTokens = 600; model = CALLIE_MODEL;
    const hist = (Array.isArray(c.history) ? c.history : []).slice(-3).map((h) => `- ${String(h).slice(0, 300)}`).join("\n");
    prompt = `Today is ${String(c.today || "").slice(0, 10)}. You read questions for Callie, the assistant in a golf analytics portal (PGA TOUR and
Korn Ferry Tour ShotLink-style data: one row per player per round, strokes gained (SG) by category, and stats). The portal works out every
number itself; you only turn the question into a JSON plan it can carry out. Reply with the JSON object only.

{
  "intent": "player" (about named players' own numbers) | "field" (who leads / ranks / is best or worst across a tour) | "compare" (sets of rounds side by side: A vs B, this year vs last, club vs club) | "unsupported",
  "players": [player names exactly as written; for "field", any players they want placed in the ranking],
  "tour": "PGA TOUR" or "Korn Ferry Tour" if they name one ("on Tour", "the PGA Tour" = "PGA TOUR"), else null,
  "metric": one key from the list below (the main thing asked about; "best player" or "overall" = "sg_total"), or null if they don't name one,
  "period": { optional keys: "years": ["2025"], "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "last": N rounds, "last_events": N tournaments } ({} = the default),
  "breakdown": null | "season" | "event" | "round" | "category" | "distance" | "lie" | "club" | "ball" (how to split a player's numbers:
     "where does he lose strokes" = "category"; "by distance / from 150 yards" = "distance"; "best tournament" = "event"; "best round" = "round";
     "year by year" = "season"; "which putter / driver model" = "club"),
  "part": "OTT" | "APP" | "ARG" | "PUTT" | null (the part of the game a distance / lie / club breakdown is for: approach shots = "APP", putts = "PUTT"),
  "order": "best" | "worst" (for rankings and for picking best / worst events or rounds; default "best"),
  "limit": N (how many to list; default 10),
  "min_rounds": N only if they say a minimum number of rounds,
  "compare": for intent "compare" only, a Compare plan as described below, else null,
  "unsupported": null, or one short sentence naming any part of the question the plan can't express
}

Metric keys: sg_total, sg_ott (off the tee / driving), sg_app (approach / iron play), sg_arg (around the green / short game / chipping),
sg_putt (putting / putter), sg_t2g (tee to green); and stats: scoring (scoring average), par3, par4, par5, eagles, birdiesRd (birdies a round),
parsRd, bogeysRd, dblBogeysRd, birdie (birdie %), parOrBetter, bogey (bogey avoidance), gir (greens in regulation), scramble (scrambling),
putts (putts a round), fwy (fairways hit), drive (driving distance), hitGreen, pinHigh, onLine, prox (proximity to the hole), ud (up and down),
make (putts made %), goodLag (lag putting), threePutt (3-putt avoidance). For "who putts best" use sg_putt; "most accurate driver" fwy; "longest
hitter" drive; "best ball striker" sg_t2g.
Periods: "this season" / "this year" = years [current year]; "last season" = the year before; "past 12 months" = from today minus 12 months;
"lately" / "recent form" with no number = "last": 20. Leave "period" {} when they don't say one.

Compare plan (for "compare"):
${compareSpec(c.today)}
${hist ? `\nEarlier questions in this chat (for "he", "his", "them" and follow-ups like "and his putting?"):\n${hist}\n` : ""}
Question: ${String(c.question).slice(0, 800)}`;
  } else if (body.ask?.text) {
    // (update 254) a plan (JSON) the portal carries out, instead of a sentence it has to read again: the sentence
    // could only say a handful of things, so anything else ("his best 12-round stretch") was lost on the way
    maxTokens = 500; model = ASK_MODEL;
    prompt = `Today is ${String(body.ask.today || "").slice(0, 10)}. A golf analytics portal (PGA / Korn Ferry strokes-gained data, one row per round)
compares sets of a player's rounds side by side. Turn the request below into a JSON plan the portal carries out. The portal does all the maths;
you only say which sets of rounds to put side by side. Reply with the JSON object only, no other text.

${compareSpec(body.ask.today)}

Request: ${String(body.ask.text).slice(0, 800)}`;
  } else if (body.comparison) {
    // Compare's "Generate AI Report"
    maxTokens = 450;
    prompt = `You are a golf performance analyst explaining a comparison to someone who isn't a numbers person (a player,
a coach, a product manager). Using ONLY the data below (strokes gained a round: + is strokes gained against the baseline,
- is strokes lost), write 150-250 words of plain prose, no headings, no bullet points: what's being compared, which one
comes out on top and by how much in everyday terms, where the biggest differences are (the highlights and the lowlights),
and a clear warning wherever something has fewer than 10 rounds. Describe the data only: no practice advice or recommendations.
Don't invent numbers; round to two decimals as given.

${JSON.stringify(body.comparison).slice(0, 9000)}`;
  } else if (body.analysis) {
    // the performance report
    maxTokens = 400;
    prompt = `You are a PGA Tour performance analyst writing for a player and their coach. Using ONLY the numbers below
(strokes gained per round: positive = better than the baseline), write a short summary (120-180 words, plain prose, no headings):
what the overall picture is, the clearest strength, the trend, and where strokes are being lost, in order. Describe the data only: no practice advice, drills or recommendations. Don't invent numbers.

${JSON.stringify(body.analysis).slice(0, 9000)}`;
  } else return res.status(400).send("Nothing to do");

  try {
    const out = await claude(prompt, maxTokens, model, cap);
    if (out.capped) return res.status(402).json({ capped: true, cap: CAP }); // (the portal falls back to its built-in version)
    if (out.error || !out.text) return res.status(502).send("The AI didn't answer");
    // (update 255) each answer: who asked and what it cost, for the admin's At a glance (AI Questions, AI Cost by person)
    // (update 256) and which players it was about (Ask AI: the names in its plan; "Everyone" for the whole field)
    const logCall = (players) => db.collection("aiCalls").add({ uid: who.uid, at: admin.firestore.FieldValue.serverTimestamp(), usd: out.usd || 0, model,
      kind: body.callie?.question ? "callie" : body.ask?.text ? "ask" : body.comparison ? "compareReport" : "report", ...(players ? { players } : {}) }).catch((e) => console.error("aiCalls", e));
    if (body.callie?.question) { // (update 259) Callie's plan
      const m = /\{[\s\S]*\}/.exec(out.text);
      let plan = null;
      try { plan = m ? JSON.parse(m[0]) : null; } catch { plan = null; }
      const players = (Array.isArray(plan?.players) ? plan.players : []).filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).slice(0, 4);
      await logCall(players.length ? players : plan?.intent === "field" ? ["Field ranking"] : []);
      if (!plan || typeof plan !== "object") return res.status(502).send("The AI's plan couldn't be read");
      return res.json({ plan });
    }
    if (body.ask?.text) {
      // (update 254) the plan, as JSON (anything around it, like a code fence, is trimmed off)
      const m = /\{[\s\S]*\}/.exec(out.text);
      let plan = null;
      try { plan = m ? JSON.parse(m[0]) : null; } catch { plan = null; }
      if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) { await logCall([]); return res.status(502).send("The AI's plan couldn't be read"); }
      const players = [...(Array.isArray(plan.players) ? plan.players : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 4), ...(plan.everyone === true ? ["Everyone"] : [])];
      await logCall(players);
      return res.json({ plan });
    }
    await logCall(null);
    return res.json({ summary: out.text });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Something went wrong");
  }
});
