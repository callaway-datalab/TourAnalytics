import { el, mount, formatWhen, confirmAction } from "../ui.js";
import {
  watchInvites, watchUsers, createInvite, revokeInvite, sendPasswordReset, removeUserAccess, adminAllClients,
  watchTeamRoster, applyTeamRoster, UserError,
} from "../store.js";
import { clientKey, formatCode, isTeamKey, roleLabel, parseTeamRoster, toCsv, ROSTER_COLUMNS, norm } from "../data.js";

export async function render(main, { flash }) {
  const clientIdInput = el("input", { list: "known-ids", placeholder: "As it appears in your data", required: true });
  const knownIds = el("datalist", { id: "known-ids" });
  const note = el("input", { maxLength: 200, placeholder: "Who is this for?" });
  const days = el("select", {}, [
    el("option", { value: "7" }, "7 days"), el("option", { value: "14", selected: true }, "14 days"),
    el("option", { value: "30" }, "30 days"), el("option", { value: "0" }, "Never"),
  ]);
  const createBtn = el("button", { class: "btn", type: "submit" }, "Create code");

  let clientsCache = { labels: new Map() };

  const form = el("form", {
    class: "inline-form",
    onSubmit: async (e) => {
      e.preventDefault();
      const label = clientIdInput.value.trim();
      if (!label) { flash("Enter the person's ID exactly as it appears in your data.", "error"); return; }
      createBtn.disabled = true;
      try {
        const key = clientKey(label);
        const code = await createInvite({ clientKey: key, clientLabel: label, note: note.value.trim(), days: Number(days.value) });
        const known = clientsCache.labels.has(key);
        flash(`Access code for ${label}: ${formatCode(code)}` + (known ? "" : " (No uploaded data matches this ID yet.)"), "ok");
        form.reset(); days.value = "14";
      } catch {
        flash("Couldn't create that code. Try again.", "error");
      } finally {
        createBtn.disabled = false;
      }
    },
  }, [
    el("label", {}, ["Player ID", clientIdInput, knownIds]),
    el("label", {}, ["Note (optional)", note]),
    el("label", {}, ["Expires after", days]),
    createBtn,
  ]);

  // ---- Team roster: a CSV the admin keeps and re-uploads whenever it changes ----
  const rosterFile = el("input", { type: "file", accept: ".csv,text/csv", required: true });
  const rosterBtn = el("button", { class: "btn", type: "submit" }, "Upload roster");
  const downloadBtn = el("button", { class: "link", type: "button" }, "Download current roster");
  const templateBtn = el("button", { class: "link", type: "button" }, "Download a blank template");
  const saveCsv = (name, csv) => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = el("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  downloadBtn.addEventListener("click", () => saveCsv("team_members.csv",
    toCsv(ROSTER_COLUMNS, (rosterCache.entries || []).map((e) => [e.email, e.name, roleLabel(e.role), e.playerLabel]))));
  templateBtn.addEventListener("click", () => saveCsv("team_members.csv",
    toCsv(ROSTER_COLUMNS, [["coach@example.com", "Mike Smith", "Coach", "C1001"], ["caddy@example.com", "Jo Brown", "Caddy", "C1001; C1002"]])));
  const rosterForm = el("form", {
    class: "inline-form",
    onSubmit: async (e) => {
      e.preventDefault();
      const f = rosterFile.files[0];
      if (!f) { flash("Choose your team roster CSV.", "error"); return; }
      rosterBtn.disabled = true; rosterBtn.textContent = "Applying\u2026";
      try {
        const { entries, problems } = parseTeamRoster(await f.text());
        if (problems.length) {
          flash(`Nothing was changed. Fix these rows and upload again: ${problems.slice(0, 8).join(" ")}${problems.length > 8 ? ` (and ${problems.length - 8} more)` : ""}`, "error");
          return;
        }
        if (!entries.length && !confirmAction("This roster has no team members. Uploading it removes every coach, caddy, etc. from every player. Continue?")) return;
        const r = await applyTeamRoster(entries);
        const unknown = [...new Set(entries.filter((x) => clientsCache.labels.size && !clientsCache.labels.has(x.playerKey)).map((x) => x.playerLabel))];
        flash(`Roster applied: ${r.people} team ${r.people === 1 ? "member" : "members"}, ${r.links} player ${r.links === 1 ? "link" : "links"}.`
          + (r.updated ? ` Updated ${r.updated} existing ${r.updated === 1 ? "account" : "accounts"}.` : "")
          + (r.newCodes ? ` ${r.newCodes} new access ${r.newCodes === 1 ? "code" : "codes"} to send (see the table).` : "")
          + (unknown.length ? ` Note: no data or account uses these player IDs yet: ${unknown.join(", ")}.` : ""), "ok");
        rosterForm.reset();
      } catch (err) {
        flash(err instanceof UserError ? err.message : "Couldn't apply that roster. Nothing was changed if this happened before saving; try again.", "error");
      } finally {
        rosterBtn.disabled = false; rosterBtn.textContent = "Upload roster";
      }
    },
  }, [el("label", {}, ["Roster file (.csv)", rosterFile]), rosterBtn]);
  const rosterNotes = el("p", { class: "muted" }, [
    "One row per team member per player, with columns ", el("code", {}, "email, name, role, player_id"),
    ". Uploading replaces the previous roster completely: anyone you remove loses access. Players not in the file have no team, so only they see their data. ",
    downloadBtn, " \u00b7 ", templateBtn,
  ]);

  const clientsBox = el("div");
  const invitesBox = el("div");
  const accountsBox = el("div");
  const teamBox = el("div");

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, "Clients & access codes"),
      el("p", { class: "muted" }, "A code lets one player create an account tied to their ID. Each code works once. Coaches, caddies and other team members get their codes from the team roster below."),
    ]),
    el("section", {}, [el("h2", {}, "Create a player access code"), form,
      el("p", { class: "muted" }, ["Sign-up page: ", el("strong", {}, location.origin + location.pathname + "#/signup")])]),
    el("section", {}, [el("h2", {}, "Clients"), clientsBox]),
    el("section", {}, [el("h2", {}, "Team roster"), rosterForm, rosterNotes, teamBox]),
    el("section", {}, [el("h2", {}, "Access codes"), invitesBox]),
    el("section", {}, [el("h2", {}, "Accounts"), accountsBox]),
  ]);

  let invitesCache = [];
  let rosterCache = { entries: [], uploadedAt: null };
  let usersCache = [];

  async function refreshClients() {
    const { labels, usersSnap, invitesSnap } = await adminAllClients();
    clientsCache = { labels };
    const perClient = new Map([...labels.keys()].map((k) => [k, { accounts: 0, openInvites: 0 }]));
    const teamOf = new Map();
    for (const e of rosterCache.entries || []) {
      if (!teamOf.has(e.playerKey)) teamOf.set(e.playerKey, []);
      teamOf.get(e.playerKey).push(`${e.name} (${roleLabel(e.role)})`);
    }
    usersSnap.forEach((d) => { const s = perClient.get(d.data().clientKey); if (s) s.accounts++; });
    const now = Date.now();
    invitesSnap.forEach((d) => {
      const v = d.data();
      const s = perClient.get(v.clientKey);
      if (s && !v.usedBy && !v.revoked && (!v.expiresAt || v.expiresAt.toMillis() > now)) s.openInvites++;
    });
    mount(knownIds, [...labels.values()].map((label) => el("option", { value: label })));
    renderTeam();
    if (!labels.size) { mount(clientsBox, el("p", { class: "empty" }, "No clients yet. Upload data or create a code to add one.")); return; }
    const rows = [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    mount(clientsBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Client ID", "Accounts", "Unused codes", "Team", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map(([key, label]) => el("tr", {}, [
        el("td", {}, el("strong", {}, label)),
        el("td", {}, String(perClient.get(key)?.accounts || 0)),
        el("td", {}, String(perClient.get(key)?.openInvites || 0)),
        el("td", {}, (teamOf.get(key) || []).join(", ") || el("span", { class: "muted" }, "\u2014")),
        el("td", { class: "actions" }, el("a", { href: `#/view-as/${encodeURIComponent(key)}?label=${encodeURIComponent(label)}` }, "See their portal")),
      ]))),
    ])));
  }

  function renderInvites() {
    if (!invitesCache.length) { mount(invitesBox, el("p", { class: "empty" }, "No codes yet.")); return; }
    const now = Date.now();
    mount(invitesBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Code", "Client ID", "Note", "Status", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, invitesCache.map((inv) => {
        let status;
        const asker = usersCache.find((u) => u.uid === inv.usedBy);
        if (inv.usedBy) status = [`Used by ${asker?.name || "someone"} `, el("span", { class: "muted" }, formatWhen(inv.usedAt))];
        else if (inv.revoked) status = el("span", { class: "muted" }, "Revoked");
        else if (inv.expiresAt && inv.expiresAt.toMillis() < now) status = el("span", { class: "muted" }, "Expired");
        else {
          status = [el("span", { class: "tag" }, "Unused")];
          if (inv.expiresAt) status.push(" ", el("span", { class: "muted" }, `expires ${formatWhen(inv.expiresAt)}`));
        }
        let action = null;
        if (!inv.usedBy && !inv.revoked) {
          const btn = el("button", { class: "link danger", type: "button" }, "Revoke");
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try { await revokeInvite(inv.code); flash("Code revoked.", "ok"); }
            catch { flash("Couldn't revoke that code.", "error"); btn.disabled = false; }
          });
          action = btn;
        }
        return el("tr", {}, [
          el("td", {}, el("code", {}, formatCode(inv.code))),
          el("td", {}, isTeamKey(inv.clientKey) ? `${inv.clientLabel} (team member)` : inv.clientLabel), el("td", {}, inv.note || ""),
          el("td", {}, status), el("td", { class: "actions" }, action),
        ]);
      })),
    ])));
  }

  function renderAccounts() {
    if (!usersCache.length) { mount(accountsBox, el("p", { class: "empty" }, "Nobody has signed up yet.")); return; }
    mount(accountsBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Name", "Email", "Client ID", "Joined", "", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, usersCache.map((u) => {
        const resetBtn = el("button", { class: "link", type: "button" }, "Send password reset");
        resetBtn.addEventListener("click", async () => {
          resetBtn.disabled = true;
          try { await sendPasswordReset(u.email); flash(`Password reset email sent to ${u.email}.`, "ok"); }
          catch { flash("Couldn't send that email.", "error"); }
          finally { resetBtn.disabled = false; }
        });
        const delBtn = el("button", { class: "link danger", type: "button" }, "Remove access");
        delBtn.addEventListener("click", async () => {
          if (!confirmAction(`Remove ${u.name}'s access to their data? Their login will stop working.`)) return;
          delBtn.disabled = true;
          try { await removeUserAccess(u.uid); flash(`Removed ${u.name}'s access.`, "ok"); }
          catch { flash("Couldn't remove that account.", "error"); delBtn.disabled = false; }
        });
        return el("tr", {}, [
          el("td", {}, u.name), el("td", {}, u.email), el("td", {}, isTeamKey(u.clientKey) ? el("span", { class: "muted" }, "Team member") : u.clientLabel),
          el("td", {}, formatWhen(u.createdAt)), el("td", {}, resetBtn), el("td", { class: "actions" }, delBtn),
        ]);
      })),
    ])));
  }

  function renderTeam() {
    const entries = rosterCache.entries || [];
    const people = new Map(); // email -> { name, grants: [...] }
    for (const e of entries) {
      if (!people.has(e.email)) people.set(e.email, { name: e.name, grants: [] });
      people.get(e.email).grants.push(e);
    }
    const accounts = new Map(usersCache.filter((u) => isTeamKey(u.clientKey)).map((u) => [norm(u.email), u]));
    const now = Date.now();
    const codes = new Map(invitesCache
      .filter((v) => isTeamKey(v.clientKey) && v.email && !v.usedBy && !v.revoked && (!v.expiresAt || v.expiresAt.toMillis() > now))
      .map((v) => [norm(v.email), v.code]));
    // Team logins that exist but aren't in the roster any more: they can log in but see no players.
    const offRoster = [...accounts.entries()].filter(([email]) => !people.has(email));

    if (!people.size && !offRoster.length) {
      mount(teamBox, el("p", { class: "empty" }, "No roster uploaded yet, so every player's data is visible to that player only."));
      return;
    }
    const signupUrl = location.origin + location.pathname + "#/signup";
    const rows = [...people.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([email, p]) => {
      let status;
      if (accounts.has(email)) status = el("span", { class: "tag" }, "Signed up");
      else if (codes.has(email)) status = [el("code", {}, formatCode(codes.get(email))), el("br"), el("span", { class: "muted" }, "Not signed up yet: send them this code")];
      else status = el("span", { class: "muted" }, "Upload the roster again to make a code");
      const unknown = (key) => clientsCache.labels.size && !clientsCache.labels.has(key);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, p.name)), el("td", {}, email),
        el("td", {}, el("ul", { class: "grant-list" }, p.grants.map((g) => el("li", {}, [
          el("strong", {}, g.playerLabel), el("span", { class: "tag" }, roleLabel(g.role)),
          unknown(g.playerKey) ? el("span", { class: "muted", title: "No data or account uses this player ID yet" }, "?") : null,
        ])))),
        el("td", {}, status),
      ]);
    });
    for (const [email, u] of offRoster) {
      rows.push(el("tr", {}, [
        el("td", {}, el("strong", {}, u.name)), el("td", {}, email),
        el("td", {}, el("span", { class: "muted" }, "Not in the roster: sees no players")),
        el("td", {}, el("span", { class: "muted" }, "Remove their account below if they no longer need a login")),
      ]));
    }
    mount(teamBox, [
      el("p", { class: "muted" }, ["Codes for team members only work with the email address in the roster. Sign-up page: ", el("strong", {}, signupUrl)]),
      el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
        el("thead", {}, el("tr", {}, ["Name", "Email", "Players", "Account"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ])),
    ]);
  }

  const unInv = watchInvites((invites) => { invitesCache = invites; renderInvites(); renderTeam(); });
  const unUsers = watchUsers((users) => { usersCache = users; renderAccounts(); renderInvites(); renderTeam(); });
  const unRoster = watchTeamRoster((r) => { rosterCache = r; renderTeam(); refreshClients(); });
  refreshClients();
  const clientsInterval = setInterval(refreshClients, 15000); // no realtime listener for this derived summary

  return () => { unInv(); unUsers(); unRoster(); clearInterval(clientsInterval); };
}
