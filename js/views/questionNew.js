import { el, mount } from "../ui.js";
import { roleLabel } from "../data.js";
import { getState } from "../auth.js";
import { askQuestion, getPlayerTeam, uploadErrorMessage } from "../store.js";
import { attachPicker } from "../attachments.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels } from "../names.js";

export async function render(main, { flash, previewClient }) {
  const state = getState();
  const team = effectiveTeam(state);         // a coach/caddy/analyst/other (or the admin previewing one)
  const adminPreview = state.isAdmin && (!!previewClient || team.preview);
  const playerPreview = state.isAdmin && !!previewClient && !team.preview;

  // Team members: which of their players is this about? (Or none in particular.)
  const aboutSel = team.isTeam ? el("select", {}, [
    ...[...teamLabels(team.teamAccess)].map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((p) => el("option", { value: p.key, selected: previewClient?.key === p.key }, p.label)),
    el("option", { value: "" }, "General (not about one player)"),
  ]) : null;
  const about = () => {
    if (!aboutSel || !aboutSel.value) return null;
    return { key: aboutSel.value, label: teamLabels(team.teamAccess).get(aboutSel.value) || aboutSel.value.replace(/^c_/, "") };
  };
  const subject = el("input", { maxLength: 150, placeholder: "What is this about?", required: true, autofocus: true });
  const body = el("textarea", { rows: 8, maxLength: 5000, placeholder: "Include the table, month or figure you're asking about.", required: true });
  const submit = el("button", { class: "btn", type: "submit" }, "Send question");
  const picker = attachPicker();
  const onProgress = (done, total) => { submit.textContent = `Uploading files\u2026 ${Math.min(99, Math.round((done / total) * 100))}%`; };

  // Who else gets it: the administrator always; team members (from the roster) unless unticked.
  // Shown to players, and to the admin previewing a player. Team members asking their own
  // questions don't get this choice.
  const playerKey = playerPreview ? previewClient.key : (!state.isTeam && !state.isAdmin ? state.profile?.clientKey : null);
  const teamBox = el("fieldset", { class: "check-group", hidden: true });
  let teamList = [];
  if (playerKey) {
    getPlayerTeam(playerKey).then((members) => {
      teamList = members;
      mount(teamBox, [
        el("legend", {}, "Who gets this question"),
        el("label", {}, [el("input", { type: "checkbox", checked: true, disabled: true }), "Callaway Analysts (always)"]),
        ...members.map((m, i) => el("label", {}, [
          el("input", { type: "checkbox", checked: true, value: String(i) }),
          `${m.name} (${roleLabel(m.role)})`,
        ])),
        members.length
          ? el("p", { class: "muted", style: "margin:.4rem 0 0" }, adminPreview
            ? "This is what the player sees. Sample questions aren't sent to their team."
            : "Untick anyone who shouldn't see this question. They'll be able to read it and the replies.")
          : null,
      ]);
      teamBox.hidden = false;
    }).catch(() => {});
  }

  const form = el("form", {
    class: "stack narrow",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!subject.value.trim() || !body.value.trim()) { flash("Add a subject and your question.", "error"); return; }
      submit.disabled = true; submit.textContent = "Sending\u2026";
      try {
        const a = about();
        const id = await askQuestion(adminPreview
          ? {
            // A sample from your preview: stored under your account, never sent to anyone else.
            uid: state.user.uid,
            clientKey: team.preview ? (a?.key || previewClient?.key || "t_preview") : previewClient.key,
            clientLabel: team.preview ? (a?.label || team.name) : previewClient.label,
            askerName: team.preview ? `Sample (preview of ${team.name})` : "Sample (admin preview)", askerEmail: state.user.email || "",
            subject: subject.value.trim(), body: body.value.trim(), sample: true, about: team.preview ? a : null,
            files: picker.files(), onProgress,
          }
          : {
            uid: state.user.uid, clientKey: state.profile.clientKey, clientLabel: state.profile.clientLabel,
            askerName: state.profile.name, askerEmail: state.profile.email,
            subject: subject.value.trim(), body: body.value.trim(),
            shareWith: [...teamBox.querySelectorAll("input[value]:checked")].map((c) => teamList[Number(c.value)]),
            files: picker.files(), onProgress, about: a,
          });
        location.hash = `#/questions/${id}`;
      } catch (err) {
        flash(uploadErrorMessage(err, "your question"), "error");
        submit.disabled = false; submit.textContent = "Send question";
      }
    },
  }, [
    aboutSel ? el("label", {}, ["Which player is this about?", aboutSel]) : null,
    el("label", {}, ["Subject", subject]),
    el("label", {}, ["Your question", body]),
    picker.node,
    teamBox,
    el("div", {}, submit),
  ]);

  mount(main, [
    el("header", { class: "page-head" }, [el("p", { class: "crumb" }, el("a", { href: "#/questions" }, "My Questions")), el("h1", {}, "Ask a new question"),
      adminPreview ? el("p", { class: "muted" }, `This is what ${team.preview ? team.name : previewClient.label} sees when asking a question. Your sample lands in your own Questions inbox, marked "Sample", so you can reply and see the whole round trip.`) : null]),
    form,
  ]);
  return () => {};
}
