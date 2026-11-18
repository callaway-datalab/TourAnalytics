import { listener, canListen, whyNothing } from "./listen.js"; // (update 646: started straight from the touch)
import { getPreviewTeam, effectiveTeam } from "./preview.js";
import { portalName } from "./firebase-init.js";
import { subscribe, signOut } from "./auth.js";
import { openPalette, setPages } from "./palette.js"; // (update 816: search everything)
import { currentPlayer, setCurrent, onCurrent, lastName } from "./current.js"; // (update 816: the current player)

/** Builds a DOM element without ever touching innerHTML, so nothing here can be an XSS vector.
 *  el('div', {class: 'x', onClick: fn}, ['text', childEl]) */
/* Optional logo: put an image at media/logo.png and it shows in the banner and on the login page. */
const LOGO_URL = "media/logo.png";
let logoMissing = false;
export function logoImg(cls = "brand-logo") {
  if (logoMissing) return null;
  const img = document.createElement("img");
  img.src = LOGO_URL; img.alt = ""; img.className = cls;
  img.addEventListener("error", () => { logoMissing = true; img.remove(); });
  return img;
}

/** Second row of pill buttons inside a section, e.g. Data: Upload | Analyze. items: [[href, label]]. */
export function subNav(items, currentHref) {
  return el("nav", { class: "subnav", "aria-label": "Section" }, items.map(([href, label]) =>
    el("a", { href, "aria-current": href === currentHref ? "page" : null }, label)));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node && k !== "list") node[k] = v; // property assignment (value, checked, htmlFor, ...) — never innerHTML
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children).flat(Infinity)) { // (update 760: nested lists flattened)
    if (child == null || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(child) : child);
  }
  return node;
}
export const text = (s) => document.createTextNode(s ?? "");
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, children) {
  clear(node);
  for (const c of [].concat(children).flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(c) : c);
  }
}

