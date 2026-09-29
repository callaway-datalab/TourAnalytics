// Reports → View: pick a player and see every report they can see, by type.
import { el, mount, formatWhen, subNav } from "../ui.js";
import { adminAllClients, watchVisibleDocuments, getDocumentBlobUrl } from "../store.js";
import { REPORT_CATEGORIES, reportCategory, roleLabel } from "../data.js";
import { playerPicker } from "../playerPicker.js";

export async function render(main, { flash }) {
  const results = el("div");
  const pickerBox = el("div");
  mount(main, [
    subNav([["#/admin/documents", "Upload"], ["#/admin/reports/view", "View"]], "#/admin/reports/view"),
    pickerBox,
    results,
  ]);

  let unsub = () => {};
  const open = async (d, link) => {
    const original = link.textContent;
    link.textContent = "Opening\u2026";
    try {
      const url = await getDocumentBlobUrl(d);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { flash("Couldn't open that report.", "error"); }
    finally { link.textContent = original; }
  };

  const show = (player) => {
    unsub(); unsub = () => {};
    if (!player) { mount(results, el("p", { class: "empty center" }, "Choose a player to see every report they've been sent.")); return; }
    mount(results, el("p", { class: "empty center" }, "Loading\u2026"));
    unsub = watchVisibleDocuments(player.key, (docs) => {
      mount(results, [
        el("p", { class: "muted center" }, `${docs.length} ${docs.length === 1 ? "report" : "reports"} visible to ${player.label}, exactly as they see them on My Reports.`),
        ...REPORT_CATEGORIES.map(([cat, label]) => {
          const items = docs.filter((d) => reportCategory(d) === cat);
          return el("section", {}, [el("h2", {}, label), items.length
            ? el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
                el("thead", {}, el("tr", {}, ["Report", "Sent to", "Uploaded"].map((h) => el("th", {}, h)))),
                el("tbody", {}, items.map((d) => {
                  const link = el("a", { href: "#" }, el("strong", {}, d.title));
                  link.addEventListener("click", (e) => { e.preventDefault(); open(d, link); });
                  return el("tr", {}, [
                    el("td", {}, [link, d.description ? el("div", { class: "muted" }, d.description) : null]),
                    el("td", {}, d.audienceClientKey
                      ? `${player.label}${(d.teamRoles || []).length ? ` + their ${d.teamRoles.map((r) => roleLabel(r).toLowerCase()).join(", ")}` : " only"}`
                      : "Everyone"),
                    el("td", {}, formatWhen(d.uploadedAt)),
                  ]);
                })),
              ]))
            : el("p", { class: "empty" }, `No ${label.toLowerCase()} for ${player.label}.`)]);
        }),
      ]);
    });
  };

  const { labels } = await adminAllClients();
  const picker = playerPicker(labels, show);
  mount(pickerBox, picker.node);
  show(null);
  picker.restore();
  return () => unsub();
}
