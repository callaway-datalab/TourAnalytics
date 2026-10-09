// The Chat page: the same for everyone (chat.js). Replaces Questions (update 101).
import { el, mount } from "../ui.js";
import { renderChat } from "../chat.js";

export async function render(main, { flash }) {
  const box = el("div");
  mount(main, box);
  return renderChat(box, { flash });
}
