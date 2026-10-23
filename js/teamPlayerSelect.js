// For coaches, caddies and analysts with more than one player: a dropdown at the top of the Data and
// Reports pages to switch player without going back to My players.
import { el } from "./ui.js";
import { getState } from "./auth.js";
import { effectiveTeam } from "./preview.js";
import { teamLabels } from "./names.js";
import { playerPicker } from "./playerPicker.js";

export function teamPlayerSelect(previewClient, page) {
  const state = getState();
  const team = effectiveTeam(state);
  if (!team.isTeam || !previewClient) return null;
  // A coach / caddy / analyst can also look at their own entered rounds ("Me"); the admin in their portal, theirs
  const selfKey = team.selfKey;
  const names = teamLabels(team.teamAccess);
  const players = Object.keys(team.teamAccess)
    .map((key) => ({ key, label: names.get(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (selfKey) players.unshift({ key: selfKey, label: (team.preview ? team.name : state.profile?.name) || "Me" }); // you, by your Profile name
  if (players.length < 2) return null;
  const sel = el("select", { "aria-label": "Player" }, players.map((p) =>
    el("option", { value: p.key, selected: p.key === previewClient.key }, p.label)));
  sel.addEventListener("change", () => {
    const p = players.find((x) => x.key === sel.value);
    location.hash = `#/view-as/${encodeURIComponent(p.key)}?label=${encodeURIComponent(p.label)}&to=${page}`;
  });
  return el("div", { class: "team-player-select" }, el("label", {}, ["Player", sel]));
}

// Player Stats (update 158) for coaches, caddies and analysts with more than one player: the same search
// as the admin's (type a name), instead of the dropdown. Blank to start; picking opens that player's stats,
// Clear goes back to the blank page. With one player there's no search: the page is just theirs.
export function teamPlayerSearch(previewClient) {
  const state = getState();
  const team = effectiveTeam(state);
  const selfKey = team.selfKey; // (update 307: their own rounds count as one to pick, and the admin sees them in their portal)
  if (!team.isTeam || Object.keys(team.teamAccess).length + (selfKey ? 1 : 0) < 2) return null;
  const names = teamLabels(team.teamAccess);
  const labels = new Map([...(selfKey ? [[selfKey, (team.preview ? team.name : state.profile?.name) || "Me"]] : []), ...Object.keys(team.teamAccess).map((k) => [k, names.get(k)])]);
  const picker = playerPicker(labels, (p) => {
    if (!p) { location.hash = "#/player-stats"; return; }
    if (p.key === previewClient?.key) return;
    location.hash = `#/view-as/${encodeURIComponent(p.key)}?label=${encodeURIComponent(p.label)}&to=/dashboard`;
  }, new Map(), selfKey);
  if (previewClient) picker.preset(previewClient.key);
  return el("div", { class: "analyze-picker team-player-search" }, picker.node);
}
