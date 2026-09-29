import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchMyThreads, watchSharedWithMe } from "../store.js";

export async function render(main, { previewClient }) {
  const state = getState();
  // The admin previewing a player sees the sample questions they've sent from this preview.
  const adminPreview = state.isAdmin && previewClient;
  const list = el("ul", { class: "rows" });
  // Team members also see questions their players shared with them.
  const sharedList = el("ul", { class: "rows" });
  const sharedSection = state.isTeam
    ? el("section", {}, [el("h2", {}, "Shared with you by your players"), sharedList])
    : null;

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, "My Questions"),
      el("p", { class: "muted" }, adminPreview
        ? `Sample questions you've sent while previewing ${previewClient.label}. They go to your own inbox; ${previewClient.label} never sees them.`
        : "Ask about your data or reports. The reply arrives here."),
      el("p", {}, el("a", { class: "btn", href: "#/questions/new" }, adminPreview ? "Send a sample question" : "Ask a question")),
    ]),
    list,
    sharedSection,
  ]);

  const unsub = watchMyThreads(state.user.uid, (all) => {
    const threads = adminPreview ? all.filter((t) => t.sample && t.clientKey === previewClient.key) : all;
    mount(list, threads.length ? threads.map((t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `Last activity ${formatWhen(t.updatedAt)}`),
      ]),
      el("span", { class: "row-meta" },
        t.userUnread ? el("span", { class: "tag hot" }, "New reply")
        : el("span", { class: "tag" + (t.lastFromAdmin ? "" : " muted-tag") }, t.lastFromAdmin ? "Answered" : "Waiting for reply")),
    ])) : el("p", { class: "empty" }, adminPreview ? "No sample questions yet." : "You haven't asked anything yet."));
  });
  const unShared = state.isTeam
    ? watchSharedWithMe(Object.keys(state.teamAccess || {}), state.user.email, (items) => {
      mount(sharedList, items.length ? items.map((t) => el("li", {}, [
        el("a", { class: "row-main", href: `#/questions/${t.id}` }, [
          el("span", { class: "row-title" }, t.subject),
          el("span", { class: "muted" }, `From ${t.askerName} (${t.clientLabel}) \u00b7 ${formatWhen(t.createdAt)}`),
        ]),
      ])) : el("p", { class: "empty" }, "Nothing shared with you yet."));
    })
    : () => {};
  return () => { unsub(); unShared(); };
}
