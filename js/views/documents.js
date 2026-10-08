import { el, mount, formatWhen, openTabNow } from "../ui.js";
import { getState } from "../auth.js";
import { watchDocumentsFor, getDocumentBlobUrl } from "../store.js";
import { REPORT_CATEGORIES, reportCategory } from "../data.js";
import { teamPlayerSelect } from "../teamPlayerSelect.js";
import { reportBuilder } from "../reportGen.js";

export async function render(main, { previewClient, flash, only = "performance" }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile?.clientKey;
  if (!clientKey) return; // signed out or profile gone mid-navigation
  // One list per report type: Performance Reports, then Course Reports.
  const lists = new Map(REPORT_CATEGORIES.map(([cat]) => [cat, el("ul", { class: "rows" })]));

  // "Auto-generate report" under Performance Reports (for a player's own data; only the admin can save it to their reports)
  const playerLabel = previewClient?.label || state.profile?.name || "Player";
  const builder = clientKey.startsWith("c_") ? reportBuilder({ playerKey: clientKey, playerLabel, canSave: state.isAdmin, flash }) : null;
  mount(main, [
    teamPlayerSelect(previewClient, only === "course" ? "/course-reports" : "/documents"),
    // Performance Reports (under Data) or Course Reports (under Planning): one list each
    ...REPORT_CATEGORIES.filter(([cat]) => cat === only).map(([cat, label]) => el("section", {}, [el("h2", {}, label), cat === "performance" ? builder : null, lists.get(cat)])),
  ]);

  const openFile = async (doc, link) => {
    if (link.dataset.busy) return;
    link.dataset.busy = "1";
    const original = link.textContent;
    const isPdf = doc.mimeType === "application/pdf";
    const tab = isPdf ? openTabNow() : null; // on the tap, so phones allow it
    link.textContent = "Opening\u2026";
    try {
      const url = await getDocumentBlobUrl(doc);
      if (isPdf) {
        tab.show(url, doc.originalName || "report.pdf");
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = doc.originalName;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      tab?.close();
      flash("Couldn't open that file. Try again.", "error");
    } finally {
      link.textContent = original;
      delete link.dataset.busy;
    }
  };

  const row = (d) => {
    const isPdf = d.mimeType === "application/pdf";
    const link = el("a", { class: "row-main", href: "#" }, [
      el("span", { class: "row-title" }, d.title),
      d.description ? el("span", { class: "muted" }, d.description) : null,
    ]);
    link.addEventListener("click", (e) => { e.preventDefault(); openFile(d, link); });
    return el("li", {}, [
      link,
      el("span", { class: "row-meta" }, [el("span", { class: "tag" }, isPdf ? "PDF" : "PowerPoint"), el("br"), el("span", { class: "muted" }, formatWhen(d.uploadedAt))]),
    ]);
  };
  const unsub = watchDocumentsFor(clientKey, previewClient?.role || null, (docs) => {
    for (const [cat, label] of REPORT_CATEGORIES) {
      const items = docs.filter((d) => reportCategory(d) === cat);
      mount(lists.get(cat), items.length ? items.map(row) : el("p", { class: "empty" }, `No ${label.toLowerCase()} yet.`));
    }
  });

  return unsub;
}
