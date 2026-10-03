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
  const a = req.body?.analysis;
  if (!a) return res.status(400).send("Missing analysis");
  const prompt = `You are a PGA Tour performance analyst writing for a player and their coach. Using ONLY the numbers below
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
