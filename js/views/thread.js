import { isTeamKey } from "../data.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchThread, watchMessages, replyToThread, markThreadReadByAdmin, markThreadReadByUser } from "../store.js";

export async function render(main, { params, routeId, flash }) {
  const state = getState();
  const isAdmin = routeId === "admin-thread";
  const threadId = params.id;

  const backHref = isAdmin ? "#/admin/questions" : "#/questions";
  const crumb = el("p", { class: "crumb" }, el("a", { href: backHref }, isAdmin ? "All questions" : "My Questions"));
  const titleEl = el("h1", {}, "\u00a0");
  const metaEl = el("p", { class: "muted" });
  const messagesList = el("ol", { class: "messages" });
  const body = el("textarea", { rows: 5, maxLength: 5000, required: true });
  const submit = el("button", { class: "btn", type: "submit" }, isAdmin ? "Send reply" : "Send");

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!body.value.trim()) { flash("Write a message first.", "error"); return; }
      submit.disabled = true;
      try {
        await replyToThread(threadId, { fromAdmin: isAdmin, body: body.value.trim(), authorUid: state.user.uid });
        body.value = "";
      } catch {
        flash("Couldn't send that message. Try again.", "error");
      } finally {
        submit.disabled = false;
      }
    },
  }, [
    el("label", {}, [isAdmin ? "Your reply" : "Add a message", body]),
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [crumb, titleEl, metaEl]),
    messagesList,
    form,
  ]);

  let firstLoad = true;
  let threadData = null;
  const unThread = watchThread(threadId, (t) => {
    threadData = t;
    if (!t || (!isAdmin && t.uid !== state.user.uid)) {
      main.textContent = "";
      main.append(el("p", { class: "empty" }, "That question isn't available."));
      return;
    }
    titleEl.textContent = t.subject;
    if (isAdmin) {
      mount(metaEl, isTeamKey(t.clientKey)
        ? [`From ${t.askerName} \u00b7 ${t.askerEmail} \u00b7 `, el("strong", {}, "team member")]
        : [
          `From ${t.askerName} \u00b7 ${t.askerEmail} \u00b7 client ID `, el("strong", {}, t.clientLabel), " \u00b7 ",
          el("a", { href: `#/view-as/${encodeURIComponent(t.clientKey)}?label=${encodeURIComponent(t.clientLabel)}` }, "See their portal"),
        ]);
    }
    if (firstLoad) {
      firstLoad = false;
      if (isAdmin && t.adminUnread) markThreadReadByAdmin(threadId).catch(() => {});
      if (!isAdmin && t.userUnread) markThreadReadByUser(threadId).catch(() => {});
    }
  });

  const unMessages = watchMessages(threadId, (messages) => {
    mount(messagesList, messages.map((m, i) => el("li", { class: `msg ${m.fromAdmin ? "from-admin" : "from-client"}`, id: i === messages.length - 1 ? "latest" : null }, [
      el("div", { class: "msg-head" }, [
        el("strong", {}, m.fromAdmin ? (isAdmin ? "You" : "Administrator") : (isAdmin ? (threadData?.askerName || "Client") : "You")),
        el("span", { class: "muted" }, formatWhen(m.createdAt)),
      ]),
      el("p", { class: "msg-body" }, m.body),
    ])));
    if (messages.length) document.getElementById("latest")?.scrollIntoView({ block: "nearest" });
  });

  return () => { unThread(); unMessages(); };
}
