// Analyze → Player Stats (update 158), for coaches, caddies and analysts with more than one player: the page
// starts with just the player search; picking a player opens their stats (#/dashboard, with the search on top).
// Anyone with a single player (or a player themselves) goes straight to that player's stats.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamPlayerSearch } from "../teamPlayerSelect.js";

export async function render(main) {
  const state = getState();
  const team = effectiveTeam(state);
  const search = team.isTeam ? teamPlayerSearch(null) : null;
  if (!search) { location.hash = team.isTeam && !Object.keys(team.teamAccess).length ? "#/team" : "#/dashboard"; return; }
  mount(main, [search]);
}
