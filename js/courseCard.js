// Course scorecards from BlueGolf or GolfTraxx: the first thing Add Data tries (a photo of the card is the
// fallback). A browser page can't read another site directly (the sites don't allow it), so a small proxy does
// the fetching: functions/course-card/worker.js, a free Cloudflare Worker, with its address in config.js as
// courseCardUrl. The proxy only searches for and fetches pages on those two sites; the reading is done here.
//
//   searchCourseCards("Torrey Pines South", "La Jolla, CA") -> [{ title, url, source }]
//   loadCourseCard(url)                                      -> { holes, par[], hcp[], tees: [{ name, yards[] }], found, notes[] }
//   parseScorecardHtml(html)                                 -> the same, from a page's HTML (any table layout)

export const courseCardUrl = () => window.PORTAL_CONFIG?.courseCardUrl || "";
export const courseCardsEnabled = () => !!courseCardUrl();
export const SOURCES = [["bluegolf.com", "BlueGolf"], ["golftraxx.com", "GolfTraxx"]];
export const sourceOf = (url) => { try { const h = new URL(url).hostname; return SOURCES.find(([d]) => h === d || h.endsWith(`.${d}`))?.[1] || null; } catch { return null; } };

async function call(params) {
  const base = courseCardUrl();
  if (!base) throw new Error("not set up");
  const res = await fetch(`${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  return res.json();
}

/** Scorecard pages on BlueGolf / GolfTraxx for a course, best guess first. */
export async function searchCourseCards(course, location = "") {
  const r = await call({ q: [course, location].filter(Boolean).join(" ") });
  const words = norm(course).split(" ").filter((w) => w.length > 2 && !["golf", "club", "course", "country", "the"].includes(w));
  const score = (x) => words.filter((w) => norm(x.title).includes(w)).length + (/scorecard/i.test(x.url) ? 0.5 : 0);
  return (r.results || []).filter((x) => sourceOf(x.url)).map((x) => ({ ...x, title: String(x.title || "").replace(/\s*[|\u2013-]\s*(BlueGolf|GolfTraxx)(\.com)?\s*$/i, "").trim(), source: sourceOf(x.url) }))
    .sort((a, b) => score(b) - score(a));
}

/** Read the scorecard on one page (a BlueGolf course page also tries its scorecard pages). */
export async function loadCourseCard(url) {
  const tries = [url];
  if (sourceOf(url) === "BlueGolf" && !/scorecard/i.test(url)) {
    const base = url.replace(/[?#].*$/, "").replace(/\/[^/]*\.htm$/, "");
    tries.push(`${base}/detailedscorecard.htm`, `${base}/scorecard.htm`);
  }
  let last = null;
  for (const u of tries) {
    try {
      const r = await call({ url: u });
      const card = parseScorecardHtml(r.html || "");
      if (card.found) return { ...card, url: u };
      last = card;
    } catch (err) { last = last || { found: 0, error: String(err.message || err) }; }
  }
  return last || { found: 0 };
}

/* ------------------------------ reading a scorecard table ------------------------------ */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const int = (s) => { const m = clean(s).match(/^(\d{1,3})(?:\s*[\/|]\s*\d{1,3})?$/); return m ? Number(m[1]) : null; }; // "7/8" (men's / women's): the first
const NOT_TEE = /hole|^par\b|hand|hcp|hdcp|index|stroke|^s\.?i\.?$|score|player|date|attest|net|^out$|^in$|^tot|signature|rating|slope|^yards?$|^yardage$/i;
const LADIES = /women|ladies|\(w\)|\bw\b|\blpga\b/i;

function gridsOf(doc) {
  const out = [];
  for (const t of doc.querySelectorAll("table")) {
    const rows = [...t.rows].map((r) => [...r.cells].flatMap((c) => Array(Math.max(1, Math.min(Number(c.colSpan) || 1, 4))).fill(clean(c.textContent))));
    if (rows.length < 2) continue;
    out.push(rows);
    // the same table turned on its side (holes down the page, rows across)
    const w = Math.max(...rows.map((r) => r.length));
    out.push(Array.from({ length: w }, (_, j) => rows.map((r) => r[j] ?? "")));
  }
  return out;
}
// the hole numbers in a row: { holeNumber: column } (a run of 9 or more, from 1 or 10)
function holeCols(row) {
  const cols = {};
  row.forEach((c, j) => { const n = int(c); if (n && n <= 18 && cols[n] === undefined && /^\d{1,2}$/.test(clean(c))) cols[n] = j; });
  const ks = Object.keys(cols).map(Number);
  const run = (from) => { let k = from; while (cols[k] !== undefined && (k === from || cols[k] > cols[k - 1])) k++; return k - from; };
  const front = run(1), back = run(10);
  if (front < 9 && back < 9) return null;
  const keep = {};
  for (const k of ks) if ((k <= 9 && front >= 9) || (k >= 10 && (back >= 9 || front >= 18))) keep[k] = cols[k];
  return keep;
}

export function parseScorecardHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const par = {}, hcp = {}, tees = new Map(), notes = [];
  const parRows = [], hcpRows = []; // (men's rows first; a women's row only fills what's missing)
  for (const g of gridsOf(doc)) {
    const hi = g.findIndex((r) => (/^hole/i.test(r[0] || "") || r.length > 9) && holeCols(r));
    if (hi < 0) continue;
    const cols = holeCols(g[hi]);
    const first = Math.min(...Object.values(cols));
    for (let i = 0; i < g.length; i++) {
      if (i === hi) continue;
      const row = g[i];
      const label = clean(row.slice(0, first).filter((c) => c && int(c) === null).join(" ")) || clean(row[0]);
      const vals = Object.fromEntries(Object.entries(cols).map(([k, j]) => [k, int(row[j])]));
      const got = Object.values(vals).filter((v) => v != null);
      if (got.length < Object.keys(cols).length * 0.7) continue;
      const isPar = /^par\b/i.test(label) || (!label && got.every((v) => v >= 3 && v <= 6));
      const isHcp = /hcp|hdcp|handicap|index|stroke|^s\.?i\.?\b/i.test(label);
      const ladies = LADIES.test(label);
      if (isPar && got.every((v) => v >= 3 && v <= 6)) parRows.push({ vals, ladies });
      else if (isHcp && got.every((v) => v >= 1 && v <= 18)) hcpRows.push({ vals, ladies });
      else if (!isPar && !isHcp && label && !NOT_TEE.test(label) && got.every((v) => v >= 40 && v <= 720)) {
        // a tee: its name without ratings ("Blue 72.1/131" -> "Blue")
        const name = clean(label.replace(/\(?\s*\d+(\.\d+)?\s*[\/|]\s*\d+\s*\)?/g, "").replace(/\b\d+(\.\d+)?\b/g, "").replace(/\b(tees?|yards?|yardage)\b/gi, "").replace(/^[\s\-\u2013:|,]+|[\s\-\u2013:|,]+$/g, "")) || "Tees";
        const t = tees.get(name.toLowerCase()) || { name, yards: {} };
        for (const [k, v] of Object.entries(vals)) if (v != null && t.yards[k] == null) t.yards[k] = v;
        tees.set(name.toLowerCase(), t);
      }
    }
  }
  for (const [rows, into] of [[parRows, par], [hcpRows, hcp]]) {
    for (const r of [...rows.filter((x) => !x.ladies), ...rows.filter((x) => x.ladies)]) for (const [k, v] of Object.entries(r.vals)) if (v != null && into[k] == null) into[k] = v;
  }
  const nHoles = Math.max(0, ...Object.keys(par).map(Number), ...[...tees.values()].flatMap((t) => Object.keys(t.yards).map(Number)));
  const holes = nHoles > 9 ? 18 : nHoles ? 9 : 0;
  const arr = (o) => Array.from({ length: holes }, (_, i) => o[i + 1] ?? null);
  const teeList = [...tees.values()].map((t) => ({ name: t.name, yards: arr(t.yards) })).filter((t) => t.yards.filter(Boolean).length >= holes * 0.7)
    .sort((a, b) => b.yards.reduce((x, y) => x + (y || 0), 0) - a.yards.reduce((x, y) => x + (y || 0), 0)); // longest tees first
  const parA = arr(par), hcpA = arr(hcp);
  if (hcpA.some(Boolean) && new Set(hcpA.filter(Boolean)).size !== hcpA.filter(Boolean).length) notes.push("Some handicaps repeat on that card; check them.");
  const found = parA.filter(Boolean).length + hcpA.filter(Boolean).length + teeList.reduce((n, t) => n + t.yards.filter(Boolean).length, 0);
  return { holes, par: parA, hcp: hcpA, tees: teeList, found, notes };
}
