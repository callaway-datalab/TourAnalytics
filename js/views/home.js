// (update 609) Home: everyone's first page. A greeting, Ask Cal (a big gold microphone: one tap and it listens), the
// game as a radar (the four parts of the game against tour average: outside the dashed circle better, inside worse;
// a coach with several players, or the admin: a row of small radars to swipe, one a player), Explore (picture cards
// to the main pages) and this week's tournament (live, else the next one and when it starts).
import { el, mount, calAllowed } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, summaryPlayers, fmtSG } from "../sg.js";
import { playerCard } from "../watchlistData.js";
import { watchPrefs, loadWatch } from "../watchlist.js";

const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; try { un = watch(fin); } catch { fin(null); } });
const AXES = [["OTT", "Driving"], ["APP", "Approach"], ["ARG", "Short game"], ["PUTT", "Putting"]];

/** The radar: { OTT, APP, ARG, PUTT } strokes gained a round. Tour average is the dashed circle; outside is better. */
function radar(v, { small = false } = {}) {
  const W = small ? 200 : 340, H = small ? 170 : 290, cx = W / 2, cy = H / 2, R = small ? 58 : 100, r0 = R * 0.55;
  const vals = AXES.map(([k]) => v[k] ?? 0), lim = Math.max(0.5, Math.ceil(Math.max(...vals.map(Math.abs)) / 0.25) * 0.25);
  const rad = (x) => Math.max(4, r0 + (x / lim) * (R - r0));
  const ang = [-90, 0, 90, 180].map((a) => (a * Math.PI) / 180);
  const pts = vals.map((x, i) => [cx + rad(x) * Math.cos(ang[i]), cy + rad(x) * Math.sin(ang[i])]);
  const NS = "http://www.w3.org/2000/svg", s = (t, a = {}, kids = []) => { const e = document.createElementNS(NS, t); for (const [k, x] of Object.entries(a)) e.setAttribute(k, x); for (const c of kids) e.appendChild(c); return e; };
  const col = (x) => (x >= 0 ? "#4cd17e" : "#ff8a7a"), fs = small ? 11 : 14, fv = small ? 10.5 : 13;
  const lab = (i, [k, name]) => {
    const x = vals[i], txt = (t, dy, fill, w) => { const e = s("text", { "font-size": dy ? fv : fs, fill, "font-weight": w }); e.textContent = t; return e; };
    const pos = [[cx, small ? 14 : 22, "middle"], [W - 4, cy - 5, "end"], [cx, H - (small ? 18 : 24), "middle"], [4, cy - 5, "start"]][i];
    const g = s("g", { "text-anchor": pos[2] }); const a = txt(name, 0, "#f5f5f7", 700), b = txt(fmtSG(x), 1, col(x), 700);
    a.setAttribute("x", pos[0]); a.setAttribute("y", pos[1]); b.setAttribute("x", pos[0]); b.setAttribute("y", pos[1] + (small ? 13 : 17)); g.append(a, b); return g;
  };
  return s("svg", { class: `hm-radar${small ? " sm" : ""}`, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": AXES.map(([k, n]) => `${n} ${fmtSG(v[k] ?? 0)}`).join(", ") }, [
    s("g", { fill: "none", stroke: "#2a2a2e" }, [s("circle", { cx, cy, r: R }), s("line", { x1: cx, y1: cy - R, x2: cx, y2: cy + R }), s("line", { x1: cx - R, y1: cy, x2: cx + R, y2: cy })]),
    s("circle", { cx, cy, r: r0, fill: "rgba(255,255,255,.03)", stroke: "#8e8e93", "stroke-width": 1.5, "stroke-dasharray": "5 4" }),
    s("g", { class: "hm-shape", style: `transform-origin:${cx}px ${cy}px` }, [
      s("polygon", { points: pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" "), fill: "rgba(76,209,126,.22)", stroke: "#4cd17e", "stroke-width": small ? 2 : 2.5, "stroke-linejoin": "round" }),
      ...pts.map((p, i) => s("circle", { cx: p[0], cy: p[1], r: small ? 3.5 : 5, fill: col(vals[i]) }))]),
    s("g", { "font-family": "-apple-system,Inter,sans-serif" }, AXES.map((a, i) => lab(i, a))),
  ]);
}

