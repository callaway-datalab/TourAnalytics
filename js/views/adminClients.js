// Player Access: the admin's home page.
//   At a glance · Access codes (create + table) · Team roster · Players
import { el, mount, formatWhen, confirmAction, num, subNav } from "../ui.js";
import { sameNamePlayers } from "../playerPicker.js";
import { plainName } from "../names.js";
import {
  watchInvites, watchUsers, createInvite, revokeInvite, sendPasswordReset, removeUserAccess, adminAllClients,
  watchTeamRoster, applyTeamRoster, UserError, adminStats,
  refreshInvite, deleteInvite, storageEstimate, createAnalystAccess, setAnalystPlayers, syncAllPlayersAnalysts,
  createTeamAccess, setTeamPlayers, clearInviteExpiry, syncAccessLabels,
} from "../store.js";
import { clientKey, formatCode, isTeamKey, roleLabel, parseTeamRoster, toCsv, ROSTER_COLUMNS, norm } from "../data.js";

const USER_TYPES = [["player", "Player"], ["coach", "Coach"], ["caddy", "Caddy"], ["analyst", "Analyst"], ["other", "Other"]];
const CODE_FILTERS = [["player", "Player"], ["coach", "Coach"], ["caddy", "Caddy"], ["analyst", "Analyst"], ["other", "Other"]];

