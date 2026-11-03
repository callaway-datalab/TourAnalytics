// (update 470) Focus: the Stats page as one short story for the player picked. Where they stand; the three places
// they lose the most strokes lately (against the tour average, which strokes gained already is), what fixing each is
// worth (a round, and on the season rank), a drill for each; whether the practice they've added is working (strokes
// gained there since they added it); and what to keep doing. Full stats is one tap away (the switch above it).
// Takes S first, like the other Stats page sections (see sgDashboard.js).
import { el, mount, CATEGORIES, distLead, drillFor, drillLine, practiceOpen, isMine, getState, planEditor, PLAN_ADDED } from "./sgShared.js";

const CAT = Object.fromEntries(CATEGORIES);
const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));

/** Strokes gained a round, and attempts a round, for every part of the game and distance in these rounds. */
function buckets(rounds) {
  const m = new Map(), n = rounds.length || 1;
  for (const rd of rounds) for (const x of rd.shots || []) {
    if (!x.cat) continue;
    const k = `${x.cat}|${x.dist || ""}`, b = m.get(k) || m.set(k, { cat: x.cat, dist: x.dist || null, sg: 0, w: 0 }).get(k);
    b.sg += x.sg || 0; b.w += x.w || 1;
  }
  return [...m.values()].map((b) => ({ ...b, perRd: b.sg / n, att: b.w / n, perShot: b.w ? b.sg / b.w : 0 }));
}
const nameOf = (b) => `${CAT[b.cat] || b.cat}${b.dist ? ` · ${b.dist}` : ""}`;

