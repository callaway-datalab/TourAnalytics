import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { changeOwnPassword } from "../store.js";

const MIN_PASSWORD = 10;
const FRIENDLY = {
  "auth/wrong-password": "Your current password is wrong.",
  "auth/invalid-credential": "Your current password is wrong.",
  "auth/weak-password": `Use a new password of at least ${MIN_PASSWORD} characters.`,
  "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
};

export async function render(main, { flash }) {
  const state = getState();
  const current = el("input", { type: "password", autocomplete: "current-password", required: true });
  const next = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const confirm = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Change password");

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      if (next.value !== confirm.value) { flash("The two new passwords don't match.", "error"); return; }
      if (next.value.length < MIN_PASSWORD) { flash(`Use a new password of at least ${MIN_PASSWORD} characters.`, "error"); return; }
      submit.disabled = true;
      try {
        await changeOwnPassword(current.value, next.value);
        flash("Password changed.", "ok");
        form.reset();
      } catch (err) {
        flash(FRIENDLY[err.code] || "Something went wrong. Try again.", "error");
      } finally {
        submit.disabled = false;
      }
    },
  }, [
    el("h2", {}, "Change password"),
    el("label", {}, ["Current password", current]),
    el("label", {}, ["New password", next, el("small", {}, `At least ${MIN_PASSWORD} characters.`)]),
    el("label", {}, ["Confirm new password", confirm]),
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [el("h1", {}, "Your account"), el("p", { class: "muted" }, `${state.profile?.name || ""} \u00b7 ${state.user.email}`)]),
    form,
  ]);
  return () => {};
}
