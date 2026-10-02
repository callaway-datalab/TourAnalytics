import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchMyThreads, watchSharedWithMe, watchAdminThreads, watchForwardedToMe } from "../store.js";
import { threadActions } from "../threadActions.js";
import { effectiveTeam } from "../preview.js";
import { withChatTabs } from "../chatTabs.js";

// My Questions. Three ways to arrive:
//  - a player or team member looking at their own questions;
//  - the admin previewing a player: their sample questions (to try the form) plus, read-only, the
//    player's real questions;
//  - the admin previewing a team member / analyst: read-only view of their questions and what's shared with them.
export async function render(main, { previewClient, flash }) {
  const state = getState();
  const team = effectiveTeam(state);
  const previewingTeam = team.preview;
  const previewingPlayer = state.isAdmin && !!previewClient && !previewingTeam;
  const readOnly = previewingTeam;

  const list = el("ul", { class: "rows" });
  const archivedList = el("ul", { class: "rows" });
  // Archived questions: collapsed until opened. Created once, so it stays open or closed as the lists update.
  const archivedCount = el("span", { class: "muted" });
  const archived = el("details", { class: "archive" }, [
    el("summary", {}, ["Archived questions ", archivedCount]),
    el("p", { class: "muted" }, "Completed questions. A new message on one moves it back up."),
    archivedList,
  ]);
  const sharedList = el("ul", { class: "rows" });
  const sharedSection = team.isTeam
    ? el("section", {}, [el("h2", {}, previewingTeam ? `Shared with ${team.name} by their players` : "Shared with you by your players"), sharedList])
    : null;
  // Analysts: questions the admin forwarded to them, to read and answer.
  const isAnalyst = !previewingTeam && state.isTeam && state.profile?.kind === "analyst";
  const fwdList = el("ul", { class: "rows" });
  const fwdSection = isAnalyst ? el("section", {}, [el("h2", {}, "Forwarded to you"), fwdList]) : null;
  const theirList = el("ul", { class: "rows" });
  const theirSection = previewingPlayer
    ? el("section", {}, [el("h2", {}, `${previewClient.label}'s questions`),
      el("p", { class: "muted" }, "What the player has actually asked. Opening one takes you to it in your Questions inbox."), theirList])
    : null;

  const previewName = previewingTeam ? team.name : previewClient?.label;
  const put = (nodes) => (isAnalyst ? (stopTabs = withChatTabs(main, nodes, { flash })) : mount(main, nodes));
  let stopTabs = () => {};
  put([
    fwdSection,
    el("div", { class: "page-actions" }, [
      el("a", { class: "btn", href: "#/questions/new" }, "Ask a new question"),
      previewingPlayer || previewingTeam ? el("p", { class: "muted" },
        `Questions you ask while previewing ${previewName} are samples: they go to your own inbox, and ${previewName} never sees them.`) : null,
    ]),
    readOnly ? el("h2", {}, `${team.name}'s questions`) : null,
    theirSection,
    // In a player preview only the player's own questions are shown (samples go to your inbox).
    previewingPlayer ? null : list,
    previewingPlayer ? null : archived,
    sharedSection,
  ].filter(Boolean));

  // Links: your own questions open normally; in a preview, questions open in the admin inbox.
  const hrefFor = (t) => (readOnly || (previewingPlayer && !t.sample) ? `#/admin/questions/${t.id}` : `#/questions/${t.id}`);
  const statusTag = (t) => (t.archived ? el("span", { class: "tag muted-tag" }, "Completed")
    : t.userUnread ? el("span", { class: "tag hot" }, "New reply")
    : el("span", { class: "tag" + (t.lastFromAdmin ? "" : " muted-tag") }, t.lastFromAdmin ? "Answered" : "Waiting for reply"));
  const row = (t, withActions) => el("li", {}, [
    el("a", { class: "row-main", href: hrefFor(t) }, [
      el("span", { class: "row-title" }, t.subject),
      el("span", { class: "muted" }, `Last activity ${formatWhen(t.updatedAt)}`),
    ]),
    el("span", { class: "row-meta" }, [statusTag(t), withActions ? el("br") : null, withActions ? threadActions(t, { asAdmin: false, flash }) : null]),
  ]);

  const showOwn = (threads) => {
    const active = threads.filter((t) => !t.archived), done = threads.filter((t) => t.archived);
    archivedCount.textContent = `(${done.length})`;
    mount(list, active.length ? active.map((t) => row(t, !readOnly))
      : el("p", { class: "empty" }, previewingPlayer ? "No sample questions yet." : threads.length ? "No open questions."
        : readOnly ? `${team.name} hasn't asked anything yet.` : "You haven't asked anything yet."));
    mount(archivedList, done.length ? done.map((t) => row(t, !readOnly)) : el("p", { class: "empty" }, "Nothing archived yet."));
  };

  const unsubs = [];
  if (readOnly) {
    unsubs.push(watchAdminThreads((all) => showOwn(team.uid ? all.filter((t) => t.uid === team.uid) : [])));
  } else {
    unsubs.push(watchMyThreads(state.user.uid, (all) =>
      showOwn(previewingPlayer ? all.filter((t) => t.sample && t.clientKey === previewClient.key) : all)));
  }
  if (previewingPlayer) {
    unsubs.push(watchAdminThreads((all) => {
      const theirs = all.filter((t) => t.clientKey === previewClient.key && !t.sample);
      mount(theirList, theirs.length ? theirs.map((t) => row(t, false)) : el("p", { class: "empty" }, `${previewClient.label} hasn't asked anything yet.`));
    }));
  }
  if (team.isTeam) {
    unsubs.push(watchSharedWithMe(Object.keys(team.teamAccess), team.email, (items) => {
      mount(sharedList, items.length ? items.map((t) => el("li", {}, [
        el("a", { class: "row-main", href: readOnly ? `#/admin/questions/${t.id}` : `#/questions/${t.id}` }, [
          el("span", { class: "row-title" }, t.subject),
          el("span", { class: "muted" }, `From ${t.askerName} (${t.clientLabel}) \u00b7 ${formatWhen(t.createdAt)}`),
        ]),
      ])) : el("p", { class: "empty" }, "Nothing shared yet."));
    }));
  }
  if (isAnalyst) {
    unsubs.push(watchForwardedToMe(state.user.uid, (items) => {
      mount(fwdList, items.length ? items.map((t) => el("li", {}, [
        el("a", { class: "row-main", href: `#/questions/${t.id}` }, [
          el("span", { class: "row-title" }, t.subject),
          el("span", { class: "muted" }, `From ${t.askerName} (${t.aboutLabel || t.clientLabel}) \u00b7 ${formatWhen(t.updatedAt || t.createdAt)}`),
        ]),
        el("span", { class: "row-meta" }, el("span", { class: "tag" + (t.lastFromAdmin ? "" : " hot") }, t.lastFromAdmin ? "Answered" : "Needs a reply")),
      ])) : el("p", { class: "empty" }, "Nothing forwarded to you right now."));
    }));
  }
  return () => { unsubs.forEach((u) => u()); stopTabs(); };
}
