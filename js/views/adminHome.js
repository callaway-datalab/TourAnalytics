import { el, mount, formatWhen, num } from "../ui.js";
import { watchAdminThreads, adminStats } from "../store.js";

export async function render(main) {
  const waitingBox = el("ul", { class: "rows" });
  const statsBox = el("dl", { class: "facts" }, el("p", { class: "muted" }, "Loading\u2026"));
  const gettingStarted = el("div");

  mount(main, [
    el("header", { class: "page-head" }, el("h1", {}, "Overview")),
    el("section", {}, [
      el("div", { class: "section-head" }, [el("h2", {}, "Waiting for you"), el("a", { href: "#/admin/questions" }, "Open inbox")]),
      waitingBox,
    ]),
    el("section", {}, [el("h2", {}, "At a glance"), statsBox]),
    gettingStarted,
  ]);

  adminStats().then((stats) => {
    mount(statsBox, [
      ["People in your data", stats.clients], ["Accounts created", stats.accounts], ["Unused access codes", stats.openInvites],
      ["Data files", stats.datasets], ["Documents", stats.documents],
    ].map(([label, value]) => el("div", {}, [el("dt", {}, label), el("dd", {}, num(value))])));

    if (!stats.datasets) {
      mount(gettingStarted, el("section", {}, [
        el("h2", {}, "Getting started"),
        el("ol", { class: "plain-steps" }, [
          el("li", {}, [el("a", { href: "#/admin/datasets" }, "Upload a CSV or Parquet file"), " with one column that says who each row belongs to."]),
          el("li", {}, [el("a", { href: "#/admin/clients" }, "Create an access code"), " for each person, using the value from that column."]),
          el("li", {}, "Send them the code and the sign-up link. They'll only ever see their own rows."),
        ]),
      ]));
    }
  }).catch(() => mount(statsBox, el("p", { class: "empty" }, "Couldn't load the summary.")));

  const unsub = watchAdminThreads((threads) => {
    const waiting = threads.filter((t) => t.adminUnread).slice(0, 8);
    mount(waitingBox, waiting.length ? waiting.map((t) => el("li", {}, [
      el("a", { class: "row-main", href: `#/admin/questions/${t.id}` }, [
        el("span", { class: "row-title" }, t.subject),
        el("span", { class: "muted" }, `${t.askerName} \u00b7 client ${t.clientLabel}`),
      ]),
      el("span", { class: "row-meta" }, [el("span", { class: "tag hot" }, "New"), el("br"), el("span", { class: "muted" }, formatWhen(t.updatedAt))]),
    ])) : el("p", { class: "empty" }, "No unread questions."));
  });
  return unsub;
}
