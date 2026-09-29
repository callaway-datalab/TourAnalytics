import { el, mount, formatWhen, confirmAction, num } from "../ui.js";
import {
  watchInvites, watchUsers, createInvite, revokeInvite, sendPasswordReset, removeUserAccess, adminAllClients,
  watchTeamRoster, applyTeamRoster, UserError, adminStats,
  refreshInvite, deleteInvite, createAnalystAccess, setAnalystPlayers, syncAllPlayersAnalysts,
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
  // File picker styled as a button: "Choose File" before any roster, "Replace Roster" after, with the
  // current roster's file name beside it (or the newly picked file, ready to upload).
  const rosterFile = el("input", { type: "file", accept: ".csv,text/csv", class: "visually-hidden" });
  const rosterPickText = el("span", {}, "Choose File");
  const rosterFileName = el("span", { class: "file-name muted" }, "No file chosen");
  const rosterPicker = el("label", { class: "file-pick" }, [el("span", { class: "btn ghost" }, rosterPickText), rosterFile]);
  const drawRosterFile = () => {
    const picked = rosterFile.files[0];
    const hasRoster = (rosterCache.entries || []).length > 0 || !!rosterCache.fileName;
    rosterPickText.textContent = hasRoster ? "Replace Roster" : "Choose File";
    if (picked) rosterFileName.textContent = `${picked.name} (ready to upload)`;
    else if (hasRoster) rosterFileName.textContent = `${rosterCache.fileName || "Current roster"}${rosterCache.uploadedAt ? ` \u00b7 uploaded ${formatWhen(rosterCache.uploadedAt)}` : ""}`;
    else rosterFileName.textContent = "No file chosen";
  };
  rosterFile.addEventListener("change", drawRosterFile);
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
        const r = await applyTeamRoster(entries, f.name);
        const unknown = [...new Set(entries.filter((x) => clientsCache.labels.size && !clientsCache.labels.has(x.playerKey)).map((x) => x.playerLabel))];
        flash(`Roster applied: ${r.people} team ${r.people === 1 ? "member" : "members"}, ${r.links} player ${r.links === 1 ? "link" : "links"}.`
          + (r.updated ? ` Updated ${r.updated} existing ${r.updated === 1 ? "account" : "accounts"}.` : "")
          + (r.newCodes ? ` ${r.newCodes} new access ${r.newCodes === 1 ? "code" : "codes"} to send (see the table).` : "")
          + (unknown.length ? ` Note: no data or account uses these player IDs yet: ${unknown.join(", ")}.` : ""), "ok");
        rosterForm.reset(); drawRosterFile();
      } catch (err) {
        flash(err instanceof UserError ? err.message : "Couldn't apply that roster. Nothing was changed if this happened before saving; try again.", "error");
      } finally {
        rosterBtn.disabled = false; rosterBtn.textContent = "Upload roster";
      }
    },
  }, [el("div", { class: "file-row" }, [el("span", { class: "field-label" }, "Roster file (.csv)"), el("div", { class: "file-line" }, [rosterPicker, rosterFileName])]), rosterBtn]);
  const rosterNotes = el("p", { class: "muted" }, [
    "Uploading replaces the previous roster completely: anyone you remove loses access. ",
    downloadBtn, " \u00b7 ", templateBtn,
  ]);

  const clientsBox = el("div");
  const analystBox = el("div");
  const invitesBox = el("div");
  // Access codes: search box and type filters. Built once so they keep their state as the table redraws.
  const CODE_TYPES = [["player", "Players"], ["coach", "Coaches"], ["caddy", "Caddies"], ["analyst", "Analysts"], ["other", "Other"]];
  const codeSearch = el("input", { type: "search", placeholder: "Search by name, email, code, role or player\u2026", "aria-label": "Search access codes" });
  const typeBoxes = CODE_TYPES.map(([v, l]) => el("label", {}, [el("input", { type: "checkbox", value: v, checked: true }), l]));
  const codeTools = el("div", { class: "code-tools" }, [
    codeSearch,
    el("fieldset", { class: "type-filters" }, [el("legend", { class: "visually-hidden" }, "Show"), ...typeBoxes]),
  ]);
  codeSearch.addEventListener("input", () => renderInvites());
  typeBoxes.forEach((l) => l.querySelector("input").addEventListener("change", () => renderInvites()));
  // Pop-up listing the players someone works with.
  const playersDialog = el("dialog", { class: "players-dialog" });
  document.body.appendChild(playersDialog);
  const showPlayers = (name, grants) => {
    mount(playersDialog, [
      el("h3", {}, `${name} works with`),
      el("ul", {}, grants.map((g) => el("li", {}, [el("strong", {}, g.label), ` \u00b7 ${roleLabel(g.role)}`]))),
      el("form", { method: "dialog" }, el("button", { class: "btn" }, "Close")),
    ]);
    playersDialog.showModal();
  };
  const accountsBox = el("div");

  // At a glance: the numbers that used to be on the Overview page.
  const statsBox = el("dl", { class: "facts glance" }, el("p", { class: "muted" }, "Loading\u2026"));
  const loadStats = () => adminStats().then((stats) => mount(statsBox, [
    ["Players in your data", stats.clients], ["Accounts created", stats.accounts], ["Unused access codes", stats.openInvites],
    ["Data files", stats.datasets], ["Reports", stats.documents],
  ].map(([label, value]) => el("div", {}, [el("dt", {}, label), el("dd", {}, num(value))])))).catch(() => {});
  loadStats();
  const statsInterval = setInterval(loadStats, 60000);

  mount(main, [
    el("section", { class: "glance-section" }, [el("h2", {}, "At a glance"), statsBox]),
    el("section", {}, [el("h2", {}, "Create a player access code"), form,
      el("p", { class: "muted" }, ["Sign-up page: ", el("strong", {}, location.origin + location.pathname + "#/signup")])]),
    el("section", {}, [el("h2", {}, "Players"), clientsBox]),
    el("section", {}, [el("h2", {}, "Team roster"), rosterForm, rosterNotes]),
    el("section", {}, [el("h2", {}, "Access codes"), codeTools, invitesBox]),
    el("section", {}, [el("h2", {}, "Accounts"), accountsBox]),
    el("section", {}, [el("h2", {}, "Callaway Access"),
      analystBox]),
  ]);

  let invitesCache = [];
  let rosterCache = { entries: [], uploadedAt: null };
  let usersCache = [];

  async function refreshClients() {
    const { labels, usersSnap, invitesSnap } = await adminAllClients();
    const labelsChanged = [...labels.keys()].sort().join("|") !== [...clientsCache.labels.keys()].sort().join("|");
    clientsCache = { labels };
    syncAllPlayersAnalysts(usersCache, invitesCache, labels).catch(() => {});
    if (labelsChanged) renderAnalysts();
    const perClient = new Map([...labels.keys()].map((k) => [k, { accounts: 0, openInvites: 0 }]));
    const teamOf = new Map();
    for (const e of rosterCache.entries || []) {
      if (!teamOf.has(e.playerKey)) teamOf.set(e.playerKey, []);
      teamOf.get(e.playerKey).push(e);
    }
    // Each team member's name opens their portal (their account if they've signed up, else a roster preview).
    const teamLinks = (entries) => entries.flatMap((e, i) => {
      const acct = usersCache.find((u) => isTeamKey(u.clientKey) && u.kind !== "analyst" && norm(u.email) === e.email);
      const href = acct ? portalHref(acct) : `#/view-as-roster/${encodeURIComponent(e.email)}`;
      return [i ? ", " : null, el("a", { href, title: `See ${e.name}'s portal` }, e.name), ` (${roleLabel(e.role)})`];
    });
    usersSnap.forEach((d) => { const s = perClient.get(d.data().clientKey); if (s) s.accounts++; });
    const now = Date.now();
    invitesSnap.forEach((d) => {
      const v = d.data();
      const s = perClient.get(v.clientKey);
      if (s && !v.usedBy && !v.revoked && (!v.expiresAt || v.expiresAt.toMillis() > now)) s.openInvites++;
    });
    mount(knownIds, [...labels.values()].map((label) => el("option", { value: label })));
    if (!labels.size) { mount(clientsBox, el("p", { class: "empty" }, "No clients yet. Upload data or create a code to add one.")); return; }
    const rows = [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    mount(clientsBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Client ID", "Accounts", "Unused codes", "Team", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map(([key, label]) => el("tr", {}, [
        el("td", {}, el("strong", {}, label)),
        el("td", {}, String(perClient.get(key)?.accounts || 0)),
        el("td", {}, String(perClient.get(key)?.openInvites || 0)),
        el("td", {}, (teamOf.get(key) || []).length ? teamLinks(teamOf.get(key)) : el("span", { class: "muted" }, "\u2014")),
        el("td", { class: "actions" }, el("a", { href: `#/view-as/${encodeURIComponent(key)}?label=${encodeURIComponent(label)}` }, "See their portal")),
      ]))),
    ])));
  }

  function renderInvites() {
    if (!invitesCache.length) { mount(invitesBox, el("p", { class: "empty" }, "No codes yet.")); return; }
    const now = Date.now();
    const shown = new Set(typeBoxes.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value));
    const q = codeSearch.value.trim().toLowerCase();

    const rows = invitesCache.map((inv) => {
      const user = inv.usedBy ? usersCache.find((u) => u.uid === inv.usedBy) : null;
      // Which players this person works with (their current access once they've signed up).
      const access = (user?.access ?? inv.access) || {};
      const grants = Object.entries(access).map(([key, g]) => ({ key, role: g.role, label: g.label || key.replace(/^c_/, "") }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const roles = [...new Set(grants.map((g) => g.role))];
      let types, note;
      if (!isTeamKey(inv.clientKey)) { types = ["player"]; note = inv.note || ""; }
      else if (inv.kind === "analyst") { types = ["analyst"]; note = "Callaway Analyst"; }
      else {
        types = roles.map((r) => (r === "coach" || r === "caddy" ? r : "other"));
        if (!types.length) types = ["other"];
        note = roles.map((r) => roleLabel(r)).join(", ") || "Team member";
      }

      let status, statusText;
      if (inv.usedBy) { status = [`Used by ${user?.name || "someone"} `, el("span", { class: "muted" }, formatWhen(inv.usedAt))]; statusText = `used by ${user?.name || ""}`; }
      else if (inv.revoked) { status = el("span", { class: "muted" }, "Revoked"); statusText = "revoked"; }
      else if (inv.expiresAt && inv.expiresAt.toMillis() < now) { status = el("span", { class: "muted" }, "Expired"); statusText = "expired"; }
      else {
        status = [el("span", { class: "tag" }, "Unused")];
        if (inv.expiresAt) status.push(" ", el("span", { class: "muted" }, `expires ${formatWhen(inv.expiresAt)}`));
        statusText = "unused";
      }

      const teamOf = !isTeamKey(inv.clientKey) ? el("span", { class: "muted" }, "\u2014")
        : inv.kind === "analyst" && (user?.allPlayers ?? inv.allPlayers) ? linkButton("All players", () => showPlayers(inv.clientLabel, grants))
        : grants.length === 0 ? el("span", { class: "muted" }, "\u2014")
        : grants.length === 1 ? grants[0].label
        : linkButton(`${grants.length} players`, () => showPlayers(inv.clientLabel, grants));

      const haystack = [inv.code, formatCode(inv.code), inv.clientLabel, inv.email, user?.email, note, statusText, ...grants.map((g) => g.label)]
        .filter(Boolean).join(" ").toLowerCase();
      return { inv, types, note, status, teamOf, haystack };
    }).filter((r) => r.types.some((t) => shown.has(t)) && (!q || r.haystack.includes(q)));

    if (!rows.length) { mount(invitesBox, el("p", { class: "empty" }, "No codes match.")); return; }
    mount(invitesBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Code", "Name", "Note", "Team of", "Status", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map(({ inv, note, status, teamOf }) => el("tr", {}, [
        el("td", {}, el("code", {}, formatCode(inv.code))),
        el("td", {}, inv.clientLabel),
        el("td", {}, note),
        el("td", {}, teamOf),
        el("td", {}, status),
        el("td", { class: "actions" }, codeActions(inv, now)),
      ]))),
    ])));
  }

  function linkButton(text, onClick) {
    const b = el("button", { class: "link", type: "button" }, text);
    b.addEventListener("click", onClick);
    return b;
  }

  // Revoke an open code; bring back or delete an expired / revoked one.
  function codeActions(inv, now) {
    if (inv.usedBy) return null;
    const expired = !!inv.expiresAt && inv.expiresAt.toMillis() < now;
    if (inv.revoked || expired) {
      const refresh = linkButton("Refresh access", async () => {
        refresh.disabled = true;
        try { await refreshInvite(inv); flash(`Code ${formatCode(inv.code)} works again.`, "ok"); }
        catch { flash("Couldn't refresh that code.", "error"); refresh.disabled = false; }
      });
      const del = el("button", { class: "link danger", type: "button" }, "Delete");
      del.addEventListener("click", async () => {
        if (!confirmAction(`Delete code ${formatCode(inv.code)}?`)) return;
        del.disabled = true;
        try { await deleteInvite(inv.code); flash("Code deleted.", "ok"); }
        catch { flash("Couldn't delete that code.", "error"); del.disabled = false; }
      });
      return el("span", { class: "thread-actions" }, [refresh, del]);
    }
    const btn = el("button", { class: "link danger", type: "button" }, "Revoke");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { await revokeInvite(inv.code); flash("Code revoked.", "ok"); }
      catch { flash("Couldn't revoke that code.", "error"); btn.disabled = false; }
    });
    return btn;
  }

  // Preview anyone's portal: players open their own view, team members and analysts their My players page.
  const portalHref = (u) => (isTeamKey(u.clientKey)
    ? `#/view-as-member/${encodeURIComponent(u.uid)}`
    : `#/view-as/${encodeURIComponent(u.clientKey)}?label=${encodeURIComponent(u.clientLabel)}`);

  function renderAccounts() {
    if (!usersCache.length) { mount(accountsBox, el("p", { class: "empty" }, "Nobody has signed up yet.")); return; }
    mount(accountsBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Name", "Email", "Client ID", "Joined", "", "", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, usersCache.map((u) => {
        const portal = el("a", { href: portalHref(u) }, "See their portal");
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
          el("td", {}, u.name), el("td", {}, u.email), el("td", {}, u.kind === "analyst" ? el("span", { class: "muted" }, "Callaway Access") : isTeamKey(u.clientKey) ? el("span", { class: "muted" }, "Team member") : u.clientLabel),
          el("td", {}, formatWhen(u.createdAt)), el("td", {}, portal), el("td", {}, resetBtn), el("td", { class: "actions" }, delBtn),
        ]);
      })),
    ])));
  }

  /* ---------------- Callaway Access ---------------- */
  // A checklist of players with an "All players" switch; used to create access and to edit it.
  // "Players they can see": an "All players" box, or a searchable dropdown that adds players to a list.
  function playerChecklist(selected = [], all = false) {
    const players = [...clientsCache.labels.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    const labelOf = (k) => players.find((p) => p.key === k)?.label || k.replace(/^c_/, "");
    let chosen = [...new Set(selected)];
    const allBox = el("input", { type: "checkbox", checked: all });
    const listId = "analyst-players-" + Math.random().toString(36).slice(2, 7);
    const search = el("input", { type: "search", list: listId, placeholder: players.length ? "Search players to add\u2026" : "No players yet", autocomplete: "off", "aria-label": "Add a player" });
    const options = el("datalist", { id: listId });
    const chips = el("ul", { class: "attach-list chosen-players" });
    const picker = el("div", { class: "player-adder" }, [search, options, chips]);

    const draw = () => {
      mount(options, players.filter((p) => !chosen.includes(p.key)).map((p) => el("option", { value: p.label })));
      mount(chips, chosen.length
        ? chosen.map((k) => el("li", {}, [
            el("span", {}, labelOf(k)),
            el("button", { class: "link danger", type: "button", title: `Remove ${labelOf(k)}`, onClick: () => { chosen = chosen.filter((x) => x !== k); draw(); } }, "\u00d7"),
          ]))
        : el("li", { class: "none-yet" }, el("span", { class: "muted" }, "No players added yet.")));
      picker.hidden = allBox.checked;
    };
    const tryAdd = () => {
      const t = search.value.trim().toLowerCase();
      const p = players.find((x) => x.label.toLowerCase() === t);
      if (p) { if (!chosen.includes(p.key)) chosen.push(p.key); search.value = ""; draw(); }
      return !!p;
    };
    search.addEventListener("input", tryAdd); // picking from the dropdown fills the box with an exact name
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!tryAdd()) {
        // Enter on a partial name adds the only match, if there's exactly one.
        const t = search.value.trim().toLowerCase();
        const matches = players.filter((x) => !chosen.includes(x.key) && x.label.toLowerCase().includes(t));
        if (t && matches.length === 1) { search.value = matches[0].label; tryAdd(); }
      }
    });
    allBox.addEventListener("change", draw);
    draw();

    const node = el("fieldset", { class: "check-group player-checklist" }, [
      el("legend", {}, "Players they can see"),
      el("label", { class: "all-players" }, [allBox, "All players (including players added later)"]),
      picker,
    ]);
    return { node, value: () => ({ allPlayers: allBox.checked, playerKeys: allBox.checked ? [] : [...chosen] }) };
  }

  function renderAnalysts() {
    const nameIn = el("input", { required: true, placeholder: "e.g. Jordan Lee", maxLength: 80 });
    const emailIn = el("input", { type: "email", required: true, placeholder: "name@callawaygolf.com" });
    const daysIn = el("select", {}, [["14", "14 days"], ["30", "30 days"], ["90", "90 days"], ["0", "Never"]].map(([v, l]) => el("option", { value: v }, l)));
    const list = playerChecklist();
    const createBtn = el("button", { class: "btn", type: "submit" }, "Create access");
    const form = el("form", {
      class: "stack",
      onSubmit: async (e) => {
        e.preventDefault();
        const { allPlayers, playerKeys } = list.value();
        if (!allPlayers && !playerKeys.length) { flash("Choose at least one player, or All players.", "error"); return; }
        createBtn.disabled = true;
        try {
          const code = await createAnalystAccess({
            name: nameIn.value.trim(), email: emailIn.value.trim(), playerKeys, allPlayers, labels: clientsCache.labels, days: Number(daysIn.value),
          });
          flash(`Callaway Access for ${nameIn.value.trim()}: ${formatCode(code)}. It only works with ${emailIn.value.trim().toLowerCase()}. Send it with the sign-up link.`, "ok");
          renderAnalysts();
        } catch (err) {
          flash(err instanceof UserError ? err.message : "Couldn't create that access. Try again.", "error");
          createBtn.disabled = false;
        }
      },
    }, [
      el("div", { class: "inline-form" }, [el("label", {}, ["Name", nameIn]), el("label", {}, ["Email", emailIn]), el("label", {}, ["Code expires after", daysIn])]),
      list.node,
      el("div", {}, createBtn),
    ]);

    // Everyone with Callaway Access: signed-up accounts and codes still waiting to be used.
    const now = Date.now();
    const people = [
      ...usersCache.filter((u) => u.kind === "analyst").map((u) => ({ target: { uid: u.uid }, name: u.name, email: u.email, access: u.access, allPlayers: u.allPlayers,
        status: [el("span", { class: "tag" }, "Signed up"), el("br"), el("a", { href: portalHref(u) }, "See their portal")] })),
      ...invitesCache.filter((v) => v.kind === "analyst" && !v.usedBy && !v.revoked && (!v.expiresAt || v.expiresAt.toMillis() > now))
        .map((v) => ({ target: { code: v.code }, name: v.clientLabel, email: v.email, access: v.access, allPlayers: v.allPlayers,
          status: [el("code", {}, formatCode(v.code)), el("br"), el("span", { class: "muted" }, "Not signed up yet"), el("br"), el("a", { href: `#/view-as-code/${v.code}` }, "See their portal")] })),
    ];
    const rows = people.map((p) => {
      const keys = Object.keys(p.access || {});
      const edit = el("details", { class: "edit-players" }, [el("summary", {}, "Change players")]);
      edit.addEventListener("toggle", () => {
        if (!edit.open || edit.querySelector("form")) return;
        const cl = playerChecklist(keys, p.allPlayers);
        const save = el("button", { class: "btn", type: "submit" }, "Save");
        edit.appendChild(el("form", { class: "stack", onSubmit: async (e) => {
          e.preventDefault();
          const v = cl.value();
          if (!v.allPlayers && !v.playerKeys.length) { flash("Choose at least one player, or All players.", "error"); return; }
          save.disabled = true;
          try { await setAnalystPlayers(p.target, { ...v, labels: clientsCache.labels }); flash(`Updated ${p.name}'s players.`, "ok"); refreshClients(); }
          catch { flash("Couldn't save that change.", "error"); save.disabled = false; }
        } }, [cl.node, el("div", {}, save)]));
      });
      return el("tr", {}, [
        el("td", {}, el("strong", {}, p.name)), el("td", {}, p.email),
        el("td", {}, [p.allPlayers ? "All players" : keys.map((k) => p.access[k].label).sort().join(", ") || el("span", { class: "muted" }, "None"), edit]),
        el("td", {}, p.status),
      ]);
    });
    mount(analystBox, [
      rows.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
        el("thead", {}, el("tr", {}, ["Name", "Email", "Players", "Access"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ])) : el("p", { class: "empty" }, "Nobody has Callaway Access yet."),
      el("h3", { class: "subhead" }, "Add Callaway Access"),
      form,
    ]);
  }

  const unInv = watchInvites((invites) => { invitesCache = invites; renderInvites(); renderAnalysts(); });
  const unUsers = watchUsers((users) => { usersCache = users; renderAccounts(); renderInvites(); renderAnalysts(); });
  const unRoster = watchTeamRoster((r) => { rosterCache = r; drawRosterFile(); refreshClients(); });
  refreshClients();
  const clientsInterval = setInterval(refreshClients, 15000); // no realtime listener for this derived summary

  return () => { unInv(); unUsers(); unRoster(); clearInterval(clientsInterval); clearInterval(statsInterval); playersDialog.remove(); };
}
