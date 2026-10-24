// (update 281) A one-line status that says "Loading…" (set from code, e.g. "Loading players…") gets the small
// ball-round-the-cup in front of it, and loses it when the text changes. Block messages use .ta-loading instead.
const isLoading = (t) => /^\s*(Loading\b|Data is loading)/.test(t || ""); // (update 318: and the "Data is loading" note)
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
  // (update 293) "only the loader": a ball-and-cup on screen and, apart from it, no more than a heading's worth of
  // words (a page title, tour pills, a button or two), so the screen is otherwise empty
  const page = document.querySelector("#app main") || document.getElementById("app");
  const loaders = [...(page?.querySelectorAll(".ta-loading") || [])].filter((x) => x.getClientRects().length);
  let only = false;
  if (loaders.length) {
    let chars = 0;
    const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.trim(), p = n.parentElement;
      if (!t || !p || p.closest(".ta-loading, script, style, [hidden], .section-nav, .subnav") || !p.getClientRects().length) continue;
      chars += t.length;
      if (chars > 160) break;
    }
    only = chars <= 160;
  }
  document.documentElement.classList.toggle("ta-only-loading", only && !document.documentElement.classList.contains("ta-booted")); // (update 318: only on the first load)
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
