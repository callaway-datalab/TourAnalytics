// Stats → Goals (admin): pick a player (or yourself), then set and follow their goals.
import { el, mount, subNav } from "../ui.js";
import { adminAllClients } from "../store.js";
import { playerPicker } from "../playerPicker.js";
import { goalsPanel } from "./goals.js";
import { getState } from "../auth.js";
import { myEntryKey, myName } from "./dataEntry.js";

export async function render(main, { flash }) {
  const box = el("div", { class: "goals-box" });
  const pickBox = el("div", { class: "analyze-picker" });
  mount(main, [pickBox, box]);
  let panel = null;
  const show = (player) => {
    panel?.destroy?.(); panel = null;
    if (!player) { mount(box, el("p", { class: "muted center" }, "Pick a player to set or follow their goals.")); return; }
    panel = goalsPanel(box, { playerKey: player.key, label: player.label, flash });
  };
  const { labels, ids } = await adminAllClients();
  const meKey = myEntryKey(getState());
  const picker = playerPicker(new Map([[meKey, myName()], ...labels]), show, ids, meKey);
  mount(pickBox, picker.node);
  show(null);
  return () => panel?.destroy?.();
}
