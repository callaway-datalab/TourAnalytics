import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchDocumentsFor, getDocumentBlobUrl } from "../store.js";
import { REPORT_CATEGORIES, reportCategory } from "../data.js";

export async function render(main, { previewClient, flash }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile.clientKey;
  // One list per report type: Performance Reports, then Course Reports.
  const lists = new Map(REPORT_CATEGORIES.map(([cat]) => [cat, el("ul", { class: "rows" })]));

  mount(main, [
    ...REPORT_CATEGORIES.map(([cat, label]) => el("section", {}, [el("h2", {}, label), lists.get(cat)])),
  ]);

  const openFile = async (doc, link) => {
    if (link.dataset.busy) return;
    link.dataset.busy = "1";
    const original = link.textContent;
    link.textContent = "Opening\u2026";
    try {
      const url = await getDocumentBlobUrl(doc);
      const isPdf = doc.mimeType === "application/pdf";
      if (isPdf) {
        window.open(url, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = doc.originalName;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
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
