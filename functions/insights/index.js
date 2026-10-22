// The portal's AI service (optional). The portal works out every number itself; this only:
//   - "Ask AI" (Compare): rewrites a request in someone's own words into the plain form the portal reads;
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
//   INSIGHTS_MODEL      optional, default claude-sonnet-5-5 (claude-haiku-5-5 is about 20x cheaper)
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");

admin.initializeApp(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : undefined);
const db = admin.firestore();

const MODEL = process.env.INSIGHTS_MODEL || "claude-sonnet-5-5";
const CAP = Number(process.env.AI_CAP_USD || 1);
const PERIOD = process.env.AI_CAP_PERIOD === "month" ? "month" : "total";
// US dollars per million tokens [input, output] (Anthropic's price list; Haiku 5.5: prompts under 100k tokens)
const PRICES = { "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-opus-5-5": [5, 25] };
const price = PRICES[MODEL] || [5, 25]; // (an unknown model: counted at the dearest, to be safe)
// the most one answer can cost (its prompt and its longest reply): it only goes ahead if this still fits the cap
const worstCase = (inTok, maxOut) => (inTok * price[0] + maxOut * price[1]) / 1e6;
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
      cap: CAP, model: MODEL, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}

async function claude(prompt, maxTokens) {
  const inTok = Math.ceil(prompt.length / 3) + 50; // (a generous guess at the prompt's tokens, for the check)
  if ((await spentSoFar()) + worstCase(inTok, maxTokens) > CAP) return { capped: true };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) return { error: true };
  const data = await r.json();
  const u = data.usage || {};
  await addSpend(((u.input_tokens || inTok) * price[0] + (u.output_tokens || maxTokens) * price[1]) / 1e6);
  return { text: (data.content || []).map((c) => c.text || "").join("").trim() };
}

functions.http("insights", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("POST only");
  // only signed-in portal users
  try { await admin.auth().verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer /, "")); }
  catch { return res.status(401).send("Sign in first"); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).send("No API key set");

  const body = req.body || {};
  let prompt, maxTokens;
  // Compare's "Ask AI": the request in the plain form the portal reads
  if (body.ask?.text) {
    maxTokens = 200;
    prompt = `Today is ${String(body.ask.today || "").slice(0, 10)}. Rewrite this golf comparison request as ONE plain sentence in exactly
this form, keeping every name as written (players, brands, models, tournaments):
"Compare <what A> [from <YYYY>-<YYYY>] vs <what B> [from <YYYY>-<YYYY>] for <player names, or everyone>. Exclude <tournaments with years>, round <n>."
Rules: <what> is brand and/or model and kind of club (drivers, putters, irons, wedges, fairway woods, hybrids, balls), e.g. "all Callaway drivers"
or "TRTL putters". If they want one set ranked ("which Callaway driver was best"), write just "Compare all Callaway drivers" with no "vs".
For "X against all the other putters", write "Compare TRTL putters vs all the other putters". For seasons only (no clubs), write e.g.
"Compare 2026 vs 2025 for Scottie Scheffler". Turn "last year", "this season", "since 2024" into years. For recent form, write e.g.
"Compare the last 12 rounds for Sam Burns". For a stretch back from today, keep it as "over the past 12 months" (or weeks). For sets of
rounds by score, write e.g. "Compare his best 25% of rounds vs his average rounds over the past 12 months for Xander Schauffele" (or
"best 10 rounds", "worst rounds", "the rest"). If they name a part of the game (approach, off the tee, around the green, putting), keep it,
e.g. "Compare the approach game over the last 12 rounds for Sam Burns". Leave out the Exclude part if nothing is excluded.
Reply with the sentence only.

Request: ${String(body.ask.text).slice(0, 800)}`;
  } else if (body.comparison) {
    // Compare's "Generate AI Report"
    maxTokens = 600;
    prompt = `You are a golf performance analyst explaining a comparison to someone who isn't a numbers person (a player,
a coach, a product manager). Using ONLY the data below (strokes gained a round: + is strokes gained against the baseline,
- is strokes lost), write 150-250 words of plain prose, no headings, no bullet points: what's being compared, which one
comes out on top and by how much in everyday terms, where the biggest differences are (the highlights and the lowlights),
and a clear warning wherever something has fewer than 10 rounds. Describe the data only: no practice advice or recommendations.
Don't invent numbers; round to two decimals as given.

${JSON.stringify(body.comparison).slice(0, 60000)}`;
  } else if (body.analysis) {
    // the performance report
    maxTokens = 600;
    prompt = `You are a PGA Tour performance analyst writing for a player and their coach. Using ONLY the numbers below
(strokes gained per round: positive = better than the baseline), write a short summary (120-180 words, plain prose, no headings):
what the overall picture is, the clearest strength, the trend, and where strokes are being lost, in order. Describe the data only: no practice advice, drills or recommendations. Don't invent numbers.

${JSON.stringify(body.analysis).slice(0, 60000)}`;
  } else return res.status(400).send("Nothing to do");

  try {
    const out = await claude(prompt, maxTokens);
    if (out.capped) return res.status(402).json({ capped: true, cap: CAP }); // (the portal falls back to its built-in version)
    if (out.error || !out.text) return res.status(502).send("The AI didn't answer");
    if (body.ask?.text) return res.json({ rewrite: out.text.replace(/^"|"$/g, "") });
    return res.json({ summary: out.text });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Something went wrong");
  }
});