let robotN = 0;
export function icon(name) {
  const paths = {
    home: "M3 9.5 10 3l7 6.5V17H12v-4H8v4H3z",
    // (update 849) Your Report: a paper scroll (rolled ends, lines of text)
    report: "M5 2.5h9.5a2.5 2.5 0 0 1 2.5 2.5v.5h-2.5V5a.5.5 0 0 0-1 0v10.5A2.5 2.5 0 0 1 11 18H4.5A2.5 2.5 0 0 1 2 15.5V15h2.5V5A2.5 2.5 0 0 1 5 2.5zm1.8 4v1.4h5.4V6.5zm0 3v1.4h5.4V9.5zm0 3v1.4h3.6v-1.4zM12.6 4.5H6.4v10.9a2.4 2.4 0 0 1-.2.6H11a.5.5 0 0 0 .5-.5V5c0-.2 0-.3.1-.5z",
    rank: "M2 2.5h16v3.2H2zM2 7.5h3.4v2.6H2zm5 0h11v2.6H7zM2 11.5h3.4v2.6H2zm5 0h11v2.6H7zM2 15.5h3.4v2.6H2zm5 0h11v2.6H7z", // (update 828: Leaderboards, a rankings table)
    flag: "M5.2 1.8h1.5v14.6H5.2zM6.7 2.2l8.6 3.4-8.6 3.5zM1.8 17.4c0-1.1 2.9-1.9 6.4-1.9s6.4.8 6.4 1.9-2.9 1.9-6.4 1.9-6.4-.8-6.4-1.9zm2.6 0c.9.5 2.2.7 3.8.7s2.9-.2 3.8-.7c-.9-.5-2.2-.7-3.8-.7s-2.9.2-3.8.7z", // (update 831: Play, a golf flag in its hole)
    search: "M8.5 2a6.5 6.5 0 0 1 5.2 10.4l4.2 4.2-1.4 1.4-4.2-4.2A6.5 6.5 0 1 1 8.5 2zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z",
    plus: "M9 3h2v6h6v2h-6v6H9v-6H3V9h6z",
    star: "M10 2.2l2.4 5 5.4.6-4 3.7 1.1 5.4L10 14.2l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z",
    data: "M3 16V4h2v10h12v2zM7 12V8h2v4zm4 0V5h2v7zm4 0V9h2v3z",
    doc: "M5 2h7l4 4v12H5zm6 1.5V7h3.5zM7 10h7v1.5H7zm0 3h7v1.5H7z",
    chat: "M3 4h14v10H9l-4 3v-3H3z",
    // header icons: a word bubble (Chat), a golf bag (WITB) and a menu (Account)
    bubble: "M4 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9.5L5 17.5V14H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    bag: "M6.6 7.3h5.8v9.9a1.5 1.5 0 0 1-1.5 1.5H8.1a1.5 1.5 0 0 1-1.5-1.5zm1.6 3.4v3.4h2.6v-3.4zM6 5.2h7v1.8H6zm.9-.3V3.3a1.7 1.7 0 0 1 1.7-1.7h.8v3.3zm3.3 0V1.4h1.1l1.8 1.4-.6.9-1.1-.7v1.9zm2.9 3.2c2.3.4 3.1 3.8 1.5 6.8l-1.1-.6c1.2-2.4.7-4.5-.4-4.8z",
    menu: "M3 5h14v2H3zm0 4h14v2H3zm0 4h14v2H3z",
    // (update 258) Callie, the AI assistant: a small robot (antenna, head with eyes and a smile cut out, ears, shoulders)
    robot: "M9.25 1.2h1.5v2.4H15a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h4.25zM7.1 6.9a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7zm5.8 0a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7zM7 11.1v1.3h6v-1.3zM.9 7.2h1.3v3.6H.9zm16.9 0h1.3v3.6h-1.3zM5.6 15.4h8.8l1.1 3.4h-11z",
    people: "M7 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6 1a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM1 17c0-3 2.5-5 6-5s6 2 6 5zm12-4.5c2.6 0 5 1.4 5 4.5h-3.5c0-1.9-.7-3.5-1.5-4.5z",
    user: "M10 10a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM3 17c0-3.5 3-5.5 7-5.5s7 2 7 5.5z",
    // (update 188) Live Feed: a dot with signal rings
    live: "M10 12.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4zM5.4 14.6a6.5 6.5 0 0 1 0-9.2l1.1 1.1a5 5 0 0 0 0 7zm9.2 0-1.1-1.1a5 5 0 0 0 0-7l1.1-1.1a6.5 6.5 0 0 1 0 9.2zM3.2 16.8a9.6 9.6 0 0 1 0-13.6l1.1 1.1a8 8 0 0 0 0 11.4zm13.6 0-1.1-1.1a8 8 0 0 0 0-11.4l1.1-1.1a9.6 9.6 0 0 1 0 13.6z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  // (update 278) Callie is drawn from her picture (icons/callie.png: the robot in white), in the text colour
  if (name === "robot" || name === "calface") { // (update 624: calface: Cal without his speech bubble, for the header's coin)
    const ns = "http://www.w3.org/2000/svg", id = `callie-m${++robotN}`;
    const mask = document.createElementNS(ns, "mask"); mask.setAttribute("id", id);
    const img = document.createElementNS(ns, "image"); img.setAttribute("href", name === "calface" ? "icons/cal-face.png?v=8" : "icons/cal.png?v=4"); /* (update 620: Cal, the caddie in a speech bubble) */ img.setAttribute("width", "20"); img.setAttribute("height", "20");
    mask.appendChild(img);
    const rect = document.createElementNS(ns, "rect"); rect.setAttribute("width", "20"); rect.setAttribute("height", "20"); rect.setAttribute("fill", "currentColor"); rect.setAttribute("mask", `url(#${id})`);
    svg.append(mask, rect); svg.classList.add("ico-callie");
    return svg;
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || "");
  if (name === "bag" || name === "robot" || name === "flag") path.setAttribute("fill-rule", "evenodd"); // (the pocket, and the robot's face, are cut-outs)
  svg.appendChild(path);
  return svg;
}

export function formatWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export const num = (n) => Number(n ?? 0).toLocaleString();

export function flash(container, message, type = "info") {
  const node = el("p", { class: `flash ${type}`, role: type === "error" ? "alert" : "status" }, message);
  container.prepend(node);
  return node;
}

export function confirmAction(message) {
  return window.confirm(message);
}

/* ---------------- Layout: sidebar + main, rebuilt whenever auth state changes ---------------- */

// Two levels: a few headers in the top bar, each with its own row of pages under it.
//   [label, href, routeIds, { soon, q }]  (q: a ?cat= the link needs to count as current)
const teamCount = () => Object.keys(effectiveTeam(window.__authState || {}).teamAccess || {}).length;
// (update 297) Course Prep and Practice: open to the admin only for now; greyed out for everyone else
const soonFor = () => (shellKind() === "admin" ? {} : { off: true, offTitle: "Coming soon" }); // (update 298: in someone else's portal too)
const sectionsFor = (kind) => {
  const admin = kind === "admin", player = kind === "client";
  // (update 164) Watchlist: anyone with more than one player (Home for a player, or one player's coach)
  const multi = admin || (kind === "team" && teamCount() > 1);
  const statsItem = ([v, label]) => [label, `${admin ? "#/admin/player-stats" : kind === "team" && teamCount() > 1 ? "#/player-stats" : "#/dashboard"}?view=${v}`,
    admin ? ["admin-player-stats"] : ["dashboard", "dataset", "player-stats"], { view: v }];
  const dataItems = [
    // (update 292) the Watchlist is the first page of Analyze (and what Analyze opens on)
    // (update 609) the Watchlist is off the menu for now; (610) Home is its own header link, left of Analyze
    // (update 158: Stats split in two. A coach with more than one player starts Player Stats on the search.)
    // (update 505) Watchlist, Stats, Compare, Leaderboards
    // (update 833) Stats' views are its row of pages (the tabs that were on the page): each opens Stats on that view
    ...STATS_VIEWS.filter(([v]) => !PLAY_VIEWS.includes(v)).map(statsItem), // (update 858: What's in the Bag and Practice & Goals are under Play)
    // (update 160) no Performance Reports page
    // (update 188) Comparisons: a player's rounds side by side (Live Feed moved up to the top bar)
    // (update 817) the Player Dossier (Overview), Course Fit and Practice & Goals are tabs on Stats now
    // (update 827) Compare is a tab on Stats (its own address still works, for the links that open it set up)
    // (update 818) Leaderboards and the Event Feed are their own header, Follow
    // (update 827) Course Prep is back under Play
    // (update 209) no Product Usage tab: product usage is in Compare (staff can compare products across everyone)
  ];
  // (update 160) Course Prep (course reports, maps, history and simulated rounds), Enter New Round, Practice, Goals
  // (update 817) Play is Enter New Round only (Course Prep is under Analyze; Practice, Practice Week and Goals are a tab on Stats)
  // (update 818) Follow: the leaderboards (Historical) and the Event Feed (Live)
  const followItems = [
    ["Historical", admin ? "#/admin/analyze" : "#/leaderboards", admin ? ["admin-analyze"] : ["leaderboards"]],
    ["Live", "#/live", ["live"]],
  ];
  const planItems = [
    ["Enter New Round", "#/entry", ["entry", "entry-new", "entry-round"]],
    ["Course Prep", "#/course-prep", admin ? ["course-prep", "admin-documents", "admin-reports-view"] : ["course-prep"], {}], // (update 827)
    ...STATS_VIEWS.filter(([v]) => PLAY_VIEWS.includes(v)).map(statsItem), // (update 858: still Stats' own views, listed under Play)
  ];
  return [
    { id: "data", label: "Stats", icon: "data", items: dataItems }, // (update 827: was Analyze)
    { id: "follow", label: "Leaderboards", icon: "rank", items: followItems }, // (update 827: was Follow)
    { id: "plan", label: "Play", icon: "flag", items: planItems },
  ];
};
// (Player Access also holds Upload Data for the admin)
const NAV = { admin: [["#/admin/clients", "people", "User Access", ["admin-clients", "admin-datasets"]]] };
const catNow = () => new URLSearchParams(location.hash.split("?")[1] || "").get("cat") || "performance";
// (update 833) Stats' views, its row of pages; the one showing is ?view= in the address (Overview when there's none)
export const STATS_VIEWS = [["full", "Player Stats"], /* (update 838: no Overview (it's on Home now); Full stats renamed) */ ["results", "Tournament Results"], ["fit", "Course Fit"], ["compare", "Comparisons"], ["bag", "What's in the Bag"], ["practice", "Practice & Goals"]]; // (update 836: no Focus; Compare is Comparisons)
// (update 858) What's in the Bag and Practice & Goals are listed under Play (they're still Stats' views)
export const PLAY_VIEWS = ["bag", "practice"];
/** (update 858) can Stats switch from the view showing to `view` in place? Only within the same header (Stats or Play), so the header and its row of pages redraw when it changes */
export const sameStatsHeader = (view) => PLAY_VIEWS.includes(view) === PLAY_VIEWS.includes(statsViewNow());
export const statsViewNow = () => new URLSearchParams(location.hash.split("?")[1] || "").get("view") || "full";
const itemOn = (item, routeId) => {
  const [, , routes, opt = {}] = item;
  if (!routes.includes(routeId)) return false;
  if (opt.view) return opt.view === statsViewNow();
  return !opt.q || (routeId !== "admin-reports-view" ? opt.q === "performance" : catNow() === opt.q);
};

/**
 * Move the row of pages (Stats / Performance Reports / WITB / …) from above the page into `host` (under the
 * page's player search, say), and pull the page up close to the top bar. Returns the undo for the spacing.
 */
export function relocateSectionNav(main, host) {
  const prev = main?.previousElementSibling;
  const nav = prev?.classList?.contains("section-nav") ? prev : null;
  if (nav && host) { nav.classList.add("moved"); host.appendChild(nav); }
  const top = document.getElementById("main");
  top?.classList.add("tight-top");
  return () => top?.classList.remove("tight-top");
}

/** (update 833) A Stats view link: on Stats already, it switches the view in place (no reload); elsewhere it opens Stats on it */
function viewLink(a, view) {
  if (!view) return a;
  a.dataset.view = view;
  a.addEventListener("click", (e) => {
    if (!document.querySelector(".st-host") || !sameStatsHeader(view)) return; // (Stats isn't showing, or it's under the other header: a normal link)
    e.preventDefault(); history.replaceState(history.state, "", a.getAttribute("href"));
    window.dispatchEvent(new CustomEvent("ta-stats-view", { detail: { view } })); syncStatsNav(); closeBotPop();
  });
  return a;
}
/** light the Stats view that's showing, in the row under the header and the phone's pop-up menu */
export function syncStatsNav() { const v = statsViewNow(); document.querySelectorAll("a[data-view]").forEach((a) => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }); }
/** (update 833) on a phone, Stats, Leaderboards and Play open their pages in a row above the bottom bar */
let botPop = null;
export function closeBotPop() { botPop?.remove(); botPop = null; document.querySelectorAll(".botbar .on-pop").forEach((x) => x.classList.remove("on-pop")); }
function openBotPop(sec, btn) {
  const same = botPop && botPop.dataset.sec === sec.id; closeBotPop(); if (same) return;
  botPop = el("nav", { class: "botpop", "aria-label": sec.label, "data-sec": sec.id }, sec.items.filter((it) => !it[3]?.off).map((it) => { const [label, href, routes, opt = {}] = it;
    const a = el("a", { href, "aria-current": routes.includes(window.__routeId) && (!opt.view || opt.view === statsViewNow()) ? "page" : null }, label); a.addEventListener("click", () => setTimeout(closeBotPop, 0)); return viewLink(a, opt.view); }));
  document.body.append(botPop); btn.classList.add("on-pop");
  // (update 835) a list stacked above the button tapped, kept on screen
  { const r = btn.getBoundingClientRect(), w = botPop.offsetWidth, left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)); botPop.style.left = `${left}px`; }

}
addEventListener("hashchange", () => closeBotPop());
// (update 836) the phone's back button (or back swipe) closes an open pop-up instead of leaving the page, so a pop-up can
// always be closed even if its × is out of reach. Opening one adds a history step on the same address; closing it any other
// way takes that step back off (only while still on that address, so a link followed from a pop-up is never undone).
{ const POP_SEL = ".ip-popwrap, .gx-pop-overlay, .td-popwrap, .tr-popwrap, .ps-modal-wrap, .ah-sheet-wrap, .ax-wrap, .botpop";
  let pushed = false, at = "";
  const watch = () => new MutationObserver(() => { const open = document.querySelector(POP_SEL);
    if (open && !pushed) { try { history.pushState({ ...(history.state || {}), taPop: 1 }, "", location.href); pushed = true; at = location.href; } catch { /* */ } }
    else if (!open && pushed) { pushed = false; if (history.state?.taPop && location.href === at) history.back(); } }).observe(document.body, { childList: true });
  if (document.body) watch(); else addEventListener("DOMContentLoaded", watch);
  addEventListener("popstate", () => { if (!pushed) return; pushed = false; const all = document.querySelectorAll(POP_SEL), top = all[all.length - 1]; if (!top) return;
    if (top.classList.contains("botpop")) { closeBotPop(); return; }
    const x = top.querySelector(".ip-pop-x, .gx-pop-x, .td-pop-x, .tr-pop-x"); if (x) x.click(); else top.remove(); }); }
