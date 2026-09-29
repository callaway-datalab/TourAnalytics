import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { watchMyThreads, watchSharedWithMe, watchAdminThreads } from "../store.js";
import { threadActions } from "../threadActions.js";
import { effectiveTeam } from "../preview.js";

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
  const theirList = el("ul", { class: "rows" });
  const theirSection = previewingPlayer
    ? el("section", {}, [el("h2", {}, `${previewClient.label}'s questions`),
      el("p", { class: "muted" }, "What the player has actually asked. Opening one takes you to it in your Questions inbox."), theirList])
    : null;

  mount(main, [
    readOnly
      ? el("p", { class: "muted intro" }, `${team.name}'s questions, read-only. Opening one takes you to it in your Questions inbox.`)
      : el("div", { class: "page-actions" }, [
        el("a", { class: "btn", href: "#/questions/new" }, "Ask a new question"),
        previewingPlayer ? el("p", { class: "muted" },
          `Questions you ask while previewing ${previewClient.label} are samples: they go to your own inbox, and ${previewClient.label} never sees them.`) : null,
      ]),
    theirSection,
    previewingPlayer ? el("h2", {}, "Your sample questions") : null,
    list,
    archived,
    sharedSection,
  ]);

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
  return () => unsubs.forEach((u) => u());
}
