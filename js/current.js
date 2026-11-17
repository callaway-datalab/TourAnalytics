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
export const lastName = (label) => String(label || "").replace(/\s*\(.*\)\s*$/, "").split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).at(-1) || label;
