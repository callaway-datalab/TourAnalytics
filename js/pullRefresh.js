// (update 321) Pull down to refresh, for the Home Screen app (it has no reload button and no pull-to-refresh of its own).
// At the top of a page, drag down: a circle with an arrow follows your finger and turns; let go past the line and the
// page reloads (fresh from the server, as the reload button would in Safari). Safari itself is left alone.
const THRESHOLD = 75;   // px of finger travel to refresh
const MAX = 120;        // how far the circle comes down

const standalone = () => {
  try { return window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch { return false; }
};
/** Is the touch inside something of its own that's scrolled down (a list, a pop-up, Cal's chat)? Then it isn't a pull. */
function innerScrolled(node) {
  for (let e = node; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e.scrollTop > 0) return true;
    if (e.matches?.("dialog, [role=dialog], .cal-wrap, .cal-log, .gx-pop-overlay, .chat-list, input, textarea, select, .wl-dragging")) return true;
  }
  return false;
}

export function pullToRefresh() {
  if (!standalone() || !("ontouchstart" in window)) return;
  const dot = document.createElement("div");
  dot.className = "ptr";
  dot.setAttribute("aria-hidden", "true");
  dot.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><polyline points="20 4 20 9 15 9"/></svg>';
  document.body.appendChild(dot);
  let startY = null, pull = 0, busy = false;
  const place = (d) => {
    const p = Math.min(MAX, d * 0.55);
    dot.style.transform = `translate(-50%, ${p}px) rotate(${Math.min(1, d / THRESHOLD) * 300}deg)`;
    dot.style.opacity = String(Math.min(1, d / 40));
    dot.classList.toggle("ready", d >= THRESHOLD);
  };
  const reset = () => { startY = null; pull = 0; dot.classList.add("back"); dot.style.transform = "translate(-50%, 0) rotate(0deg)"; dot.style.opacity = "0"; dot.classList.remove("ready"); setTimeout(() => dot.classList.remove("back"), 250); };
  document.addEventListener("touchstart", (e) => {
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || document.scrollingElement?.scrollTop > 0 || innerScrolled(e.target)) { startY = null; return; }
    startY = e.touches[0].clientY; pull = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (startY == null || busy) return;
    if (document.querySelector(".wl-dragging, .wl-reordering")) { if (pull) reset(); startY = null; return; } // (moving a Watchlist card)
    const d = e.touches[0].clientY - startY;
    if (d <= 0 || window.scrollY > 0) { if (pull) reset(); startY = d <= 0 ? startY : null; pull = 0; return; }
    pull = d; place(d);
  }, { passive: true });
  const end = () => {
    if (startY == null || busy) return;
    if (pull >= THRESHOLD) {
      busy = true;
      dot.classList.add("spin");
      dot.style.transform = `translate(-50%, ${Math.min(MAX, THRESHOLD * 0.55)}px)`;
      setTimeout(() => location.reload(), 150);
      return;
    }
    reset();
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", () => { if (!busy) reset(); }, { passive: true });
}