export function focusView(S, mine, slicedField) {
  const me = S.me, st = S.st;
  const all = [...mine].sort(byDate);
  if (all.length < 6) return [el("section", { class: "panel fx" }, el("p", { class: "empty" }, "Focus needs at least 6 rounds in this selection. Widen the time frame, or see Full stats."))];
  const N = Math.max(6, Math.min(all.length, Math.round(Number(st.recentN) || 12)));
  const recent = all.slice(-N);
  const tot = (rs) => rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + (x.sg || 0), 0), 0) / (rs.length || 1);
  const seasonV = tot(all), recentV = tot(recent);
  // the season rank: where a value would sit among everyone else's averages over the same selection
  const others = S.rankedField(slicedField).filter((p) => p.key !== me.key).map((p) => tot(p.rounds)).filter(Number.isFinite);
  const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length, of = others.length + 1;
  const ranked = others.length > 0;
  const whose = isMine(me.key) ? "your" : `${me.label}’s`, you = isMine(me.key) ? "you" : (me.label || "they").split(" ")[0];

  // 1. where they stand
  const trend = recentV - seasonV;
  const stand = el("section", { class: "panel fx fx-stand" }, [
    el("p", { class: "fx-eyebrow" }, "Where you stand"),
    el("div", { class: "fx-stats" }, [
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, "Season"), el("strong", { class: seasonV >= 0 ? "pos" : "neg" }, f2(seasonV)), el("span", { class: "fx-s" }, ranked ? `${ord(rankOf(seasonV))} of ${of}` : "a round")]),
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, `Last ${N}`), el("strong", { class: recentV >= 0 ? "pos" : "neg" }, f2(recentV)), el("span", { class: "fx-s" }, ranked ? `a ${ord(rankOf(recentV))} level` : "a round")]),
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, "Trend"), el("strong", { class: trend >= 0 ? "pos" : "neg" }, `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(2)}`), el("span", { class: "fx-s" }, Math.abs(trend) < 0.1 ? "steady" : trend > 0 ? "getting better" : "slipping")]),
    ]),
  ]);

  // 2 and 3. where they lose strokes lately, what it's worth, and the practice for it
  const bs = buckets(recent).filter((b) => b.att >= 0.5); // (shots they face at least every other round)
  const losses = bs.filter((b) => b.perRd < -0.02).sort((a, b) => a.perRd - b.perRd).slice(0, 3);
  const gains = bs.filter((b) => b.perRd > 0.02).sort((a, b) => b.perRd - a.perRd).slice(0, 2);
  const canAdd = practiceOpen(me.key);
  const sig = (d) => `${me.key}|${d.kind}|${d.dist || ""}|${d.lie || ""}`;
  const itemFor = (b) => {
    const drill = drillFor(b.cat, b.dist, null);
    if (!drill) return null;
    drill.from = `last ${N} rounds`;
    // the goal in real rounds: strokes gained there back to the tour average (0), over the next N rounds
    const goal = { stat: "skill", cat: b.cat, dist: b.dist, target: 0, measure: "round", when: "nextN", n: N };
    return { drill, goal };
  };
  const send = async (list, btns) => {
    btns.forEach((x) => { x.disabled = true; });
    try {
      const { addToPlan } = await import("./practice/plan.js");
      await addToPlan(getState(), { items: list.map((x) => ({ ...x })), playerKey: me.key, playerLabel: me.label });
      list.forEach((x) => PLAN_ADDED.add(sig(x.drill)));
      S.draw();
    } catch (err) { console.error(err); btns.forEach((x) => { x.disabled = false; }); }
  };
  const addBtn = (items, label) => {
    const left = items.filter((x) => x && !PLAN_ADDED.has(sig(x.drill)));
    if (!canAdd || !items.some(Boolean)) return null;
    const b = el("button", { type: "button", class: "fx-btn", disabled: !left.length }, left.length ? label : "✓ In the practice plan");
    b.addEventListener("click", () => { if (left.length) planEditor(left, whose, (edited) => send(edited, [b])); });
    return b;
  };
  const allFix = losses.reduce((t, b) => t + -b.perRd, 0);
  const loseCards = losses.map((b, i) => {
    const fix = -b.perRd, item = itemFor(b);
    return el("div", { class: "fx-card" }, [
      el("div", { class: "fx-card-h" }, [el("span", { class: "fx-n" }, String(i + 1)), el("strong", {}, nameOf(b)), el("span", { class: "neg fx-v" }, `${f2(b.perRd)} a round`)]),
      el("p", { class: "fx-why" }, `${b.att.toFixed(1)} shots a round, losing ${Math.abs(b.perShot).toFixed(3)} a shot against the tour average.`),
      el("p", { class: "fx-worth" }, ["Getting it to the tour average is worth ", el("strong", { class: "pos" }, `${f2(fix)} a round`), ranked ? (rankOf(recentV + fix) < rankOf(recentV) ? ` — a ${ord(rankOf(recentV))} → ${ord(rankOf(recentV + fix))} level.` : " (not enough on its own to move the rank).") : "."]),
      item ? el("div", { class: "fx-drill" }, [el("span", { class: "fx-k" }, "Practice"), el("span", {}, drillLine(item.drill)), addBtn([item], "＋ Add to practice")]) : null,
    ]);
  });
  const loseBox = el("section", { class: "panel fx" }, [
    el("p", { class: "fx-eyebrow" }, `Where ${you} lose${you === "you" ? "" : "s"} strokes · last ${N} rounds`),
    losses.length ? el("div", { class: "fx-cards" }, loseCards) : el("p", { class: "muted" }, `No part of the game is costing much over the last ${N} rounds. Keep doing what ${you === "you" ? "you’re" : "they’re"} doing.`),
    losses.length > 1 ? el("div", { class: "fx-total" }, [
      el("span", {}, ["All of them together: ", el("strong", { class: "pos" }, `${f2(allFix)} a round`), ranked ? ` — a ${ord(rankOf(recentV))} → ${ord(rankOf(recentV + allFix))} level` : ""]),
      addBtn(losses.map(itemFor), `＋ Add all ${losses.length} to practice`)]) : null,
  ]);

  // 4. is the practice working? Each drill in their plan: strokes gained there a round since it was added, against before
  const working = el("section", { class: "panel fx" }, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), el("p", { class: "muted small" }, "Checking the practice plan…")]);
  if (canAdd || isMine(me.key)) {
    import("./practice/plan.js").then((m) => m.planFor(getState(), me.key)).then((items) => {
      const rows = (items || []).filter((p) => p.cat && p.addedAt).map((p) => {
        const day = String(p.addedAt).slice(0, 10), after = all.filter((rd) => String(rd.date || "").slice(0, 10) > day), before = all.filter((rd) => String(rd.date || "").slice(0, 10) <= day).slice(-N);
        const at = (rs) => { if (!rs.length) return null; let s = 0; for (const rd of rs) for (const x of rd.shots || []) if (x.cat === p.cat && (!p.dist || x.dist === p.dist)) s += x.sg || 0; return s / rs.length; };
        const a = at(after), b = at(before);
        const when = new Date(p.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const what = `${p.title || CAT[p.cat]}${p.dist && !(p.title || "").includes(p.dist) ? ` (${p.dist})` : ""}`;
        if (!after.length) return el("li", {}, [el("strong", {}, what), el("span", { class: "muted" }, ` · added ${when} · no rounds since`)]);
        const d = a - (b ?? 0);
        return el("li", {}, [el("strong", {}, what), ` · ${f2(a)} a round over ${after.length} ${after.length === 1 ? "round" : "rounds"} since ${when}`,
          b != null ? el("span", { class: Math.abs(d) < 0.01 ? "muted" : d > 0 ? "pos" : "neg" }, ` (${Math.abs(d) < 0.01 ? "no change" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(2)} against the ${before.length} rounds before`})`) : null]);
      });
      mount(working, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), rows.length ? el("ul", { class: "fx-list" }, rows) : el("p", { class: "muted small" }, `Nothing in ${whose} practice plan yet. Add a drill above and this tracks whether it shows up in real rounds.`)]);
    }).catch(() => mount(working, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), el("p", { class: "muted small" }, "Couldn’t read the practice plan just now.")]));
  } else mount(working, null);

  // 5. what to keep
  const keep = gains.length ? el("section", { class: "panel fx" }, [el("p", { class: "fx-eyebrow" }, "Keep doing"),
    el("ul", { class: "fx-list" }, gains.map((b) => el("li", {}, [el("strong", {}, nameOf(b)), " · ", el("span", { class: "pos" }, `${f2(b.perRd)} a round`), el("span", { class: "muted" }, ` (${b.att.toFixed(1)} shots a round)`)])))]) : null;

  return [stand, loseBox, working.childNodes.length ? working : null, keep].filter(Boolean);
}

/** The Focus / Full stats switch. */
export function focusSwitch(S) {
  const st = S.st, on = st.view2 !== "full";
  const seg = el("div", { class: "seg seg-sm fx-switch", role: "group", "aria-label": "Stats view" }, [["focus", "Focus"], ["full", "Full stats"]].map(([v, l]) => {
    const cur = (on ? "focus" : "full") === v;
    const b = el("button", { type: "button", class: `seg-btn${cur ? " on" : ""}`, "aria-pressed": String(cur) }, l);
    b.addEventListener("click", () => { if (!cur) { st.view2 = v; S.draw(); } });
    return b;
  }));
  return el("div", { class: "fx-switch-row" }, seg);
}
