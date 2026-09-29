import { el, mount, formatWhen } from "../ui.js";
import { watchAdminThreads } from "../store.js";
import { threadActions } from "../threadActions.js";

export async function render(main, { flash }) {
  const list = el("ul", { class: "rows" });
  const archivedList = el("ul", { class: "rows" });

  mount(main, [
    el("header", { class: "page-head row-head" }, [
      el("div", {}, [el("h1", {}, "Questions"), el("p", { class: "muted" }, "Waiting-for-reply conversations are listed first.")]),
    ]),
    list,
    el("section", {}, [el("h2", {}, "Archived questions"),
      el("p", { class: "muted" }, "Questions marked as completed, by you or the player. A new message moves one back up."), archivedList]),
  ]);

  const unsub = watchAdminThreads((threads) => {
    const row = (t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/admin/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `${t.askerName} \u00b7 client ${t.clientLabel}`),
      ]),
      el("span", { class: "row-meta" }, [
        t.sample ? el("span", { class: "tag muted-tag" }, "Sample") : null, t.sample ? " " : null,
        t.archived ? el("span", { class: "tag muted-tag" }, "Completed")
          : t.adminUnread ? el("span", { class: "tag hot" }, "New")
          : !t.lastFromAdmin ? el("span", { class: "tag" }, "Needs reply")
          : el("span", { class: "tag muted-tag" }, "Answered"),
        el("br"), el("span", { class: "muted" }, formatWhen(t.updatedAt)),
        el("br"), threadActions(t, { asAdmin: true, flash }),
      ]),
    ]);
    const active = threads.filter((t) => !t.archived)
      .sort((a, b) => (a.adminUnread === b.adminUnread ? 0 : a.adminUnread ? -1 : 1));
    const archived = threads.filter((t) => t.archived);
    mount(list, active.length ? active.map(row)
      : el("p", { class: "empty" }, "No open questions. New ones appear here and in the alert badge."));
    mount(archivedList, archived.length ? archived.map(row) : el("p", { class: "empty" }, "Nothing archived yet."));
  });
  return unsub;
}
