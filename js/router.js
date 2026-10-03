import { getPreviewTeam, setPreviewTeam, effectiveTeam } from "./preview.js";
import { isTeamKey, rosterByEmail } from "./data.js";
import { teamLabels } from "./names.js";
import { getUserProfile, getTeamRoster, fetchInvite } from "./store.js";
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
  ["/witb", "signed-in", () => import("./views/witb.js"), "witb"],
  ["/entry", "signed-in", () => import("./views/dataEntry.js"), "entry"],
  ["/entry/new", "signed-in", () => import("./views/dataEntry.js"), "entry-new"],
  ["/entry/:player/:round", "signed-in", () => import("./views/dataEntry.js"), "entry-round"],
  ["/team", "team", () => import("./views/teamHome.js"), "team"],
  ["/admin", "admin", () => import("./views/adminClients.js"), "admin-clients"], // Player Access is the admin's home
  ["/admin/datasets", "admin", () => import("./views/adminDatasets.js"), "admin-datasets"],
  ["/admin/analyze", "admin", () => import("./views/adminAnalyze.js"), "admin-analyze"],
  ["/admin/clients", "admin", () => import("./views/adminClients.js"), "admin-clients"],
  ["/admin/documents", "admin", () => import("./views/adminDocuments.js"), "admin-documents"],
  ["/admin/reports/view", "admin", () => import("./views/adminReportsView.js"), "admin-reports-view"],
  ["/admin/questions", "admin", () => import("./views/adminQuestions.js"), "admin-questions"],
  ["/admin/questions/:id", "admin", () => import("./views/thread.js"), "admin-thread"],
];

let currentCleanup = null;
// The player being looked at by someone else: the admin previewing, or a team member viewing one
// of their players. { key, label, role? }. Set by #/view-as/:key, cleared by #/exit-preview.
// This only decides what the screen shows; the Firestore rules decide what can actually be read.
let previewClient = null;
let lastTeamPlayer = null; // the player a team member last looked at
// Pages that show one player's data and need to know which player.
const PLAYER_PAGES = ["dashboard", "dataset", "documents"];
const homeFor = (state) => (!state.user ? "/login" : state.isAdmin ? "/admin/clients" : state.isTeam ? "/team" : "/dashboard");

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

// Each render gets a number; a render that's been overtaken by a newer one (e.g. signing in while
// the log-in page is still loading) stops instead of drawing the wrong page over the right one.
let renderGen = 0;