addEventListener("click", (e) => { if (botPop && !e.target.closest(".botpop, .botbar")) closeBotPop(); }, true);

/** The row of pages under the current header (Stats / Performance Reports / …), or null. */
export function sectionNav(currentRoute) {
  const kind = shellKind();
  const sec = sectionsFor(kind).find((x) => x.items.some((it) => itemOn(it, currentRoute)));
  if (!sec || sec.items.length < 2) return null; // (Watchlist / Home: no row of pages under it)
  return el("nav", { class: "section-nav", "aria-label": sec.label }, sec.items.map((it) => {
    const [label, href, , opt = {}] = it;
    const on = itemOn(it, currentRoute);
    // (update 205) greyed out until it has data; (update 207) a link with no address, so it's styled exactly like its neighbours
    if (opt.off) return el("a", { class: "nav-off", role: "link", "aria-disabled": "true", title: opt.offTitle || "Available once there\u2019s product data" }, label);
    return viewLink(el("a", { href, "aria-current": on ? "page" : null, class: opt.soon ? "soon" : null }, [label, opt.soon ? el("span", { class: "soon-tag" }, "Soon") : null]), opt.view);
  }));
}
function shellKind() {
  const state = window.__authState || {};
  const previewingTeam = state.isAdmin && !!getPreviewTeam();
  if (state.isAdmin && !window.__previewClient && !previewingTeam) return "admin";
  if ((!state.isAdmin && state.isTeam) || previewingTeam) return "team";
  return "client";
}

