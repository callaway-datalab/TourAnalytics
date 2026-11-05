// (update 446) The Outlook report page: the report the Compare page built (kept for this tab in sessionStorage), shown
// as a page of its own, with Save PDF and Close (back to the app).
// (update 447) Save PDF makes the PDF right here (each letter-landscape page drawn to an image with html2canvas, put
// into a PDF with jsPDF, both from cdnjs), because the installed app on a phone can't print.
// (update 511) Just two buttons, Save PDF and Close (no Print), on every report: the course strategy report and the
// Outlook report, in the app's report page or in a tab of their own (the report then loads this script itself). Save PDF
// makes the PDF and saves it straight away: a computer downloads it; a phone opens the share sheet (Save to Files,
// Mail…), and if the phone wants a fresh tap for that, the button says Share PDF for one more tap.
(function () {
  const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  const inline = !!document.querySelector(".page"); // the report already on the page
  const tabbed = /[?&]tab=1/.test(location.search); // a tab the app opened for it (Close closes it)
  const back = () => {
    if (inline || tabbed) { window.close(); return; }
    if (history.length > 1) history.back(); else location.href = "./";
  };
  if (!inline) {
    let html = null;
    if (tabbed) { try { html = window.opener && window.opener.__taReport; } catch { /* */ } if (html) { try { sessionStorage.setItem("ta.outlookReport", html); } catch { /* (too big to keep for a reload) */ } } }
    if (!html) { try { html = sessionStorage.getItem("ta.outlookReport"); } catch { /* */ } }
    if (!html) {
      const p = document.getElementById("ovEmpty");
      p.textContent = "This report isn't here any more. ";
      const a = document.createElement("a"); a.href = "./"; a.textContent = "Back to the app"; p.append(a);
      return;
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.title) document.title = doc.title;
    for (const st of doc.querySelectorAll("head style")) document.head.appendChild(document.importNode(st, true));
    document.body.replaceChildren(...[...doc.body.childNodes].filter((n) => n.nodeName !== "SCRIPT").map((n) => document.importNode(n, true)));
  }
  for (const b of document.querySelectorAll(".bar [onclick]")) b.removeAttribute("onclick"); // (this script handles them)
  // the bar: Save PDF and Close, nothing else
  const bar = document.querySelector(".bar");
  let save = document.getElementById("pdfBtn"), close = document.getElementById("closeBtn");
  document.getElementById("printBtn")?.remove();
  if (!save && bar) { save = document.createElement("button"); save.type = "button"; save.id = "pdfBtn"; (close ? close.before(save) : bar.append(save)); }
  if (!close && bar) { close = document.createElement("button"); close.type = "button"; close.id = "closeBtn"; bar.append(close); }
  if (!save) return;
  save.textContent = "Save PDF";
  if (close) { close.textContent = "Close"; close.addEventListener("click", back); }
  const msg = document.createElement("span"); msg.className = "pdf-msg"; msg.style.cssText = "font-size:12px;opacity:.85";
  save.after(msg);

  const loadJs = (src) => new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => ok(); s.onerror = () => no(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
  const fileName = () => `${(document.title || "Report").replace(/[·–—]/g, "-").replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").replace(/(\s*-\s*)+/g, " - ").trim() || "Report"}.pdf`;
  const phone = /iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let ready = null; // { file, blob } once made
  const download = () => {
    const url = URL.createObjectURL(ready.blob);
    const a = document.createElement("a"); a.href = url; a.download = ready.file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    msg.textContent = "Saved to your downloads";
  };
  // a phone: the share sheet; anywhere else (or no sharing): a download. Returns false when the share sheet wants a new tap.
  const deliver = async () => {
    const { file } = ready;
    if (phone && navigator.canShare && navigator.share) {
      let can = false; try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
      if (can) {
        try { await navigator.share({ files: [file], title: file.name }); msg.textContent = ""; return true; }
        catch (err) { if (err && err.name === "AbortError") return true; if (err && err.name === "NotAllowedError") return false; console.error(err); }
      }
    }
    download();
    return true;
  };
  const make = async () => {
    save.disabled = true; save.textContent = "Making the PDF…"; msg.textContent = "";
    try {
      if (!window.html2canvas) await loadJs(H2C);
      if (!(window.jspdf && window.jspdf.jsPDF)) await loadJs(JSPDF);
      document.body.classList.add("pdf-snap");
      if (bar) bar.style.visibility = "hidden";
      window.scrollTo(0, 0);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const pages = [...document.querySelectorAll(".page")];
      if (!pages.length) throw new Error("No pages");
      const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "in", format: "letter", compress: true });
      for (let i = 0; i < pages.length; i++) {
        save.textContent = `Making the PDF… ${i + 1} of ${pages.length}`;
        const c = await window.html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 1120, scrollX: 0, scrollY: -window.scrollY });
        if (i) pdf.addPage("letter", "landscape");
        pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 11, 8.5);
        c.width = 0; c.height = 0; // (the memory back)
      }
      const blob = pdf.output("blob"), name = fileName();
      let file; try { file = new File([blob], name, { type: "application/pdf" }); } catch { file = Object.assign(blob, { name }); }
      ready = { file, blob };
    } catch (err) {
      console.error(err);
      ready = null;
      msg.textContent = "Couldn't make the PDF. Check the connection and try again.";
    } finally {
      document.body.classList.remove("pdf-snap");
      if (bar) bar.style.visibility = "";
      save.disabled = false; save.textContent = "Save PDF";
    }
    if (ready && !(await deliver())) { save.textContent = "Share PDF"; msg.textContent = "PDF ready: tap Share PDF to save it"; }
  };
  save.addEventListener("click", async () => {
    if (ready && save.textContent === "Share PDF") { if (await deliver()) save.textContent = "Save PDF"; return; }
    if (ready) { await deliver(); return; }
    make();
  });
  window.scrollTo(0, 0);
})();
