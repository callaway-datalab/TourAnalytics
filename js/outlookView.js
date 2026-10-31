// (update 446) The Outlook report page: the report the Compare page built (kept for this tab in sessionStorage), shown
// as a page of its own, with Print (Save as PDF from the print sheet) and Close (back to the app).
(function () {
  let html = null;
  try { html = sessionStorage.getItem("ta.outlookReport"); } catch { /* */ }
  const back = () => { if (history.length > 1) history.back(); else location.href = "./"; };
  if (!html) {
    const p = document.getElementById("ovEmpty");
    p.textContent = "This report isn't here any more. ";
    const a = document.createElement("a"); a.href = "./"; a.textContent = "Back to the app"; p.append(a);
    return;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.title) document.title = doc.title;
  for (const st of doc.querySelectorAll("head style")) document.head.appendChild(document.importNode(st, true));
  document.body.replaceChildren(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  for (const b of document.querySelectorAll("[onclick]")) b.removeAttribute("onclick"); // (the page's own handlers aren't allowed)
  document.getElementById("printBtn")?.addEventListener("click", () => window.print());
  const close = document.getElementById("closeBtn");
  if (close) { close.textContent = "✕ Close"; close.addEventListener("click", back); }
  window.scrollTo(0, 0);
})();
