// (update 816) The current player: picked once, carried to every page with a player (the header chip shows them).
// Only { key, label } is kept (on the device, so it survives a reload), never their stats file.
// Crash guard (update 533's lesson): a page that opens on the current player by itself marks it first; if the site
// died while that page was loading (a phone out of memory), the next start doesn't open them by itself again.
const LS = "ta.current", GUARD = "ta.currentAuto";
let cur = null, crashed = false; const subs = new Set();
try { cur = JSON.parse(localStorage.getItem(LS) || "null"); } catch { cur = null; }
try { if (sessionStorage.getItem(GUARD) || localStorage.getItem(GUARD)) { crashed = true; localStorage.removeItem(GUARD); sessionStorage.removeItem(GUARD); } } catch { /* */ }
if (cur && !(cur.key && typeof cur.key === "string")) cur = null;

/** { key, label } or null */
export const currentPlayer = () => cur;
/** set (or clear with null) the current player; tells the header chip and anyone listening */
export function setCurrent(p) {
  const next = p?.key ? { key: String(p.key), label: String(p.label || p.key.replace(/^c_/, "")) } : null;
  if ((next?.key || null) === (cur?.key || null) && (next?.label || null) === (cur?.label || null)) return;
  cur = next; try { if (cur) localStorage.setItem(LS, JSON.stringify(cur)); else localStorage.removeItem(LS); } catch { /* */ }
  for (const f of subs) { try { f(cur); } catch (e) { console.warn(e); } }
}
export const onCurrent = (f) => { subs.add(f); return () => subs.delete(f); };
/** the current player for a page to open on by itself, or null (none, or the last such open crashed the site) */
export function autoPlayer() {
  if (!cur || crashed) { crashed = false; return null; }
  try { localStorage.setItem(GUARD, "1"); } catch { /* */ }
  setTimeout(() => { try { localStorage.removeItem(GUARD); } catch { /* */ } }, 20000); // loaded fine (or the person moved on)
  return cur;
}
/** last name for short labels (never a first name alone) */
export const lastName = (label) => { const w = String(label || "").replace(/\s*\(.*\)\s*$/, "").split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); if (!w.length) return label;
  let i = w.length - 1; while (i > 1 && /^(van|von|der|den|de|da|di|du|la|le|del|dos|ter|mac)$/i.test(w[i - 1])) i--; return w.slice(i).join(" "); }; // ("van Rooyen")
/** (update 817) open Stats on one of its tabs (overview, full, focus, results, fit, practice) for the header's player;
 *  sub: the Practice & Goals tab's part (practice, week, goals) */
export function statsHref() {
  const st = window.__authState || {}, pv = window.__previewClient;
  if (st.isAdmin && !pv) return "#/admin/player-stats";
  if (!st.isAdmin && st.isTeam && !pv) return "#/player-stats";
  return "#/dashboard";
}
// (update 858) bag and practice are under Play: switching across Stats and Play reloads the page so the header redraws (as ui.js's sameStatsHeader)
const samePlayHeader = (v) => { const P = ["bag", "practice"], now = new URLSearchParams(location.hash.split("?")[1] || "").get("view") || "full"; return P.includes(v) === P.includes(now); };
export function openStatsTab(view2, sub = null) {
  // (update 833) Stats already showing: switch the view in place; else open Stats on it (?view= in the address)
  if (document.querySelector(".st-host") && samePlayHeader(view2)) { const h0 = location.hash.split("?"), q = new URLSearchParams(h0[1] || ""); q.set("view", view2); history.replaceState(history.state, "", `${h0[0]}?${q}`); window.dispatchEvent(new CustomEvent("ta-stats-view", { detail: { view: view2, sub } })); import("./ui.js").then((m) => m.syncStatsNav()).catch(() => {}); return; }
  try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st: { view2, ...(sub ? { pgSub: sub } : {}) } })); } catch { /* */ }
  const h = `${statsHref()}?view=${view2}`; if (location.hash === h) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = h;
}
