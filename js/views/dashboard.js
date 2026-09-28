import { el, mount, formatWhen, num, icon } from "../ui.js";
import { getState } from "../auth.js";
import { watchClientDatasets, watchVisibleDocuments, watchMyThreads } from "../store.js";

export async function render(main, { previewClient }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile.clientKey;
  const firstName = (state.profile?.name || "").split(" ")[0];

  const datasetsBox = el("ul", { class: "rows" });
  const docsBox = el("ul", { class: "rows" });
  const questionsSection = previewClient ? null : el("section", {}, [
    el("div", { class: "section-head" }, [el("h2", {}, "Your questions"), el("a", { href: "#/questions/new" }, "Ask a question")]),
    el("ul", { class: "rows" }),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, previewClient ? "Client view" : `Hello, ${firstName}`),
      el("p", { class: "muted" }, "Everything on this page belongs to you and is private to your account."),
    ]),
    el("section", {}, [el("h2", {}, "Your data"), datasetsBox]),
    el("section", {}, [
      el("div", { class: "section-head" }, [el("h2", {}, "Latest documents"), el("a", { href: "#/documents" }, "See all documents")]),
      docsBox,
    ]),
    questionsSection,
  ]);

  const un1 = watchClientDatasets(clientKey, (datasets) => {
    mount(datasetsBox, datasets.length
      ? datasets.sort((a, b) => a.name.localeCompare(b.name)).map((d) => el("li", {}, [
          el("a", { class: "row-main", href: `#/data/${d.id}` }, [
            el("span", { class: "row-title" }, d.name),
            d.description ? el("span", { class: "muted" }, d.description) : null,
          ]),
          el("span", { class: "row-meta" }, [num(d.rowCount) + " rows", el("br"), el("span", { class: "muted" }, `Updated ${formatWhen(d.uploadedAt)}`)]),
        ]))
      : el("p", { class: "empty" }, "No data has been added to your account yet. It will appear here as soon as it's uploaded."));
  });

  const un2 = watchVisibleDocuments(clientKey, (docs) => {
    const latest = docs.slice(0, 4);
    mount(docsBox, latest.length
      ? latest.map((d) => el("li", {}, [
          el("a", { class: "row-main", href: `#/documents` }, [
            el("span", { class: "row-title" }, d.title),
            d.description ? el("span", { class: "muted" }, d.description) : null,
          ]),
          el("span", { class: "row-meta" }, el("span", { class: "tag" }, d.originalName.split(".").pop().toUpperCase())),
        ]))
      : el("p", { class: "empty" }, "No documents yet."));
  });

  let un3 = () => {};
  if (questionsSection) {
    const list = questionsSection.querySelector("ul");
    un3 = watchMyThreads(state.user.uid, (threads) => {
      const latest = threads.slice(0, 4);
      mount(list, latest.length
        ? latest.map((t) => el("li", {}, [
            el("a", { class: "row-main", href: `#/questions/${t.id}` }, el("span", { class: "row-title" }, t.subject)),
            el("span", { class: "row-meta" }, t.userUnread ? el("span", { class: "tag hot" }, "New reply") : null),
          ]))
        : el("p", { class: "empty" }, ["Have a question about your numbers? ", el("a", { href: "#/questions/new" }, "Send it here"), " and you'll get a reply in this portal."]));
    });
  }

  return () => { un1(); un2(); un3(); };
}
