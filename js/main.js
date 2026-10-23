import { portalName, actingAs, actAsError, stopActingAs } from "./firebase-init.js"; // validates config.js and initializes Firebase first
document.title = portalName; // browser tab shows the portal name from config.js
import { startRouter } from "./router.js";
import { subscribe } from "./auth.js";
import { setUnreadCount } from "./ui.js";

// The build this page loaded (main.js?v= in index.html), so other files can tell if they're an older copy
window.__taBuild = new URL(import.meta.url).searchParams.get("v");
import { minimalKeyboard } from "./keyboard.js";
minimalKeyboard(); // (update 267) no word suggestions or contact autofill on the phone keyboard
import { fixStatusBar } from "./statusBar.js";
fixStatusBar(); // (update 277) the Home Screen app's top edge, under the clock
startRouter();

// (update 170) a tab acting as a fake user says so, with a way back to your own sign-in
if (actingAs || actAsError) {
  const bar = document.createElement("div");
  bar.className = `actas-bar${actAsError ? " bad" : ""}`;
  bar.setAttribute("role", "status");
  const txt = document.createElement("span");
  txt.textContent = actAsError ? `Couldn't act as that fake user: ${actAsError}` : `Acting as ${actingAs.name} · a fake user · this tab only`;
  const stop = document.createElement("button");
  stop.type = "button"; stop.className = "actas-stop"; stop.textContent = actAsError ? "Dismiss" : "Stop";
  stop.addEventListener("click", () => (actAsError ? bar.remove() : stopActingAs()));
  bar.append(txt, stop);
  document.body.prepend(bar);
  document.body.classList.toggle("acting-as", !!actingAs);
  if (actingAs) document.title = `${actingAs.name} · ${portalName}`;
}

// Offline: let the app open with no signal (Data Entry on the course).
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// Unread-question badge + desktop notifications, independent of which page is open.
let unsubThreads = null;
let lastCount = 0;
let circlesSyncedFor = null; // (once per sign-in)
let prunedFor = null;         // (the field detail's old copies: checked once per visit)

subscribe((state) => {
  if (unsubThreads) { unsubThreads(); unsubThreads = null; }
  if (!state.user) { setUnreadCount(0); return; }
  if (state.status === "ready" && prunedFor !== state.user.uid) {
    // copies of field detail whose data file was deleted or rebuilt: removed, a little after the page is up
    prunedFor = state.user.uid;
    setTimeout(() => import("./fieldStore.js").then((m) => m.pruneDetailCopies()).catch(() => {}), 8000);
    // (update 183) a player: where their bag is, so their team can see it (and their caddie change it)
    setTimeout(() => import("./bag.js").then((m) => m.registerBagOwner(state)).catch(() => {}), 3000);
  }
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