let unreadCount = 0;
export function setUnreadCount(n) {
  unreadCount = n;
  document.querySelectorAll("[data-unread-badge]").forEach((b) => {
    b.textContent = n;
    b.hidden = n < 1;
  });
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  document.title = n > 0 ? `(${n}) ${base}` : base;
}

/** (update 731) "Light mode" / "Dark mode": every page, kept on this device (js/theme.js). */
function themeItem() {
  const cur = () => (window.taTheme?.get?.() === "light" ? "light" : "dark");
  const b = el("button", { class: "menu-item menu-theme", type: "button", role: "menuitem" }, cur() === "light" ? "Dark mode" : "Light mode");
  b.addEventListener("click", () => { const t = cur() === "light" ? "dark" : "light"; window.taTheme?.set?.(t); b.textContent = t === "light" ? "Dark mode" : "Light mode"; });
  return b;
}
/* Account button: a drop-down with your email, Questions (with the unread count) and Reset Password. */
function accountMenu(state) {
  const email = state.user?.email || "";
  const btn = el("button", { class: "account-btn hdr-icon", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Menu", title: "Menu" }, [icon("menu"), el("span", { class: "badge menu-dot", dataset: { unreadBadge: "1" }, hidden: unreadCount < 1 }, String(unreadCount))]);
  const note = el("p", { class: "menu-note", role: "status", hidden: true });
  const reset = el("button", { class: "menu-item", type: "button", role: "menuitem" }, "Reset Password");
  reset.addEventListener("click", async () => {
    reset.disabled = true;
    try {
      const { sendPasswordReset } = await import("./store.js");
      await sendPasswordReset(email);
      note.textContent = `We've emailed a reset link to ${email}.`;
    } catch { note.textContent = "Couldn't send the reset email. Try again in a moment."; }
    finally { note.hidden = false; reset.disabled = false; }
  });
  const menu = el("div", { class: "account-menu", role: "menu", hidden: true }, [
    el("a", { class: "menu-item", href: "#/account", role: "menuitem" }, "Profile"),
    state.isAdmin && !window.__previewClient && !getPreviewTeam() ? el("a", { class: "menu-item", href: "#/admin/clients", role: "menuitem" }, "User Access") : null, // (update 832: from the top bar)
    state.isAdmin || state.profile?.kind === "analyst" ? el("a", { class: "menu-item menu-bulk", href: "#/bulk-reports", role: "menuitem" }, "Bulk Reports") : null, // (update 740)
    // (update 829) Chat & support: report an issue, ask a question, request a feature (the unread count beside it)
    el("a", { class: "menu-item menu-chat", href: state.isAdmin ? "#/admin/questions" : "#/questions", role: "menuitem" }, [state.isAdmin || state.profile?.kind === "analyst" ? "Chat" : "Chat & support", el("span", { class: "badge", dataset: { unreadBadge: "1" }, hidden: unreadCount < 1 }, String(unreadCount))]),
    state.isAdmin ? el("button", { class: "menu-item menu-perf", type: "button", role: "menuitem", onClick: () => { setOpen(false); import("./perf.js").then((m) => m.togglePerf()); } }, "Performance") : null, // (update 325)
    themeItem(), // (update 731)
    el("button", { class: "menu-item menu-logout", type: "button", role: "menuitem", onClick: () => signOut() }, "Log out"),
  ]);
  const wrap = el("div", { class: "account" }, [btn, menu]);
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); if (!open) note.hidden = true; };
  // Opened from the keyboard (detail 0), move focus into the menu; a tap or click leaves it be.
  btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); if (!menu.hidden && e.detail === 0) menu.querySelector(".menu-item")?.focus(); });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  currentAccountMenu = { wrap, btn, menu, setOpen };
  return wrap;
}
/** (update 305) "Report an issue": a short note that goes only to the admin (it lands in their Chat; they can reply there). */
function reportIssueDialog() {
  const st = window.__authState;
  if (!st?.user) return;
  document.querySelector("dialog.issue-dialog")?.remove();
  const text = el("textarea", { rows: 5, maxLength: 1800, placeholder: "What went wrong? What were you doing when it happened?", "aria-label": "Describe the issue" });
  const msg = el("p", { class: "muted small issue-msg", role: "status" });
  const send = el("button", { class: "btn", type: "submit" }, "Send");
  const cancel = el("button", { class: "btn ghost", type: "button" }, "Cancel");
  const form = el("form", { class: "issue-form" }, [
    el("h3", {}, "Report an issue"),
    el("p", { class: "muted small" }, st.isAdmin ? "You’re the admin: reports from everyone arrive in your Chat, marked ⚠." : "This goes only to the admin, not to analysts or anyone else. Any reply shows in your Chat."),
    text, msg, el("div", { class: "issue-btns" }, [cancel, send]),
  ]);
  const dlg = el("dialog", { class: "issue-dialog", "aria-label": "Report an issue" }, form);
  const close = () => { try { dlg.close(); } catch { /* */ } dlg.remove(); };
  cancel.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) { msg.textContent = "Write a line or two about what happened."; text.focus(); return; }
    if (st.isAdmin) { msg.textContent = "As the admin you’d be sending this to yourself."; return; }
    send.disabled = true; send.textContent = "Sending…";
    try {
      const { reportIssue } = await import("./store.js");
      await reportIssue({ uid: st.user.uid, name: st.profile?.name || st.user.displayName || st.user.email || "", text: body, page: (location.hash || "#/").slice(0, 120) });
      mount(form, [el("h3", {}, "Thanks: sent"), el("p", { class: "muted small" }, "The admin has it. If they reply, you’ll see it in Chat under “Report an issue”."),
        el("div", { class: "issue-btns" }, el("button", { class: "btn", type: "button", onClick: close }, "Close"))]);
    } catch {
      msg.textContent = "Couldn’t send that. Try again in a moment.";
      send.disabled = false; send.textContent = "Send";
    }
  });
  document.body.append(dlg);
  try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
  text.focus();
}
// One set of page-wide listeners for whichever Account menu is on screen (the header is redrawn often).
let currentAccountMenu = null;
document.addEventListener("click", (e) => { const m = currentAccountMenu; if (m && !m.wrap.contains(e.target)) m.setOpen(false); });
document.addEventListener("keydown", (e) => { const m = currentAccountMenu; if (m && e.key === "Escape" && !m.menu.hidden) { m.setOpen(false); m.btn.focus(); } });
window.addEventListener("hashchange", () => currentAccountMenu?.setOpen(false));

