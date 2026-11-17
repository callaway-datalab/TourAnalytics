// (update 816) Search everything: Ctrl+K (⌘K on a Mac), "/" or the header's magnifier. Type part of a player, a page or
// a course; Enter opens the top result. A player opens their Dossier (and becomes the current player); the small links
// beside them open their Stats, Compare, Practice, Practice Week or Bag instead. Arrows move, Esc closes.
import { el, mount } from "./ui.js";
import { setCurrent, currentPlayer } from "./current.js";

let pagesFn = () => [], box = null, idx = null, idxAt = 0;
/** ui.js hands over the pages this person's menus show: [{ label, href, group }] */
export const setPages = (f) => { pagesFn = f; };

async function index() {
  if (idx && Date.now() - idxAt < 5 * 60e3) return idx;
  const st = window.__authState || {};
  const [who, courses] = await Promise.all([
    import("./views/insightPages.js").then((m) => m.whoCanBePicked(window.__previewClient || null)).catch(() => null),
    import("./courseHeat.js").then((m) => m.listHeatCourses()).catch(() => []),
  ]);
  const statsHref = st.isAdmin && !window.__previewClient ? "#/admin/player-stats" : who?.self ? "#/dashboard" : "#/player-stats";
  const players = who ? [...who.labels].map(([key, label]) => ({ kind: "player", key, label, fav: who.favs.includes(key), self: who.self === key, statsHref })) : [];
  const crs = (courses || []).map((c) => ({ kind: "course", id: c.id, label: c.name, raw: !!c.rawChunks, sub: (c.events || []).map((e) => e.name).join(", ") }));
  idx = { players, courses: crs }; idxAt = Date.now(); return idx;
}
// a word-start match scores best, then anywhere in the text, then the letters in order
const score = (text, q) => { const t = String(text || "").toLowerCase(); if (!q) return 1; if (t.startsWith(q)) return 100 - t.length / 100; if (t.split(/[\s·,-]+/).some((w) => w.startsWith(q))) return 80 - t.length / 100; const i = t.indexOf(q); if (i >= 0) return 60 - i / 10;
  let j = 0; for (const ch of t) if (ch === q[j]) j++; return j === q.length ? 20 - t.length / 100 : 0; };

function go(href, p = null) { if (p) setCurrent({ key: p.key, label: p.label }); close(); if (location.hash === href) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = href; try { import("./perf.js").then((m) => m.clickPath?.("search", href)).catch(() => {}); } catch { /* */ } }
function close() { if (!box) return; box.remove(); box = null; document.body.classList.remove("pal-open"); }

