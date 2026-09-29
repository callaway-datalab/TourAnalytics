import { el, mount, formatWhen, num, icon } from "../ui.js";
import { getState } from "../auth.js";
import { watchClientDatasets } from "../store.js";

export async function render(main, { previewClient }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile.clientKey;
  const teamRole = previewClient?.role || null; // set when a coach, caddy, ... is viewing a player

  const datasetsBox = el("ul", { class: "rows" });

  // Just the data: reports live on My Reports, questions on My Questions.
  mount(main, datasetsBox);

  const un1 = watchClientDatasets(clientKey, (datasets) => {
    mount(datasetsBox, datasets.length
      ? datasets.sort((a, b) => a.name.localeCompare(b.name)).map((d) => el("li", {}, [
          el("a", { class: "row-main", href: `#/data/${d.id}` }, [
            el("span", { class: "row-title" }, d.name),
            d.description ? el("span", { class: "muted" }, d.description) : null,
          ]),
          el("span", { class: "row-meta" }, [num(d.rowCount) + " rows", el("br"), el("span", { class: "muted" }, `Updated ${formatWhen(d.uploadedAt)}`)]),
        ]))
      : el("p", { class: "empty" }, teamRole ? "No data has been added for this player yet."
          : "No data has been added to your account yet. It will appear here as soon as it's uploaded."));
  });

  return un1;
}