/** (update 258) Callie in the header: opens her chat panel over whatever page is showing. */
// (update 281) Cal is on per person (the admin turns him on); the admin always has him
let calOn = null, calFor = null;
let caMsgOn = null; // (update 305) may they message Callaway Analyst (null: not known yet = yes)
export function analystAllowed() { const st = window.__authState; return !!st?.isAdmin || st?.profile?.kind === "analyst" || caMsgOn !== false; }
export function calAllowed() { const st = window.__authState; return !!st?.isAdmin || calOn === true; }
function checkCal() {
  const st = window.__authState, uid = st?.user?.uid;
  if (st?.isAdmin || !uid || calFor === uid) return;
  calFor = uid; calOn = null; caMsgOn = null;
  import("./store.js").then((m) => m.myAnalystAccess(st.profile?.inviteCode)).then((on) => { caMsgOn = on; }).catch(() => {});
  import("./store.js").then((m) => m.myCalAccess(st.profile?.inviteCode)).then((on) => {
    calOn = on; document.querySelectorAll(".callie-link").forEach((x) => { x.hidden = !on; });
  }).catch(() => {});
}
function callieButton() {
  checkCal();
  const b = el("button", { type: "button", class: "hdr-icon callie-link", hidden: !calAllowed(), "aria-label": "Ask Cal", title: "Ask Cal: any question about a player\u2019s data" }, [icon("calface"), el("span", { class: "callie-name" }, "Cal")]);
  let held = false;
  b.addEventListener("click", (e) => { if (held) { held = false; e.preventDefault(); return; } import("./callie.js").then((m) => m.openCallie()).catch((err) => console.error(err)); });
  holdToTalk(b, () => { held = true; });
  return b;
}
/* (update 644) hold the header's Cal: the microphone starts at once (no need to open Cal), and what you say is asked when
   you let go: a question opens Cal with its answer; a shot ("I just hit a 5 iron to the green, 25 ft left") goes into
   your round in progress. A tap still just opens Cal. */
export function holdToTalk(b, onHold = () => {}) {
  // (update 645) only letting go ends it (iPhone cancelled the touch mid-hold).
  // (update 646) the microphone starts the moment your finger goes down (iPhone only hears a session started straight from
  // a touch: one started a moment later, once it was clearly a hold, heard nothing, so letting go always said "I didn't
  // catch that"). A tap, let go before it's a hold, drops it unheard and does what a tap does. On iPhone a pause ends the
  // listening (it can't be restarted unheard), so what you said is sent then, without waiting for you to let go.
  if (!canListen()) return;
  b.classList.add("cal-holdable");
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  let timer = null, L = null, holding = false, armed = false, pill = null, sent = false;
  const show = (msg, live = true) => {
    if (!pill) { pill = el("div", { class: "cal-hold", role: "status", "aria-live": "polite" }); pill.onclick = () => release(); document.body.appendChild(pill); }
    pill.classList.toggle("live", live);
    mount(pill, [live ? el("span", { class: "cal-hold-dot", "aria-hidden": "true" }) : null, el("span", {}, msg)]);
  };
  const hide = (ms = 0) => { const p = pill; setTimeout(() => { p?.remove(); if (pill === p) pill = null; }, ms); };
  const send = (text) => {
    if (sent) return; sent = true;
    if (!text) { show(`I didn\u2019t catch that (${whyNothing()}).`, false); hide(5000); return; } // (update 651: why)
    show(`\u201c${text}\u201d`, false); hide(1500);
    import("./callie.js").then((m) => m.askHeld(text)).catch((err) => console.error(err));
  };
  const release = async () => {
    // a tap: the microphone (started silently at the touch) dropped at once, nothing listened to, Cal just opens
    if (timer) { clearTimeout(timer); timer = null; armed = false; const l = L; L = null; l?.cancel(); return; }
    if (!holding) return;
    holding = false;
    const l = L; L = null;
    send(l ? await l.stop() : "");
  };
  const down = (e) => {
    if (e.button > 0 || holding || armed) return;
    armed = true; sent = false;
    // (update 687) the microphone starts silently the moment the finger goes down: iPhone only lets it start from the touch
    // itself (started a moment later, once it was clearly a hold, it was cancelled at once: "it was interrupted"). Nothing
    // shows and nothing is used until it's a hold; a tap drops it straight away.
    L = listener({
      onText: (t) => { if (holding) show(t || "Listening\u2026 let go to ask"); },
      onBlocked: () => { holding = false; armed = false; show("Microphone blocked: allow it for this site in Settings", false); hide(2500); },
      onPause: (t) => { if (holding) { holding = false; L = null; send(t); } },
    });
    try { L.start(); } catch (err) { console.error(err); L = null; }
    timer = setTimeout(() => {
      timer = null; armed = false;
      if (!L) { import("./callie.js").then((m) => m.openCallie()); return; }
      holding = true; onHold();
      try { navigator.vibrate?.(15); } catch { /* */ }
      show("Listening\u2026 let go to ask");
      setTimeout(() => { if (holding) release(); }, 45000); // (never left listening)
    }, 380);
    const up = () => { window.removeEventListener("pointerup", up); window.removeEventListener("touchend", up); release(); };
    window.addEventListener("pointerup", up); window.addEventListener("touchend", up);
  };
  b.addEventListener("pointerdown", down);
}

