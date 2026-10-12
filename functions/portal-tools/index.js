/*
 * Portal tools for Tour Analytics (update 132): a Cloud Run function in the Firebase project for Track Round's
 * course scorecard lookup (it replaces the Cloudflare Worker; free at the portal's usage).
 *
 *   GET  /course-card?q=<course and town>   -> { results: [{ title, url }] }   BlueGolf / GolfTraxx scorecard pages
 *   GET  /course-card?url=<a page on those>  -> { html }                        that page, for the portal to read
 *
 * Every call needs a signed-in portal user (Firebase ID token in "Authorization: Bearer …"), so nobody else can
 * use it.
 *
 * Course cards: please check BlueGolf's and GolfTraxx's terms of use before relying on this. It reads their
 * public scorecard pages one at a time when someone sets up a round, and keeps them in memory for a day.
 *
 * Deploy: see DEPLOY_BLAZE.md, step 4 (Cloud Run -> Write a function; entry point "tools", Node.js 22).
 */
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
// The portal's own address(es), comma-separated, e.g. https://callaway-datalab.github.io (empty: any)
const ALLOWED = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

functions.http("tools", async (req, res) => {
  const origin = req.get("Origin") || "";
  res.set("Access-Control-Allow-Origin", !ALLOWED.length ? "*" : ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Max-Age", "3600");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return res.status(403).send("Not allowed");
  try {
    await admin.auth().verifyIdToken(String(req.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  } catch { return res.status(401).json({ error: "Sign in first" }); }
  const path = req.path.replace(/\/+$/, "");
  try {
    if (path.endsWith("/course-card")) return await courseCard(req, res);
    return res.status(404).json({ error: "Unknown tool" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

/* ============================== course cards ============================== */

const SITES = ["bluegolf.com", "golftraxx.com"];
const okHost = (u) => { try { const h = new URL(u).hostname; return SITES.some((d) => h === d || h.endsWith(`.${d}`)); } catch { return false; } };
const UA = "Mozilla/5.0 (compatible; TourAnalytics course-card reader)";
const cache = new Map(); // key -> { at, value } (a day; at most 300 entries)
const DAY = 24 * 3600 * 1000;
const cached = async (key, make) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const value = await make();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
};

async function courseCard(req, res) {
  res.set("Cache-Control", "private, max-age=86400");
  const url = req.query.url;
  if (url) {
    if (!okHost(url)) return res.status(400).json({ error: "Only BlueGolf and GolfTraxx pages" });
    const html = await cached(`u:${url}`, async () => {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`page ${r.status}`);
      return (await r.text()).slice(0, 1500000);
    });
    return res.json({ html });
  }
  const q = clean(req.query.q || "");
  if (!q) return res.status(400).json({ error: "q or url needed" });
  const results = await cached(`q:${q.toLowerCase()}`, async () => {
    const query = `${q} scorecard (site:bluegolf.com OR site:golftraxx.com)`;
    let list = await ddg(query).catch(() => []);
    if (!list.length) list = await bing(query).catch(() => []);
    return list.filter((x) => okHost(x.url)).slice(0, 8);
  });
  return res.json({ results });
}

const clean = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 160);
const strip = (s) => clean(String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"'));
async function ddg(q) {
  const r = await fetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ q }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [];
  const html = await r.text(), out = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = m[1].replace(/&amp;/g, "&");
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    out.push({ title: strip(m[2]), url });
  }
  return out;
}
async function bing(q) {
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [];
  const html = await r.text(), out = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) out.push({ title: strip(m[2]), url: m[1].replace(/&amp;/g, "&") });
  return out;
}
