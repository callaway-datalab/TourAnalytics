// Optional (recommended): read a scorecard photo with a vision AI model (Claude).
// The portal sends the photo; this returns { holes, par[], hcp[], tees: [{ name, yards[] }] } and the portal
// fills the scorecard straight in (you still check it). Without it, the portal uses its own grid reader.
//
// Needs the Firebase Blaze plan (Cloud Functions) and an Anthropic API key:
//   1. firebase init functions            (in this repo; JavaScript)
//   2. copy this file into functions/index.js (alongside the insights function, if you use it) and run:
//        npm install firebase-functions firebase-admin
//   3. firebase functions:secrets:set ANTHROPIC_API_KEY
//   4. firebase deploy --only functions
//   5. put the function's URL in config.js:  scorecardUrl: "https://…/scorecard"
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const MODEL = process.env.SCORECARD_MODEL || "claude-sonnet-5-5";

const PROMPT = `This is a photo of a golf course scorecard. Read it carefully and return ONLY JSON, no other text:
{"holes": 18 or 9,
 "par": [one number per hole, in hole order],
 "hcp": [the handicap / stroke index per hole; where a box shows two numbers (men's over women's), use the TOP one; null if missing],
 "tees": [{"name": "the tee's name as printed (e.g. Black, Blue)", "yards": [one yardage per hole]}],
 "notes": "anything you couldn't read, briefly"}
Use null for any number you can't read. Don't include the OUT / IN / TOTAL columns.`;

exports.scorecard = onRequest({ secrets: [ANTHROPIC_API_KEY], cors: true, maxInstances: 5, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  try { await admin.auth().verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer /, "")); }
  catch { return res.status(401).send("Sign in first"); }
  const { image, mediaType = "image/jpeg", nine = null } = req.body || {};
  if (!image) return res.status(400).send("Missing image");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: PROMPT + (nine ? `\nThis photo shows only the ${nine === "front" ? "front nine (holes 1-9)" : "back nine (holes 10-18)"}; return 18 entries per list with null for the holes not shown.` : "") },
      ] }],
    }),
  });
  if (!r.ok) return res.status(502).send("The reader service didn't answer");
  const data = await r.json();
  const text = (data.content || []).map((c) => c.text || "").join("").replace(/```json|```/g, "").trim();
  try { res.json(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))); }
  catch { res.status(502).send("Couldn't understand the reply"); }
});
