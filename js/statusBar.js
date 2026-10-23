// (update 277) The Home Screen app's top edge on iPhone. Recent iOS versions draw their own blurred band behind the
// clock in a Home Screen app and, in some versions, report no safe area at the top (env(safe-area-inset-top) = 0)
// even though the page runs underneath that band (WebKit bug 301994). The CSS uses --sat for the clock's area:
// the real safe area when iOS reports one, or else the band's height when the page is plainly running under it.
export function fixStatusBar() {
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!standalone) return;
  document.documentElement.classList.add("ta-app");
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const iPhone = /iPhone|iPod/.test(navigator.userAgent);
  const measure = () => {
    const env = probe.getBoundingClientRect().height;
    const portrait = innerHeight > innerWidth;
    // the page fills the whole screen (so it's under the clock) but iOS says there's nothing at the top
    const under = Math.abs(innerHeight - screen.height) <= 2 && portrait;
    const root = document.documentElement.style;
    if (iPhone && env < 1 && under) root.setProperty("--sat", `${screen.height >= 852 ? 59 : screen.height >= 812 ? 47 : 20}px`);
    else root.removeProperty("--sat");
  };
  measure();
  addEventListener("resize", measure); addEventListener("orientationchange", () => setTimeout(measure, 300));
}
