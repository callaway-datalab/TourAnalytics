import "./firebase-init.js"; // validates config.js and initializes Firebase first
import { startRouter } from "./router.js";
import { subscribe } from "./auth.js";
import { setUnreadCount } from "./ui.js";
import { watchMyThreads, watchAdminThreads } from "./store.js";

startRouter();

// Unread-question badge + desktop notifications, independent of which page is open.
let unsubThreads = null;
let lastCount = 0;
let notifiedIds = new Set();

subscribe((state) => {
  if (unsubThreads) { unsubThreads(); unsubThreads = null; }
  if (!state.user) { setUnreadCount(0); return; }

  if (state.isAdmin) {
    unsubThreads = watchAdminThreads((threads) => updateBadge(threads.filter((t) => t.adminUnread), threads));
  } else if (state.profile) {
    unsubThreads = watchMyThreads(state.user.uid, (threads) => updateBadge(threads.filter((t) => t.userUnread), threads));
  }
});

function updateBadge(unread, all) {
  setUnreadCount(unread.length);
  if (unread.length > lastCount && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    const newest = unread.find((t) => !notifiedIds.has(t.id));
    if (newest) new Notification("New message", { body: newest.subject || "You have a new message." });
  }
  notifiedIds = new Set(all.map((t) => t.id));
  lastCount = unread.length;
}
