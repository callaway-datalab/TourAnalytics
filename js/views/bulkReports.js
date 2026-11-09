// (update 668) Generate Bulk Reports (the admin and analysts): pick players, check each one's tour (as the Stats page
// would start them: their latest season, the tour they've played most), confirm, and every player's PDF report is made
// the way the Stats page's Generate PDF Report makes it; then one .zip of them all to save.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";

const allowed = (st) => !!st?.isAdmin || st?.profile?.kind === "analyst";
async function playersYouCanSee() {
  const state = getState(), team = effectiveTeam(state);
  if (state.isAdmin && !team.preview) { try { return [...(await (await import("../store.js")).adminAllClients()).labels].map(([k, l]) => [k, plainName(l)]); } catch { return []; } }
  if (team.isTeam) return [...teamLabels(team.teamAccess)].map(([k, l]) => [k, plainName(l)]);
  return [];
}
const tourName = (t) => (t ? String(t) : "No tour");

export async function render(main) {
  const st = getState();
  if (!allowed(st)) { mount(main, el("section", { class: "panel" }, [el("h1", {}, "Bulk Reports"), el("p", { class: "muted" }, "Bulk Reports are for the admin and analysts.")])); return; }
  const wrap = el("div", { class: "bulk" });
  mount(main, [el("header", { class: "page-head" }, [el("p", { class: "eyebrow" }, "Reports"), el("h1", {}, "Generate Bulk Reports"),
    el("p", { class: "muted" }, "Pick players, check each one's tour, then every player's PDF report is made the way the Stats page makes it, and you get one file of them all to save.")]), wrap]);
  mount(wrap, el("p", { class: "muted" }, "Loading players…"));
  const pool = (await playersYouCanSee()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const chosen = new Set();
  let alive = true; window.addEventListener("hashchange", () => { alive = false; }, { once: true });

  /* ---- 1: pick the players ---- */
  const step1 = () => {
    const q = el("input", { type: "search", class: "bulk-q", placeholder: "Search players…", autocomplete: "off", "aria-label": "Search players" });
    const list = el("div", { class: "bulk-list" }), count = el("span", { class: "muted small" });
    const next = el("button", { type: "button", class: "btn" }, "Next: check tours ›");
    const allBtn = el("button", { type: "button", class: "link small" }, "Select all shown"), noneBtn = el("button", { type: "button", class: "link small" }, "Clear");
    const shown = () => { const t = q.value.trim().toLowerCase(); return pool.filter(([, l]) => !t || String(l).toLowerCase().includes(t)); };
    const draw = () => {
      const rows = shown();
      mount(list, rows.length ? rows.map(([k, l]) => {
        const on = chosen.has(k), b = el("label", { class: `bulk-row${on ? " on" : ""}` }, [el("input", { type: "checkbox", checked: on }), el("span", {}, l)]);
        b.firstChild.addEventListener("change", () => { if (chosen.has(k)) chosen.delete(k); else chosen.add(k); draw(); });
        return b;
      }) : el("p", { class: "muted small" }, pool.length ? "No players by that name." : "No players to pick from."));
      count.textContent = `${chosen.size} selected`; next.disabled = !chosen.size;
    };
    q.addEventListener("input", draw);
    allBtn.addEventListener("click", () => { for (const [k] of shown()) chosen.add(k); draw(); });
    noneBtn.addEventListener("click", () => { chosen.clear(); draw(); });
    next.addEventListener("click", step2);
    mount(wrap, el("section", { class: "panel bulk-step" }, [el("h2", {}, "1 · Pick the players"), el("div", { class: "bulk-tools" }, [q, allBtn, noneBtn, count]), list, el("div", { class: "bulk-actions" }, [next])]));
    draw();
  };

  /* ---- 2: each player's tour (their season's defaults), then confirm ---- */
  let plan = [];
  async function step2() {
    const picked = pool.filter(([k]) => chosen.has(k));
    const box = el("div", { class: "bulk-plan" }), status = el("p", { class: "muted small", role: "status" }, `Looking up ${picked.length} player${picked.length === 1 ? "" : "s"}…`);
    const back = el("button", { type: "button", class: "btn ghost" }, "‹ Back"), go = el("button", { type: "button", class: "btn", disabled: true }, "Confirm and generate reports");
    back.addEventListener("click", step1);
    mount(wrap, el("section", { class: "panel bulk-step" }, [el("h2", {}, "2 · Check each player's tour"),
      el("p", { class: "muted small" }, "Each player starts on what their Stats page would show: their latest season, on the tour they've played the most. Tap another tour to change it."), status, box, el("div", { class: "bulk-actions" }, [back, go])]));
    const { loadSource, reportDefaults } = await import("../reportGen.js");
    plan = picked.map(([key, label]) => ({ key, label, state: "loading" }));
    const draw = () => {
      mount(box, el("table", { class: "plain bulk-t" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Player"), el("th", {}, "Season"), el("th", {}, "Tour")])),
        el("tbody", {}, plan.map((p) => el("tr", {}, [el("td", { class: "bulk-name" }, p.label), el("td", {}, p.year || "—"),
          el("td", {}, p.state === "loading" ? el("span", { class: "muted small" }, "Looking up…") : p.state === "none" ? el("span", { class: "muted small" }, "No rounds: skipped")
            : el("div", { class: "bulk-tours" }, p.tours.map((t) => { const on = p.tour === t.tour, b = el("button", { type: "button", class: `chip${on ? " on" : ""}`, "aria-pressed": String(on) }, `${tourName(t.tour)} · ${t.inYear || t.rounds} rds`);
              b.addEventListener("click", () => { p.tour = t.tour; draw(); }); return b; }))),
        ])))]));
      const ready = plan.filter((p) => p.state === "ready").length, waiting = plan.filter((p) => p.state === "loading").length;
      go.disabled = !!waiting || !ready;
      status.textContent = waiting ? `Looking up ${waiting} more…` : `${ready} report${ready === 1 ? "" : "s"} to make${plan.length > ready ? ` (${plan.length - ready} skipped: no rounds)` : ""}.`;
    };
    draw();
    // a few at a time
    let i = 0;
    const worker = async () => { while (i < plan.length && alive) { const p = plan[i++];
      try { const d = await loadSource("tour", p.key, p.label, { detail: false }); const rs = d?.me?.rounds || [];
        if (!rs.length) p.state = "none"; else { const def = reportDefaults(rs); Object.assign(p, def, { state: "ready" }); }
      } catch (err) { console.error(err); p.state = "none"; }
      draw(); } };
    await Promise.all([worker(), worker(), worker()]);
    go.addEventListener("click", step3);
  }

  /* ---- 3: make them, then one file to save ---- */
  async function step3() {
    const todo = plan.filter((p) => p.state === "ready");
    const list = el("ol", { class: "bulk-prog" }), status = el("p", { role: "status" }), actions = el("div", { class: "bulk-actions" });
    mount(wrap, el("section", { class: "panel bulk-step" }, [el("h2", {}, "3 · Making the reports"), el("p", { class: "muted small" }, "Keep this page open until it finishes."), status, list, actions]));
    const line = (p) => el("li", { class: `bulk-p ${p.run || "wait"}` }, [el("strong", {}, p.label), el("span", { class: "muted small" }, ` ${tourName(p.tour)} · ${p.year || "all time"}`), el("span", { class: "bulk-ps" }, p.msg || (p.run === "done" ? "✓ Ready" : p.run === "fail" ? "Couldn’t make it" : "Waiting"))]);
    const draw = () => mount(list, todo.map(line));
    const { makePlayerReport } = await import("../reportGen.js");
    const files = [], cache = {};
    for (const [n, p] of todo.entries()) {
      if (!alive) return;
      status.textContent = `Report ${n + 1} of ${todo.length}…`;
      p.run = "busy"; p.msg = "Starting…"; draw();
      try {
        const r = await makePlayerReport({ key: p.key, label: p.label, tour: p.tour, year: p.year, cache, onStep: (m) => { p.msg = m; draw(); } });
        if (!r || r.empty) { p.run = "fail"; p.msg = "No rounds in that season and tour"; }
        else { files.push({ name: r.name, bytes: r.bytes }); p.run = "done"; p.msg = `✓ Ready · ${r.rounds} rounds`; }
      } catch (err) { console.error(err); p.run = "fail"; p.msg = "Couldn’t make it"; }
      draw();
      await new Promise((res) => setTimeout(res, 30)); // (let the page draw)
    }
    status.textContent = files.length ? `${files.length} report${files.length === 1 ? "" : "s"} ready.` : "No reports could be made.";
    if (!files.length) { const again = el("button", { type: "button", class: "btn ghost" }, "Start again"); again.addEventListener("click", step1); mount(actions, again); return; }
    // unique names inside the zip
    const seen = new Map(); for (const f of files) { const n = seen.get(f.name) || 0; seen.set(f.name, n + 1); if (n) f.name = f.name.replace(/\.pdf$/, ` (${n + 1}).pdf`); }
    const { makeZip } = await import("../zipLite.js");
    const blob = makeZip(files), href = URL.createObjectURL(blob), zipName = `Tour Analytics reports ${new Date().toISOString().slice(0, 10)}.zip`;
    const dl = el("a", { class: "btn", href, download: zipName }, `⬇ Download all (${files.length} PDFs, ${(blob.size / 1048576).toFixed(1)} MB)`);
    const again = el("button", { type: "button", class: "btn ghost" }, "Make more");
    again.addEventListener("click", () => { chosen.clear(); step1(); });
    mount(actions, [dl, again]);
  }

  step1();
}
