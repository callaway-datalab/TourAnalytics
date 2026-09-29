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
    ["#/dashboard", "data", "My Data", ["dashboard", "dataset"]],
    ["#/documents", "doc", "My Reports", ["documents"]],
    ["#/questions", "chat", "My Questions", ["questions", "question-new", "thread"]],
  ],
  admin: [
    ["#/admin/clients", "people", "Player Access", ["admin-clients"]],
    ["#/admin/datasets", "data", "Data", ["admin-datasets", "admin-analyze"]],
    ["#/admin/documents", "doc", "Reports", ["admin-documents", "admin-reports-view"]],
    ["#/admin/questions", "chat", "Questions", ["admin-questions", "admin-thread"]],
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

function teamNav(previewClient) {
  const items = [["#/team", "people", "My players", ["team"]]];
  if (previewClient) {
    items.push(["#/dashboard", "data", `${previewClient.label}: Data`, ["dashboard", "dataset"]]);
    items.push(["#/documents", "doc", `${previewClient.label}: Reports`, ["documents"]]);
  }
  items.push(NAV.client[2]); // Questions
  return items;
}

export function renderShell(root, { previewClient, currentRoute }) {
  const state = window.__authState;
  const previewingTeam = state.isAdmin && !!getPreviewTeam(); // admin looking at a coach/caddy/analyst's portal
  const admin = state.isAdmin && !previewClient && !previewingTeam;
  const team = (!state.isAdmin && state.isTeam) || previewingTeam;
  const items = admin ? NAV.admin : team ? teamNav(previewClient) : NAV.client;
  // In the admin's preview the unread count would be the admin's own inbox, so leave it off there.
  const showBadge = !(state.isAdmin && (previewClient || previewingTeam));

  const nav = el("nav", { "aria-label": "Main" },
    items
      .map(([href, ic, label, matches]) => {
        const isCurrent = matches.includes(currentRoute);
        const link = el("a", { href, "aria-current": isCurrent ? "page" : null }, [icon(ic), text(" " + label)]);
        if (href.endsWith("/questions") && showBadge) {
          link.appendChild(el("span", { class: "badge", dataset: { unreadBadge: "1" }, hidden: unreadCount < 1 }, String(unreadCount)));
        }
        return link;
      }));

  const footItems = [];
  if ((!previewClient || team) && !previewingTeam) {
    footItems.push(el("a", { href: "#/account" }, [icon("user"), text(" " + (state.user?.displayName || state.profile?.name || state.user?.email || "Account"))]));
  }
  footItems.push(el("button", { class: "link", type: "button", onClick: () => signOut() }, "Log out"));

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
