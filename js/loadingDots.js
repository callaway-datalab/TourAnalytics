// (update 281) A one-line status that says "Loading…" (set from code, e.g. "Loading players…") gets the small
// ball-round-the-cup in front of it, and loses it when the text changes. Block messages use .ta-loading instead.
const isLoading = (t) => /^\s*Loading\b/.test(t || "");
function check(node) {
  const e = node?.nodeType === 3 ? node.parentElement : node;
  if (!e || e.nodeType !== 1 || e.classList.contains("ta-loading") || e.closest(".ta-loading")) return;
  if (e.matches("script, style, title, option, textarea, input, button, a")) return;
  const on = !e.firstElementChild && isLoading(e.textContent) && e.textContent.length < 160;
  e.classList.toggle("ta-loading-inline", on);
}
export function loadingDots() {
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") check(m.target);
      else { check(m.target); m.addedNodes.forEach((n) => { if (n.nodeType === 1) { check(n); n.querySelectorAll?.("p, span, div, li").forEach(check); } }); }
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
}
