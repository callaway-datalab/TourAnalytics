// Reports → View: pick a player and see every report they can see, by type.
import { el, mount, formatWhen, subNav, openTabNow } from "../ui.js";
import { adminAllClients, watchVisibleDocuments, watchEveryoneDocuments, getDocumentBlobUrl } from "../store.js";
import { REPORT_CATEGORIES, reportCategory, roleLabel, ANALYST_ROLE } from "../data.js";
import { playerPicker } from "../playerPicker.js";
import { reportBuilder } from "../reportGen.js";

export async function render(main, { flash }) {
  const results = el("div");
  const pickerBox = el("div");
  mount(main, [
    subNav([["#/admin/reports/view", "View"], ["#/admin/documents", "Upload"]], "#/admin/reports/view"),
    pickerBox,
    results,
  ]);

  let unsub = () => {};
  const open = async (d, link) => {
    const original = link.textContent;
    const tab = openTabNow(); // on the tap, so phones allow it
    link.textContent = "Opening\u2026";
    try {
      const url = await getDocumentBlobUrl(d);
      tab.show(url, d.originalName || "report.pdf");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { tab.close(); flash("Couldn't open that report.", "error"); }
    finally { link.textContent = original; }
  };

  let builder = null; // "Auto-generate report" for the picked player (kept across list updates)
  const show = (player) => {
    unsub(); unsub = () => {};
    builder = player ? reportBuilder({ playerKey: player.key, playerLabel: player.label, canSave: true, flash }) : null;
    mount(results, el("p", { class: "empty center" }, "Loading\u2026"));
    // No player picked: the reports shared with everyone. A player: everything they can see.
    const watch = player ? (cb) => watchVisibleDocuments(player.key, cb) : watchEveryoneDocuments;
    unsub = watch((docs) => {
      mount(results, [
        el("p", { class: "muted center" }, player
          ? `${docs.length} ${docs.length === 1 ? "report" : "reports"} visible to ${player.label}, exactly as they see them on My Reports.`
          : `${docs.length} ${docs.length === 1 ? "report" : "reports"} shared with everyone. Pick a player to see everything they've been sent.`),
        ...REPORT_CATEGORIES.map(([cat, label]) => {
          const items = docs.filter((d) => reportCategory(d) === cat);
          return el("section", {}, [el("h2", {}, label), cat === "performance" ? builder : null, items.length
            ? el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
                el("thead", {}, el("tr", {}, ["Report", "Sent to", "Uploaded"].map((h) => el("th", {}, h)))),
                el("tbody", {}, items.map((d) => {
                  const link = el("a", { href: "#" }, el("strong", {}, d.title));
                  link.addEventListener("click", (e) => { e.preventDefault(); open(d, link); });
                  const team = (d.teamRoles || []).filter((r) => r !== ANALYST_ROLE);
                  return el("tr", {}, [
                    el("td", {}, [link, d.description ? el("div", { class: "muted" }, d.description) : null]),
                    el("td", {}, d.audienceClientKey
                      ? `${player?.label}${team.length ? ` + their ${team.map((r) => roleLabel(r).toLowerCase()).join(", ")}` : " only"}`
                      : "Everyone"),
                    el("td", {}, formatWhen(d.uploadedAt)),
                  ]);
                })),
              ]))
            : el("p", { class: "empty" }, player ? `No ${label.toLowerCase()} for ${player.label}.` : `No ${label.toLowerCase()} shared with everyone.`)]);
        }),
      ]);
    });
  };

  const { labels, ids } = await adminAllClients();
  const picker = playerPicker(labels, show, ids);
  mount(pickerBox, picker.node);
  show(null);
  picker.restore();
  return () => unsub();
}
