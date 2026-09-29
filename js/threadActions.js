// "Mark as completed" / "Reopen" and "Delete" for a question, used in lists and on the question page.
import { el, confirmAction } from "./ui.js";
import { setThreadArchived, deleteThread } from "./store.js";

export function threadActions(t, { asAdmin, flash, onDeleted }) {
  const toggle = el("button", { class: "link", type: "button" }, t.archived ? "Reopen" : "Mark as completed");
  toggle.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    toggle.disabled = true;
    try {
      await setThreadArchived(t.id, !t.archived, { asAdmin });
      flash(t.archived ? `Reopened "${t.subject}".` : `"${t.subject}" marked as completed and moved to Archived questions.`, "ok");
    } catch { flash("Couldn't update that question. Try again.", "error"); toggle.disabled = false; }
  });
  const del = el("button", { class: "link danger", type: "button" }, "Delete");
  del.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirmAction(`Delete "${t.subject}"? This removes the question, its replies and attachments for everyone, including ${asAdmin ? "the player" : "Callaway Analysts"}. It can't be undone.`)) return;
    del.disabled = true;
    try { await deleteThread(t.id); flash(`Deleted "${t.subject}".`, "ok"); if (onDeleted) onDeleted(); }
    catch { flash("Couldn't delete that question. Try again.", "error"); del.disabled = false; }
  });
  return el("span", { class: "thread-actions" }, [toggle, del]);
}
