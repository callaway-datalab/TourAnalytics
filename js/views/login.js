import { el, mount, logoImg } from "../ui.js";
import { logIn } from "../store.js";
import { portalName } from "../firebase-init.js";

const FRIENDLY = {
  "auth/invalid-credential": "That email and password don't match.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection.",
};

export async function render(main) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const email = el("input", { type: "email", autocomplete: "username", required: true, autofocus: true });
  const password = el("input", { type: "password", autocomplete: "current-password", required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Log in");
  const errorBox = el("div");

  const form = el("form", {
    onSubmit: async (e) => {
      e.preventDefault();
      mount(errorBox, []);
      submit.disabled = true; submit.textContent = "Logging in\u2026";
      try {
        await logIn(email.value.trim(), password.value);
        location.hash = decodeURIComponent(params.get("next") || "") || "#/dashboard";
      } catch (err) {
        mount(errorBox, el("p", { class: "flash error", role: "alert" }, FRIENDLY[err.code] || "Something went wrong. Try again."));
      } finally {
        submit.disabled = false; submit.textContent = "Log in";
      }
    },
  }, [
    el("label", {}, ["Email", email]),
    el("label", {}, ["Password", password]),
    submit,
  ]);

  mount(main, el("div", { class: "auth" }, [
    el("section", { class: "auth-intro" }, [
      el("p", { class: "auth-name" }, [logoImg(), portalName]),
      el("h1", {}, "Your game. Beyond the score."),
      el("p", {}, "Stats, insights, and reports. All in one place."),
    ]),
    el("section", { class: "auth-form" }, [
      el("h2", {}, "Log in"),
      errorBox,
      form,
      el("p", { class: "muted" }, ["Have an access code? ", el("a", { href: "#/signup" }, "Create your account")]),
    ]),
  ]));
}