// (update 816) Search's extra words for each page, so "sg" or "drills" finds the right one
const WORDS = { Stats: "strokes gained sg radar season form", "Player Dossier": "player profile report overview pdf", "Course Fit": "suits who next event projection",
  Compare: "versus side by side products", Historical: "leaderboards rank ranking field follow", Live: "event feed live tournament scores follow", "Enter New Round": "add round entry scorecard",
  "Course Prep": "maps strategy holes course report", Practice: "drills sessions range", "Practice Week": "plan drills schedule", Goals: "targets" };
/** (update 816) the current player in the header: tap for their Dossier, × to let go of them */
const playerOnly = () => { const st = window.__authState; return !!(st?.profile?.clientKey && !st.isAdmin && !st.isTeam); }; // a player is always themself
function paintChip(n, c) {
  // (update 817) the one place a player is picked: "Pick a player" until there is one; then their name (tap to switch) and ×
  n.hidden = playerOnly(); if (n.hidden) { n.replaceChildren(); return; }
  if (!c) { const b = el("button", { type: "button", class: "cur-go cur-pick" }, [el("i", { "aria-hidden": "true" }), "Pick a player"]); b.addEventListener("click", () => openPalette("", { pick: true })); n.classList.add("empty"); n.replaceChildren(b); n.title = "Pick a player: every page opens on them"; return; }
  n.classList.remove("empty"); n.title = `${c.label}: the player on every page (tap to switch)`;
  const a = el("button", { type: "button", class: "cur-go" }, [el("i", { "aria-hidden": "true" }), lastName(c.label)]); a.addEventListener("click", () => openPalette("", { pick: true }));
  // (update 863) a coach or caddie with one player: always them (no ×; the picker offers only them and "Me")
  const st0 = window.__authState || {}, tk = st0.isAdmin ? [] : Object.keys(effectiveTeam(st0).teamAccess || {}), locked = tk.length === 1 && c.key === tk[0];
  const x = locked ? null : el("button", { type: "button", class: "cur-x", "aria-label": `Clear ${c.label}` }, "×"); x?.addEventListener("click", () => setCurrent(null));
  n.replaceChildren(...[a, x].filter(Boolean));
}
function curChip() { const n = el("span", { class: "cur-chip" }); paintChip(n, currentPlayer()); return n; }
onCurrent((c) => { for (const n of document.querySelectorAll(".cur-chip")) paintChip(n, c); });
export function renderShell(root, { previewClient, currentRoute }) {
  window.__routeId = currentRoute; // (update 833: the phone's pop-up menu lights the page showing)
  const state = window.__authState;
  const previewingTeam = state.isAdmin && !!getPreviewTeam(); // admin looking at a coach/caddy/analyst's portal
  const admin = state.isAdmin && !previewClient && !previewingTeam;
  const team = (!state.isAdmin && state.isTeam) || previewingTeam;
  window.__previewClient = previewClient || null;
  const kind = admin ? "admin" : team ? "team" : "client";
  // top bar: (Player Access,) Analyze, Play — each opens on its first page
  const secs = sectionsFor(kind), onSec = secs.find((sec) => sec.items.some((it) => itemOn(it, currentRoute)));
  const items = [/* (update 832: User Access is in the ☰ menu) */ ["#/home", "home", "Your Report", ["home"]] /* (update 849: was Home) */ /* (update 610) */, ...secs.map((sec) => [sec.items.find((it) => !it[3]?.soon)[1], sec.icon, sec.label, sec === onSec ? [currentRoute] : []])];
  // In the admin's preview the unread count would be the admin's own inbox, so leave it off there.
  const showBadge = !(state.isAdmin && (previewClient || previewingTeam));

  const nav = el("nav", { "aria-label": "Main" }, [
    ...items
      .map(([href, ic, label, matches]) => {
        const isCurrent = matches.includes(currentRoute);
        const link = el("a", { href, "aria-current": isCurrent ? "page" : null }, [icon(ic), text(" " + label)]);
        return link;
      }),
    // (update 611) the Event Feed is in Analyze now (after Leaderboards), not in the top bar
  ]);

  const askBadge = showBadge ? el("span", { class: "badge", dataset: { unreadBadge: "1" }, hidden: unreadCount < 1 }, String(unreadCount)) : null;
  // Chat (with Questions inside it) first, then Account; both look like the other header links.
  const footItems = [
    // (update 258) Callie (a robot: ask anything about a player's data), WITB (a golf bag) and Chat (a word bubble), then the Account menu
    callieButton(),
    el("a", { class: "hdr-icon witb-link", href: "#/witb", "aria-label": "WITB", title: "WITB", "aria-current": currentRoute === "witb" ? "page" : null }, [icon("bag")]),
    el("a", { class: "ask-link hdr-icon", href: admin ? "#/admin/questions" : "#/questions", "aria-label": "Chat", title: "Chat", "aria-current": ["questions", "question-new", "thread", "admin-questions", "admin-thread"].includes(currentRoute) ? "page" : null }, [icon("bubble"), askBadge]),
    accountMenu(state),
  ];

  // (update 816) the pages Search knows, a search button, the current player's chip, and on phones a bottom bar
  setPages(() => [["Your Report", "#/home", "", "home today daily report news"], ...(admin ? NAV.admin.map(([href, , label]) => [label, href, "Admin", "users codes access players"]) : []), ...secs.flatMap((sec) => sec.items.filter((it) => !it[3]?.off && !it[3]?.soon).map((it) => [it[0], it[1], sec.label, WORDS[it[0]] || ""])),
["Comparisons", "stats:compare", "Stats", "versus side by side products compare comparisons"], ["Course Fit", "stats:fit", "Stats", "suits which courses tournaments"],
    ["Custom Practice", "stats:practice:practice", "Stats · Practice & Goals", "practice drills sessions range"], ["Recommended Practice", "stats:practice:week", "Stats · Practice & Goals", "practice week plan drills next event"], ["Goals", "stats:practice:goals", "Stats · Practice & Goals", "targets"],
    ["What's in the Bag", "stats:bag", "Stats", "witb clubs equipment gear bag"], ["Chat & support", state.isAdmin ? "#/admin/questions" : "#/questions", "", "report an issue question feature request help chat"], ["Profile", "#/account", "Account", "settings password"]]
    .map(([label, href, group, words]) => ({ label, href, group, words })));
  const searchBtn = el("button", { type: "button", class: "hdr-icon search-btn", "aria-label": "Search (Ctrl+K)", title: "Search players, pages, courses (Ctrl+K)" }, [icon("search")]);
  searchBtn.addEventListener("click", () => openPalette());
  // (update 829) the top bar: the player picker, Cal and the ☰ menu (Chat & support and What's in the Bag moved: the menu, a Stats tab)
  footItems.splice(0, footItems.length, curChip(), callieButton(), accountMenu(state));
  void searchBtn;
  const plan = secs.find((x) => x.id === "plan"), data = secs.find((x) => x.id === "data");
  const fol = secs.find((x) => x.id === "follow");
  // (update 849) Cal AI: opens (or closes) Cal's small panel over the bar
  const botCal = (() => { const b = el("button", { type: "button", class: "botbar-cal", "aria-label": "Cal AI" }, [icon("calface"), el("span", {}, "Cal AI")]);
    b.addEventListener("click", () => import("./callie.js").then((m) => (document.documentElement.classList.contains("cal-open") ? m.closeCallie?.() : m.openCallie())).catch((err) => console.error(err))); return b; })();
  const srch = (() => { const b = el("button", { type: "button", class: "botbar-search" }, [icon("search"), el("span", {}, "Search")]); b.addEventListener("click", () => openPalette()); return b; })();
  // (update 829) Home, Stats, Play, Leaderboards, Search
  const bot = el("nav", { class: "botbar", "aria-label": "Quick" }, [
    el("a", { href: "#/home", "aria-current": currentRoute === "home" ? "page" : null }, [icon("report"), el("span", {}, "Your Report")]), /* (update 849) */
    ...[[data, "data"], [plan, plan?.icon || "flag"], [fol, fol?.icon || "rank"]].map(([sec, ic]) => { if (!sec) return null;
      const b = el("a", { href: sec.items[0][1], "aria-current": sec === onSec ? "page" : null, role: "button", "aria-haspopup": "true" }, [icon(ic), el("span", {}, sec.label)]);
      b.addEventListener("click", (e) => { e.preventDefault(); openBotPop(sec, b); }); return b; }),
    calAllowed() ? botCal : srch, /* (update 849: Cal AI in Search's place on the phone's bar) */
  ]);
  const rail = el("aside", { class: "rail" }, [
    el("a", { class: "brand", href: "#/home" }, [logoImg(), portalName]),
    nav,
    el("div", { class: "rail-foot" }, footItems),
  ]);
  // (the bottom bar lives on the page itself: inside the header it would scroll away with it)
  document.querySelector("body > .botbar")?.remove(); document.body.append(bot);
  // (update 281) Going to another page keeps the header that's already there (no flicker): when it would come out the
  // same, only which link is lit changes, and just the page below is replaced.
  const old = root.querySelector(":scope > .shell > .rail");
  if (old && keepHeader(old, rail)) {
    const main = el("main", { id: "main" });
    root.querySelector(":scope > .shell > main")?.replaceWith(main);
    return main;
  }
  mount(root, el("div", { class: "shell" }, [rail, el("main", { id: "main" })]));
  return document.getElementById("main");
}
/** The same header, apart from which link is lit? Then light the right ones in the old one, and keep it. */
const headerKey = (node) => {
  const c = node.cloneNode(true);
  c.querySelectorAll(".subhead").forEach((x) => x.remove());
  c.querySelectorAll("[aria-current]").forEach((x) => x.removeAttribute("aria-current"));
  // (things the header sets on itself after it's drawn: the Event Feed link, a logo that didn't load)
  c.querySelectorAll("[data-live-link]").forEach((x) => { ["href", "title", "aria-disabled", "class"].forEach((k) => x.removeAttribute(k)); });
  c.querySelectorAll(".brand-logo").forEach((x) => x.removeAttribute("hidden"));
  c.querySelectorAll(".callie-link").forEach((x) => x.removeAttribute("hidden"));
  c.querySelectorAll(".cur-chip").forEach((x) => { x.replaceChildren(); x.removeAttribute("hidden"); x.removeAttribute("title"); });
  return c.outerHTML.replace(/callie-m\d+/g, "");
};
function keepHeader(oldNode, newNode) {
  if (headerKey(oldNode) !== headerKey(newNode)) return false;
  syncCurrent(oldNode, newNode);
  return true;
}
function syncCurrent(oldNode, newNode) {
  const skip = (x) => !x.closest(".subhead") || newNode.classList?.contains("subhead");
  const o = [...oldNode.querySelectorAll("a, button")].filter(skip), n = [...newNode.querySelectorAll("a, button")];
  o.forEach((x, i) => { const v = n[i]?.getAttribute("aria-current"); if (v) x.setAttribute("aria-current", v); else x.removeAttribute("aria-current"); });
}
/** (update 281) The row of pages under the header: kept as it is when it's the same row (just the lit link moves). */
export function placeSubhead(rail, sub) {
  const old = rail.querySelector(":scope > .subhead");
  if (old && sub && headerKey(old) === headerKey(sub)) { syncCurrent(old, sub); return; }
  old?.remove();
  if (sub) rail.appendChild(sub);
}

