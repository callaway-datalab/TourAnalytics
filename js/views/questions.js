import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchMyThreads } from "../store.js";

export async function render(main) {
  const state = getState();
  const list = el("ul", { class: "rows" });

  mount(main, [
    el("header", { class: "page-head row-head" }, [
      el("div", {}, [el("h1", {}, "Questions"), el("p", { class: "muted" }, "Ask about your data or documents. The reply arrives here.")]),
      el("a", { class: "btn", href: "#/questions/new" }, "Ask a question"),
    ]),
    list,
  ]);

  const unsub = watchMyThreads(state.user.uid, (threads) => {
    mount(list, threads.length ? threads.map((t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `Last activity ${formatWhen(t.updatedAt)}`),
      ]),
      el("span", { class: "row-meta" },
        t.userUnread ? el("span", { class: "tag hot" }, "New reply")
        : el("span", { class: "tag" + (t.lastFromAdmin ? "" : " muted-tag") }, t.lastFromAdmin ? "Answered" : "Waiting for reply")),
    ])) : el("p", { class: "empty" }, "You haven't asked anything yet."));
  });
  return unsub;
}
