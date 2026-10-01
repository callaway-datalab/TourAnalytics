// For coaches, caddies and analysts with more than one player: a dropdown at the top of the Data and
// Reports pages to switch player without going back to My players.
import { el } from "./ui.js";
import { getState } from "./auth.js";
import { effectiveTeam } from "./preview.js";
import { teamLabels } from "./names.js";

export function teamPlayerSelect(previewClient, page) {
  const state = getState();
  const team = effectiveTeam(state);
  if (!team.isTeam || !previewClient) return null;
  // A coach / caddy / analyst can also look at their own entered rounds ("Me").
  const selfKey = !team.preview ? state.profile?.clientKey : null;
  const names = teamLabels(team.teamAccess);
  const players = Object.keys(team.teamAccess)
    .map((key) => ({ key, label: names.get(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (selfKey) players.unshift({ key: selfKey, label: "Me" });
  if (players.length < 2) return null;
  const sel = el("select", { "aria-label": "Player" }, players.map((p) =>
    el("option", { value: p.key, selected: p.key === previewClient.key }, p.label)));
  sel.addEventListener("change", () => {
    const p = players.find((x) => x.key === sel.value);
    location.hash = `#/view-as/${encodeURIComponent(p.key)}?label=${encodeURIComponent(p.label)}&to=${page}`;
  });
  return el("div", { class: "team-player-select" }, el("label", {}, ["Player", sel]));
}
