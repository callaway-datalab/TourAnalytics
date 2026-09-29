import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchDocumentsFor, getDocumentBlobUrl } from "../store.js";

export async function render(main, { previewClient, flash }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile.clientKey;
  const list = el("ul", { class: "rows" });

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, previewClient?.role ? `${previewClient.label}: Reports` : "My Reports"),
      el("p", { class: "muted" }, "PDFs open in a new tab. PowerPoint files download to your computer."),
    ]),
    list,
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

  const unsub = watchDocumentsFor(clientKey, previewClient?.role || null, (docs) => {
    mount(list, docs.length ? docs.map((d) => {
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
    }) : el("p", { class: "empty" }, "No reports have been shared with you yet."));
  });

  return unsub;
}
