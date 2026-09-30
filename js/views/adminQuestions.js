import { el, mount, formatWhen } from "../ui.js";
import { watchAdminThreads, adminAllClients } from "../store.js";
import { threadActions } from "../threadActions.js";

export async function render(main, { flash }) {
  const list = el("ul", { class: "rows" });
  const archivedList = el("ul", { class: "rows" });
  const archivedCount = el("span", { class: "muted" });

  mount(main, [
    list,
    el("details", { class: "archive" }, [
      el("summary", {}, ["Archived questions ", archivedCount]),
      el("p", { class: "muted" }, "Questions marked as completed, by you or the player. A new message moves one back up."),
      archivedList,
    ]),
  ]);

  // Show players by name (the ID when the data has no name).
  let names = new Map();
  let lastThreads = null;
  adminAllClients().then(({ labels }) => { names = labels; if (lastThreads) draw(lastThreads); }).catch(() => {});
  const unsub = watchAdminThreads((threads) => { lastThreads = threads; draw(threads); });
  function draw(threads) {
    const row = (t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/admin/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, t.aboutLabel ? `${t.askerName} \u00b7 about ${names.get(t.aboutKey) || t.aboutLabel}` : `${t.askerName} \u00b7 ${names.get(t.clientKey) || t.clientLabel}`),
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
    archivedCount.textContent = `(${archived.length})`;
    mount(list, active.length ? active.map(row)
      : el("p", { class: "empty" }, "No open questions. New ones appear here and in the alert badge."));
    mount(archivedList, archived.length ? archived.map(row) : el("p", { class: "empty" }, "Nothing archived yet."));
  }

  return unsub;
}