async function render() {
  const gen = ++renderGen;
  const raw = location.hash.slice(1) || "/login";

  const state = await whenReady();
  if (gen !== renderGen) return;
  const team = effectiveTeam(state); // a real team member, or the admin previewing one

  // Admin: preview any account's portal. Players go to their own view; team members and
  // Callaway analysts go to their My players page.
  if (raw.startsWith("/view-as-member/")) {
    if (!state.isAdmin) { navigate(homeFor(state)); return; }
    const u = await getUserProfile(decodeURIComponent(raw.slice("/view-as-member/".length).split("?")[0])).catch(() => null);
    if (!u) { navigate(homeFor(state)); return; }
    if (isTeamKey(u.clientKey)) {
      setPreviewTeam({ uid: u.uid, name: u.name, email: u.email, kind: u.kind || null, access: u.access || {} });
      previewClient = null;
      navigate("/team");
    } else {
      setPreviewTeam(null);
      previewClient = { key: u.clientKey, label: u.clientLabel };
      navigate("/dashboard");
    }
    return;
  }
  // Admin: preview a roster team member or a Callaway Access code before (or without) them signing up,
  // using the players the roster / code gives them.
  if (raw.startsWith("/view-as-roster/") || raw.startsWith("/view-as-code/")) {
    if (!state.isAdmin) { navigate(homeFor(state)); return; }
    const id = decodeURIComponent(raw.split("/")[2].split("?")[0]);
    let t = null;
    if (raw.startsWith("/view-as-roster/")) {
      const { entries = [] } = await getTeamRoster().catch(() => ({}));
      const person = rosterByEmail(entries).get(id);
      if (person) t = { uid: null, name: person.name, email: id, kind: null, access: person.access };
    } else {
      const inv = await fetchInvite(id).catch(() => null);
      if (inv) t = { uid: null, name: inv.clientLabel || "this person", email: inv.email || null, kind: inv.kind || null, access: inv.access || {} };
    }
    if (!t) { navigate(homeFor(state)); return; }
    setPreviewTeam(t);
    previewClient = null;
    navigate("/team");
    return;
  }
  if (raw === "/back-to-players") { previewClient = null; navigate(team.isTeam ? "/team" : homeFor(state)); return; }

  if (raw.startsWith("/view-as/")) {
    const [keyPart, queryPart] = raw.slice("/view-as/".length).split("?");
    const key = decodeURIComponent(keyPart);
    const qs = new URLSearchParams(queryPart || "");
    const label = qs.get("label") || key;
    // Optional page to land on (the player dropdown keeps you on Data or Reports).
    const to = ["/dashboard", "/documents"].includes(qs.get("to")) ? qs.get("to") : "/dashboard";
    if (!team.preview && state.isTeam && key === state.profile?.clientKey) {
      previewClient = { key, label: state.profile?.name || "Me", self: true }; // a team member's own entered rounds
    } else if (team.isTeam && team.teamAccess[key]) {
      previewClient = { key, label: teamLabels(team.teamAccess).get(key) || label, role: team.teamAccess[key].role };
    } else if (state.isAdmin) {
      setPreviewTeam(null); // "See their portal" on a player: a plain player preview
      previewClient = { key, label };
    } else {
      previewClient = null;
      navigate(homeFor(state));
      return;
    }
    navigate(to);
    return;
  }
  if (raw === "/exit-preview") {
    previewClient = null;
    lastTeamPlayer = null;
    setPreviewTeam(null);
    navigate(homeFor(state));
    return;
  }
  // A team member whose access to this player was just removed goes back to their list.
  if (previewClient && !previewClient.self && team.isTeam && !team.teamAccess[previewClient.key]) previewClient = null;
  const path = raw.split("?")[0];
  const found = match(path);

  if (!found) { navigate(homeFor(state)); return; }
  const { guard, loader, routeId, params } = found;

  if (guard !== "public" && !state.user) { navigate(`/login?next=${encodeURIComponent(raw)}`); return; }
  if (guard === "public" && state.user) { navigate(homeFor(state)); return; }
  if (guard === "team" && !team.isTeam) { navigate(homeFor(state)); return; }
  // Team members (and the admin previewing one) skip the players list: open a player's data straight
  // away, keeping the last player chosen. The Data/Reports dropdown switches players. Only someone
  // with no players yet sees the /team page, which explains that.
  if (routeId === "team") {
    const keys = Object.keys(team.teamAccess).sort((a, b) =>
      (team.teamAccess[a].label || a).localeCompare(team.teamAccess[b].label || b));
    if (keys.length) {
      const key = lastTeamPlayer && team.teamAccess[lastTeamPlayer] ? lastTeamPlayer : keys[0];
      previewClient = { key, label: teamLabels(team.teamAccess).get(key) || key.replace(/^c_/, ""), role: team.teamAccess[key].role };
      navigate("/dashboard");
      return;
    }
  }
  if (previewClient?.role) lastTeamPlayer = previewClient.key;
  if (guard === "client" && team.isTeam && !previewClient && PLAYER_PAGES.includes(routeId)) { navigate("/team"); return; }
  if (guard === "admin" && !state.isAdmin) { navigate("/dashboard"); return; }
  // Going back to an admin page (e.g. opening a question from a preview) ends any preview.
  if (guard === "admin" && (previewClient || getPreviewTeam())) { previewClient = null; setPreviewTeam(null); }
  if (guard === "client" && state.isAdmin && !previewClient && !team.preview) { navigate("/admin/clients"); return; }
  if (guard === "client" && !state.isAdmin && !state.profile && state.status === "ready") {
    // Signed in, but no profile doc (e.g. access was removed by the admin).
    document.getElementById("app").textContent =
      "Your access to this portal has been removed. Contact Callaway Analysts if you think this is a mistake.";
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
    // (the admin in someone's portal also sees the bar on Data Entry, which shows that player's rounds)
    const adminEntry = state.isAdmin && ["entry", "entry-new", "entry-round"].includes(routeId);
    if ((previewClient && !previewClient.self && (PLAYER_PAGES.includes(routeId) || adminEntry || (state.isAdmin && guard === "client"))) || (team.preview && guard !== "admin")) {
      // The bar goes INSIDE <main> (placing it beside <main> breaks the two-column layout and
      // pushes the page off-screen). Views clear their container, so give them an inner one.
      const inner = document.createElement("div");
      main.append(el_previewBar(), inner);
      main = inner;
    }
  }

  try {
    const mod = await loader();
    if (gen !== renderGen) return;
    const cleanup = await mod.render(main, { params, previewClient, routeId, flash: (msg, type) => flash(main, msg, type) });
    if (gen !== renderGen) { if (typeof cleanup === "function") cleanup(); return; }
    currentCleanup = cleanup;
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
  const link = document.createElement("a");
  link.href = "#/exit-preview";
  const pt = getPreviewTeam();
  if (pt) {
    // Admin previewing a coach / caddy / analyst.
    const kind = pt.kind === "analyst" ? "Callaway Access" : "team member";
    span.append("Previewing ", Object.assign(document.createElement("strong"), { textContent: pt.name }), `'s portal (${kind})`);
    if (previewClient) span.append(" \u00b7 viewing ", Object.assign(document.createElement("strong"), { textContent: previewClient.label }));
    span.append(".");
    const links = document.createElement("span");
    links.className = "thread-actions";
    link.textContent = "Exit preview";
    links.append(link);
    bar.append(span, links);
    return bar;
  }
  const who = Object.assign(document.createElement("strong"), { textContent: previewClient.label });
  if (previewClient.role) {
    span.append("Viewing ", who, previewClient.role === "analyst" ? "'s portal with Callaway Access. View only." : `'s portal as their ${previewClient.role}. View only.`);
    bar.append(span);
    return bar;
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
      if (lastUid !== undefined && uid !== lastUid) { previewClient = null; lastTeamPlayer = null; setPreviewTeam(null); } // different person
      lastUid = uid;
      render();
    }
  });
  render();
}

export function getPreviewClient() { return previewClient; }
