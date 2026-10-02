// "Questions | Analyst chat" tabs, for the admin and Callaway analysts on their Questions page.
import { el, mount } from "./ui.js";
import { renderStaffChat } from "./staffChat.js";

let lastTab = "questions"; // remembered while the app is open

/** Wraps the page's question content (qNodes) with the tabs. Returns a cleanup function. */
export function withChatTabs(main, qNodes, { flash }) {
  const qBox = el("div", {}, qNodes);
  const chatBox = el("div");
  const tabs = el("nav", { class: "subnav chat-tabs", "aria-label": "Questions or analyst chat" });
  let stopChat = null;
  const show = () => {
    qBox.hidden = lastTab !== "questions";
    chatBox.hidden = lastTab !== "chat";
    if (lastTab === "chat" && !stopChat) stopChat = renderStaffChat(chatBox, { flash });
    mount(tabs, [["questions", "Questions"], ["chat", "Analyst chat"]].map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": lastTab === v ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); lastTab = v; show(); });
      return a;
    }));
  };
  mount(main, [tabs, qBox, chatBox]);
  show();
  return () => stopChat?.();
}
