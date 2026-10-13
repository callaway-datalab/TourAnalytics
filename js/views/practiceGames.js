/*
 * Practice › Games (update 139): pressure games with a target to beat, your best and your history.
 *   Every game can be edited (your version replaces the built-in one for you; "Reset" brings it back),
 *   you can make your own, and a coach (or the admin) can send a game to their players, which shows up
 *   at the top of the player's Games under "From your coach".
 */
import { el, mount, confirmAction } from "../ui.js";
import { CATS } from "../practice/model.js";
import { BUILT_IN, SCORING, buildGame, personalBest, fmtGameScore, targetText, scoringOf, describeGame, isLow } from "../practice/games.js";
import { listMyGames, saveMyGame, deleteMyGame, listAssigned, sendGame, dismissAssigned } from "../practice/store.js";
import { spotHole } from "../practice/round.js";

let mine = null;     // your games (made or edited), loaded once a visit
let assigned = null; // games sent to you
const CAT_ORDER = ["OTT", "APP", "ARG", "PUTT"];

/** Start a game: a new session, straight into the first shot (or spot). */
export async function startGame(ctx, game) {
  const base = { id: ctx.newId(), mode: "game", gameId: game.id, gameDef: game, status: "active", startedAt: new Date().toISOString(), playerKey: ctx.playerKey, playerLabel: ctx.label };
  if (game.play === "holes") {
    const { startRound } = await import("./practiceRound.js");
    startRound(ctx, { mode: "game", course: { name: game.title }, holes: buildGame(game), gameId: game.id, gameDef: game });
    return;
  }
  const s = { ...base, cat: game.cat, shots: buildGame(game), plan: { stimp: 11 } };
  s.plan.total = s.shots.length;
  ctx.save(s);
  ctx.playSession(s);
}
void spotHole;

/** Coaches (and the admin) can send games: who to. */
async function sendTargets(ctx) {
  const st = ctx.state;
  if (st.isAdmin) {
    try {
      const { watchUsers } = await import("../store.js");
      const { isTeamKey } = await import("../data.js");
      const users = await new Promise((res) => { let un = null; un = watchUsers((list) => { res(list); setTimeout(() => un?.(), 0); }); });
      return users.filter((u) => u.clientKey && !u.kind && !isTeamKey(u.clientKey)).map((u) => ({ key: u.clientKey, label: u.name || u.clientKey })).sort((a, b) => a.label.localeCompare(b.label));
    } catch { return []; }
  }
  if (st.isTeam) {
    const { teamLabels } = await import("../names.js");
    const labels = teamLabels(st.teamAccess || {});
    return Object.entries(st.teamAccess || {}).filter(([, v]) => v.role === "coach").map(([k]) => ({ key: k, label: labels.get(k) || k })).sort((a, b) => a.label.localeCompare(b.label));
  }
  return [];
}
const canSend = (st) => st.isAdmin || (st.isTeam && Object.values(st.teamAccess || {}).some((v) => v.role === "coach"));

export async function render(ctx) {
  const v = ctx.view;
  if (v.name === "gameEdit") return drawEditor(ctx, v.game, v.isNew);
  if (v.name === "gameSend") return drawSend(ctx, v.game);
  if (!mine || !assigned) {
    mount(ctx.body, el("p", { class: "muted pr-loading" }, "Loading games…"));
    const isPlayer = !ctx.state.isAdmin && !ctx.state.isTeam && ctx.state.profile?.clientKey;
    [mine, assigned] = await Promise.all([listMyGames(ctx.owner), isPlayer ? listAssigned(ctx.state.profile.clientKey) : []]);
    if (ctx.view.name !== "home" && !ctx.view.name.startsWith("game")) return;
  }
  drawHome(ctx);
}

