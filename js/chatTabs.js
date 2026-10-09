// "Chat | Questions" tabs on the Chat page (everyone: players, teams, analysts and the admin).
// Chat is the conversations (chat.js); Questions is the question threads, as before.
import { el, mount } from "./ui.js";
import { renderChat } from "./chat.js";

let lastTab = "chat"; // remembered while the app is open

/** Wraps the page's question content (qNodes) with the tabs. Returns a cleanup function. */
export function withChatTabs(main, qNodes, { flash }) {
  const qBox = el("div", {}, qNodes);
  const chatBox = el("div");
  const tabs = el("nav", { class: "subnav chat-tabs", "aria-label": "Chat or questions" });
  let stopChat = null;
  const show = () => {
    qBox.hidden = lastTab !== "questions";
    chatBox.hidden = lastTab !== "chat";
    if (lastTab === "chat" && !stopChat) stopChat = renderChat(chatBox, { flash });
    mount(tabs, [["chat", "Chat"], ["questions", "Questions"]].map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": lastTab === v ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); lastTab = v; show(); });
      return a;
    }));
  };
  mount(main, [tabs, qBox, chatBox]);
  show();
  return () => stopChat?.();
}
