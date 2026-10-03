// Attach-files control and attachment links for questions and replies.
import { el, mount, openTabNow } from "./ui.js";
import { readableSize, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "./data.js";
import { getAttachmentBlobUrl } from "./store.js";

/** A file picker that collects up to MAX_ATTACHMENTS files. */
export function attachPicker() {
  let files = [];
  const input = el("input", { type: "file", multiple: true, class: "visually-hidden" });
  const list = el("ul", { class: "attach-list" });
  const draw = () => mount(list, files.map((f, i) => el("li", {}, [
    el("span", {}, `\u{1F4CE} ${f.name}`), el("span", { class: "muted" }, readableSize(f.size)),
    el("button", { class: "link danger", type: "button", title: `Remove ${f.name}`, onClick: () => { files.splice(i, 1); draw(); } }, "\u00d7"),
  ])));
  input.addEventListener("change", () => {
    files = [...files, ...input.files].slice(0, MAX_ATTACHMENTS);
    input.value = "";
    draw();
  });
  const node = el("div", { class: "attach" }, [
    el("label", { class: "btn ghost attach-btn" }, ["Attach files", input]),
    el("span", { class: "muted" }, ` Optional. Up to ${MAX_ATTACHMENTS} files, ${readableSize(MAX_ATTACHMENT_BYTES)} each.`),
    list,
  ]);
  return { node, files: () => files, clear: () => { files = []; draw(); } };
}

/** Clickable chips for a message's attachments. Images and PDFs open in a new tab; others download. */
export function attachmentLinks(threadId, attachments, flash) {
  if (!attachments?.length) return null;
  return el("ul", { class: "attach-list in-message" }, attachments.map((att) => {
    const link = el("a", { href: "#" }, `\u{1F4CE} ${att.name}`);
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      if (link.dataset.busy) return;
      link.dataset.busy = "1";
      const original = link.textContent;
      const viewable = att.mimeType === "application/pdf" || att.mimeType.startsWith("image/");
      const tab = viewable ? openTabNow() : null; // on the tap, so phones allow it
      link.textContent = "Opening\u2026";
      try {
        const url = await getAttachmentBlobUrl(threadId, att);
        if (viewable) {
          tab.show(url, att.name);
        } else {
          const a = el("a", { href: url, download: att.name });
          document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch {
        tab?.close();
        flash("Couldn't open that attachment. Try again.", "error");
      } finally {
        link.textContent = original;
        delete link.dataset.busy;
      }
    });
    return el("li", {}, [link, el("span", { class: "muted" }, readableSize(att.sizeBytes))]);
  }));
}
