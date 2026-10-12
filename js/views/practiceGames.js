/*
 * Practice › Games (update 138): pressure games with a target to beat, your best, and your history.
 * Shot games play in the practice session runner; Up & Down 9 plays out each spot like a round.
 */
import { el, mount, confirmAction } from "../ui.js";
import { CATS } from "../practice/model.js";
import { GAMES, gameById, personalBest, fmtGameScore } from "../practice/games.js";

/** Start a game: a new session, straight into the first shot. */
export function startGame(ctx, game) {
  const base = { id: ctx.newId(), mode: "game", gameId: game.id, status: "active", startedAt: new Date().toISOString(), playerKey: ctx.playerKey, playerLabel: ctx.label };
  if (game.kind === "holes") {
    const s = { ...base, cat: "ROUND", holes: game.build(), cur: 0 };
    ctx.add(s); ctx.save(s);
    ctx.go({ name: "round", session: s });
    return;
  }
  const s = { ...base, cat: game.cat, shots: game.build(), plan: { stimp: 11, total: 0 } };
  s.plan.total = s.shots.length;
  ctx.save(s);
  ctx.playSession(s);
}

export function render(ctx) {
  const all = ctx.sessions.filter((s) => s.mode === "game");
  const done = all.filter((s) => s.status === "done"), active = all.filter((s) => s.status === "active");
  const resume = active.map((s) => {
    const g = gameById(s.gameId);
    if (!g) return null;
    const b = el("button", { type: "button", class: "btn ghost" }, "Resume");
    b.addEventListener("click", () => (g.kind === "holes" ? ctx.go({ name: "round", session: s }) : ctx.playSession(s)));
    const x = el("button", { type: "button", class: "link danger" }, "Discard");
    x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished game?")) return; await ctx.remove(s.id); render(ctx); });
    return el("section", { class: "panel pr-resume" }, [el("div", {}, [el("strong", {}, `${g.title} in progress`), el("span", { class: "muted" }, ` · ${new Date(s.startedAt).toLocaleDateString()}`)]), el("div", { class: "pr-row" }, [b, x])]);
  });
  const cards = ["OTT", "APP", "ARG", "PUTT"].map((cat) => {
    const list = GAMES.filter((g) => g.cat === cat);
    return el("section", { class: "panel pr-games" }, [
      el("h2", {}, CATS[cat].label),
      el("div", { class: "pr-game-grid" }, list.map((g) => {
        const mine = done.filter((s) => s.gameId === g.id), pb = personalBest(g, ctx.sessions);
        const passed = mine.filter((s) => s.game?.passed).length;
        const last = mine[0];
        const play = el("button", { type: "button", class: "btn pr-play-btn" }, "▶  Play");
        play.addEventListener("click", () => startGame(ctx, g));
        return el("article", { class: "pr-game" }, [
          el("div", { class: "pr-game-top" }, [el("h3", {}, g.title), el("span", { class: "pr-target" }, g.sg ? "Beat 0.00 SG" : `Target ${fmtGameScore(g, g.target)}${g.better === "low" ? " or less" : ""}`)]),
          el("p", { class: "muted small" }, g.blurb),
          el("p", { class: "pr-scoring small" }, g.pointsText),
          el("div", { class: "pr-game-stats" }, [
            el("span", {}, [el("em", {}, "Best"), el("strong", {}, pb == null ? "—" : fmtGameScore(g, pb))]),
            el("span", {}, [el("em", {}, "Last"), el("strong", { class: last ? (last.game?.passed ? "pos" : "neg") : "" }, last ? fmtGameScore(g, last.game?.score) : "—")]),
            el("span", {}, [el("em", {}, "Beaten"), el("strong", {}, mine.length ? `${passed} of ${mine.length}` : "—")]),
          ]),
          play,
        ]);
      })),
    ]);
  });
  const history = done.length ? el("section", { class: "panel" }, [el("h2", {}, "Recent games"), el("div", { class: "pr-sessions" }, done.slice(0, 20).map((s) => {
    const g = gameById(s.gameId);
    if (!g) return null;
    const row = el("button", { type: "button", class: "pr-sess" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), el("span", { class: "pr-sess-tag" }, g.title)]),
      el("span", { class: "muted" }, s.game?.best ? "Best!" : ""),
      el("strong", { class: s.game?.passed ? "pos" : "neg" }, fmtGameScore(g, s.game?.score)),
      el("span", { class: "pr-sess-per muted" }, s.game?.passed ? "beaten" : s.game?.complete === false ? "unfinished" : "missed"),
    ]);
    row.addEventListener("click", () => (g.kind === "holes" ? ctx.go({ name: "roundEnd", session: s }) : ctx.showSummary(s)));
    return row;
  }))]) : null;
  mount(ctx.body, [
    el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Pressure games"),
      el("p", { class: "muted pr-lede" }, "Short games with a score to beat, so every shot counts. Each one is scored against a Tour-level target, keeps your best, and tells you what you need as you go.")])]),
    ...resume, ...cards, history,
  ]);
}