subscribe((s) => { window.__authState = s; });

// (update 188) Live Feed in the top bar: live when liveFeed/status says an event is on (the admin sets it),
// greyed out (and not a link) otherwise
// (update 259) the Live Feed always has the latest tournaments to show now, so it's always open
let liveOn = true, liveWatching = true;
function paintLive() {
  document.querySelectorAll("[data-live-link]").forEach((a) => {
    a.classList.toggle("nav-off", !liveOn);
    if (liveOn) { a.setAttribute("href", "#/live"); a.removeAttribute("aria-disabled"); a.title = "Event Feed"; }
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); a.title = "Event Feed: no live event right now"; }
  });
}
function liveLink(currentRoute) {
  const a = el("a", { class: "live-link", dataset: { liveLink: "1" }, "aria-current": currentRoute === "live" ? "page" : null }, [icon("live"), text(" Event Feed")]);
  if (!liveWatching) {
    liveWatching = true;
    Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")])
      .then(([fs, fi]) => fs.onSnapshot(fs.doc(fi.db, "liveFeed", "status"), (d) => { liveOn = !!(d.exists() && d.data().active); paintLive(); }, () => {}))
      .catch(() => {});
  }
  setTimeout(paintLive, 0);
  return a;
}

const loadedScripts = new Map();
/** Loads a plain (non-module) script once and caches the promise, for UMD libraries like Chart.js. */
export function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

