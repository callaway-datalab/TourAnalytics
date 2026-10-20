// Optional: an AI-written summary for auto-generated performance reports.
// The portal works out every number itself; this function only turns those numbers into a short
// coaching summary with Claude, and the portal adds it to the PDF under "Coach's summary".
//
// Needs the Firebase Blaze plan (Cloud Functions) and an Anthropic API key:
//   1. firebase init functions            (in this repo; JavaScript)
//   2. copy this file to functions/index.js and run:  npm install firebase-functions firebase-admin
//   3. firebase functions:secrets:set ANTHROPIC_API_KEY
//   4. firebase deploy --only functions
//   5. put the function's URL in config.js:  insightsUrl: "https://…/insights"
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const MODEL = process.env.INSIGHTS_MODEL || "claude-sonnet-5-5";

exports.insights = onRequest({ secrets: [ANTHROPIC_API_KEY], cors: true, maxInstances: 5 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  // only signed-in portal users
  try { await admin.auth().verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer /, "")); }
  catch { return res.status(401).send("Sign in first"); }
  // (update 244) Compare's "Ask AI": a request in the user's own words, rewritten in the plain form the portal
  // reads ("<player> : <side A> vs <side B> ... exclude <tournaments>"). The portal matches the names to its data.
  const ask = req.body?.ask;
  if (ask?.text) {
    const prompt = `Today is ${String(ask.today || "").slice(0, 10)}. Rewrite this golf comparison request as ONE plain sentence in exactly
this form, keeping every name as written (players, brands, models, tournaments):
"Compare <what A> [from <YYYY>-<YYYY>] vs <what B> [from <YYYY>-<YYYY>] for <player names, or everyone>. Exclude <tournaments with years>, round <n>."
Rules: <what> is brand and/or model and kind of club (drivers, putters, irons, wedges, fairway woods, hybrids, balls), e.g. "all Callaway drivers"
or "TRTL putters". If they want one set ranked ("which Callaway driver was best"), write just "Compare all Callaway drivers" with no "vs".
For seasons only (no clubs), write e.g. "Compare 2026 vs 2025 for Scottie Scheffler". Turn "last year", "this season", "since 2024"
into years. Leave out the Exclude part if nothing is excluded. Reply with the sentence only.

Request: ${String(ask.text).slice(0, 800)}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) return res.status(502).send("The AI service didn't answer");
    const data = await r.json();
    return res.json({ rewrite: (data.content || []).map((c) => c.text || "").join("").trim().replace(/^"|"$/g, "") });
  }
  // (update 211) Compare's "Generate AI Report": a plain-English summary of a comparison
  const cmp = req.body?.comparison;
  const a = req.body?.analysis;
  if (!a && !cmp) return res.status(400).send("Missing analysis");
  const prompt = cmp ? `You are a golf performance analyst explaining a comparison to someone who isn't a numbers person (a player,
a coach, a product manager). Using ONLY the data below (strokes gained a round: + is strokes gained against the baseline,
- is strokes lost), write 150-250 words of plain prose, no headings, no bullet points: what's being compared, which one
comes out on top and by how much in everyday terms, where the biggest differences are (the highlights and the lowlights),
and a clear warning wherever something has fewer than 10 rounds. Describe the data only: no practice advice or recommendations.
Don't invent numbers; round to two decimals as given.

${JSON.stringify(cmp)}` : `You are a PGA Tour performance analyst writing for a player and their coach. Using ONLY the numbers below
(strokes gained per round: positive = better than the baseline), write a short summary (120-180 words, plain prose, no headings):
what the overall picture is, the clearest strength, the trend, and where strokes are being lost, in order. Describe the data only: no practice advice, drills or recommendations. Don't invent numbers.

${JSON.stringify(a)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) return res.status(502).send("The summary service didn't answer");
  const data = await r.json();
  res.json({ summary: (data.content || []).map((c) => c.text || "").join("").trim() });
});
