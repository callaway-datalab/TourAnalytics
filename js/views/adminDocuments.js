import { el, mount, formatWhen, confirmAction } from "../ui.js";
import { watchAdminDocuments, uploadDocument, deleteDocumentFile, getDocumentBlobUrl, adminAllClients, getTeamRoster, uploadErrorMessage } from "../store.js";
import { MAX_DOC_BYTES, readableSize, DEFAULT_ROLES, roleLabel } from "../data.js";

export async function render(main, { flash }) {
  const file = el("input", { type: "file", accept: ".pdf,.ppt,.pptx", required: true });
  const title = el("input", { placeholder: "Defaults to the file name" });
  const description = el("input", { maxLength: 200 });
  const audience = el("select", {}, el("option", { value: "" }, "Everyone"));
  const submit = el("button", { class: "btn", type: "submit" }, "Upload document");
  const listBox = el("div");

  // "Also share with their team": one checkbox per role, shown once a single player is chosen.
  // Next to each role we name who on that player's team currently holds it.
  const teamBox = el("fieldset", { class: "check-group", hidden: true });
  let teamByPlayer = new Map(); // playerKey -> Map(role -> [names])
  const drawTeamChecks = () => {
    const key = audience.value;
    teamBox.hidden = !key;
    if (!key) return;
    const onTeam = teamByPlayer.get(key) || new Map();
    const roles = [...new Set([...onTeam.keys(), ...DEFAULT_ROLES])];
    mount(teamBox, [
      el("legend", {}, "Also let their team see it"),
      el("p", { class: "muted", style: "margin:0 0 .3rem" }, "Leave everything unticked to share with the player only."),
      ...roles.map((r) => el("label", {}, [
        el("input", { type: "checkbox", value: r }),
        roleLabel(r),
        onTeam.get(r) ? el("span", { class: "muted" }, ` (${onTeam.get(r).join(", ")})`) : el("span", { class: "muted" }, " (nobody yet)"),
      ])),
    ]);
  };
  audience.addEventListener("change", drawTeamChecks);

  let clientLabels = new Map();
  // Who is on each player's team comes from the uploaded team roster.
  getTeamRoster().then(({ entries = [] }) => {
    teamByPlayer = new Map();
    for (const e of entries) {
      if (!teamByPlayer.has(e.playerKey)) teamByPlayer.set(e.playerKey, new Map());
      const m = teamByPlayer.get(e.playerKey);
      if (!m.has(e.role)) m.set(e.role, []);
      m.get(e.role).push(e.name);
    }
    drawTeamChecks();
  }).catch(() => {});
  adminAllClients().then(({ labels }) => {
    clientLabels = labels;
    mount(audience, [el("option", { value: "" }, "Everyone"),
      ...[...labels.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => el("option", { value: key }, label))]);
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
        const teamRoles = audience.value ? [...teamBox.querySelectorAll("input:checked")].map((c) => c.value) : [];
        const onProgress = (done, total) => { submit.textContent = `Uploading\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`; };
        await uploadDocument({ title: title.value.trim() || f.name.replace(/\.[^.]+$/, ""), description: description.value.trim(), audienceClientKey: audience.value || null, teamRoles, file: f, onProgress });
        flash("Document uploaded.", "ok");
        form.reset(); drawTeamChecks();
      } catch (err) {
        flash(uploadErrorMessage(err, "that document"), "error");
      } finally {
        submit.disabled = false; submit.textContent = "Upload document";
      }
    },
  }, [
    el("label", {}, ["File (.pdf, .pptx or .ppt)", file]),
    el("label", {}, ["Title", title]),
    el("label", {}, ["Description (optional)", description]),
    el("label", {}, ["Who can see it", audience]),
    teamBox,
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, "Documents"),
      el("p", { class: "muted" }, "Share PDFs and PowerPoint files with everyone, or with one player and, if you choose, members of their team."),
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
          el("td", {}, d.audienceClientKey
            ? (clientLabels.get(d.audienceClientKey) || d.audienceClientKey.replace(/^c_/, ""))
              + ((d.teamRoles || []).length ? ` + their ${d.teamRoles.map((r) => roleLabel(r).toLowerCase()).join(", ")}` : " only")
            : "Everyone"),
          el("td", {}, formatWhen(d.uploadedAt)), el("td", { class: "actions" }, del),
        ]);
      })),
    ])));
  });
  return unsub;
}
