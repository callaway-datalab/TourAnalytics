import { isTeamKey, norm, roleLabel } from "../data.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchThread, watchMessages, replyToThread, markThreadReadByAdmin, markThreadReadByUser, uploadErrorMessage } from "../store.js";
import { attachPicker, attachmentLinks } from "../attachments.js";
import { threadActions } from "../threadActions.js";

export async function render(main, { params, routeId, flash }) {
  const state = getState();
  const isAdmin = routeId === "admin-thread";
  const threadId = params.id;

  const backHref = isAdmin ? "#/admin/questions" : "#/questions";
  const crumb = el("p", { class: "crumb" }, el("a", { href: backHref }, isAdmin ? "All questions" : "My Questions"));
  const titleEl = el("h1", {}, "\u00a0");
  const metaEl = el("p", { class: "muted" });
  const actionsEl = el("div");
  const messagesList = el("ol", { class: "messages" });
  const body = el("textarea", { rows: 5, maxLength: 5000 });
  const picker = attachPicker();
  const submit = el("button", { class: "btn", type: "submit" }, isAdmin ? "Send reply" : "Send");

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!body.value.trim() && !picker.files().length) { flash("Write a message or attach a file first.", "error"); return; }
      const label = submit.textContent;
      submit.disabled = true;
      try {
        await replyToThread(threadId, {
          fromAdmin: isAdmin, body: body.value.trim(), authorUid: state.user.uid, files: picker.files(),
          onProgress: (done, total) => { submit.textContent = `Uploading files\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`; },
        });
        body.value = ""; picker.clear();
      } catch (err) {
        flash(uploadErrorMessage(err, "that message"), "error");
      } finally {
        submit.disabled = false; submit.textContent = label;
      }
    },
  }, [
    el("label", {}, [isAdmin ? "Your reply" : "Add a message", body]),
    picker.node,
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [crumb, titleEl, metaEl, actionsEl]),
    messagesList,
    form,
  ]);

  let firstLoad = true;
  let threadData = null;
  const sharedNames = (t) => (t.sharedWithNames || []).map((m) => `${m.name} (${roleLabel(m.role)})`).join(", ");
  const unThread = watchThread(threadId, (t) => {
    threadData = t;
    const mine = !!t && t.uid === state.user.uid;
    const sharedWithMe = !!t && !isAdmin && !mine && (t.sharedWith || []).includes(norm(state.user.email));
    if (!t || (!isAdmin && !mine && !sharedWithMe)) {
      main.textContent = "";
      main.append(el("p", { class: "empty" }, "That question isn't available."));
      return;
    }
    titleEl.textContent = t.subject;
    // The person who asked, and the admin, can complete or delete the question.
    mount(actionsEl, (isAdmin || mine) ? [
      t.archived ? el("span", { class: "tag muted-tag" }, "Completed") : null, t.archived ? " " : null,
      threadActions(t, { asAdmin: isAdmin, flash, onDeleted: () => { location.hash = backHref; } }),
    ] : null);
    if (sharedWithMe) {
      // A team member reading a question their player shared: read-only.
      mount(metaEl, `Asked by ${t.askerName} (${t.clientLabel}) and shared with you. Only they and Callaway Analysts can reply.`);
      form.remove();
    } else if (!isAdmin) {
      mount(metaEl, (t.sharedWithNames || []).length ? `Also shared with ${sharedNames(t)}.` : "");
    }
    if (isAdmin) {
      mount(metaEl, isTeamKey(t.clientKey)
        ? [`From ${t.askerName} \u00b7 ${t.askerEmail} \u00b7 `, el("strong", {}, "team member")]
        : [
          `From ${t.askerName} \u00b7 ${t.askerEmail} \u00b7 client ID `, el("strong", {}, t.clientLabel), " \u00b7 ",
          el("a", { href: `#/view-as/${encodeURIComponent(t.clientKey)}?label=${encodeURIComponent(t.clientLabel)}` }, "See their portal"),
          (t.sharedWithNames || []).length ? ` \u00b7 also shared with ${sharedNames(t)}` : "",
        ]);
    }
    if (firstLoad) {
      firstLoad = false;
      if (isAdmin && t.adminUnread) markThreadReadByAdmin(threadId).catch(() => {});
      if (mine && !isAdmin && t.userUnread) markThreadReadByUser(threadId).catch(() => {});
    }
  });

  const unMessages = watchMessages(threadId, (messages) => {
    mount(messagesList, messages.map((m, i) => el("li", { class: `msg ${m.fromAdmin ? "from-admin" : "from-client"}`, id: i === messages.length - 1 ? "latest" : null }, [
      el("div", { class: "msg-head" }, [
        el("strong", {}, m.fromAdmin ? (isAdmin ? "You" : "Callaway Analysts")
          : (!isAdmin && threadData?.uid === state.user.uid ? "You" : (threadData?.askerName || "Player"))),
        el("span", { class: "muted" }, formatWhen(m.createdAt)),
      ]),
      m.body ? el("p", { class: "msg-body" }, m.body) : null,
      attachmentLinks(threadId, m.attachments, flash),
    ])));
    if (messages.length) document.getElementById("latest")?.scrollIntoView({ block: "nearest" });
  });

  return () => { unThread(); unMessages(); };
}
