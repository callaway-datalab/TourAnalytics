// (update 281) A one-line status that says "Loading…" (set from code, e.g. "Loading players…") gets the small
// ball-round-the-cup in front of it, and loses it when the text changes. Block messages use .ta-loading instead.
const isLoading = (t) => /^\s*Loading\b/.test(t || "");
function check(node) {
  const e = node?.nodeType === 3 ? node.parentElement : node;
  if (!e || e.nodeType !== 1 || e.classList.contains("ta-loading") || e.closest(".ta-loading")) return;
  if (e.matches("script, style, title, option, textarea, input, button, a")) return;
  const on = !e.firstElementChild && isLoading(e.textContent) && e.textContent.length < 160;
  e.classList.toggle("ta-loading-inline", on);
  e.classList.toggle("ta-just", on && /^\s*Loading\s*(\u2026|\.\.\.)?\s*$/.test(e.textContent)); // (update 282: just the animation)
}
// (update 291) the page is just the ball and cup (nothing else to read yet): show the course photo behind it, as on
// the first loading screen
function onlyLoading() {
  const page = document.querySelector("#app main") || document.getElementById("app");
  const loader = page?.querySelector(".ta-loading");
  let only = false;
  if (loader) {
    only = true;
    const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim() || n.parentElement?.closest(".ta-loading, script, style, [hidden]")) continue;
      only = false; break;
    }
  }
  document.documentElement.classList.toggle("ta-only-loading", only);
}
let pend = 0;
const later = () => { if (!pend) pend = requestAnimationFrame(() => { pend = 0; onlyLoading(); }); };
export function loadingDots() {
  onlyLoading();
  new MutationObserver((list) => {
    later();
    for (const m of list) {
      if (m.type === "characterData") check(m.target);
      else { check(m.target); m.addedNodes.forEach((n) => { if (n.nodeType === 1) { check(n); n.querySelectorAll?.("p, span, div, li").forEach(check); } }); }
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
}
