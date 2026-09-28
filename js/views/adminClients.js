import { el, mount, formatWhen, confirmAction } from "../ui.js";
import {
  watchInvites, watchUsers, createInvite, revokeInvite, sendPasswordReset, removeUserAccess, adminAllClients,
} from "../store.js";
import { clientKey, formatCode } from "../data.js";

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
    el("label", {}, ["Client ID", clientIdInput, knownIds]),
    el("label", {}, ["Note (optional)", note]),
    el("label", {}, ["Expires after", days]),
    createBtn,
  ]);

  const clientsBox = el("div");
  const invitesBox = el("div");
  const accountsBox = el("div");

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, "Clients & access codes"),
      el("p", { class: "muted" }, "A code lets one person create an account tied to a client ID. Each code works once."),
    ]),
    el("section", {}, [el("h2", {}, "Create an access code"), form,
      el("p", { class: "muted" }, ["Sign-up page: ", el("strong", {}, location.origin + location.pathname + "#/signup")])]),
    el("section", {}, [el("h2", {}, "Clients"), clientsBox]),
    el("section", {}, [el("h2", {}, "Access codes"), invitesBox]),
    el("section", {}, [el("h2", {}, "Accounts"), accountsBox]),
  ]);

  let invitesCache = [];
  let usersCache = [];

  async function refreshClients() {
    const { labels, usersSnap, invitesSnap } = await adminAllClients();
    clientsCache = { labels };
    const perClient = new Map([...labels.keys()].map((k) => [k, { accounts: 0, openInvites: 0 }]));
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
      el("thead", {}, el("tr", {}, ["Client ID", "Accounts", "Unused codes", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map(([key, label]) => el("tr", {}, [
        el("td", {}, el("strong", {}, label)),
        el("td", {}, String(perClient.get(key)?.accounts || 0)),
        el("td", {}, String(perClient.get(key)?.openInvites || 0)),
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
          el("td", {}, inv.clientLabel), el("td", {}, inv.note || ""),
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
          el("td", {}, u.name), el("td", {}, u.email), el("td", {}, u.clientLabel),
          el("td", {}, formatWhen(u.createdAt)), el("td", {}, resetBtn), el("td", { class: "actions" }, delBtn),
        ]);
      })),
    ])));
  }

  const unInv = watchInvites((invites) => { invitesCache = invites; renderInvites(); });
  const unUsers = watchUsers((users) => { usersCache = users; renderAccounts(); renderInvites(); });
  refreshClients();
  const clientsInterval = setInterval(refreshClients, 15000); // no realtime listener for this derived summary

  return () => { unInv(); unUsers(); clearInterval(clientsInterval); };
}