export async function render(main, { previewClient } = {}) {
  const state = getState(), team = effectiveTeam(state);
  const admin = state.isAdmin && !team.preview && !previewClient;
  const teamKeys = team.isTeam ? Object.keys(team.teamAccess) : [];
  const single = admin ? null : team.isTeam ? (teamKeys.length === 1 ? teamKeys[0] : null) : previewClient?.key || state.profile?.clientKey || null;
  const store = await import("../store.js");
  const root = el("div", { class: "hm" });
  mount(main, root);

  // ---- the greeting ----
  const hr = new Date().getHours(), tod = hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening";
  const myName = plainName(previewClient?.label || state.profile?.name || state.user?.displayName || "");
  const first = String(myName || "").split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const head = el("div", { class: "hm-top" }, [el("p", { class: "hm-date" }, today), el("h1", { class: "hm-h" }, first ? `Good ${tod}, ${first}` : `Good ${tod}`)]);

  // ---- Ask Cal ----
  let calCard = null;
  if (calAllowed()) {
    const talk = el("button", { type: "button", class: "hm-orb", "aria-label": "Ask Cal: tap to talk" }, el("span", { "aria-hidden": "true" }));
    talk.firstChild.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#1a1408"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="#1a1408" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    const typeB = el("button", { type: "button", class: "hm-type" }, "or type a question");
    const open = async (listen) => { const m = await import("../callie.js"); await m.openCallie(); if (listen) setTimeout(() => document.querySelector(".cal-mic:not(.on)")?.click(), 150); };
    talk.addEventListener("click", () => open(true));
    typeB.addEventListener("click", () => open(false));
    calCard = el("section", { class: "hm-cal" }, [talk, el("b", {}, "Ask Cal anything"), el("span", { class: "hm-ex" }, "“How should I play the 2nd at Torrey Pines?”"), el("span", { class: "hm-tap" }, "TAP TO TALK"), typeB]);
  }

  // ---- your game (filled in once the data is in) ----
  const game = el("section", { class: "hm-card hm-game" }, el("p", { class: "muted small hm-load" }, "Loading your game…"));

  // ---- Explore ----
  const statsHref = admin ? "#/admin/player-stats" : team.isTeam && teamKeys.length > 1 ? "#/player-stats" : "#/dashboard";
  const pic = (kind) => {
    const P = {
      plan: '<path d="M40 112 C36 84 60 58 84 40 L108 32 C116 58 100 86 96 112Z" fill="#3f7a35"/><circle cx="102" cy="28" r="14" fill="#5fae4d"/><circle cx="84" cy="66" r="12" fill="none" stroke="#a3e635" stroke-width="2.5" stroke-dasharray="5 4"/>',
      lost: '<g transform="translate(20 14) scale(.95)"><rect x="0" y="40" width="18" height="50" rx="4" fill="#4cd17e"/><rect x="28" y="20" width="18" height="70" rx="4" fill="#4cd17e"/><rect x="56" y="60" width="18" height="30" rx="4" fill="#ff8a7a"/><rect x="84" y="30" width="18" height="60" rx="4" fill="#4cd17e"/></g>',
      prac: '<g transform="translate(74 58) scale(.9)"><circle r="42" fill="none" stroke="#d4b483" stroke-width="3" opacity=".4"/><circle r="26" fill="none" stroke="#d4b483" stroke-width="3" opacity=".7"/><circle r="11" fill="#d4b483"/></g>',
      cmp: '<g transform="translate(26 18)"><rect x="0" y="30" width="34" height="60" rx="6" fill="#3d9cff"/><rect x="58" y="10" width="34" height="80" rx="6" fill="#d4b483"/><path d="M40 52 h14" stroke="#f5f5f7" stroke-width="3" stroke-linecap="round"/></g>',
      live: '<g transform="translate(74 56)"><circle r="40" fill="none" stroke="#ff453a" stroke-width="2" opacity=".25"/><circle r="26" fill="none" stroke="#ff453a" stroke-width="2.5" opacity=".5"/><circle r="11" fill="#ff453a"/></g>',
    }[kind];
    const d = document.createElement("span"); d.className = "hm-pic"; d.innerHTML = `<svg viewBox="0 0 148 112" preserveAspectRatio="xMidYMid meet">${P}</svg>`; return d;
  };
  const card = (href, kind, title, page, bg) => el("a", { class: "hm-fc", href, style: `background:${bg}` }, [pic(kind), el("b", {}, title), el("small", {}, page)]);
  const row = el("div", { class: "hm-row" }, [
    card("#/course-prep", "plan", "Plan every hole", "Course Prep", "linear-gradient(160deg,#1f3a1f,#0c160c)"),
    card(statsHref, "lost", "Find lost strokes", "Stats", "linear-gradient(160deg,#2a1717,#120a0a)"),
    card("#/practice", "prac", "Practise smarter", "Practice", "linear-gradient(160deg,#2a2414,#120f08)"),
    card("#/comparisons", "cmp", "Compare anything", "Compare", "linear-gradient(160deg,#16202e,#0a0e14)"),
    card("#/live", "live", "Follow live", "Event Feed", "linear-gradient(160deg,#2a1414,#120808)"),
  ]);
  const dots = el("div", { class: "hm-dots", "aria-hidden": "true" }, [0, 1, 2, 3, 4].map((i) => el("i", { class: i ? "" : "on" })));
  row.addEventListener("scroll", () => { const w = row.scrollWidth - row.clientWidth, i = w > 0 ? Math.round((row.scrollLeft / w) * 4) : 0; [...dots.children].forEach((d, j) => d.classList.toggle("on", j === i)); }, { passive: true });

  // ---- this week's tournament ----
  const live = el("a", { class: "hm-live", href: "#/live", hidden: true });

  mount(root, [head, calCard, game, el("p", { class: "hm-lbl" }, "EXPLORE"), row, dots, live]);

  // the tournament: live now, else the next one and when it starts, else the latest
  import("../liveData.js").then((m) => m.liveFile("current.json")).then((cur) => {
    const ts = (cur?.tours || []).filter((x) => x.name);
    const day = (d) => { const t = new Date(`${String(d || "").slice(0, 10)}T12:00:00`); return Number.isNaN(t.getTime()) ? null : t; };
    const now = Date.now();
    const on = ts.find((x) => x.status === "live");
    const next = ts.filter((x) => x.status !== "final" && x.status !== "live" && day(x.start) && day(x.start).getTime() >= now - 864e5).sort((a, b) => day(a.start) - day(b.start))[0];
    const last = ts.filter((x) => x.status === "final").sort((a, b) => String(b.end || b.start).localeCompare(String(a.end || a.start)))[0];
    const pick = on || next || last; if (!pick) return;
    const rnd = pick.current_round || pick.round || null;
    const when = on ? (rnd ? `Round ${rnd}` : "In progress") : next ? `Starts ${day(next.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "Final";
    mount(live, [el("span", { class: `hm-dot${on ? " on" : ""}`, "aria-hidden": "true" }), el("b", { class: on ? "on" : "" }, on ? "LIVE" : next ? "NEXT" : "LATEST"), el("span", { class: "hm-live-t" }, `${pick.name} · ${when}`), el("span", { class: "hm-go", "aria-hidden": "true" }, "›")]);
    live.hidden = false;
  }).catch(() => {});

  // ---- the data: the newest stats file and the field's summary ----
  try {
    let labels = new Map();
    if (admin) labels = (await store.adminAllClients()).labels;
    else if (team.isTeam) labels = teamLabels(team.teamAccess);
    else if (single) labels = new Map([[single, myName || "You"]]);
    const via = single || teamKeys[0];
    const list = admin ? await once((cb) => store.watchAdminDatasets(cb)) : via ? await once((cb) => store.watchClientDatasets(via, cb)) : [];
    const ds = (list || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
    const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null;
    const field = summaryPlayers(summary).filter((p) => p.rounds.length);
    let keys = single ? [single] : team.isTeam ? teamKeys : [];
    if (admin) { await loadWatch(true).catch(() => {}); keys = watchPrefs().players || []; }
    const period = (() => { try { return watchPrefs().period || "season"; } catch { return "season"; } })();
    const nameOf = (k) => plainName(labels.get(k) || field.find((p) => p.key === k)?.name || k.replace(/^c_/, ""));
    const cards = keys.map((k) => { try { return playerCard(k, { field, label: nameOf(k), period, lite: true }); } catch { return { key: k, label: nameOf(k), empty: true }; } });
    const valsOf = (c) => Object.fromEntries((c.sg || []).map((x) => [x.k, x.v]));
    const none = el("p", { class: "hm-none" }, single || keys.length === 1 ? "Your game will appear here once your first rounds are in." : "Your players’ games will appear here once their first rounds are in.");
    if (cards.length === 1 || single) {
      const c = cards[0];
      if (!c || c.empty || !(c.sg || []).length) { mount(game, [el("p", { class: "hm-t" }, single && !team.isTeam ? "YOUR GAME" : `${(c?.label || "").toUpperCase()}`), none]); return; }
      const v = valsOf(c), tot = v.TOTAL ?? 0;
      mount(game, [
        el("div", { class: "hm-gh" }, [el("span", { class: "hm-t" }, team.isTeam || admin ? (c.label || "").toUpperCase() : "YOUR GAME"), el("span", { class: `hm-big ${tot >= 0 ? "pos" : "neg"}` }, fmtSG(tot))]),
        el("p", { class: "hm-sub" }, `strokes a round ${tot >= 0 ? "better" : "worse"} than tour average`),
        radar(v), el("div", { class: "hm-key" }, [el("span", {}, [el("i", { class: "k-avg" }), "Tour average"]), el("span", {}, [el("i", { class: "k-out" }), "Outside = better"])]),
      ]);
    } else if (cards.length > 1) {
      const live2 = cards.filter((c) => !c.empty && (c.sg || []).length);
      if (!live2.length) { mount(game, [el("p", { class: "hm-t" }, "YOUR PLAYERS"), none]); return; }
      const statsFor = (k) => (admin ? `#/admin/player-stats?player=${encodeURIComponent(k)}` : statsHref);
      mount(game, [
        el("div", { class: "hm-gh" }, [el("span", { class: "hm-t" }, "YOUR PLAYERS"), el("span", { class: "hm-sub2" }, "Swipe · outside the dashed line = better than tour average")]),
        el("div", { class: "hm-rads" }, live2.map((c) => { const v = valsOf(c), tot = v.TOTAL ?? 0;
          return el("a", { class: "hm-rad", href: statsFor(c.key) }, [el("span", { class: "hm-rn" }, [el("b", {}, c.label), el("span", { class: tot >= 0 ? "pos" : "neg" }, fmtSG(tot))]), radar(v, { small: true })]); })),
      ]);
    } else {
      mount(game, [el("p", { class: "hm-t" }, "YOUR PLAYERS"), el("p", { class: "hm-none" }, admin ? "Pick the players you follow, and their games will show here." : "Your players’ games will appear here once their first rounds are in."),
        admin ? el("a", { class: "link small", href: "#/watchlist" }, "Choose players →") : null]);
    }
  } catch (err) { console.error(err); mount(game, el("p", { class: "hm-none" }, "Couldn’t load your game just now. Try again in a moment.")); }
}
