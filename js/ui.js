import { getPreviewTeam } from "./preview.js";
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

export function icon(name) {
  const paths = {
    home: "M3 9.5 10 3l7 6.5V17H12v-4H8v4H3z",
    data: "M3 16V4h2v10h12v2zM7 12V8h2v4zm4 0V5h2v7zm4 0V9h2v3z",
    doc: "M5 2h7l4 4v12H5zm6 1.5V7h3.5zM7 10h7v1.5H7zm0 3h7v1.5H7z",
    chat: "M3 4h14v10H9l-4 3v-3H3z",
    people: "M7 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6 1a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM1 17c0-3 2.5-5 6-5s6 2 6 5zm12-4.5c2.6 0 5 1.4 5 4.5h-3.5c0-1.9-.7-3.5-1.5-4.5z",
    user: "M10 10a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM3 17c0-3.5 3-5.5 7-5.5s7 2 7 5.5z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || "");
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

const NAV = {
  client: [
    ["#/dashboard", "data", "My Stats", ["dashboard", "dataset"]],
    ["#/documents", "doc", "My Reports", ["documents"]],
    ["#/entry", "data", "Data Entry", ["entry", "entry-new", "entry-round"]],
  ],
  admin: [
    ["#/admin/clients", "people", "Player Access", ["admin-clients"]],
    ["#/admin/datasets", "data", "Stats", ["admin-datasets", "admin-analyze"]],
    ["#/admin/documents", "doc", "Reports", ["admin-documents", "admin-reports-view"]],
    ["#/entry", "data", "Data Entry", ["entry", "entry-new", "entry-round"]],
  ],
};

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

function teamNav() {
  // Coaches, caddies and analysts: the player is picked with the dropdown on Data and Reports.
  return [
    ["#/dashboard", "data", "Stats", ["dashboard", "dataset"]],
    ["#/documents", "doc", "Reports", ["documents"]],
    NAV.client[2], // Data Entry
  ];
}

/* Account button: a drop-down with your email, Questions (with the unread count) and Reset Password. */
function accountMenu(state, { questionsHref, showBadge }) {
  const email = state.user?.email || "";
  const badge = () => (showBadge ? el("span", { class: "badge", dataset: { unreadBadge: "1" }, hidden: unreadCount < 1 }, String(unreadCount)) : null);
  const btn = el("button", { class: "account-btn", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, [icon("user"), text(" Account"), badge()]);
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
    el("p", { class: "menu-email", title: email }, email),
    el("a", { class: "menu-item", href: questionsHref, role: "menuitem" }, ["Questions", badge()]),
    reset,
    note,
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

export function renderShell(root, { previewClient, currentRoute }) {
  const state = window.__authState;
  const previewingTeam = state.isAdmin && !!getPreviewTeam(); // admin looking at a coach/caddy/analyst's portal
  const admin = state.isAdmin && !previewClient && !previewingTeam;
  const team = (!state.isAdmin && state.isTeam) || previewingTeam;
  const items = admin ? NAV.admin : team ? teamNav() : NAV.client; // Data Entry is always the last one
  // In the admin's preview the unread count would be the admin's own inbox, so leave it off there.
  const showBadge = !(state.isAdmin && (previewClient || previewingTeam));

  const nav = el("nav", { "aria-label": "Main" },
    items
      .map(([href, ic, label, matches]) => {
        const isCurrent = matches.includes(currentRoute);
        const link = el("a", { href, "aria-current": isCurrent ? "page" : null }, [icon(ic), text(" " + label)]);
        return link;
      }));

  const footItems = [accountMenu(state, { questionsHref: admin ? "#/admin/questions" : "#/questions", showBadge }),
    el("button", { class: "link", type: "button", onClick: () => signOut() }, "Log out")];

  mount(root, el("div", { class: "shell" }, [
    el("aside", { class: "rail" }, [
      el("a", { class: "brand", href: admin ? "#/admin/clients" : team ? "#/team" : "#/dashboard" }, [logoImg(), portalName]),
      nav,
      el("div", { class: "rail-foot" }, footItems),
    ]),
    el("main", { id: "main" }),
  ]));
  return document.getElementById("main");
}

subscribe((s) => { window.__authState = s; });

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
