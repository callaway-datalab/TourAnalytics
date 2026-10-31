// (update 446) The Outlook report page: the report the Compare page built (kept for this tab in sessionStorage), shown
// as a page of its own, with Save PDF and Close (back to the app).
// (update 447) Save PDF makes the PDF right here (each letter-landscape page drawn to an image with html2canvas, put
// into a PDF with jsPDF, both from cdnjs), because the installed app on a phone can't print. When it's ready, a tap on
// "Share PDF" opens the share sheet (Save to Files, Mail, AirDrop…); where sharing files isn't there, it downloads.
// If the PDF can't be made, it falls back to the print sheet. Print stays where printing works (not the installed app).
(function () {
  const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
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
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  const printBtn = document.getElementById("printBtn");
  const close = document.getElementById("closeBtn");
  if (close) { close.textContent = "✕ Close"; close.addEventListener("click", back); }
  const save = document.createElement("button");
  save.type = "button"; save.id = "pdfBtn"; save.textContent = "Save PDF";
  const msg = document.createElement("span"); msg.className = "pdf-msg";
  if (printBtn) {
    printBtn.textContent = "Print";
    printBtn.addEventListener("click", () => window.print());
    printBtn.before(save);
    if (standalone) printBtn.remove(); // (the installed app can't print)
  } else if (close) close.before(save);
  save.after(msg);

  const loadJs = (src) => new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => ok(); s.onerror = () => no(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
  const fileName = () => `${(document.title || "Outlook report").replace(/[\u00b7\u2013\u2014]/g, "-").replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").replace(/(\s*-\s*)+/g, " - ").trim() || "Outlook report"}.pdf`;
  let ready = null; // { file, blob } once made
  const deliver = async () => {
    const { file, blob } = ready;
    if (navigator.canShare && navigator.share) {
      let can = false; try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
      if (can) {
        try { await navigator.share({ files: [file], title: file.name }); return; } catch (err) { if (err && err.name === "AbortError") return; console.error(err); }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  };
  const make = async () => {
    save.disabled = true; save.textContent = "Making the PDF…"; msg.textContent = "";
    try {
      if (!window.html2canvas) await loadJs(H2C);
      if (!(window.jspdf && window.jspdf.jsPDF)) await loadJs(JSPDF);
      document.body.classList.add("pdf-snap");
      window.scrollTo(0, 0);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const pages = [...document.querySelectorAll(".page")];
      if (!pages.length) throw new Error("No pages");
      const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "in", format: "letter", compress: true });
      for (let i = 0; i < pages.length; i++) {
        save.textContent = `Making the PDF… ${i + 1} of ${pages.length}`;
        const c = await window.html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 1120, scrollX: 0, scrollY: 0 });
        if (i) pdf.addPage("letter", "landscape");
        pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 11, 8.5);
        c.width = 0; c.height = 0; // (let the phone have the memory back)
      }
      const blob = pdf.output("blob");
      const name = fileName();
      let file; try { file = new File([blob], name, { type: "application/pdf" }); } catch { file = Object.assign(blob, { name }); }
      ready = { file, blob };
      // sharing needs a fresh tap (the phone won't open the share sheet after a wait), so the button becomes Share PDF
      save.textContent = navigator.share ? "Share PDF" : "Download PDF";
      msg.textContent = "PDF ready";
    } catch (err) {
      console.error(err);
      ready = null; save.textContent = "Save PDF";
      msg.textContent = standalone ? "Couldn't make the PDF here. Check the connection and try again." : "Couldn't make the PDF here, so here's the print sheet: choose Save as PDF.";
      if (!standalone) setTimeout(() => window.print(), 50);
    } finally {
      document.body.classList.remove("pdf-snap");
      save.disabled = false;
    }
  };
  save.addEventListener("click", () => { if (ready) deliver(); else make(); });
  window.scrollTo(0, 0);
})();
