import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { askQuestion } from "../store.js";

export async function render(main, { flash }) {
  const state = getState();
  const subject = el("input", { maxLength: 150, placeholder: "What is this about?", required: true, autofocus: true });
  const body = el("textarea", { rows: 8, maxLength: 5000, placeholder: "Include the table, month or figure you're asking about.", required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Send question");

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!subject.value.trim() || !body.value.trim()) { flash("Add a subject and your question.", "error"); return; }
      submit.disabled = true; submit.textContent = "Sending\u2026";
      try {
        const id = await askQuestion({
          uid: state.user.uid, clientKey: state.profile.clientKey, clientLabel: state.profile.clientLabel,
          askerName: state.profile.name, askerEmail: state.profile.email,
          subject: subject.value.trim(), body: body.value.trim(),
        });
        location.hash = `#/questions/${id}`;
      } catch {
        flash("Couldn't send your question. Try again.", "error");
        submit.disabled = false; submit.textContent = "Send question";
      }
    },
  }, [
    el("label", {}, ["Subject", subject]),
    el("label", {}, ["Your question", body]),
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [el("p", { class: "crumb" }, el("a", { href: "#/questions" }, "Questions")), el("h1", {}, "Ask a question")]),
    form,
  ]);
  return () => {};
}
