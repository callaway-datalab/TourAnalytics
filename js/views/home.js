// (update 609) Home: everyone's first page. A greeting, Ask Cal (a big gold microphone: one tap and it listens), the
// game as a radar (the four parts of the game against tour average: outside the dashed circle better, inside worse;
// a coach with several players, or the admin: a row of small radars to swipe, one a player), Explore (picture cards
// to the main pages) and this week's tournament (live, else the next one and when it starts).
import { el, mount, calAllowed, holdToTalk } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, summaryPlayers, fmtSG } from "../sg.js";
import { playerCard } from "../watchlistData.js";
import { watchPrefs, loadWatch, saveWatch } from "../watchlist.js";
import { radar, radarKey, yearsLabel, trendArrow } from "../radarChart.js"; // (update 611; 613: the arrow)

const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; try { un = watch(fin); } catch { fin(null); } });
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
    const talk = el("button", { type: "button", class: "hm-orb", "aria-label": "Ask Cal: tap to open, hold to talk" }, el("span", { "aria-hidden": "true" }));
    // (update 621) Cal himself in the orb (the caddie in a speech bubble, in dark ink), with a small microphone badge: tap to talk
    talk.firstChild.innerHTML = '<svg class="hm-cal-face" viewBox="0 0 20 20"><mask id="hm-cal-m"><image href="icons/cal.png?v=4" width="20" height="20"/></mask><rect width="20" height="20" fill="#1a1408" mask="url(#hm-cal-m)"/></svg>';
    talk.appendChild(el("span", { class: "hm-orb-mic", "aria-hidden": "true" }));
    talk.lastChild.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    const open = async (listen) => { const m = await import("../callie.js"); await m.openCallie(); if (listen && !(await import("../listen.js")).isIOS()) setTimeout(() => document.querySelector(".cal-mic:not(.on)")?.click(), 150); };
    // (update 645) hold it to talk (asked when you let go, as with the header's Cal); a tap opens Cal listening
    let held = false;
    talk.addEventListener("click", (e) => { e.stopPropagation(); if (held) { held = false; return; } open(false); }); // (update 663: a tap just opens Cal; hold to talk)
    holdToTalk(talk, () => { held = true; });
    calCard = el("section", { class: "hm-cal" }, [talk, el("b", {}, "Ask Cal, the AI Caddy"), // (update 611: the name; a strategy and a stat example)
      el("span", { class: "hm-ex" }, "“How should I play the 2nd at Torrey Pines?”"), el("span", { class: "hm-ex" }, single && !team.isTeam ? "“How is my putting over my last 10 rounds?”" : "“Who putts best on Tour this season?”"),
    ]);
    // (update 640) no card: Cal's orb is the button (tap to talk)
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
      rep: '<g transform="translate(38 14)"><rect x="18" y="0" width="54" height="72" rx="6" fill="#2c2c2e" stroke="#d4b483" stroke-width="2"/><rect x="9" y="9" width="54" height="72" rx="6" fill="#3a3a3c" stroke="#d4b483" stroke-width="2"/><rect x="0" y="18" width="54" height="72" rx="6" fill="#f5f5f7"/><rect x="9" y="30" width="36" height="5" rx="2" fill="#b08d57"/><rect x="9" y="42" width="28" height="4" rx="2" fill="#8e8e93"/><rect x="9" y="64" width="8" height="16" fill="#30d158"/><rect x="21" y="56" width="8" height="24" fill="#30d158"/><rect x="33" y="70" width="8" height="10" fill="#ff453a"/></g>',
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
    // (update 668) the admin and analysts: every picked player's PDF report at once
    state.isAdmin || state.profile?.kind === "analyst" ? card("#/bulk-reports", "rep", "Generate Bulk Reports", "Stats", "linear-gradient(160deg,#2a2418,#100d08)") : null,
  ].filter(Boolean));
  const nCards = row.children.length;
  const dots = el("div", { class: "hm-dots", "aria-hidden": "true" }, Array.from({ length: nCards }, (_, i) => el("i", { class: i ? "" : "on" })));
  row.addEventListener("scroll", () => { const w = row.scrollWidth - row.clientWidth, i = w > 0 ? Math.round((row.scrollLeft / w) * (nCards - 1)) : 0; [...dots.children].forEach((d, j) => d.classList.toggle("on", j === i)); }, { passive: true });

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
    const many = admin || (team.isTeam && teamKeys.length > 1);
    if (many) await loadWatch(true).catch(() => {});
    const nameOf = (k) => plainName(labels.get(k) || field.find((p) => p.key === k)?.name || k.replace(/^c_/, ""));
    // (update 610) the players shown: the admin's chosen (the "+"), a coach's chosen among their players (none chosen: all)
    const keysNow = () => {
      if (single) return [single];
      const fav = watchPrefs().players || [];
      if (admin) return fav;
      const mine = fav.filter((k) => teamKeys.includes(k));
      return mine.length ? mine : teamKeys;
    };
    // (update 610) each player twice; (611) their latest year (green) and the years before it (gold, "2024-25")
    const memo = new Map();
    const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
    const cardOf = (k) => {
      if (!memo.has(k)) {
        const one = (period) => { try { return playerCard(k, { field, label: nameOf(k), period, lite: true }); } catch { return { key: k, label: nameOf(k), empty: true }; } };
        const ys = [...new Set((field.find((p) => p.key === k)?.rounds || []).map(yrOf).filter(Boolean))].sort(), last = ys.at(-1) || "";
        const before = ys.slice(0, -1);
        memo.set(k, { now: one("season"), all: before.length ? one(`y:${before.at(-1)}`) : null, nowLabel: last || "This season", beforeLabel: before.at(-1) || "" }); // (update 612: last year only)
      }
      return memo.get(k);
    };
    const valsOf = (c) => (c && !c.empty ? Object.fromEntries((c.sg || []).map((x) => [x.k, x.v])) : null);
    // (update 610) the "+": add or remove players (the admin: anyone; a coach: their own players)
    const plus = () => { const b = el("button", { type: "button", class: "hm-plus", "aria-label": "Add or remove players", title: "Add or remove players" }, "+"); b.addEventListener("click", pickPlayers); return b; };
    function pickPlayers() {
      const pool = admin ? labels : new Map(teamKeys.map((k) => [k, nameOf(k)]));
      const chosen = new Set(keysNow());
      const q = el("input", { type: "search", class: "hm-pk-q", placeholder: "Search players\u2026", autocomplete: "off", "aria-label": "Search players" });
      const ul = el("div", { class: "hm-pk-list" });
      const draw = () => {
        const t = q.value.trim().toLowerCase();
        const rows = [...pool].filter(([k, l]) => !t || String(l).toLowerCase().includes(t)).sort((a, b) => (chosen.has(b[0]) - chosen.has(a[0])) || String(a[1]).localeCompare(String(b[1]))).slice(0, 60);
        mount(ul, rows.length ? rows.map(([k, l]) => { const on = chosen.has(k), b = el("button", { type: "button", class: `hm-pk-r${on ? " on" : ""}`, "aria-pressed": String(on) }, [el("span", {}, plainName(l)), el("i", { "aria-hidden": "true" }, on ? "\u2713" : "+")]);
          b.addEventListener("click", () => { if (chosen.has(k)) chosen.delete(k); else chosen.add(k); draw(); }); return b; }) : el("p", { class: "muted small" }, "No players by that name."));
      };
      q.addEventListener("input", draw);
      const done = el("button", { type: "button", class: "btn hm-pk-done" }, "Done"), back = el("div", { class: "hm-pk-back" });
      const sheet = el("div", { class: "hm-pk-wrap" }, [back, el("section", { class: "hm-pk", role: "dialog", "aria-modal": "true", "aria-label": "Your players" }, [el("div", { class: "hm-pk-h" }, [el("strong", {}, "Your players"), done]), q, ul])]);
      const close = async () => {
        sheet.remove();
        const before = watchPrefs().players || [], keep = before.filter((k) => !pool.has(k)); // (the admin's others, a coach's non-team picks: kept)
        await saveWatch({ players: [...keep, ...[...chosen].filter((k) => pool.has(k))] }).catch(() => {});
        drawGame();
      };
      done.addEventListener("click", close); back.addEventListener("click", close);
      document.body.appendChild(sheet); draw(); setTimeout(() => q.focus(), 50);
    }
    const none = (txt) => el("p", { class: "hm-none" }, txt);
    function drawGame() {
      const keys = keysNow();
      if (!many) {
        const c = cardOf(keys[0]), v = valsOf(c.now), cv = valsOf(c.all);
        if (!v) { mount(game, [el("p", { class: "hm-t" }, team.isTeam ? (nameOf(keys[0]) || "").toUpperCase() : "YOUR GAME"), none("Your game will appear here once your first rounds are in.")]); return; }
        const tot = v.TOTAL ?? 0;
        mount(game, [
          el("div", { class: "hm-gh" }, [el("span", { class: "hm-t" }, team.isTeam || previewClient ? (c.now.label || "").toUpperCase() : "YOUR GAME"), el("span", { class: "hm-tots" }, [el("span", { class: `hm-big ${tot >= 0 ? "pos" : "neg"}` }, [trendArrow(el, tot, cv?.TOTAL), fmtSG(tot)]), cv?.TOTAL != null ? el("span", { class: "hm-big2", title: c.beforeLabel }, fmtSG(cv.TOTAL)) : null])]), // (update 612: last year's total in gold under it)
          el("p", { class: "hm-sub" }, `strokes a round ${tot >= 0 ? "better" : "worse"} than tour average in ${c.nowLabel}`),
          radar(v, { c: cv, cLabel: c.beforeLabel }), radarKey(el, c.nowLabel, cv ? c.beforeLabel : null),
        ]);
        return;
      }
      const cards = keys.map(cardOf).filter((c) => valsOf(c.now));
      const statsFor = (k) => (admin ? `#/admin/player-stats?player=${encodeURIComponent(k)}` : statsHref);
      // (update 642) left and right arrows in the heading, away from the cards (no tapping a player by mistake)
      const prev = el("button", { type: "button", class: "hm-nav", "aria-label": "Previous players" }, "\u2039"),
        next = el("button", { type: "button", class: "hm-nav", "aria-label": "More players" }, "\u203A");
      const nav = el("span", { class: "hm-navs" }, [prev, next]);
      const headRow = el("div", { class: "hm-gh" }, [el("span", { class: "hm-t" }, "YOUR PLAYERS"), el("span", { class: "hm-gh-r" }, [nav, plus()])]);
      if (!cards.length) { mount(game, [headRow, none(keys.length ? "Your players\u2019 games will appear here once their first rounds are in." : "Tap + to pick the players you follow, and their games will show here.")]); return; }
      mount(game, [headRow, el("p", { class: "hm-sub2" }, "Swipe \u00b7 outside the dashed line = better than tour average"),
        // (update 636; 642: the arrows in the heading) a tap moves one card
        (() => { const row = el("div", { class: "hm-rads" }, cards.map((c) => { const v = valsOf(c.now), cv = valsOf(c.all), tot = v.TOTAL ?? 0;
          return el("a", { class: "hm-rad", href: statsFor(c.now.key) }, [el("span", { class: "hm-rn" }, [el("b", {}, c.now.label), el("span", { class: "hm-tots" }, [el("span", { class: tot >= 0 ? "pos" : "neg" }, [trendArrow(el, tot, cv?.TOTAL), fmtSG(tot)]), cv?.TOTAL != null ? el("span", { class: "hm-big2 sm" }, fmtSG(cv.TOTAL)) : null])]), radar(v, { small: true, c: cv, cLabel: c.beforeLabel })]); }));
          const step = () => (row.firstElementChild?.offsetWidth || 280) + 10;
          const upd = () => { prev.disabled = row.scrollLeft <= 8; next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8; nav.hidden = prev.disabled && next.disabled; };
          row.addEventListener("scroll", upd, { passive: true }); requestAnimationFrame(upd); window.addEventListener("resize", upd);
          prev.addEventListener("click", () => row.scrollBy({ left: -step(), behavior: "smooth" }));
          next.addEventListener("click", () => row.scrollBy({ left: step(), behavior: "smooth" }));
          return row; })(),
        radarKey(el, "Latest year", "Year before"), // (update 610: the key once, under the row; 611: each radar's corners name its years)
      ]);
    }
    drawGame();
  } catch (err) { console.error(err); mount(game, el("p", { class: "hm-none" }, "Couldn\u2019t load your game just now. Try again in a moment.")); }
}
