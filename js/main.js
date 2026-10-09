import { portalName } from "./firebase-init.js"; // validates config.js and initializes Firebase first
document.title = portalName; // browser tab shows the portal name from config.js
import { startRouter } from "./router.js";
import { subscribe } from "./auth.js";
import { setUnreadCount } from "./ui.js";

startRouter();

// Offline: let the app open with no signal (Data Entry on the course).
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// Unread-question badge + desktop notifications, independent of which page is open.
let unsubThreads = null;
let lastCount = 0;
let circlesSyncedFor = null; // (once per sign-in)

subscribe((state) => {
  if (unsubThreads) { unsubThreads(); unsubThreads = null; }
  if (!state.user) { setUnreadCount(0); return; }
  if (state.isAdmin && circlesSyncedFor !== state.user.uid) {
    // who each person can chat with (their team and Callaway staff): refreshed when the admin signs in
    circlesSyncedFor = state.user.uid;
    import("./chatCircles.js").then((m) => m.syncChatCircles()).catch(() => {});
  }
  if (state.isAdmin || state.profile) {
    // the Chat badge: unread conversations and friend requests waiting for you
    const uid = state.user.uid;
    let stop = null, live = true;
    unsubThreads = () => { live = false; stop?.(); };
    import("./chat.js").then((m) => { if (live) stop = m.watchChatUnread(uid, updateBadge); }).catch(() => {});
  }
});

function updateBadge(n) {
  setUnreadCount(n);
  if (n > lastCount && "Notification" in window && Notification.permission === "granted" && document.hidden) new Notification("New message", { body: "You have a new message in Chat." });
  lastCount = n;
}
