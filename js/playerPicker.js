// Search-as-you-type player picker (Analyze, Reports → View). Its own drop-down list narrows with each
// letter and works the same on phones. Players are listed by name; when two IDs share a name, typing it
// asks which one. Remembers the last player chosen across those pages.
import { el, mount } from "./ui.js";

let lastPick = null; // { key, label }

/** Players whose display label is "<name> (<id>)" for the typed name, i.e. the same name twice or more. */
export function sameNamePlayers(players, text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const hits = players.filter((p) => p.label.toLowerCase().startsWith(t + " (") && p.label.endsWith(")"));
  return hits.length > 1 ? hits : [];
}

export function playerPicker(labels, onPick, ids = new Map(), pinKey = null) {
  // pinKey (you) always sits at the top of the list.
  const players = [...labels.entries()].map(([key, label]) => ({ key, label, id: ids.get(key) || key.replace(/^c_/, "") }))
    .sort((a, b) => (a.key === pinKey ? -1 : b.key === pinKey ? 1 : a.label.localeCompare(b.label)));
  const listId = "pp-" + Math.random().toString(36).slice(2, 7);
  const input = el("input", { type: "search", placeholder: "Type a player's name\u2026", autocomplete: "off", role: "combobox",
    "aria-autocomplete": "list", "aria-controls": listId, "aria-expanded": "false", enterkeyhint: "search" });
  const list = el("ul", { class: "pp-list", id: listId, role: "listbox", hidden: true });
  const clear = el("button", { class: "btn ghost", type: "button" }, "Clear");
  const which = el("div", { class: "which-player", hidden: true });
  let shown = [], active = -1;

  const find = (text) => {
    const t = text.trim().toLowerCase();
    return players.find((p) => p.label.toLowerCase() === t || p.id.toLowerCase() === t || p.key === t) || null;
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (p) => { lastPick = p; input.value = p ? p.label : ""; which.hidden = true; delete which.dataset.for; close(); onPick(p); };

  const drawList = () => {
    const t = input.value.trim().toLowerCase();
    shown = players.filter((p) => !t || p.label.toLowerCase().includes(t) || p.id.toLowerCase().includes(t)).slice(0, 50);
    mount(list, shown.length
      ? shown.map((p, i) => {
          const li = el("li", { class: "pp-item" + (i === active ? " on" : "") + (p.key === pinKey ? " me" : ""), role: "option", id: `${listId}-${i}`, "aria-selected": i === active ? "true" : "false" }, p.label);
          li.addEventListener("pointerdown", (e) => { e.preventDefault(); choose(p); }); // before the box loses focus
          return li;
        })
      : el("li", { class: "pp-msg", role: "presentation" }, "No player matches that."));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const check = () => {
    // Same name, more than one ID: make the admin pick.
    const dupes = sameNamePlayers(players, input.value);
    which.hidden = !dupes.length;
    if (dupes.length && which.dataset.for !== input.value.trim().toLowerCase()) {
      which.dataset.for = input.value.trim().toLowerCase();
      mount(which, [
        el("span", {}, `There are ${dupes.length} players named ${input.value.trim()}. Which one?`),
        ...dupes.map((d) => {
          const b = el("button", { class: "btn ghost", type: "button" }, `ID ${d.id}`);
          b.addEventListener("click", () => choose(d));
          return b;
        }),
      ]);
    }
    const p = find(input.value);
    if (p && p.key !== lastPick?.key && !dupes.length) choose(p);
  };
  input.addEventListener("input", () => {
    active = -1; drawList(); check();
    if (!which.hidden) close(); // a name two IDs share: the "Which one?" buttons take over from the list
  });
  input.addEventListener("focus", drawList);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) drawList();
      if (!shown.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      list.querySelectorAll(".pp-item").forEach((li, i) => { li.classList.toggle("on", i === active); li.setAttribute("aria-selected", i === active ? "true" : "false"); });
      input.setAttribute("aria-activedescendant", `${listId}-${active}`);
      list.querySelector(".pp-item.on")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && shown[active]) choose(shown[active]);
      else if (shown.length === 1) choose(shown[0]);
    } else if (e.key === "Escape") close();
  });
  clear.addEventListener("click", () => { choose(null); input.focus(); });

  const node = el("div", { class: "player-picker" }, [
    el("label", { for: undefined }, "Player"),
    el("div", { class: "picker-row" }, [el("div", { class: "pp", style: "flex:1" }, [input, list]), clear]),
    which,
    el("p", { class: "muted" }, `${players.filter((p) => p.key !== pinKey).length} players`),
  ]);
  const restore = () => { if (lastPick && players.some((p) => p.key === lastPick.key)) choose(players.find((p) => p.key === lastPick.key)); };
  return { node, restore };
}
