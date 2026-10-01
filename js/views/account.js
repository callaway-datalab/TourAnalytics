// Profile (Account → Profile): your name, your email, and your password.
// Your name is what shows in player lists, on rounds you enter and at the top of Analyze.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { changeOwnPassword, updateMyName, changeMyEmail } from "../store.js";

const MIN_PASSWORD = 10;
const FRIENDLY = {
  "auth/wrong-password": "Your current password is wrong.",
  "auth/invalid-credential": "Your current password is wrong.",
  "auth/weak-password": `Use a new password of at least ${MIN_PASSWORD} characters.`,
  "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "Another account already uses that email.",
  "auth/requires-recent-login": "For security, sign out and back in, then try again.",
};

export async function render(main, { flash }) {
  const state = getState();
  const currentName = state.profile?.name || state.user.displayName || "";

  /* ---- name ---- */
  const nameIn = el("input", { value: currentName, required: true, maxLength: 80, autocomplete: "name", placeholder: "Your full name" });
  const nameBtn = el("button", { class: "btn", type: "submit" }, "Save name");
  const nameForm = el("form", {
    class: "stack panel profile-card",
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      if (!name) { flash("Enter your name.", "error"); return; }
      nameBtn.disabled = true;
      try { await updateMyName(name); flash("Name saved.", "ok"); drawHead(); }
      catch (err) { console.error(err); flash("Couldn't save your name. Try again.", "error"); }
      finally { nameBtn.disabled = false; }
    },
  }, [
    el("h2", {}, "Name"),
    el("label", {}, ["Name", nameIn, el("small", {}, "Shown in player lists, on rounds you enter, and wherever you'd otherwise see \u201cMe\u201d.")]),
    el("div", {}, nameBtn),
  ]);

  /* ---- email ---- */
  const emailIn = el("input", { type: "email", value: state.user.email || "", required: true, autocomplete: "email" });
  const emailPw = el("input", { type: "password", required: true, autocomplete: "current-password" });
  const emailBtn = el("button", { class: "btn", type: "submit" }, "Change email");
  const emailForm = el("form", {
    class: "stack panel profile-card",
    onSubmit: async (e) => {
      e.preventDefault();
      const next = emailIn.value.trim().toLowerCase();
      if (next === (state.user.email || "").toLowerCase()) { flash("That's already your email.", "error"); return; }
      emailBtn.disabled = true;
      try {
        await changeMyEmail(emailPw.value, next);
        flash(`Check ${next} for a link to confirm the change. Until you click it, keep signing in with ${state.user.email}.`, "ok");
        emailPw.value = "";
      } catch (err) { flash(FRIENDLY[err.code] || "Couldn't change your email. Try again.", "error"); }
      finally { emailBtn.disabled = false; }
    },
  }, [
    el("h2", {}, "Email"),
    el("label", {}, ["Email", emailIn, el("small", {}, "You sign in with this. We'll email the new address a link; it switches once you click it.")]),
    el("label", {}, ["Current password", emailPw]),
    el("div", {}, emailBtn),
  ]);

  /* ---- password ---- */
  const current = el("input", { type: "password", autocomplete: "current-password", required: true });
  const next = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const confirm = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Change password");
  const pwForm = el("form", {
    class: "stack panel profile-card",
    onSubmit: async (e) => {
      e.preventDefault();
      if (next.value !== confirm.value) { flash("The two new passwords don't match.", "error"); return; }
      if (next.value.length < MIN_PASSWORD) { flash(`Use a new password of at least ${MIN_PASSWORD} characters.`, "error"); return; }
      submit.disabled = true;
      try { await changeOwnPassword(current.value, next.value); flash("Password changed.", "ok"); pwForm.reset(); }
      catch (err) { flash(FRIENDLY[err.code] || "Something went wrong. Try again.", "error"); }
      finally { submit.disabled = false; }
    },
  }, [
    el("h2", {}, "Password"),
    el("label", {}, ["Current password", current]),
    el("label", {}, ["New password", next, el("small", {}, `At least ${MIN_PASSWORD} characters.`)]),
    el("label", {}, ["Confirm new password", confirm]),
    el("div", {}, submit),
  ]);

  const head = el("header", { class: "page-head" });
  const drawHead = () => mount(head, [el("h1", {}, "Profile"), el("p", { class: "muted" }, `${getState().profile?.name || getState().user.displayName || ""}${getState().profile?.name || getState().user.displayName ? " \u00b7 " : ""}${getState().user.email}`)]);
  drawHead();
  mount(main, [head, el("div", { class: "profile-grid" }, [nameForm, emailForm, pwForm])]);
  return () => {};
}
