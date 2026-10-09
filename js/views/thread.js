import { isTeamKey, norm, roleLabel } from "../data.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchThread, watchMessages, replyToThread, markThreadReadByAdmin, markThreadReadByUser, uploadErrorMessage, forwardThread, watchUsers } from "../store.js";
import { attachPicker, attachmentLinks } from "../attachments.js";
import { threadActions } from "../threadActions.js";

export async function render(main, { params, routeId, flash }) {
  const state = getState();
  const isAdmin = routeId === "admin-thread";
  const threadId = params.id;

  const backHref = isAdmin ? "#/admin/questions" : "#/questions";
  let forwardedToMe = false; // an analyst reading a question the admin forwarded to them
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
          fromAdmin: isAdmin || forwardedToMe, body: body.value.trim(), authorUid: state.user.uid,
          authorName: state.profile?.name || state.user.displayName || "", files: forwardedToMe ? [] : picker.files(),
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
    forwardedToMe = !!t && !isAdmin && !mine && (t.forwardedTo || []).includes(state.user.uid);
    if (!t || (!isAdmin && !mine && !sharedWithMe && !forwardedToMe)) {
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
    if (forwardedToMe) {
      // Forwarded by the admin: read it and answer on Callaway's behalf (text replies).
      mount(metaEl, `Asked by ${t.askerName} (${t.aboutLabel || t.clientLabel}) \u00b7 forwarded to you by Callaway Analysts. Your reply goes to them as Callaway Analysts.`);
      picker.node.remove();
    } else if (sharedWithMe) {
      // A team member reading a question their player shared: read-only.
      mount(metaEl, `Asked by ${t.askerName} (${t.clientLabel}) and shared with you. Only they and Callaway Analysts can reply.`);
      form.remove();
    } else if (!isAdmin) {
      mount(metaEl, (t.sharedWithNames || []).length ? `Also shared with ${sharedNames(t)}.` : "");
    }
    if (isAdmin) {
      drawForward(t);
      mount(metaEl, isTeamKey(t.clientKey)
        ? [`From ${t.askerName} \u00b7 ${t.askerEmail} \u00b7 `, el("strong", {}, "team member"), t.aboutLabel ? ` \u00b7 about ${t.aboutLabel}` : ""]
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
        el("strong", {}, m.fromAdmin
          ? (m.authorUid === state.user.uid ? "You" : (isAdmin || forwardedToMe) && m.authorName ? m.authorName : "Callaway Analysts")
          : (!isAdmin && threadData?.uid === state.user.uid ? "You" : (threadData?.askerName || "Player"))),
        el("span", { class: "muted" }, formatWhen(m.createdAt)),
      ]),
      m.body ? el("p", { class: "msg-body" }, m.body) : null,
      attachmentLinks(threadId, m.attachments, flash),
    ])));
    if (messages.length) document.getElementById("latest")?.scrollIntoView({ block: "nearest" });
  });

  // Admin: forward this question to one or more Callaway analysts.
  const forwardBox = el("div", { class: "forward-box" });
  actionsEl.after(forwardBox);
  let analysts = [];
  const unUsers = isAdmin ? watchUsers((users) => { analysts = users.filter((u) => u.kind === "analyst").map((u) => ({ uid: u.uid, name: u.name || u.email })); if (threadData) drawForward(threadData); }) : () => {};
  function drawForward(t) {
    const names = t.forwardedNames || [];
    const open = el("button", { type: "button", class: "btn ghost" }, names.length ? "Change who it's forwarded to" : "Forward to an analyst");
    const panel = el("div", { class: "panel forward-panel", hidden: true });
    open.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      if (!analysts.length) { mount(panel, el("p", { class: "muted" }, "No analysts have signed up yet. Add one under User Access \u2192 Create New Access Code \u2192 Analyst.")); return; }
      const boxes = analysts.map((a) => el("label", { class: "ms-row" }, [el("input", { type: "checkbox", value: a.uid, checked: (t.forwardedTo || []).includes(a.uid) }), el("span", {}, a.name)]));
      const save = el("button", { type: "button", class: "btn" }, "Save");
      save.addEventListener("click", async () => {
        const picked = boxes.map((b) => b.querySelector("input")).filter((c) => c.checked).map((c) => analysts.find((a) => a.uid === c.value));
        save.disabled = true;
        try { await forwardThread(threadId, picked); flash(picked.length ? `Forwarded to ${picked.map((p) => p.name).join(", ")}.` : "No longer forwarded.", "ok"); panel.hidden = true; }
        catch { flash("Couldn't forward that question. (Republish the Firestore rules if you haven't since this update.)", "error"); save.disabled = false; }
      });
      mount(panel, [el("p", { class: "muted small" }, "They'll find it under Questions and can reply as Callaway Analysts."), ...boxes, el("div", { class: "forward-actions" }, save)]);
    });
    mount(forwardBox, [names.length ? el("p", { class: "muted small" }, `Forwarded to ${names.join(", ")}`) : null, open, panel]);
  }

  return () => { unThread(); unMessages(); unUsers(); };
}
