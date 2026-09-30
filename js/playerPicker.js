// Search-as-you-type player picker for the admin's Analyze and Reports → View pages.
// Players are listed by name. If two player IDs share a name, typing the name asks which one.
// Remembers the last player chosen, so switching between those pages keeps the same player.
import { el, mount } from "./ui.js";

let lastPick = null; // { key, label }

/** Players whose display label is "<name> (<id>)" for the typed name, i.e. the same name twice or more. */
export function sameNamePlayers(players, text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const hits = players.filter((p) => p.label.toLowerCase().startsWith(t + " (") && p.label.endsWith(")"));
  return hits.length > 1 ? hits : [];
}

export function playerPicker(labels, onPick, ids = new Map()) {
  const players = [...labels.entries()].map(([key, label]) => ({ key, label, id: ids.get(key) || key.replace(/^c_/, "") }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const listId = "player-options-" + Math.random().toString(36).slice(2, 7);
  const input = el("input", { type: "search", list: listId, placeholder: "Type a player's name\u2026", autocomplete: "off" });
  const clear = el("button", { class: "btn ghost", type: "button" }, "Clear");
  const which = el("div", { class: "which-player", hidden: true });
  const find = (text) => {
    const t = text.trim().toLowerCase();
    return players.find((p) => p.label.toLowerCase() === t || p.id.toLowerCase() === t || p.key === t) || null;
  };
  const choose = (p) => { lastPick = p; input.value = p ? p.label : ""; which.hidden = true; delete which.dataset.for; onPick(p); };
  const check = () => {
    const p = find(input.value);
    if (p) { if (p.key !== lastPick?.key) choose(p); return; }
    // Same name, more than one ID: make the admin pick.
    const dupes = sameNamePlayers(players, input.value);
    which.hidden = !dupes.length;
    // Leaving the box also fires "change"; don't rebuild the buttons under the click.
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
  };
  input.addEventListener("input", check);
  input.addEventListener("change", check);
  clear.addEventListener("click", () => { choose(null); input.focus(); });

  const node = el("div", { class: "player-picker" }, [
    el("label", {}, ["Player", el("div", { class: "picker-row" }, [input, clear])]),
    which,
    el("datalist", { id: listId }, players.map((p) => el("option", { value: p.label }))),
    el("p", { class: "muted" }, `${players.length} ${players.length === 1 ? "player" : "players"}`),
  ]);
  // Restore the previous choice (after the caller has finished setting up).
  const restore = () => { if (lastPick && players.some((p) => p.key === lastPick.key)) choose(players.find((p) => p.key === lastPick.key)); };
  return { node, restore };
}
