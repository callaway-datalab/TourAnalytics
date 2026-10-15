// Analyze → Leaderboards for players, coaches, caddies and analysts (update 158): the whole field from the
// published field summary of the newest strokes-gained file (the same numbers the Rankings table uses), with
// lie / distance detail once it's loaded. Only your own name (a player) or your players' names (a coach)
// open a player's view.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { watchClientDatasets, getFieldStats } from "../store.js";
import { detectColumns, isShotData, summaryPlayers } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";
import { plainName, teamLabels } from "../names.js";
import { effectiveTeam } from "../preview.js";

export async function render(main, { previewClient }) {
  const state = getState();
  const team = effectiveTeam(state);
  const access = team.isTeam ? team.teamAccess : {};
  const myKey = team.isTeam ? null : previewClient ? previewClient.key : state.profile?.clientKey;
  // the data file is found through your own files (a player) or one of your players' (a coach)
  const viaKey = myKey || (previewClient && !previewClient.self && access[previewClient.key] ? previewClient.key : null) || Object.keys(access).sort()[0] || null;
  const box = el("div", { class: "embedded-dataset leaderboards" });
  mount(main, box);
  if (!viaKey) { mount(box, el("p", { class: "empty center" }, "No players have been added to your account yet.")); return () => {}; }

  const tl = team.isTeam ? teamLabels(access) : new Map();
  const shown = (key, name) => tl.get(key) ?? plainName(name || key.replace(/^c_/, ""));
  const canPick = (key) => (team.isTeam ? !!access[key] : key === myKey);
  const onPick = (key) => {
    if (!team.isTeam) { location.hash = "#/dashboard"; return; }
    location.hash = `#/view-as/${encodeURIComponent(key)}?label=${encodeURIComponent(tl.get(key) || key)}&to=/dashboard`;
  };
  const pickNote = !team.isTeam ? "Tap your name for your own stats." : Object.keys(access).length > 1 ? "Tap one of your players for their view." : "Tap your player's name for their view.";
  const dashState = {};
  let dash = null, shownVersion = null;
  const stop = () => { dash?.destroy(); dash = null; };

  const unsub = watchClientDatasets(viaKey, async (datasets) => {
    const d = datasets.filter((x) => isShotData(detectColumns(x.columns || [])))
      .sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
    if (!d) { stop(); shownVersion = null; mount(box, el("p", { class: "empty center" }, "No leaderboard yet. It appears once a stats file has been uploaded.")); return; }
    const version = `${d.id}|${d.uploadedAt?.toMillis?.() ?? ""}`;
    if (version === shownVersion) return;
    shownVersion = version;
    stop();
    mount(box, el("p", { class: "empty center" }, "Loading…"));
    const summary = await getFieldStats(d.id).catch(() => null);
    if (shownVersion !== version) return;
    const field = summaryPlayers(summary).map((p) => ({ ...p, label: shown(p.key, p.name) })).filter((p) => p.rounds.length);
    if (!field.length) { mount(box, el("p", { class: "empty center" }, "The leaderboard for the latest stats file isn’t ready yet. Check back soon.")); return; }
    const idx = detectColumns(d.columns || []);
    const inner = el("div");
    mount(box, inner);
    dash = sgDashboard(inner, { me: null, field, idx, mode: "player", teamRole: previewClient?.role || null, state: dashState, updatedAt: d.uploadedAt?.toMillis?.() ?? null, onPick, canPick, pickNote });
    // the field's per-round lie / distance detail (kept on the device per upload), so the filters can follow them
    (async () => {
      const { getFieldDetail } = await import("../fieldStore.js");
      const { players } = await getFieldDetail(d.id, d.uploadedAt?.toMillis?.() ?? 0).catch(() => ({}));
      if (!players || shownVersion !== version || !dash) return;
      const full = players.map((p) => ({ key: p.key, label: shown(p.key, p.name), rounds: p.rounds })).filter((p) => p.rounds.length);
      if (full.length >= 2) dash.update({ field: full });
    })();
  });
  return () => { unsub(); stop(); };
}
