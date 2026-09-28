import { el, mount, formatWhen, confirmAction } from "../ui.js";
import { watchAdminDocuments, uploadDocument, deleteDocumentFile, getDocumentBlobUrl, adminAllClients } from "../store.js";
import { MAX_DOC_BYTES, readableSize } from "../data.js";

export async function render(main, { flash }) {
  const file = el("input", { type: "file", accept: ".pdf,.ppt,.pptx", required: true });
  const title = el("input", { placeholder: "Defaults to the file name" });
  const description = el("input", { maxLength: 200 });
  const audience = el("select", {}, el("option", { value: "" }, "Everyone"));
  const submit = el("button", { class: "btn", type: "submit" }, "Upload document");
  const listBox = el("div");

  let clientLabels = new Map();
  adminAllClients().then(({ labels }) => {
    clientLabels = labels;
    mount(audience, [el("option", { value: "" }, "Everyone"),
      ...[...labels.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => el("option", { value: key }, `Only ${label}`))]);
  });

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      const f = file.files[0];
      if (!f) { flash("Choose a PDF or PowerPoint file.", "error"); return; }
      const ext = f.name.toLowerCase().split(".").pop();
      if (!["pdf", "ppt", "pptx"].includes(ext)) { flash("Documents must be .pdf, .ppt or .pptx.", "error"); return; }
      if (f.size > MAX_DOC_BYTES) { flash(`That file is larger than the ${readableSize(MAX_DOC_BYTES)} limit for this portal.`, "error"); return; }

      submit.disabled = true; submit.textContent = "Uploading\u2026";
      try {
        await uploadDocument({ title: title.value.trim() || f.name.replace(/\.[^.]+$/, ""), description: description.value.trim(), audienceClientKey: audience.value || null, file: f });
        flash("Document uploaded.", "ok");
        form.reset();
      } catch {
        flash("Couldn't upload that file. Try again.", "error");
      } finally {
        submit.disabled = false; submit.textContent = "Upload document";
      }
    },
  }, [
    el("label", {}, ["File (.pdf, .pptx or .ppt)", file]),
    el("label", {}, ["Title", title]),
    el("label", {}, ["Description (optional)", description]),
    el("label", {}, ["Who can see it", audience]),
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, "Documents"),
      el("p", { class: "muted" }, "Share PDFs and PowerPoint files with everyone, or with one client."),
    ]),
    el("section", {}, [el("h2", {}, "Upload a document"), form]),
    el("section", {}, [el("h2", {}, "Library"), listBox]),
  ]);

  const unsub = watchAdminDocuments((docs) => {
    if (!docs.length) { mount(listBox, el("p", { class: "empty" }, "No documents yet.")); return; }
    mount(listBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Title", "File", "Visible to", "Uploaded", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, docs.map((d) => {
        const openLink = el("a", { href: "#" }, el("strong", {}, d.title));
        openLink.addEventListener("click", async (e) => {
          e.preventDefault();
          openLink.textContent = "Opening\u2026";
          try {
            const url = await getDocumentBlobUrl(d);
            window.open(url, "_blank", "noopener");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch { flash("Couldn't open that file.", "error"); }
          finally { mount(openLink, el("strong", {}, d.title)); }
        });
        const del = el("button", { class: "link danger", type: "button" }, "Delete");
        del.addEventListener("click", async () => {
          if (!confirmAction(`Delete "${d.title}"?`)) return;
          del.disabled = true;
          try { await deleteDocumentFile(d.id); flash(`Deleted "${d.title}".`, "ok"); }
          catch { flash("Couldn't delete that document.", "error"); del.disabled = false; }
        });
        return el("tr", {}, [
          el("td", {}, openLink), el("td", {}, d.originalName),
          el("td", {}, d.audienceClientKey ? (clientLabels.get(d.audienceClientKey) || d.audienceClientKey.replace(/^c_/, "")) : "Everyone"),
          el("td", {}, formatWhen(d.uploadedAt)), el("td", { class: "actions" }, del),
        ]);
      })),
    ])));
  });
  return unsub;
}
