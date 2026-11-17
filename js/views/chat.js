// The Chat page: the same for everyone (chat.js). Replaces Questions (update 101).
import { el, mount } from "../ui.js";
import { renderChat } from "../chat.js";

export async function render(main, { flash }) {
  // (update 829) outside Callaway (players, coaches, caddies): Chat & support (an issue, a question, a feature request),
  // all to Callaway's analysts and the admin; the admin and analysts keep the full Chat to answer them
  const st = (await import("../auth.js")).getState();
  if (!st.isAdmin && st.profile?.kind !== "analyst") return (await import("./support.js")).render(main, { flash });
  const box = el("div");
  mount(main, box);
  return renderChat(box, { flash });
}
