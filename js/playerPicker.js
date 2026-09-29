// Search-as-you-type player picker for the admin's Analyze and Reports → View pages.
// Remembers the last player chosen, so switching between those pages keeps the same player.
import { el } from "./ui.js";

let lastPick = null; // { key, label }

export function playerPicker(labels, onPick) {
  const players = [...labels.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  const listId = "player-options-" + Math.random().toString(36).slice(2, 7);
  const input = el("input", { type: "search", list: listId, placeholder: "Type a player ID or name\u2026", autocomplete: "off" });
  const clear = el("button", { class: "btn ghost", type: "button" }, "Clear");
  const find = (text) => {
    const t = text.trim().toLowerCase();
    return players.find((p) => p.label.toLowerCase() === t || p.key === t) || null;
  };
  const choose = (p) => { lastPick = p; input.value = p ? p.label : ""; onPick(p); };
  input.addEventListener("input", () => { const p = find(input.value); if (p && p.key !== lastPick?.key) choose(p); });
  input.addEventListener("change", () => { const p = find(input.value); if (p) choose(p); });
  clear.addEventListener("click", () => { choose(null); input.focus(); });

  const node = el("div", { class: "player-picker" }, [
    el("label", {}, ["Player", el("div", { class: "picker-row" }, [input, clear])]),
    el("datalist", { id: listId }, players.map((p) => el("option", { value: p.label }))),
    el("p", { class: "muted" }, `${players.length} ${players.length === 1 ? "player" : "players"}`),
  ]);
  // Restore the previous choice (after the caller has finished setting up).
  const restore = () => { if (lastPick && players.some((p) => p.key === lastPick.key)) choose(lastPick); };
  return { node, restore };
}