/* Opening a file in a new tab on phones: browsers (iPhone especially) only allow a new tab straight from a
   tap, not after the file has finished downloading. So: open the tab on the tap, then show the file in it
   when it's ready; if no tab could be opened, download the file instead. */
export function openTabNow() {
  let w = null;
  try {
    w = window.open("", "_blank");
    if (w) { w.opener = null; w.document.title = "Opening\u2026"; w.document.body.innerHTML = '<p style="font:16px -apple-system,Helvetica,Arial,sans-serif;padding:24px;color:#555">Opening\u2026</p>'; }
  } catch { w = null; }
  return {
    show(url, name = "file") {
      if (w && !w.closed) { w.location.href = url; return; }
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
    },
    close() { try { w?.close(); } catch { /* fine */ } },
  };
}

/* Drop-downs (update 140): an open list that would run off the right edge of the screen opens leftwards from its
   button instead, so it always drops straight down from where you tapped. */
function keepPanelsOnScreen() {
  document.querySelectorAll(".ms-panel:not([hidden])").forEach((p) => {
    p.classList.remove("to-left");
    const r = p.getBoundingClientRect();
    if (r.right > window.innerWidth - 6) p.classList.add("to-left");
  });
}
document.addEventListener("click", () => requestAnimationFrame(keepPanelsOnScreen), true);
document.addEventListener("click", () => requestAnimationFrame(keepPanelsOnScreen));

/** (update 366) An explainer behind a small ⓘ: tap it to read the note (one paragraph, or a list of them). */
export function infoTip(content, label = "What this means") {
  const paras = (Array.isArray(content) && content.every((x) => typeof x === "string") ? content : [content]).filter((x) => x != null && x !== "");
  return el("details", { class: "bs-help info-tip" }, [el("summary", { "aria-label": label, title: label }, "ⓘ"), ...paras.map((x) => el("p", { class: "muted small" }, x))]);
}

/** (update 643) every page someone can open from the menus, for Cal to take them there: [{ label, href, section }] */
export function siteLinks() {
  const kind = shellKind(), admin = kind === "admin", out = [];
  if (admin) out.push({ label: "User Access", href: "#/admin/clients", section: "" }, { label: "Upload Data", href: "#/admin/datasets", section: "User Access" });
  out.push({ label: "Your Report", href: "#/home", section: "" });
  for (const sec of sectionsFor(kind)) for (const it of sec.items) if (!it[3]?.off) out.push({ label: it[0], href: it[1], section: sec.label });
  out.push({ label: "WITB", href: "#/witb", section: "" }, { label: "Chat", href: admin ? "#/admin/questions" : "#/questions", section: "" }, { label: "Profile", href: "#/account", section: "" });
  return out;
}

/* (update 735) Bars that scroll sideways (tabs, pills, section links): a ‹ or › at the edge while there's more that way.
   Classes sh-l / sh-r on the bar (css: the arrow and a fade, drawn by the bar itself, nothing added inside it). */
const SH_SEL = ".subnav, .section-nav, .gx-ov-range, .pr-pills, .pr-strip, .wl-alert-row, .cmp-chips.cmp-win-row, .cmp-dist-tabs, .sh-holes, .hm-rads, .hm-row, .ah-tabs, .td-secs, .td-grp";
const shSeen = new WeakSet();
function shUpdate(n) {
  const max = n.scrollWidth - n.clientWidth;
  n.classList.toggle("sh-l", max > 2 && n.scrollLeft > 2);
  n.classList.toggle("sh-r", max > 2 && n.scrollLeft < max - 2);
}
function shScan() {
  for (const n of document.querySelectorAll(SH_SEL)) {
    if (!shSeen.has(n)) { shSeen.add(n); n.addEventListener("scroll", () => shUpdate(n), { passive: true }); }
    shUpdate(n);
  }
}
if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(shScan, 150); };
  const start = () => { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); window.addEventListener("resize", later); later(); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
}
