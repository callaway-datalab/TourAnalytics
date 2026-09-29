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
  ["/team", "team", () => import("./views/teamHome.js"), "team"],
  ["/admin", "admin", () => import("./views/adminHome.js"), "admin"],
  ["/admin/datasets", "admin", () => import("./views/adminDatasets.js"), "admin-datasets"],
  ["/admin/clients", "admin", () => import("./views/adminClients.js"), "admin-clients"],
  ["/admin/documents", "admin", () => import("./views/adminDocuments.js"), "admin-documents"],
  ["/admin/questions", "admin", () => import("./views/adminQuestions.js"), "admin-questions"],
  ["/admin/questions/:id", "admin", () => import("./views/thread.js"), "admin-thread"],
];

let currentCleanup = null;
// The player being looked at by someone else: the admin previewing, or a team member viewing one
// of their players. { key, label, role? }. Set by #/view-as/:key, cleared by #/exit-preview.
// This only decides what the screen shows; the Firestore rules decide what can actually be read.
let previewClient = null;
// Pages that show one player's data and need to know which player.
const PLAYER_PAGES = ["dashboard", "dataset", "documents"];
const homeFor = (state) => (!state.user ? "/login" : state.isAdmin ? "/admin" : state.isTeam ? "/team" : "/dashboard");

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

  const state = await whenReady();

  if (raw.startsWith("/view-as/")) {
    const [keyPart, queryPart] = raw.slice("/view-as/".length).split("?");
    const key = decodeURIComponent(keyPart);
    const label = new URLSearchParams(queryPart || "").get("label") || key;
    if (state.isAdmin) {
      previewClient = { key, label };
    } else if (state.isTeam && state.teamAccess[key]) {
      previewClient = { key, label: state.teamAccess[key].label || label, role: state.teamAccess[key].role };
    } else {
      previewClient = null;
      navigate(homeFor(state));
      return;
    }
    navigate("/dashboard");
    return;
  }
  if (raw === "/exit-preview") {
    previewClient = null;
    navigate(homeFor(state));
    return;
  }
  // A team member whose access to this player was just removed goes back to their list.
  if (previewClient && state.isTeam && !state.teamAccess[previewClient.key]) previewClient = null;
  const path = raw.split("?")[0];
  const found = match(path);

  if (!found) { navigate(homeFor(state)); return; }
  const { guard, loader, routeId, params } = found;

  if (guard !== "public" && !state.user) { navigate(`/login?next=${encodeURIComponent(raw)}`); return; }
  if (guard === "public" && state.user) { navigate(homeFor(state)); return; }
  if (guard === "team" && !state.isTeam) { navigate(homeFor(state)); return; }
  if (guard === "client" && state.isTeam && !previewClient && PLAYER_PAGES.includes(routeId)) { navigate("/team"); return; }
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
    if (previewClient && (PLAYER_PAGES.includes(routeId) || (state.isAdmin && guard === "client"))) {
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
  const who = Object.assign(document.createElement("strong"), { textContent: previewClient.label });
  const link = document.createElement("a");
  link.href = "#/exit-preview";
  if (previewClient.role) {
    span.append("Viewing ", who, `'s portal as their ${previewClient.role}. View only.`);
    link.textContent = "Back to my players";
  } else {
    span.append("Previewing what ", who, " sees.");
    link.textContent = "Exit preview";
  }
  bar.append(span, link);
  return bar;
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  let lastUid; // re-run the current route's guard when sign-in/out happens without a hash change
  subscribe((state) => {
    if (state.status === "loading") return;
    const uid = state.user?.uid ?? null;
    if (uid !== lastUid) {
      if (lastUid !== undefined && uid !== lastUid) previewClient = null; // different person
      lastUid = uid;
      render();
    }
  });
  render();
}

export function getPreviewClient() { return previewClient; }