function drawHome(ctx) {
  const games = ctx.sessions.filter((s) => s.mode === "game");
  const done = games.filter((s) => s.status === "done"), active = games.filter((s) => s.status === "active");
  const sender = canSend(ctx.state);
  const override = new Map(mine.filter((g) => BUILT_IN.some((b) => b.id === g.id)).map((g) => [g.id, g]));
  const own = mine.filter((g) => !BUILT_IN.some((b) => b.id === g.id));

  const card = (g, { tag = null, note = null, onDismiss = null, edited = false, custom = false } = {}) => {
    const plays = done.filter((s) => s.gameId === g.id), pb = personalBest(g, ctx.sessions);
    const passed = plays.filter((s) => s.game?.passed).length, last = plays[0];
    const play = el("button", { type: "button", class: "btn pr-play-btn" }, "▶  Play");
    play.addEventListener("click", () => startGame(ctx, g));
    const edit = el("button", { type: "button", class: "link" }, "Edit");
    edit.addEventListener("click", () => ctx.go({ name: "gameEdit", game: JSON.parse(JSON.stringify(g)), isNew: false }));
    const send = sender ? el("button", { type: "button", class: "link" }, "Send to players") : null;
    send?.addEventListener("click", () => ctx.go({ name: "gameSend", game: g }));
    const reset = edited ? el("button", { type: "button", class: "link" }, "Reset") : null;
    reset?.addEventListener("click", async () => { if (!confirmAction(`Put ${g.title} back to how it was?`)) return; await deleteMyGame(ctx.owner, g.id).catch(() => {}); mine = mine.filter((x) => x.id !== g.id); drawHome(ctx); });
    const del = custom ? el("button", { type: "button", class: "link danger" }, "Delete") : null;
    del?.addEventListener("click", async () => { if (!confirmAction(`Delete ${g.title}? Your scores at it stay in your history.`)) return; await deleteMyGame(ctx.owner, g.id).catch(() => {}); mine = mine.filter((x) => x.id !== g.id); drawHome(ctx); });
    const dismiss = onDismiss ? el("button", { type: "button", class: "link danger" }, "Dismiss") : null;
    dismiss?.addEventListener("click", onDismiss);
    return el("article", { class: "pr-game" }, [
      el("div", { class: "pr-game-top" }, [el("h3", {}, g.title), el("span", { class: "pr-target" }, targetText(g))]),
      tag ? el("p", { class: "pr-from" }, tag) : null,
      note ? el("p", { class: "pr-note" }, `“${note}”`) : null,
      el("p", { class: "muted small" }, g.blurb || describeGame(g)),
      el("p", { class: "pr-scoring small" }, scoringOf(g).text(g)),
      el("div", { class: "pr-game-stats" }, [
        el("span", {}, [el("em", {}, "Best"), el("strong", {}, pb == null ? "—" : fmtGameScore(g, pb))]),
        el("span", {}, [el("em", {}, "Last"), el("strong", { class: last ? (last.game?.passed ? "pos" : "neg") : "" }, last ? fmtGameScore(g, last.game?.score) : "—")]),
        el("span", {}, [el("em", {}, "Beaten"), el("strong", {}, plays.length ? `${passed} of ${plays.length}` : "—")]),
      ]),
      play,
      el("div", { class: "pr-game-links" }, [edit, send, reset, del, dismiss].filter(Boolean)),
    ]);
  };

  const resume = active.map((s) => {
    const g = s.gameDef || BUILT_IN.find((x) => x.id === s.gameId);
    if (!g) return null;
    const b = el("button", { type: "button", class: "btn ghost" }, "Resume");
    b.addEventListener("click", () => (g.play === "holes" ? ctx.go({ name: "round", session: s }) : ctx.playSession(s)));
    const x = el("button", { type: "button", class: "link danger" }, "Discard");
    x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished game?")) return; await ctx.remove(s.id); drawHome(ctx); });
    return el("section", { class: "panel pr-resume" }, [el("div", {}, [el("strong", {}, `${g.title} in progress`), el("span", { class: "muted" }, ` · ${new Date(s.startedAt).toLocaleDateString()}`)]), el("div", { class: "pr-row" }, [b, x])]);
  });
  const create = el("button", { type: "button", class: "btn" }, "＋  Make a game");
  create.addEventListener("click", () => ctx.go({ name: "gameEdit", isNew: true, game: { id: `my_${ctx.newId()}`, title: "", cat: "PUTT", play: "shots", shots: 10, list: [5], scoring: { type: "makes" }, target: 7, setup: {} } }));

  const fromCoach = assigned.length ? el("section", { class: "panel pr-games pr-coach-games" }, [el("h2", {}, "From your coach"), el("div", { class: "pr-game-grid" }, assigned.map((a) => card(a.game, {
    tag: `From ${a.fromName || "your coach"} · ${new Date(a.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, note: a.note,
    onDismiss: async () => { if (!confirmAction(`Remove ${a.game.title} from your games?`)) return; await dismissAssigned(ctx.state.profile.clientKey, a.id).catch(() => {}); assigned = assigned.filter((x) => x.id !== a.id); drawHome(ctx); },
  })))]) : null;
  const myPanel = own.length ? el("section", { class: "panel pr-games" }, [el("h2", {}, "My games"), el("div", { class: "pr-game-grid" }, own.map((g) => card(g, { custom: true })))]) : null;
  const cats = CAT_ORDER.map((cat) => el("section", { class: "panel pr-games" }, [
    el("h2", {}, CATS[cat].label),
    el("div", { class: "pr-game-grid" }, BUILT_IN.filter((g) => g.cat === cat).map((b) => (override.has(b.id) ? card(override.get(b.id), { edited: true, tag: "Your version" }) : card(b)))),
  ]));
  const history = done.length ? el("section", { class: "panel" }, [el("h2", {}, "Recent games"), el("div", { class: "pr-sessions" }, done.slice(0, 20).map((s) => {
    const g = s.gameDef || BUILT_IN.find((x) => x.id === s.gameId);
    if (!g) return null;
    const row = el("button", { type: "button", class: "pr-sess" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), el("span", { class: "pr-sess-tag" }, g.title)]),
      el("span", { class: "muted" }, s.game?.best ? "Best!" : ""),
      el("strong", { class: s.game?.passed ? "pos" : "neg" }, fmtGameScore(g, s.game?.score)),
      el("span", { class: "pr-sess-per muted" }, s.game?.passed ? "beaten" : s.game?.complete === false ? "unfinished" : "missed"),
    ]);
    row.addEventListener("click", () => (g.play === "holes" ? ctx.go({ name: "roundEnd", session: s }) : ctx.showSummary(s)));
    return row;
  }))]) : null;
  mount(ctx.body, [
    el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Pressure games"),
      el("p", { class: "muted pr-lede" }, "Short games with a score to beat, so every shot counts. Each one has a Tour-level target, keeps your best, and tells you what you need as you go. Edit any of them, or make your own.")]), create]),
    ...resume, fromCoach, myPanel, ...cats, history,
  ]);
}

/* ---------------------------------------------- making / editing a game ---------------------------------------------- */
function drawEditor(ctx, g, isNew) {
  const isBuiltIn = BUILT_IN.some((b) => b.id === g.id);
  g.setup ||= {}; g.scoring ||= { type: "makes" };
  const form = el("div", { class: "pr-editor" });
  const seg = (label, options, get, set) => {
    const box = el("div", { class: "seg seg-sm pr-opt", role: "group", "aria-label": label });
    mount(box, options.map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${get() === v ? " on" : ""}` }, l); b.addEventListener("click", () => { set(v); draw(); }); return b; }));
    return el("div", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, label), box]);
  };
  const input = (label, value, onInput, attrs = {}) => {
    const i = el("input", { type: "text", value: value ?? "", autocomplete: "off", ...attrs });
    i.addEventListener("input", () => { onInput(i.value); preview(); });
    return el("label", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, label), i]);
  };
  const prev = el("p", { class: "pr-preview" });
  const preview = () => { mount(prev, [el("strong", {}, g.title || "Your game"), ` — ${describeGame(g)} ${targetText(g)}.`]); };
  const unit = () => (g.cat === "PUTT" ? "ft" : "yds");
  const draw = () => {
    // keep the scoring valid for the category and style
    const allowed = Object.entries(SCORING).filter(([k, sc]) => sc.cats.includes(g.cat) && (g.play === "holes" ? k === "strokes" : k !== "strokes"));
    if (!allowed.some(([k]) => k === g.scoring.type)) g.scoring = { type: allowed[0][0] };
    if (g.play === "holes" && !["APP", "ARG"].includes(g.cat)) g.play = "shots";
    const distMode = g.list?.length ? "list" : "range";
    mount(form, [
      input("Name", g.title, (v) => { g.title = v.slice(0, 40); }, { maxLength: 40, placeholder: "e.g. Six-foot pressure" }),
      seg("Category", CAT_ORDER.map((c) => [c, CATS[c].label]), () => g.cat, (v) => { g.cat = v; if (v === "OTT") { delete g.list; delete g.dist; } else if (!g.dist && !g.list) g.dist = v === "PUTT" ? { from: 5, to: 15 } : v === "ARG" ? { from: 10, to: 30 } : { from: 100, to: 175 }; }),
      ["APP", "ARG"].includes(g.cat) ? seg("How it's played", [["shots", "One shot each"], ["holes", "Play each one out"]], () => g.play, (v) => { g.play = v; }) : null,
      input(g.play === "holes" ? "Spots" : "Shots", g.shots, (v) => { g.shots = Math.max(1, Math.min(40, Number(v) || 1)); }, { inputmode: "numeric", maxLength: 2 }),
      g.cat !== "OTT" ? seg(`Distances (${unit()})`, [["range", "A range"], ["list", "Set distances"]], () => distMode, (v) => { if (v === "list") { g.list = [g.dist?.from || 6]; delete g.dist; } else { g.dist = { from: g.list?.[0] || 10, to: (g.list?.at(-1) || 10) + 10 }; delete g.list; } }) : null,
      g.cat !== "OTT" && distMode === "range" ? el("div", { class: "pr-optrow pr-range" }, [el("span", { class: "rd-label" }, "From – to"),
        (() => { const a = el("input", { type: "text", inputmode: "numeric", value: g.dist?.from ?? "", "aria-label": "From" }), b = el("input", { type: "text", inputmode: "numeric", value: g.dist?.to ?? "", "aria-label": "To" }); const upd = () => { g.dist = { from: Number(a.value) || 1, to: Math.max(Number(a.value) || 1, Number(b.value) || 1) }; preview(); }; a.addEventListener("input", upd); b.addEventListener("input", upd); return el("span", { class: "pr-range-in" }, [a, "–", b, el("em", {}, unit())]); })()]) : null,
      g.cat !== "OTT" && distMode === "list" ? input(`Distances, in order (${unit()})`, (g.list || []).join(", "), (v) => { g.list = v.split(/[ ,;]+/).map(Number).filter((n) => n > 0).slice(0, 12); if (!g.list.length) g.list = [5]; }, { placeholder: "3, 6, 9" }) : null,
      g.cat === "OTT" ? seg("Fairways", [["tight", "Tight"], ["standard", "Standard"], ["wide", "Wide"], ["mixed", "Mixed"]], () => g.setup.width || "standard", (v) => { g.setup.width = v; }) : null,
      ["APP", "ARG"].includes(g.cat) && g.play !== "holes" ? seg("Lie", [["Fairway", "Fairway"], ["Rough", "Rough"], ["Bunker", "Bunker"], ["mixed", "Mixed"]], () => g.setup.lie || "Fairway", (v) => { g.setup.lie = v; }) : null,
      ["APP", "ARG"].includes(g.cat) && g.play !== "holes" ? seg("Pins", [["easy", "Middle"], ["mid", "Corners"], ["hard", "Tucked"], ["mixed", "Mixed"]], () => g.setup.pin || "mixed", (v) => { g.setup.pin = v; }) : null,
      seg("Scoring", allowed.map(([k, sc]) => [k, sc.label]), () => g.scoring.type, (v) => { g.scoring = { type: v, ...(v === "inside" ? { inside: g.cat === "PUTT" ? 3 : 6 } : {}) }; if (v === "sg") g.target = 0; }),
      g.scoring.type === "inside" ? input("Inside (ft)", g.scoring.inside, (v) => { g.scoring.inside = Math.max(1, Number(v) || 1); }, { inputmode: "numeric", maxLength: 3 }) : null,
      input(isLow(g) ? "Target (or less)" : scoringOf(g).sg ? "Target (strokes gained, beat it)" : "Target", g.target, (v) => { g.target = Number(v) || 0; }, { inputmode: "decimal", maxLength: 6 }),
      input("Description (optional)", g.blurb, (v) => { g.blurb = v.slice(0, 200); }, { maxLength: 200, placeholder: "Leave blank to describe it automatically" }),
    ]);
    preview();
  };
  draw();
  const save = el("button", { type: "button", class: "btn pr-go" }, isNew ? "Save game" : "Save changes");
  save.addEventListener("click", async () => {
    if (!g.title?.trim()) { ctx.flash?.("Give the game a name.", "error"); return; }
    const out = { ...g, title: g.title.trim(), updated: new Date().toISOString() };
    if (!out.blurb) delete out.blurb;
    try { await saveMyGame(ctx.owner, out); } catch (err) { console.error(err); ctx.flash?.("Couldn't save the game. Check your connection.", "error"); return; }
    mine = [...(mine || []).filter((x) => x.id !== out.id), out];
    ctx.flash?.(isBuiltIn ? "Saved your version." : "Saved.", "ok");
    ctx.home();
  });
  const back = el("button", { type: "button", class: "link" }, "← Games");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, isNew ? "Games · new" : isBuiltIn ? "Games · your version of a built-in game" : "Games · edit"),
    el("h1", {}, isNew ? "Make a game" : `Edit ${g.title}`),
    form, prev, save,
  ])]);
}

