// (update 325) The admin's Performance readout (hamburger → Performance): how long each page took to open, how much
// data is being held in memory, and how often the page was reloaded unexpectedly (iPhone runs out of memory and
// restarts the page: "A problem repeatedly occurred"). Kept on this device only.
const LS_ALIVE = "ta.alive", LS_RELOADS = "ta.reloads";
const timings = []; // [{ route, ms, at }]
let boot = { ms: null };

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

/** Call once at start: notices if the last visit ended without the page closing normally (a crash / forced reload). */
export function watchReloads() {
  const prev = read(LS_ALIVE, null);
  if (prev && !prev.clean) {
    const list = read(LS_RELOADS, []);
    list.push({ at: Date.now(), last: prev.route || "", since: prev.at });
    write(LS_RELOADS, list.slice(-20));
  }
  const alive = () => write(LS_ALIVE, { at: Date.now(), clean: false, route: location.hash || "#/" });
  const clean = () => write(LS_ALIVE, { at: Date.now(), clean: true, route: location.hash || "#/" });
  alive();
  window.addEventListener("pagehide", clean);
  window.addEventListener("hashchange", alive);
  // in the background the phone may close the app to save memory: that isn't a crash while you were using it
  document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? clean() : alive()));
}

/** How long a page took to draw (the router reports it). */
export function markPage(route, ms) {
  timings.push({ route, ms: Math.round(ms), at: Date.now() });
  if (timings.length > 30) timings.shift();
  if (panel) update();
}
export function markBoot(ms) { boot.ms = Math.round(ms); if (panel) update(); }

let panel = null, timer = null;
async function snapshot() {
  const out = {};
  const mem = performance?.memory; // (Chrome on a computer only; iPhones don't say)
  out.heap = mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB of ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB` : "not reported on this device";
  try { const m = await import("./fieldStore.js"); out.detail = m.detailInfo(); } catch { out.detail = null; }
  try { const m = await import("./fieldCache.js"); out.rows = m.memoryInfo?.(); } catch { out.rows = null; }
  try { const m = await import("./store.js"); out.memo = m.rowsMemoInfo?.(); } catch { out.memo = null; }
  try { const m = await import("./views/adminAnalyze.js"); out.analyze = m.analyzeMemoryInfo?.(); } catch { out.analyze = null; }
  out.charts = document.querySelectorAll("canvas").length;
  out.nodes = document.getElementsByTagName("*").length;
  return out;
}
const n = (x) => (x == null ? "—" : Number(x).toLocaleString());
async function update() {
  if (!panel) return;
  const s = await snapshot();
  const reloads = read(LS_RELOADS, []);
  const recent = timings.slice(-6).reverse();
  const avg = timings.length ? Math.round(timings.reduce((t, x) => t + x.ms, 0) / timings.length) : null;
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  panel.querySelector(".perf-body").innerHTML = `
    <p><b>Memory used</b> ${s.heap}</p>
    <p><b>Field detail</b> ${n(s.detail?.players)} players · ${n(s.detail?.rounds)} rounds · ${n(s.detail?.shots)} shots</p>
    <p><b>Full rows</b> ${n(s.rows?.players)} players · ${n(s.rows?.rows)} rows${s.rows?.files ? "" : " (none: phones use the detail)"}</p>
    <p><b>Kept copies</b> ${n(s.memo?.players)} players' rows · ${n(s.memo?.stats)} summaries${s.analyze ? ` · Stats: ${s.analyze.prepared} prepared, ${s.analyze.detail} detail, ${s.analyze.rows} rows` : ""}</p>
    <p><b>On screen</b> ${n(s.charts)} charts · ${n(s.nodes)} page elements</p>
    <p><b>First load</b> ${boot.ms != null ? `${(boot.ms / 1000).toFixed(1)} s` : "—"} · <b>Page opens</b> ${avg != null ? `${avg} ms average` : "—"}</p>
    <ul class="perf-list">${recent.map((t) => `<li>${t.route.replace(/^#?\//, "") || "home"} · ${t.ms} ms</li>`).join("") || "<li>No page changes yet</li>"}</ul>
    <p><b>Unexpected reloads</b> ${reloads.length}${reloads.length ? ` (last ${when(reloads.at(-1).at)}, on ${reloads.at(-1).last.replace(/^#\//, "") || "home"})` : ""}</p>`;
}
/** Show or hide the readout. */
export function togglePerf() {
  if (panel) { panel.remove(); panel = null; clearInterval(timer); return; }
  panel = document.createElement("div");
  panel.className = "perf-panel";
  panel.innerHTML = `<div class="perf-head"><strong>Performance</strong><span><button type="button" class="perf-clear">Reset</button><button type="button" class="perf-x" aria-label="Close">×</button></span></div><div class="perf-body"></div>`;
  panel.querySelector(".perf-x").addEventListener("click", togglePerf);
  panel.querySelector(".perf-clear").addEventListener("click", () => { write(LS_RELOADS, []); timings.length = 0; update(); });
  document.body.appendChild(panel);
  update();
  timer = setInterval(update, 2000);
}
