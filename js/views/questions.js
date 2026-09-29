import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchMyThreads, watchSharedWithMe } from "../store.js";
import { threadActions } from "../threadActions.js";

export async function render(main, { previewClient, flash }) {
  const state = getState();
  // The admin previewing a player sees the sample questions they've sent from this preview.
  const adminPreview = state.isAdmin && previewClient;
  const list = el("ul", { class: "rows" });
  const archivedList = el("ul", { class: "rows" });
  // Archived questions: collapsed until opened. Created once, so it stays open or closed as the lists update.
  const archivedCount = el("span", { class: "muted" });
  const archived = el("details", { class: "archive" }, [
    el("summary", {}, ["Archived questions ", archivedCount]),
    el("p", { class: "muted" }, "Completed questions. A new message on one moves it back up."),
    archivedList,
  ]);
  // Team members also see questions their players shared with them.
  const sharedList = el("ul", { class: "rows" });
  const sharedSection = state.isTeam
    ? el("section", {}, [el("h2", {}, "Shared with you by your players"), sharedList])
    : null;

  mount(main, [
    el("div", { class: "page-actions" }, [
      el("a", { class: "btn", href: "#/questions/new" }, "Ask a new question"),
      adminPreview ? el("p", { class: "muted" },
        `Questions you ask while previewing ${previewClient.label} are samples: they go to your own inbox, and ${previewClient.label} never sees them.`) : null,
    ]),
    list,
    archived,
    sharedSection,
  ]);

  const unsub = watchMyThreads(state.user.uid, (all) => {
    const threads = adminPreview ? all.filter((t) => t.sample && t.clientKey === previewClient.key) : all;
    const row = (t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `Last activity ${formatWhen(t.updatedAt)}`),
      ]),
      el("span", { class: "row-meta" }, [
        t.archived ? el("span", { class: "tag muted-tag" }, "Completed")
        : t.userUnread ? el("span", { class: "tag hot" }, "New reply")
        : el("span", { class: "tag" + (t.lastFromAdmin ? "" : " muted-tag") }, t.lastFromAdmin ? "Answered" : "Waiting for reply"),
        el("br"),
        threadActions(t, { asAdmin: false, flash }),
      ]),
    ]);
    const active = threads.filter((t) => !t.archived), done = threads.filter((t) => t.archived);
    archivedCount.textContent = `(${done.length})`;
    mount(list, active.length ? active.map(row)
      : el("p", { class: "empty" }, adminPreview ? "No sample questions yet." : threads.length ? "No open questions." : "You haven't asked anything yet."));
    mount(archivedList, done.length ? done.map(row) : el("p", { class: "empty" }, "Nothing archived yet."));
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