export async function render(main, { flash }) {
  let clientsCache = { labels: new Map() };
  let invitesCache = [];
  let usersCache = [];
  let rosterCache = { entries: [], uploadedAt: null };
  let expiryCleared = false;

  const linkButton = (text, onClick, cls = "link") => {
    const b = el("button", { class: cls, type: "button" }, text);
    b.addEventListener("click", onClick);
    return b;
  };
  // Preview anyone's portal: players open their own view, team members and analysts theirs.
  const portalHref = (u) => (isTeamKey(u.clientKey)
    ? `#/view-as-member/${encodeURIComponent(u.uid)}`
    : `#/view-as/${encodeURIComponent(u.clientKey)}?label=${encodeURIComponent(clientsCache.labels.get(u.clientKey) || u.clientLabel)}`);

  // One pop-up, reused for "who do they work with" and "edit players".
  const dialog = el("dialog", { class: "players-dialog" });
  document.body.appendChild(dialog);
  const openDialog = (children) => { mount(dialog, children); dialog.showModal(); };
  const showPlayers = (name, grants) => openDialog([
    el("h3", {}, `${name} works with`),
    el("ul", {}, grants.map((g) => el("li", {}, [el("strong", {}, g.label), ` \u00b7 ${roleLabel(g.role)}`]))),
    el("form", { method: "dialog" }, el("button", { class: "btn" }, "Close")),
  ]);

  /* ============================ At a glance ============================ */
  const statsBox = el("dl", { class: "facts glance" }, el("p", { class: "muted" }, "Loading\u2026"));
  // Weekly Sign-ins / Weekly Users open a list (who, and when) under the boxes; tap again to close it.
  let weekly = [], openList = null;
  const weekBox = el("div", { class: "week-list", hidden: true });
  const drawWeek = () => {
    weekBox.hidden = !openList;
    statsBox.querySelectorAll(".glance-btn").forEach((b) => b.setAttribute("aria-expanded", b.dataset.list === openList ? "true" : "false"));
    if (!openList) return;
    if (!weekly.length) { mount(weekBox, el("p", { class: "muted" }, "No sign-ins yet this week.")); return; }
    if (openList === "signins") {
      mount(weekBox, [el("h3", {}, `Sign-ins this week (${weekly.length})`), el("div", { class: "table-scroll five-rows" }, el("table", { class: "plain" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Who"), el("th", {}, "When")])),
        el("tbody", {}, weekly.map((w) => el("tr", {}, [el("td", {}, w.name), el("td", { class: "nowrap muted" }, w.at ? formatWhen(w.at) : "\u2014")]))),
      ]))]);
    } else {
      const people = new Map();
      for (const w of weekly) { const p = people.get(w.uid) || { name: w.name, n: 0, last: w.at }; p.n++; if ((w.at?.toMillis?.() ?? 0) > (p.last?.toMillis?.() ?? 0)) p.last = w.at; people.set(w.uid, p); }
      const rows = [...people.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      mount(weekBox, [el("h3", {}, `Who signed in this week (${rows.length})`), el("div", { class: "table-scroll five-rows" }, el("table", { class: "plain" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Who"), el("th", { class: "num" }, "Sign-ins"), el("th", {}, "Last")])),
        el("tbody", {}, rows.map((p) => el("tr", {}, [el("td", {}, p.name), el("td", { class: "num" }, String(p.n)), el("td", { class: "nowrap muted" }, p.last ? formatWhen(p.last) : "\u2014")]))),
      ]))]);
    }
  };
  const loadStats = () => adminStats().then((stats) => {
    weekly = stats.weekly || [];
    mount(statsBox, [
      ["Players in your data", stats.clients], ["Accounts created", stats.accounts], ["Unused access codes", stats.openInvites],
      ["Weekly Sign-ins", stats.weeklySignIns, "Since Monday, everyone combined. Tap to see them.", "signins"],
      ["Weekly Users", stats.weeklyUsers, "Different people who signed in since Monday. Tap to see who.", "users"],
    ].map(([label, value, title, list]) => {
      if (!list) return el("div", { title: title || "" }, [el("dt", {}, label), el("dd", {}, num(value))]);
      const b = el("div", { class: "glance-btn", role: "button", tabindex: "0", title, "data-list": list, "aria-expanded": "false" }, [el("dt", {}, label), el("dd", {}, num(value))]);
      const toggle = () => { openList = openList === list ? null : list; drawWeek(); };
      b.addEventListener("click", toggle);
      b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return b;
    }));
    drawWeek();
  }).catch(() => {});

  // Storage: how much of the free plan's database space is used, and roughly how much more fits.
  const storageBox = el("div", { class: "storage" }, el("p", { class: "muted small" }, "Working out storage\u2026"));
  const mb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(b >= 100 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
  const loadStorage = () => storageEstimate().then((st) => {
    const pctUsed = Math.min(100, (st.used / st.quota) * 100);
    const left = Math.max(0, st.quota - st.used);
    const pdfStored = st.typicalPdf * 4 / 3 * 1.1;
    const tone = pctUsed >= 90 ? "bad" : pctUsed >= 70 ? "warn" : "ok";
    mount(storageBox, [
      el("div", { class: "storage-top" }, [el("strong", {}, "Storage"), el("span", {}, `${mb(st.used)} of ${mb(st.quota)} used`), el("span", { class: "muted" }, `${pctUsed < 1 ? pctUsed.toFixed(1) : Math.round(pctUsed)}%`)]),
      el("div", { class: `storage-bar ${tone}`, role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pctUsed)), "aria-label": "Storage used" }, [
        el("span", { class: "seg-reports", style: `width:${(st.reports * 1.1 / st.quota) * 100}%`, title: `Reports: ${mb(st.reports)}` }),
        el("span", { class: "seg-data", style: `width:${(st.data * 1.1 / st.quota) * 100}%`, title: `Data files: ${mb(st.data)}` }),
        el("span", { class: "seg-att", style: `width:${(st.attachments * 1.1 / st.quota) * 100}%`, title: `Question attachments: ${mb(st.attachments)}` }),
      ]),
      el("div", { class: "storage-legend" }, [
        el("span", {}, [el("i", { class: "seg-reports" }), `Reports ${mb(st.reports)}`]),
        el("span", {}, [el("i", { class: "seg-data" }), `Data files ${mb(st.data)}`]),
        el("span", {}, [el("i", { class: "seg-att" }), `Attachments ${mb(st.attachments)}`]),
      ]),
      el("p", { class: "muted small" }, `About ${mb(left)} left: room for roughly ${num(Math.floor(left / pdfStored))} more reports the size of yours (${mb(st.typicalPdf)} average). An estimate on Firebase's free plan (1 GB); Firebase \u2192 Firestore \u2192 Usage has the exact figure.`),
    ]);
  }).catch(() => mount(storageBox, el("p", { class: "muted small" }, "Couldn't work out storage right now.")));
  loadStorage();
  loadStats();
  const statsInterval = setInterval(loadStats, 60000);

  /* ======================= Player search-and-add list ======================= */
  // A searchable dropdown that adds players to a list (with × to remove). allowAll adds the
  // "All players (including players added later)" box, for analysts.
  // selectAll: a "Select all players" box that picks every current player (for Other team members).
  function playerPicker(selected = [], { all = false, allowAll = false, selectAll = false } = {}) {
    const players = () => [...clientsCache.labels.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    const labelOf = (k) => clientsCache.labels.get(k) || k.replace(/^c_/, "");
    let chosen = [...new Set(selected)];
    const allBox = el("input", { type: "checkbox", checked: all });
    const listId = "players-" + Math.random().toString(36).slice(2, 8);
    const search = el("input", { type: "search", list: listId, placeholder: "Search players to add\u2026", autocomplete: "off", "aria-label": "Add a player" });
    const options = el("datalist", { id: listId });
    const chips = el("ul", { class: "attach-list chosen-players" });
    const which = el("div", { class: "which-player", hidden: true });
    const adder = el("div", { class: "player-adder" }, [search, which, options, chips]);
    const draw = () => {
      mount(options, players().filter((p) => !chosen.includes(p.key)).map((p) => el("option", { value: p.label })));
      mount(chips, chosen.length
        ? chosen.map((k) => el("li", {}, [el("span", {}, labelOf(k)),
            linkButton("\u00d7", () => { chosen = chosen.filter((x) => x !== k); draw(); }, "link danger")]))
        : el("li", { class: "none-yet" }, el("span", { class: "muted" }, "No players added yet.")));
      adder.hidden = (allowAll || selectAll) && allBox.checked;
    };
    const add = (p) => { if (!chosen.includes(p.key)) chosen.push(p.key); search.value = ""; which.hidden = true; delete which.dataset.for; draw(); };
    const tryAdd = () => {
      const t = search.value.trim().toLowerCase();
      const p = players().find((x) => x.label.toLowerCase() === t);
      if (p) { add(p); return true; }
      // A name shared by more than one player ID: ask which one.
      const dupes = sameNamePlayers(players(), search.value);
      which.hidden = !dupes.length;
      const forText = search.value.trim().toLowerCase();
      if (dupes.length && which.dataset.for !== forText) which.dataset.for = forText, mount(which, [el("span", {}, `There are ${dupes.length} players named ${search.value.trim()}. Which one?`),
        ...dupes.map((d) => linkButton(`ID ${clientsCache.ids?.get(d.key) || d.key.replace(/^c_/, "")}`, () => add(d), "btn ghost"))]);
      return false;
    };
    search.addEventListener("focus", draw); // pick up players added since the form was drawn
    search.addEventListener("input", tryAdd);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (tryAdd()) return;
      const t = search.value.trim().toLowerCase();
      const matches = players().filter((x) => !chosen.includes(x.key) && x.label.toLowerCase().includes(t));
      if (t && matches.length === 1) { search.value = matches[0].label; tryAdd(); }
    });
    allBox.addEventListener("change", draw);
    draw();
    const node = el("fieldset", { class: "check-group player-checklist" }, [
      el("legend", {}, "Players they work with"),
      allowAll ? el("label", { class: "all-players" }, [allBox, "All players (including players added later)"])
        : selectAll ? el("label", { class: "all-players" }, [allBox, "Select all players"]) : null,
      adder,
    ]);
    return { node, value: () => ({ allPlayers: allowAll && allBox.checked,
      playerKeys: allowAll && allBox.checked ? [] : selectAll && allBox.checked ? players().map((p) => p.key) : [...chosen] }) };
  }

  /* ======================= Create an access code ======================= */
  const typeSel = el("select", { "aria-label": "User type" }, USER_TYPES.map(([v, l]) => el("option", { value: v }, l)));
  const fieldsBox = el("div", { class: "code-fields" });
  const createBtn = el("button", { class: "btn", type: "submit" }, "Create code");
  const knownIds = el("datalist", { id: "known-ids" });
  let fields = {};

  const drawFields = () => {
    const type = typeSel.value;
    if (type === "player") {
      fields = {
        id: el("input", { list: "known-ids", placeholder: "Start typing a name\u2026", required: true, autocomplete: "off" }),
        note: el("input", { maxLength: 200, placeholder: "Who is this for?" }),
      };
      mount(fieldsBox, el("div", { class: "inline-form" }, [
        el("label", {}, ["Player", fields.id, knownIds]),
        el("label", {}, ["Note (optional)", fields.note]),
      ]));
      return;
    }
    // Coach / caddy / analyst / other: just the players they work with. The name is optional and
    // only for you; once they sign up, their own name and email replace it.
    fields = {
      name: el("input", { maxLength: 80, placeholder: "Only for you, until they sign up" }),
      // Analysts always see every player (including ones added later), so there's nothing to pick.
      players: type === "analyst" ? { node: el("p", { class: "muted small all-note" }, "Analysts see all players, including players added later."), value: () => ({ allPlayers: true, playerKeys: [] }) }
        : playerPicker([], { allowAll: false, selectAll: type === "other" }),
      // Other: what they do (Physio, Trainer, Swing coach…)
      role: type === "other" ? el("input", { maxLength: 30, placeholder: "e.g. Physio, Trainer, Swing coach", autocomplete: "off" }) : null,
    };
    mount(fieldsBox, [
      fields.role ? el("div", { class: "inline-form" }, [el("label", {}, ["Role", fields.role])]) : null,
      fields.players.node,
      el("div", { class: "inline-form" }, [el("label", {}, ["Name (optional)", fields.name])]),
    ]);
  };
  typeSel.addEventListener("change", drawFields);

  const createForm = el("form", {
    class: "stack create-code",
    onSubmit: async (e) => {
      e.preventDefault();
      const type = typeSel.value;
      createBtn.disabled = true;
      try {
        if (type === "player") {
          const typed = fields.id.value.trim();
          if (!typed) { flash("Enter the player's name (or their ID).", "error"); return; }
          // A name from the list, or an ID. A name shared by two IDs has to be picked from the list.
          const all = [...clientsCache.labels.entries()].map(([key, label]) => ({ key, label }));
          const byName = all.find((p) => p.label.toLowerCase() === typed.toLowerCase());
          const hit = byName || all.find((p) => (clientsCache.ids?.get(p.key) || "").toLowerCase() === typed.toLowerCase());
          const dupes = hit ? [] : sameNamePlayers(all, typed);
          if (dupes.length) {
            flash(`There are ${dupes.length} players named ${typed}. Pick the right one from the list: ${dupes.map((d) => d.label).join(" or ")}.`, "error");
            return;
          }
          const key = hit ? hit.key : clientKey(typed);
          // Picked by name: use the player's ID. Typed an ID: keep it exactly as typed.
          const knownId = byName ? clientsCache.ids?.get(byName.key) : null;
          const id = knownId && knownId.toLowerCase() !== typed.toLowerCase() ? knownId : typed;
          const shown = hit ? hit.label : typed;
          const code = await createInvite({ clientKey: key, clientLabel: id, note: fields.note.value.trim(), days: 0 });
          flash(`Access code for ${shown}: ${formatCode(code)}` + (clientsCache.labels.has(key) ? "" : " (No uploaded data matches this ID yet.)"), "ok");
        } else {
          const name = fields.name.value.trim();
          const { allPlayers, playerKeys } = fields.players.value();
          if (type === "other" && !fields.role.value.trim()) { flash("Enter their role (e.g. Physio).", "error"); fields.role.focus(); return; }
          if (!allPlayers && !playerKeys.length) { flash("Add at least one player they work with.", "error"); return; }
          const code = type === "analyst"
            ? await createAnalystAccess({ name, playerKeys, allPlayers, labels: clientsCache.labels, days: 0 })
            : await createTeamAccess({ name, role: type === "other" ? fields.role.value.trim() : type, playerKeys, labels: clientsCache.labels });
          flash(`Access code${name ? ` for ${name}` : ""}: ${formatCode(code)}. Send it with the sign-up link; whoever signs up with it gets this access.`, "ok");
        }
        drawFields();
        setCreateOpen(false);
      } catch (err) {
        flash(err instanceof UserError ? err.message : "Couldn't create that code. Try again.", "error");
      } finally {
        createBtn.disabled = false;
      }
    },
  }, [
    el("div", { class: "inline-form" }, [el("label", { class: "type-pick" }, ["User Type", typeSel])]),
    fieldsBox,
    el("div", {}, createBtn),
  ]);
  drawFields();

  // The create form is tucked away behind a button until needed.
  const createPanel = el("div", { class: "create-panel", hidden: true }, [
    el("h3", { class: "subhead" }, "Create an access code"),
    createForm,
    el("p", { class: "muted" }, ["Sign-up page: ", el("strong", {}, location.origin + location.pathname + "#/signup")]),
  ]);
  const createToggle = linkButton("Create New Access Code", () => setCreateOpen(createPanel.hidden), "btn create-toggle");
  const setCreateOpen = (open) => {
    createPanel.hidden = !open;
    createToggle.textContent = open ? "Cancel" : "Create New Access Code";
    createToggle.classList.toggle("ghost", open);
    if (open) createPanel.querySelector("select")?.focus();
  };

  /* ============================ Access codes ============================ */
  const invitesBox = el("div");
  const codeSearch = el("input", { type: "search", placeholder: "Search by name, email, code, role or player\u2026", "aria-label": "Search access codes" });
  const typeBoxes = CODE_FILTERS.map(([v, l]) => el("label", {}, [el("input", { type: "checkbox", value: v, checked: true }), l]));
  codeSearch.addEventListener("input", () => renderInvites());
  typeBoxes.forEach((l) => l.querySelector("input").addEventListener("change", () => renderInvites()));

  function editPlayers(inv, user, grants) {
    const target = user ? { uid: user.uid } : { code: inv.code };
    const analyst = inv.kind === "analyst";
    const role = grants[0]?.role || "coach";
    const picker = playerPicker(grants.map((g) => g.key), { allowAll: analyst, all: !!(user?.allPlayers ?? inv.allPlayers) });
    const save = el("button", { class: "btn", type: "submit" }, "Save");
    openDialog([
      el("h3", {}, `${user?.name || inv.clientLabel || "Their"}${user?.name || inv.clientLabel ? "'s" : ""} players`),
      el("form", { class: "stack", onSubmit: async (e) => {
        e.preventDefault();
        const v = picker.value();
        if (!v.allPlayers && !v.playerKeys.length) { flash("Add at least one player.", "error"); return; }
        save.disabled = true;
        try {
          if (analyst) await setAnalystPlayers(target, { ...v, labels: clientsCache.labels });
          else await setTeamPlayers(target, { role, playerKeys: v.playerKeys, labels: clientsCache.labels });
          dialog.close(); flash(`Updated ${user?.name || inv.clientLabel || "their"}${user?.name || inv.clientLabel ? "'s" : ""} players.`, "ok"); refreshClients();
        } catch { flash("Couldn't save that change.", "error"); save.disabled = false; }
      } }, [picker.node, el("div", { class: "thread-actions" }, [save, linkButton("Cancel", () => dialog.close())])]),
    ]);
  }

  function codeActions(inv, user, grants) {
    const links = [];
    const editable = inv.kind === "analyst" || inv.kind === "team"; // roster people are edited through the roster file
    if (inv.usedBy && user) {
      links.push(el("a", { href: portalHref(user) }, "See their portal"));
      if (editable) links.push(linkButton("Edit players", () => editPlayers(inv, user, grants)));
      const reset = linkButton("Password reset", async () => {
        reset.disabled = true;
        try { await sendPasswordReset(user.email); flash(`Password reset email sent to ${user.email}.`, "ok"); }
        catch { flash("Couldn't send that email.", "error"); }
        finally { reset.disabled = false; }
      });
      const remove = linkButton("Remove access", async () => {
        if (!confirmAction(`Remove ${user.name}'s access? Their login will stop working.`)) return;
        remove.disabled = true;
        try { await removeUserAccess(user.uid); flash(`Removed ${user.name}'s access.`, "ok"); }
        catch { flash("Couldn't remove that account.", "error"); remove.disabled = false; }
      }, "link danger");
      links.push(reset, remove);
    } else if (inv.usedBy && !user) {
      // Their access has been removed: the row can now be cleared from the list.
      const del = linkButton("Delete", async () => {
        if (!confirmAction(`Delete ${inv.clientLabel || "this person"}'s code ${formatCode(inv.code)} from the list? Their access is already removed.`)) return;
        del.disabled = true;
        try { await deleteInvite(inv.code); flash("Removed from the list.", "ok"); }
        catch (err) { flash(err?.code === "permission-denied" ? "Couldn't delete that code: the database refused. Republish the Firestore rules from this update (Firebase \u2192 Firestore \u2192 Rules), then try again." : "Couldn't delete that code. Try again.", "error"); del.disabled = false; }
      }, "link danger");
      links.push(del);
    } else if (!inv.usedBy && inv.revoked) {
      const refresh = linkButton("Refresh access", async () => {
        refresh.disabled = true;
        try { await refreshInvite(inv); flash(`Code ${formatCode(inv.code)} works again.`, "ok"); }
        catch { flash("Couldn't refresh that code.", "error"); refresh.disabled = false; }
      });
      const del = linkButton("Delete", async () => {
        if (!confirmAction(`Delete code ${formatCode(inv.code)}?`)) return;
        del.disabled = true;
        try { await deleteInvite(inv.code); flash("Code deleted.", "ok"); }
        catch (err) { flash(err?.code === "permission-denied" ? "Couldn't delete that code: the database refused. Republish the Firestore rules from this update (Firebase \u2192 Firestore \u2192 Rules), then try again." : "Couldn't delete that code. Try again.", "error"); del.disabled = false; }
      }, "link danger");
      links.push(refresh, del);
    } else if (!inv.usedBy) {
      links.push(el("a", { href: isTeamKey(inv.clientKey) ? `#/view-as-code/${inv.code}`
        : `#/view-as/${encodeURIComponent(inv.clientKey)}?label=${encodeURIComponent(clientsCache.labels.get(inv.clientKey) || inv.clientLabel)}` }, "See their portal"));
      if (editable) links.push(linkButton("Edit players", () => editPlayers(inv, null, grants)));
      const revoke = linkButton("Revoke", async () => {
        revoke.disabled = true;
        try { await revokeInvite(inv.code); flash("Code revoked.", "ok"); }
        catch { flash("Couldn't revoke that code.", "error"); revoke.disabled = false; }
      }, "link danger");
      links.push(revoke);
    }
    return links.length ? el("span", { class: "row-actions" }, links) : null;
  }

  const nameOf = (r) => r.user?.name || (!isTeamKey(r.inv.clientKey) && clientsCache.labels.get(r.inv.clientKey)) || r.inv.clientLabel || "";
  function renderInvites() {
    if (!invitesCache.length) { mount(invitesBox, el("p", { class: "empty" }, "No codes yet.")); return; }
    const shown = new Set(typeBoxes.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value));
    const q = codeSearch.value.trim().toLowerCase();

    const rows = invitesCache.map((inv) => {
      const user = inv.usedBy ? usersCache.find((u) => u.uid === inv.usedBy) : null;
      const access = (user?.access ?? inv.access) || {};
      const grants = Object.entries(access).map(([key, g]) => ({ key, role: g.role, label: clientsCache.labels.get(key) || g.label || key.replace(/^c_/, "") }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const roles = [...new Set(grants.map((g) => g.role))];
      // User type: one tag per type (a team member can be e.g. a coach for one player, caddy for another).
      let types, typeLabels;
      if (!isTeamKey(inv.clientKey)) { types = ["player"]; typeLabels = [["player", "Player"]]; }
      else if (inv.kind === "analyst") { types = ["analyst"]; typeLabels = [["analyst", "Callaway Analyst"]]; }
      else {
        types = roles.map((r) => (r === "coach" || r === "caddy" ? r : "other"));
        if (!types.length) types = ["other"];
        typeLabels = roles.length ? roles.map((r) => [r === "coach" || r === "caddy" ? r : "other", roleLabel(r)]) : [["other", "Team member"]];
      }
      const note = typeLabels.map(([, l]) => l).join(" ");
      const email = user?.email || inv.email || "";
      let status, statusText;
      if (inv.usedBy && user) { status = el("span", { class: "tag" }, "Active"); statusText = "active"; }
      else if (inv.usedBy) { status = el("span", { class: "tag muted-tag" }, "Removed"); statusText = "removed"; }
      else if (inv.revoked) { status = el("span", { class: "tag muted-tag" }, "Revoked"); statusText = "revoked"; }
      else { status = el("span", { class: "tag hot" }, "Unused"); statusText = "unused"; }

      const teamOf = !isTeamKey(inv.clientKey) ? el("span", { class: "muted" }, "\u2014")
        : inv.kind === "analyst" && (user?.allPlayers ?? inv.allPlayers) ? linkButton("All players", () => showPlayers(user?.name || inv.clientLabel || "This person", grants))
        : grants.length === 0 ? el("span", { class: "muted" }, "\u2014")
        : grants.length === 1 ? grants[0].label
        : linkButton(`${grants.length} players`, () => showPlayers(user?.name || inv.clientLabel || "This person", grants));
      const haystack = [inv.code, formatCode(inv.code), inv.clientLabel, clientsCache.labels.get(inv.clientKey), email, user?.name, isTeamKey(inv.clientKey) ? "" : inv.note, note, statusText, ...grants.map((g) => g.label)]
        .filter(Boolean).join(" ").toLowerCase();
      return { inv, user, grants, types, typeLabels, email, status, teamOf, haystack };
    }).filter((r) => r.types.some((t) => shown.has(t)) && (!q || r.haystack.includes(q)))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }));

    if (!rows.length) { mount(invitesBox, el("p", { class: "empty" }, "No codes match.")); return; }
    mount(invitesBox, el("div", { class: "table-scroll five-rows codes-rows" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, ["Code", "Name", "Email", "User Type", "Team of", "Status", "Sign-ins", "Last sign-in", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map(({ inv, user, grants, typeLabels, email, status, teamOf }) => el("tr", {}, [
        el("td", {}, el("code", {}, formatCode(inv.code))),
        el("td", {}, [
          user?.name || (!isTeamKey(inv.clientKey) && clientsCache.labels.get(inv.clientKey)) || inv.clientLabel || el("span", { class: "muted" }, "No name yet"),
          !isTeamKey(inv.clientKey) ? el("div", { class: "muted small" }, [`ID ${inv.clientLabel}`, inv.note ? ` \u00b7 ${inv.note}` : ""]) : null,
        ]),
        el("td", {}, email || el("span", { class: "muted" }, "\u2014")),
        el("td", {}, el("span", { class: "type-tags" }, typeLabels.map(([cls, l]) => el("span", { class: `tag type-${cls}` }, l)))),
        el("td", {}, teamOf),
        el("td", {}, status),
        el("td", { class: "num" }, user ? num(user.signInCount || 0) : el("span", { class: "muted" }, "\u2014")),
        el("td", { class: "nowrap" }, user?.lastSignInAt ? formatWhen(user.lastSignInAt) : el("span", { class: "muted" }, user ? "Not yet" : "\u2014")),
        el("td", { class: "actions" }, codeActions(inv, user, grants)),
      ]))),
    ])));
  }

  /* ============================ Team roster ============================ */
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
  const saveCsv = (name, csv) => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = el("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  // The roster names players; downloads use the same names (with the ID only where two share a name).
  const idOf = (key) => clientsCache.ids?.get(key) || key.replace(/^c_/, "");
  const playerName = (key, fallback) => plainName(clientsCache.labels.get(key) || fallback);
  const downloadBtn = linkButton("Download current roster", () => saveCsv("team_members.csv",
    toCsv(ROSTER_COLUMNS, (rosterCache.entries || []).map((e) => [playerName(e.playerKey, e.playerLabel), idOf(e.playerKey), e.name, roleLabel(e.role), e.email]))));
  const templateBtn = linkButton("Download a blank template", () => {
    // Example rows using real players from your data: one player per row.
    const players = [...clientsCache.labels.keys()].sort((a, b) => playerName(a).localeCompare(playerName(b)));
    const p = (i) => (players[i] ? [playerName(players[i]), idOf(players[i])] : [`Player ${i + 1}`, `PLAYER-ID-${i + 1}`]);
    saveCsv("team_members.csv", toCsv(ROSTER_COLUMNS, [
      [...p(0), "Mike Smith", "Coach", "mike.smith@example.com"],
      [...p(1), "Mike Smith", "Coach", "mike.smith@example.com"],
      [...p(0), "Jo Brown", "Caddy", "jo.brown@example.com"],
      [...p(2), "Sam Lee", "Other", "sam.lee@example.com"],
    ]));
  });

  // Roster player names -> player keys. A name two IDs share must be written with its ID.
  function resolvePlayer(text, isId) {
    const t = text.trim().toLowerCase();
    const all = [...clientsCache.labels].map(([key, label]) => ({ key, label, id: clientsCache.ids?.get(key) || key.replace(/^c_/, "") }));
    const hit = isId ? all.find((p) => p.id.toLowerCase() === t)
      : all.find((p) => p.label.toLowerCase() === t) || all.find((p) => p.id.toLowerCase() === t);
    if (hit) return { key: hit.key, label: hit.label };
    const dupes = sameNamePlayers(all, text);
    if (dupes.length) return { error: `${dupes.length} players are named ${text.trim()}. Write it as ${dupes.map((d) => `"${d.label}"`).join(" or ")}.` };
    if (isId) return { key: clientKey(text.trim()), label: text.trim() }; // an ID with no data yet (e.g. a new player)
    return { error: `There's no player named "${text.trim()}" in your data. Check the spelling, or use the name exactly as it appears in Data.` };
  }
  const rosterForm = el("form", {
    class: "inline-form",
    onSubmit: async (e) => {
      e.preventDefault();
      const f = rosterFile.files[0];
      if (!f) { flash("Choose your team roster CSV.", "error"); return; }
      rosterBtn.disabled = true; rosterBtn.textContent = "Applying\u2026";
      try {
        if (!clientsCache.labels.size) await refreshClients(); // need the player list to match names
        const { entries, problems } = parseTeamRoster(await f.text(), resolvePlayer);
        if (problems.length) {
          flash(`Nothing was changed. Fix these rows and upload again: ${problems.slice(0, 8).join(" ")}${problems.length > 8 ? ` (and ${problems.length - 8} more)` : ""}`, "error");
          return;
        }
        if (!entries.length && !confirmAction("This roster has no team members. Uploading it removes every roster coach, caddy, etc. from every player. Continue?")) return;
        const r = await applyTeamRoster(entries, f.name, clientsCache.labels);
        const unknown = [...new Set(entries.filter((x) => clientsCache.labels.size && !clientsCache.labels.has(x.playerKey)).map((x) => x.playerLabel))];
        flash(`Roster applied: ${r.people} team ${r.people === 1 ? "member" : "members"}, ${r.links} player ${r.links === 1 ? "link" : "links"}.`
          + (r.updated ? ` Updated ${r.updated} existing ${r.updated === 1 ? "account" : "accounts"}.` : "")
          + (r.newCodes ? ` ${r.newCodes} new access ${r.newCodes === 1 ? "code" : "codes"} to send (see Access codes).` : "")
          + (unknown.length ? ` Note: no data or account uses these player IDs yet: ${unknown.join(", ")}.` : ""), "ok");
        rosterForm.reset(); drawRosterFile();
      } catch (err) {
        flash(err instanceof UserError ? err.message : "Couldn't apply that roster. Try again.", "error");
      } finally {
        rosterBtn.disabled = false; rosterBtn.textContent = "Upload roster";
      }
    },
  }, [el("div", { class: "file-row" }, [el("div", { class: "file-line" }, [rosterPicker, rosterFileName])]), rosterBtn]);

  /* ========================= Known players (for the forms) ========================= */
  async function refreshClients() {
    const { labels, ids } = await adminAllClients();
    clientsCache = { labels, ids };
    renderInvites(); // player codes are listed by name once names are known
    syncAllPlayersAnalysts(usersCache, invitesCache, labels).then(() => syncAccessLabels(usersCache, invitesCache, labels)).catch(() => {});
    mount(knownIds, [...labels.values()].map((label) => el("option", { value: label })));
  }

  /* ============================== Page ============================== */
  mount(main, [
    subNav([["#/admin/clients", "Players"], ["#/admin/datasets", "Upload Data"]], "#/admin/clients"), // (Upload Data lives here)
    el("section", { class: "glance-section" }, [el("h2", {}, "At a glance"), statsBox, weekBox, storageBox]),
    el("section", {}, [
      el("h2", {}, "Access codes"),
      el("div", { class: "code-tools" }, [
        codeSearch,
        el("fieldset", { class: "type-filters" }, [el("legend", { class: "visually-hidden" }, "Show"), ...typeBoxes]),
      ]),
      invitesBox,
      createToggle,
      createPanel,
    ]),
    el("section", {}, [
      el("h2", {}, "Team roster"),
      rosterForm,
      el("p", { class: "muted roster-note" }, ["Uploading replaces the previous roster completely: anyone you remove loses access. ", downloadBtn, " \u00b7 ", templateBtn]),
    ]),
  ]);

  const unInv = watchInvites((invites) => {
    invitesCache = invites;
    if (!expiryCleared) { expiryCleared = true; clearInviteExpiry(invites).catch(() => {}); } // codes no longer expire
    renderInvites(); refreshClients();
  });
  const unUsers = watchUsers((users) => { usersCache = users; renderInvites(); refreshClients(); });
  const unRoster = watchTeamRoster((r) => { rosterCache = r; drawRosterFile(); refreshClients(); });
  const clientsInterval = setInterval(refreshClients, 15000);
  refreshClients();

  return () => { unInv(); unUsers(); unRoster(); clearInterval(clientsInterval); clearInterval(statsInterval); dialog.remove(); };
}
