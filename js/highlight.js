// (update 818) The header's player, lit wherever they appear on a leaderboard (Follow → Historical and Live): every row or
// cell whose name is theirs gets .is-cur (the whole row when it's a table row or a list item). It watches the page, so
// rows drawn later (a filter changed, the live feed refreshed, "show more") are lit too, and follows a new header pick.
import { currentPlayer, onCurrent } from "./current.js";

const norm = (s) => String(s || "").replace(/[★☆]/g, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const SEL = "td, th, button, a, span, b, strong, li, p, div";

export function highlightPlayer(root) {
  let want = norm(currentPlayer()?.label), t = 0;
  const paint = () => {
    root.querySelectorAll(".is-cur, .is-cur-cell").forEach((n) => n.classList.remove("is-cur", "is-cur-cell"));
    if (!want) return;
    for (const n of root.querySelectorAll(SEL)) {
      if (n.children.length > 2) continue; // a name sits in a small element, not a whole block
      if (norm(n.textContent) !== want) continue;
      const row = n.closest("tr, li, .lv-row, .lb-row, .ti-row");
      (row && root.contains(row) ? row : n).classList.add(row ? "is-cur" : "is-cur-cell");
    }
  };
  const later = () => { clearTimeout(t); t = setTimeout(() => { obs.disconnect(); paint(); obs.observe(root, { childList: true, subtree: true }); }, 120); };
  const obs = new MutationObserver(later); obs.observe(root, { childList: true, subtree: true });
  const off = onCurrent((c) => { if (!root.isConnected) { stop(); return; } want = norm(c?.label); later(); });
  function stop() { obs.disconnect(); off(); clearTimeout(t); }
  later();
  return stop;
}