export async function openPalette(q0 = "") {
  if (box) { box.querySelector("input")?.focus(); return; }
  const input = el("input", { type: "search", class: "pal-in", placeholder: "Search players, pages, courses…", "aria-label": "Search", autocomplete: "off", enterkeyhint: "go", role: "combobox", "aria-expanded": "true", "aria-controls": "pal-list" });
  const list = el("div", { class: "pal-list", id: "pal-list", role: "listbox" }, el("p", { class: "pal-msg" }, "Loading…"));
  const hint = el("p", { class: "pal-hint" }, ["↑↓ to move · Enter to open · Esc to close", el("span", {}, " · a player opens their Dossier and stays picked on every page")]);
  box = el("div", { class: "pal", role: "dialog", "aria-modal": "true", "aria-label": "Search" }, [el("div", { class: "pal-back" }), el("div", { class: "pal-card" }, [input, list, hint])]);
  box.querySelector(".pal-back").addEventListener("click", close);
  document.body.append(box); document.body.classList.add("pal-open"); input.value = q0; input.focus();
  let rows = [], at = 0;
  const pages = pagesFn();
  const draw = async () => {
    const I = await index(); if (!box) return;
    const q = input.value.trim().toLowerCase(), cur = currentPlayer();
    const P = I.players.map((p) => ({ ...p, s: q ? score(p.label, q) : (p.key === cur?.key ? 3 : p.self ? 2.5 : p.fav ? 2 : 0) })).filter((p) => p.s > 0).sort((a, b) => b.s - a.s || String(a.label).localeCompare(String(b.label))).slice(0, q ? 6 : 6);
    const G = pages.map((p) => ({ kind: "page", ...p, s: score(`${p.label} ${p.group || ""} ${p.words || ""}`, q) })).filter((p) => p.s > 0).sort((a, b) => b.s - a.s).slice(0, q ? 6 : 8);
    const C = q ? I.courses.map((c) => ({ ...c, s: Math.max(score(c.label, q), score(c.sub, q) * 0.9) })).filter((c) => c.s > 0).sort((a, b) => b.s - a.s).slice(0, 4) : [];
    // the best match leads, whatever its kind
    const groups = [["Players", P], ["Pages", G], ["Courses", C]].filter(([, l]) => l.length).sort((a, b) => (q ? b[1][0].s - a[1][0].s : 0));
    rows = groups.flatMap(([, l]) => l); at = Math.min(at, Math.max(0, rows.length - 1));
    let i = 0;
    mount(list, rows.length ? groups.map(([h, l]) => el("div", { class: "pal-grp" }, [el("p", { class: "pal-h" }, h), ...l.map((r) => row(r, i++))])) : el("p", { class: "pal-msg" }, "Nothing matches that."));
  };
  const row = (r, i) => {
    const on = i === at, base = { class: `pal-row${on ? " on" : ""}`, role: "option", "aria-selected": String(on), id: `pal-${i}` };
    if (r.kind === "player") {
      const enc = encodeURIComponent(r.key), q = (h) => `${h}?player=${enc}`;
      const quick = [["Stats", r.statsHref], ["Compare", q("#/comparisons")], ["Practice", q("#/practice")], ["Week", q("#/practice-week")], ["Bag", q("#/witb")]];
      const n = el("div", base, [el("button", { type: "button", class: "pal-main" }, [el("b", {}, r.label), el("span", { class: "pal-sub" }, r.self ? "You · Dossier" : `${r.fav ? "★ " : ""}Dossier`)]),
        el("span", { class: "pal-quick" }, quick.map(([l, h]) => { const a = el("button", { type: "button", class: "pal-q" }, l); a.addEventListener("click", (e) => { e.stopPropagation(); go(h, r); }); return a; }))]);
      n.querySelector(".pal-main").addEventListener("click", () => go(q("#/dossier"), r)); return n; }
    if (r.kind === "course") { const n = el("div", base, [el("button", { type: "button", class: "pal-main" }, [el("b", {}, r.label), el("span", { class: "pal-sub" }, r.sub || "Course")]),
      el("span", { class: "pal-quick" }, [r.raw ? (() => { const a = el("button", { type: "button", class: "pal-q" }, "Course Fit"); a.addEventListener("click", (e) => { e.stopPropagation(); go(`#/course-fit?course=${encodeURIComponent(r.id)}`); }); return a; })() : null])]);
      n.querySelector(".pal-main").addEventListener("click", () => go(r.raw ? `#/course-fit?course=${encodeURIComponent(r.id)}` : "#/course-prep")); return n; }
    const n = el("div", base, el("button", { type: "button", class: "pal-main" }, [el("b", {}, r.label), el("span", { class: "pal-sub" }, r.group || "")]));
    n.querySelector(".pal-main").addEventListener("click", () => go(r.href)); return n;
  };
  const open = () => { const r = rows[at]; if (!r) return; box.querySelector(`#pal-${at} .pal-main`)?.click(); };
  input.addEventListener("input", () => { at = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!rows.length) return; at = (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      list.querySelectorAll(".pal-row").forEach((x, i) => { x.classList.toggle("on", i === at); x.setAttribute("aria-selected", String(i === at)); }); list.querySelector(".pal-row.on")?.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", `pal-${at}`); }
    else if (e.key === "Enter") { e.preventDefault(); open(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); } });
  draw();
}
// the keys: Ctrl+K / ⌘K anywhere; "/" when not typing
document.addEventListener("keydown", (e) => {
  if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); box ? close() : openPalette(); return; }
  if (e.key === "/" && !box && !/^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable) { e.preventDefault(); openPalette(); }
});
window.addEventListener("hashchange", close);
