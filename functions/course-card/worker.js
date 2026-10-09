// Course scorecard proxy for Add Data: a free Cloudflare Worker (no Firebase Blaze plan needed).
// The portal can't read BlueGolf or GolfTraxx pages from the browser (those sites don't allow it), so this
// fetches them for it. It only ever searches for, and fetches, pages on those two sites.
//
//   GET ?q=<course name and town>   -> { results: [{ title, url }] }   (a web search limited to the two sites)
//   GET ?url=<a BlueGolf / GolfTraxx page> -> { html }
//
// Set up (about 5 minutes):
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker -> name it (e.g. course-card) -> Deploy.
//   2. Edit code -> replace everything with this file -> Deploy.
//   3. Settings -> Variables: add ALLOWED_ORIGINS = https://callaway-datalab.github.io
//   4. In config.js:  courseCardUrl: "https://course-card.<your-subdomain>.workers.dev"
// index.html already allows *.workers.dev in its Content-Security-Policy (connect-src). If you put the worker on
// your own domain instead, add that domain there too.
//
// Please check BlueGolf's and GolfTraxx's terms of use before relying on this: it reads their public scorecard
// pages one at a time when someone sets up a round, and nothing is stored here.

const SITES = ["bluegolf.com", "golftraxx.com"];
const okHost = (u) => { try { const h = new URL(u).hostname; return SITES.some((d) => h === d || h.endsWith(`.${d}`)); } catch { return false; } };
const UA = "Mozilla/5.0 (compatible; TourAnalytics course-card proxy)";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = { "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*", Vary: "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (allowed.length && origin && !allowed.includes(origin)) return new Response("Not allowed", { status: 403, headers: cors });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } });
    const p = new URL(req.url).searchParams;
    try {
      if (p.get("url")) {
        const u = p.get("url");
        if (!okHost(u)) return json({ error: "Only BlueGolf and GolfTraxx pages" }, 400);
        const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html" }, cf: { cacheTtl: 86400, cacheEverything: true } });
        if (!r.ok) return json({ error: `page ${r.status}` }, 502);
        return json({ html: (await r.text()).slice(0, 1500000) });
      }
      const q = clean(p.get("q") || "");
      if (!q) return json({ error: "q or url needed" }, 400);
      let results = await ddg(`${q} scorecard (site:bluegolf.com OR site:golftraxx.com)`);
      if (!results.length) results = await bing(`${q} scorecard (site:bluegolf.com OR site:golftraxx.com)`);
      return json({ results: results.filter((x) => okHost(x.url)).slice(0, 8) });
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};

const clean = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 160);
const strip = (s) => clean(s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"'));
async function ddg(q) {
  const r = await fetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ q }) });
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
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const html = await r.text(), out = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) out.push({ title: strip(m[2]), url: m[1].replace(/&amp;/g, "&") });
  return out;
}
