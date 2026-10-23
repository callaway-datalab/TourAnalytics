import { getPreviewTeam, effectiveTeam } from "./preview.js";
import { portalName } from "./firebase-init.js";
import { subscribe, signOut } from "./auth.js";

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
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(child) : child);
  }
  return node;
}
export const text = (s) => document.createTextNode(s ?? "");
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, children) {
  clear(node);
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(c) : c);
  }
}

let robotN = 0;
export function icon(name) {
  const paths = {
    home: "M3 9.5 10 3l7 6.5V17H12v-4H8v4H3z",
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
  if (name === "robot") {
    const ns = "http://www.w3.org/2000/svg", id = `callie-m${++robotN}`;
    const mask = document.createElementNS(ns, "mask"); mask.setAttribute("id", id);
    const img = document.createElementNS(ns, "image"); img.setAttribute("href", "icons/callie.png"); img.setAttribute("width", "20"); img.setAttribute("height", "20");
    mask.appendChild(img);
    const rect = document.createElementNS(ns, "rect"); rect.setAttribute("width", "20"); rect.setAttribute("height", "20"); rect.setAttribute("fill", "currentColor"); rect.setAttribute("mask", `url(#${id})`);
    svg.append(mask, rect); svg.classList.add("ico-callie");
    return svg;
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || "");
  if (name === "bag" || name === "robot") path.setAttribute("fill-rule", "evenodd"); // (the pocket, and the robot's face, are cut-outs)
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
const sectionsFor = (kind) => {
  const admin = kind === "admin", player = kind === "client";
  // (update 164) Watchlist: anyone with more than one player (Home for a player, or one player's coach)
  const multi = admin || (kind === "team" && teamCount() > 1);
  const dataItems = [
    // (update 292) the Watchlist is the first page of Analyze (and what Analyze opens on)
    [multi ? "Watchlist" : "Home", "#/watchlist", ["watchlist"]],
    // (update 158: Stats split in two. A coach with more than one player starts Player Stats on the search.)
    ["Leaderboards", admin ? "#/admin/analyze" : "#/leaderboards", admin ? ["admin-analyze"] : ["leaderboards"]],
    ["Stats", admin ? "#/admin/player-stats" : kind === "team" && teamCount() > 1 ? "#/player-stats" : "#/dashboard",
      admin ? ["admin-player-stats"] : ["dashboard", "dataset", "player-stats"]],
    // (update 160) no Performance Reports page
    // (update 188) Comparisons: a player's rounds side by side (Live Feed moved up to the top bar)
    ["Compare", "#/comparisons", ["comparisons"]], // (update 205: Deep Dives; 209: Compare)
    // (update 209) no Product Usage tab: product usage is in Compare (staff can compare products across everyone)
  ];
  // (update 160) Course Prep (course reports, maps, history and simulated rounds), Enter New Round, Practice, Goals
  const planItems = [
    ["Enter New Round", "#/entry", ["entry", "entry-new", "entry-round"]], // (update 292: first, and what Play opens on)
    ["Course Prep", "#/course-prep", admin ? ["course-prep", "admin-documents", "admin-reports-view"] : ["course-prep"]],
    ["Practice", "#/practice", ["practice"]],
    ["Goals", admin ? "#/admin/goals" : "#/goals", admin ? ["admin-goals"] : ["goals"]],
  ];
  return [
    { id: "data", label: "Analyze", icon: "data", items: dataItems },
    { id: "plan", label: "Play", icon: "doc", items: planItems },
  ];
};
// (Player Access also holds Upload Data for the admin)
const NAV = { admin: [["#/admin/clients", "people", "User Access", ["admin-clients", "admin-datasets"]]] };
const catNow = () => new URLSearchParams(location.hash.split("?")[1] || "").get("cat") || "performance";
const itemOn = (item, routeId) => {
  const [, , routes, opt = {}] = item;
  if (!routes.includes(routeId)) return false;
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

/** The row of pages under the current header (Stats / Performance Reports / …), or null. */
export function sectionNav(currentRoute) {
  const kind = shellKind();
  const sec = sectionsFor(kind).find((x) => x.items.some((it) => itemOn(it, currentRoute)));
  if (!sec || sec.items.length < 2) return null; // (Watchlist / Home: no row of pages under it)
  return el("nav", { class: "section-nav", "aria-label": sec.label }, sec.items.map((it) => {
    const [label, href, , opt = {}] = it;
    const on = itemOn(it, currentRoute);
    // (update 205) greyed out until it has data; (update 207) a link with no address, so it's styled exactly like its neighbours
    if (opt.off) return el("a", { class: "nav-off", role: "link", "aria-disabled": "true", title: "Available once there\u2019s product data" }, label);
    return el("a", { href, "aria-current": on ? "page" : null, class: opt.soon ? "soon" : null }, [label, opt.soon ? el("span", { class: "soon-tag" }, "Soon") : null]);
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

/* Account button: a drop-down with your email, Questions (with the unread count) and Reset Password. */
function accountMenu(state) {
  const email = state.user?.email || "";
  const btn = el("button", { class: "account-btn hdr-icon", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Account", title: "Account" }, [icon("menu")]);
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
// One set of page-wide listeners for whichever Account menu is on screen (the header is redrawn often).
let currentAccountMenu = null;
document.addEventListener("click", (e) => { const m = currentAccountMenu; if (m && !m.wrap.contains(e.target)) m.setOpen(false); });
document.addEventListener("keydown", (e) => { const m = currentAccountMenu; if (m && e.key === "Escape" && !m.menu.hidden) { m.setOpen(false); m.btn.focus(); } });
window.addEventListener("hashchange", () => currentAccountMenu?.setOpen(false));

/** (update 258) Callie in the header: opens her chat panel over whatever page is showing. */
// (update 281) Cal is on per person (the admin turns him on); the admin always has him
let calOn = null, calFor = null;
export function calAllowed() { const st = window.__authState; return !!st?.isAdmin || calOn === true; }
function checkCal() {
  const st = window.__authState, uid = st?.user?.uid;
  if (st?.isAdmin || !uid || calFor === uid) return;
  calFor = uid; calOn = null;
  import("./store.js").then((m) => m.myCalAccess(st.profile?.inviteCode)).then((on) => {
    calOn = on; document.querySelectorAll(".callie-link").forEach((x) => { x.hidden = !on; });
  }).catch(() => {});
}
function callieButton() {
  checkCal();
  const b = el("button", { type: "button", class: "hdr-icon callie-link", hidden: !calAllowed(), "aria-label": "Ask Cal", title: "Ask Cal: any question about a player\u2019s data" }, [icon("robot"), el("span", { class: "callie-name" }, "Cal")]);
  b.addEventListener("click", () => import("./callie.js").then((m) => m.openCallie()).catch((err) => console.error(err)));
  return b;
}

export function renderShell(root, { previewClient, currentRoute }) {
  const state = window.__authState;
  const previewingTeam = state.isAdmin && !!getPreviewTeam(); // admin looking at a coach/caddy/analyst's portal
  const admin = state.isAdmin && !previewClient && !previewingTeam;
  const team = (!state.isAdmin && state.isTeam) || previewingTeam;
  window.__previewClient = previewClient || null;
  const kind = admin ? "admin" : team ? "team" : "client";
  // top bar: (Player Access,) Analyze, Play — each opens on its first page
  const secs = sectionsFor(kind), onSec = secs.find((sec) => sec.items.some((it) => itemOn(it, currentRoute)));
  const items = [...(admin ? NAV.admin : []), ...secs.map((sec) => [sec.items.find((it) => !it[3]?.soon)[1], sec.icon, sec.label, sec === onSec ? [currentRoute] : []])];
  // In the admin's preview the unread count would be the admin's own inbox, so leave it off there.
  const showBadge = !(state.isAdmin && (previewClient || previewingTeam));

  const nav = el("nav", { "aria-label": "Main" }, [
    ...items
      .map(([href, ic, label, matches]) => {
        const isCurrent = matches.includes(currentRoute);
        const link = el("a", { href, "aria-current": isCurrent ? "page" : null }, [icon(ic), text(" " + label)]);
        return link;
      }),
    liveLink(currentRoute), // (update 188) Live Feed, right of Play: greyed out with no live event
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

  const rail = el("aside", { class: "rail" }, [
    el("a", { class: "brand", href: "#/watchlist" }, [logoImg(), portalName]),
    nav,
    el("div", { class: "rail-foot" }, footItems),
  ]);
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