/* ---------------------------------------------- sending a game to players ---------------------------------------------- */
async function drawSend(ctx, g) {
  mount(ctx.body, el("p", { class: "muted pr-loading" }, "Loading your players…"));
  const players = await sendTargets(ctx);
  const picked = new Set();
  const note = el("input", { type: "text", maxLength: 140, placeholder: "A note (optional): e.g. “Do this twice before Thursday”" });
  const list = players.length ? el("div", { class: "pr-send-list" }, players.map((p) => {
    const cb = el("input", { type: "checkbox", id: `snd-${p.key}` });
    cb.addEventListener("change", () => { if (cb.checked) picked.add(p.key); else picked.delete(p.key); });
    return el("label", { class: "pr-check", for: `snd-${p.key}` }, [cb, el("span", {}, p.label)]);
  })) : el("p", { class: "muted" }, "No players to send to. Coaches can send games to the players they coach.");
  const send = el("button", { type: "button", class: "btn pr-go" }, "Send");
  send.addEventListener("click", async () => {
    if (!picked.size) { ctx.flash?.("Pick at least one player.", "error"); return; }
    send.disabled = true;
    const at = new Date().toISOString(), fromName = ctx.state.profile?.name || ctx.state.user.displayName || "Your coach";
    try {
      for (const key of picked) {
        const id = ctx.newId();
        const game = { ...g, id: `sent_${id}`, blurb: g.blurb || describeGame(g) };
        await sendGame(key, { id, game, note: note.value.trim(), fromUid: ctx.uid, fromName, sentAt: at, playerKey: key });
      }
      ctx.flash?.(`Sent ${g.title} to ${picked.size} player${picked.size === 1 ? "" : "s"}.`, "ok");
      ctx.home();
    } catch (err) { console.error(err); send.disabled = false; ctx.flash?.("Couldn't send it. Check your connection.", "error"); }
  });
  const back = el("button", { type: "button", class: "link" }, "← Games");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, "Games · send"), el("h1", {}, `Send ${g.title}`),
    el("p", { class: "muted" }, `${g.blurb || describeGame(g)} ${targetText(g)}.`),
    el("h2", {}, "To"), list, el("label", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, "Note"), note]), send,
  ])]);
}
