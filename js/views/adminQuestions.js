import { el, mount, formatWhen } from "../ui.js";
import { watchAdminThreads } from "../store.js";

export async function render(main) {
  const list = el("ul", { class: "rows" });

  mount(main, [
    el("header", { class: "page-head row-head" }, [
      el("div", {}, [el("h1", {}, "Questions"), el("p", { class: "muted" }, "Waiting-for-reply conversations are listed first.")]),
    ]),
    list,
  ]);

  const unsub = watchAdminThreads((threads) => {
    const sorted = [...threads].sort((a, b) => (a.adminUnread === b.adminUnread ? 0 : a.adminUnread ? -1 : 1));
    mount(list, sorted.length ? sorted.map((t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/admin/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `${t.askerName} \u00b7 client ${t.clientLabel}`),
      ]),
      el("span", { class: "row-meta" }, [
        t.adminUnread ? el("span", { class: "tag hot" }, "New")
          : !t.lastFromAdmin ? el("span", { class: "tag" }, "Needs reply")
          : el("span", { class: "tag muted-tag" }, "Answered"),
        el("br"), el("span", { class: "muted" }, formatWhen(t.updatedAt)),
      ]),
    ])) : el("p", { class: "empty" }, "No questions yet. New ones appear here and in the alert badge."));
  });
  return unsub;
}
