import { el, mount, logoImg } from "../ui.js";
import { fetchInvite, signUpWithCode, UserError } from "../store.js";
import { normalizeCode } from "../data.js";
import { portalName } from "../firebase-init.js";

const FRIENDLY = {
  "auth/email-already-in-use": "An account with that email already exists. Log in instead.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/weak-password": "Use a password of at least 10 characters.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection.",
};
const MIN_PASSWORD = 10;

export async function render(main) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const code = el("input", { class: "code-input", autocomplete: "off", spellcheck: false, required: true,
    placeholder: "ABCDE-FGHJK", value: params.get("code") || "" });
  code.addEventListener("input", () => { code.value = code.value.toUpperCase(); });
  const name = el("input", { autocomplete: "name", required: true });
  const email = el("input", { type: "email", autocomplete: "username", required: true });
  const password = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const confirm = el("input", { type: "password", autocomplete: "new-password", minLength: MIN_PASSWORD, required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Create account");
  const errorBox = el("div");

  const form = el("form", {
    onSubmit: async (e) => {
      e.preventDefault();
      mount(errorBox, []);
      const cleanCode = normalizeCode(code.value);
      if (password.value !== confirm.value) {
        mount(errorBox, el("p", { class: "flash error", role: "alert" }, "The two passwords don't match."));
        return;
      }
      if (password.value.length < MIN_PASSWORD) {
        mount(errorBox, el("p", { class: "flash error", role: "alert" }, `Use a password of at least ${MIN_PASSWORD} characters.`));
        return;
      }
      submit.disabled = true; submit.textContent = "Creating your account\u2026";
      try {
        const invite = await fetchInvite(cleanCode);
        const now = Date.now();
        if (!invite || invite.usedBy || invite.revoked || (invite.expiresAt && invite.expiresAt.toMillis() < now)) {
          throw new UserError("That access code isn't valid. It may have been used already or expired. Ask for a new one.");
        }
        await signUpWithCode({ code: cleanCode, name: name.value.trim(), email: email.value.trim(), password: password.value });
        location.hash = "#/dashboard";
      } catch (err) {
        const msg = err instanceof UserError ? err.message : FRIENDLY[err.code] || "Something went wrong. Try again.";
        mount(errorBox, el("p", { class: "flash error", role: "alert" }, msg));
      } finally {
        submit.disabled = false; submit.textContent = "Create account";
      }
    },
  }, [
    el("label", {}, ["Access code", code]),
    el("label", {}, ["Your name", name]),
    el("label", {}, ["Email", email]),
    el("label", {}, ["Password", password, el("small", {}, `At least ${MIN_PASSWORD} characters.`)]),
    el("label", {}, ["Confirm password", confirm]),
    submit,
  ]);

  mount(main, el("div", { class: "auth" }, [
    el("section", { class: "auth-intro" }, [
      el("p", { class: "auth-name" }, [logoImg(), portalName]),
      el("h1", {}, "Welcome. Let's set up your account."),
      el("p", {}, "You'll need the access code you were sent. It links your account to your own data."),
    ]),
    el("section", { class: "auth-form" }, [
      el("h2", {}, "Create your account"),
      errorBox,
      form,
      el("p", { class: "muted" }, ["Already have an account? ", el("a", { href: "#/login" }, "Log in")]),
    ]),
  ]));
}
