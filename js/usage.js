// (update 227) Usage: how long people use the portal and which pages they open, for the admin's At a glance.
// One document per person per day (usage/{uid}_{yyyy-mm-dd}): seconds of active use, and views and seconds by page.
// Active use = the tab is showing and they've touched, clicked, typed or scrolled in the last 2 minutes. Saved about
// once a minute (and when the tab is hidden), with increments, so it costs one small write a minute at most.
import { doc, setDoc, getDocs, collection, query, where, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const IDLE_MS = 2 * 60 * 1000, TICK_MS = 15 * 1000, FLUSH_MS = 60 * 1000;
let page = null, lastInput = Date.now(), lastTick = Date.now(), started = false;
let pend = { seconds: 0, pages: {}, pageSec: {}, paths: {} };
// (update 816) how people move: "from__to__via" counts (via: menu, submenu, bar = the phone's bottom bar, search, chip = the
// current player's chip, link = anything on a page, back = Back/Forward or a typed address)
let via = null, viaAt = 0;
addEventListener("click", (e) => { const a = e.target?.closest?.("a, button"); if (!a) return; via = a.closest(".pal") ? "search" : a.closest(".botbar") ? "bar" : a.closest(".cur-chip") ? "chip" : a.closest(".subhead, .section-nav") ? "submenu" : a.closest(".rail") ? "menu" : "link"; viaAt = Date.now(); }, { capture: true, passive: true });
const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const safe = (k) => String(k || "other").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);

function tick() {
  const now = Date.now(), dt = Math.min(now - lastTick, TICK_MS * 2);
  lastTick = now;
  if (document.visibilityState !== "visible" || now - lastInput > IDLE_MS || !auth.currentUser) return;
  const s = dt / 1000;
  pend.seconds += s;
  if (page) pend.pageSec[page] = (pend.pageSec[page] || 0) + s;
}
async function flush() {
  tick();
  const uid = auth.currentUser?.uid;
  const secs = Math.round(pend.seconds);
  const pages = pend.pages, pageSec = pend.pageSec;
  if (!uid || (!secs && !Object.keys(pages).length && !Object.keys(pend.paths).length)) return;
  const paths = pend.paths;
  pend = { seconds: pend.seconds - secs, pages: {}, pageSec: {}, paths: {} };
  const day = dayOf();
  const data = { uid, day, at: serverTimestamp(), seconds: increment(secs) };
  if (Object.keys(pages).length) data.pages = Object.fromEntries(Object.entries(pages).map(([k, n]) => [k, increment(n)]));
  const ps = Object.entries(pageSec).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0);
  if (Object.keys(paths).length) data.paths = Object.fromEntries(Object.entries(paths).map(([k, n]) => [k, increment(n)]));
  if (ps.length) data.pageSec = Object.fromEntries(ps.map(([k, v]) => [k, increment(v)]));
  try { await setDoc(doc(db, "usage", `${uid}_${day}`), data, { merge: true }); }
  catch (err) { console.warn("Usage not saved (republish firestore.rules)", err?.code || err); }
}
function start() {
  if (started) return;
  started = true;
  const seen = () => { lastInput = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "scroll", "wheel", "touchstart"]) window.addEventListener(ev, seen, { passive: true, capture: true });
  setInterval(tick, TICK_MS);
  setInterval(flush, FLUSH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); else { lastTick = Date.now(); lastInput = Date.now(); } });
  window.addEventListener("pagehide", flush);
}
/** A page was opened (the router calls this on every route). */
export function trackPage(routeId) {
  if (!auth.currentUser) return;
  start();
  tick();
  const from = page; page = safe(routeId);
  if (from && from !== page) { const how = via && Date.now() - viaAt < 3000 ? via : "back", k = `${from}__${page}__${how}`.slice(0, 120); pend.paths[k] = (pend.paths[k] || 0) + 1; } via = null;
  pend.pages[page] = (pend.pages[page] || 0) + 1;
  lastInput = Date.now();
}

/** The admin: every usage day since `since` (yyyy-mm-dd; null = all). */
export async function loadUsage(since = null) {
  const q = since ? query(collection(db, "usage"), where("day", ">=", since)) : collection(db, "usage");
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}
export { dayOf };
