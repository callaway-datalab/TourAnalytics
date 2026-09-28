import { whenReady, getState, subscribe } from "./auth.js";
import { renderShell, flash } from "./ui.js";

// [pattern, guard, loader, routeId] — routeId drives which nav item is "current".
const ROUTES = [
  ["/login", "public", () => import("./views/login.js"), "login"],
  ["/signup", "public", () => import("./views/signup.js"), "signup"],
  ["/dashboard", "client", () => import("./views/dashboard.js"), "dashboard"],
  ["/data/:id", "client", () => import("./views/dataset.js"), "dataset"],
  ["/documents", "client", () => import("./views/documents.js"), "documents"],
  ["/questions", "client", () => import("./views/questions.js"), "questions"],
  ["/questions/new", "client", () => import("./views/questionNew.js"), "question-new"],
  ["/questions/:id", "client", () => import("./views/thread.js"), "thread"],
  ["/account", "signed-in", () => import("./views/account.js"), "account"],
  ["/admin", "admin", () => import("./views/adminHome.js"), "admin"],
  ["/admin/datasets", "admin", () => import("./views/adminDatasets.js"), "admin-datasets"],
  ["/admin/clients", "admin", () => import("./views/adminClients.js"), "admin-clients"],
  ["/admin/documents", "admin", () => import("./views/adminDocuments.js"), "admin-documents"],
  ["/admin/questions", "admin", () => import("./views/adminQuestions.js"), "admin-questions"],
  ["/admin/questions/:id", "admin", () => import("./views/thread.js"), "admin-thread"],
];

let currentCleanup = null;
let previewClient = null; // set by #/view-as/:key, cleared by #/exit-preview or admin nav

function match(path) {
  for (const [pattern, guard, loader, routeId] of ROUTES) {
    const parts = pattern.split("/").filter(Boolean);
    const given = path.split("/").filter(Boolean);
    if (parts.length !== given.length) continue;
    const params = {};
    let ok = true;
    parts.forEach((p, i) => {
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(given[i]);
      else if (p !== given[i]) ok = false;
    });
    if (ok) return { guard, loader, routeId, params };
  }
  return null;
}

export function navigate(hash) { location.hash = hash; }

async function render() {
  const raw = location.hash.slice(1) || "/login";

  if (raw.startsWith("/view-as/")) {
    const [keyPart, queryPart] = raw.slice("/view-as/".length).split("?");
    const label = new URLSearchParams(queryPart || "").get("label");
    previewClient = { key: decodeURIComponent(keyPart), label: label ? decodeURIComponent(label) : decodeURIComponent(keyPart) };
    navigate("/dashboard");
    return;
  }
  if (raw === "/exit-preview") {
    previewClient = null;
    navigate("/admin");
    return;
  }

  const state = await whenReady();
  const path = raw.split("?")[0];
  const found = match(path);

  if (!found) { navigate(state.user ? (state.isAdmin ? "/admin" : "/dashboard") : "/login"); return; }
  const { guard, loader, routeId, params } = found;

  if (guard !== "public" && !state.user) { navigate(`/login?next=${encodeURIComponent(raw)}`); return; }
  if (guard === "public" && state.user) { navigate(state.isAdmin ? "/admin" : "/dashboard"); return; }
  if (guard === "admin" && !state.isAdmin) { navigate("/dashboard"); return; }
  if (guard === "client" && state.isAdmin && !previewClient) { navigate("/admin"); return; }
  if (guard === "client" && !state.isAdmin && !state.profile && state.status === "ready") {
    // Signed in, but no profile doc (e.g. access was removed by the admin).
    document.getElementById("app").textContent =
      "Your access to this portal has been removed. Contact the administrator if you think this is a mistake.";
    return;
  }

  if (currentCleanup) { try { currentCleanup(); } catch { /* noop */ } currentCleanup = null; }

  const root = document.getElementById("app");
  let main;
  if (guard === "public") {
    root.textContent = "";
    main = root;
  } else {
    main = renderShell(root, { previewClient, currentRoute: routeId });
    if (previewClient && guard === "client") {
      // The bar goes INSIDE <main> (placing it beside <main> breaks the two-column layout and
      // pushes the page off-screen). Views clear their container, so give them an inner one.
      const inner = document.createElement("div");
      main.append(el_previewBar(), inner);
      main = inner;
    }
  }

  try {
    const mod = await loader();
    currentCleanup = await mod.render(main, { params, previewClient, routeId, flash: (msg, type) => flash(main, msg, type) });
  } catch (err) {
    console.error(err);
    main.textContent = "Something went wrong loading this page. Reloading the page usually fixes it.";
  }
}

function el_previewBar() {
  const bar = document.createElement("div");
  bar.className = "preview-bar";
  bar.setAttribute("role", "status");
  const span = document.createElement("span");
  span.append("Previewing what ", Object.assign(document.createElement("strong"), { textContent: previewClient.label }), " sees.");
  const link = document.createElement("a");
  link.href = "#/exit-preview";
  link.textContent = "Exit preview";
  bar.append(span, link);
  return bar;
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  let lastUid; // re-run the current route's guard when sign-in/out happens without a hash change
  subscribe((state) => {
    const uid = state.user?.uid ?? null;
    if (uid !== lastUid) { lastUid = uid; if (state.status !== "loading") render(); }
  });
  render();
}

export function getPreviewClient() { return previewClient; }
