// (sgDashboard split) The Path table: the last N rounds against a level's rounds (or the rest, or the best stretch), with what-ifs.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, LEVELS, MIX_CAUSE, PLAN_ADDED, PLAN_SEEN, syncPlan, bucketsOf, distLead, drillFor, drillLine, el, fmtStat, getState, goalStatsFor, groupSplit, infoTip, isMine, kv, mixLead, mount, planEditor, practiceOpen, sgn2, statDef } from "./sgShared.js";

/* (update 338) Path back to Elite: the player's last N rounds (10 to start; changeable) against their elite rounds. The gap
 * in strokes, where it comes from (biggest first) with a target in plain stats for each, what hurts in their other rounds
 * (parts of the game costing a stroke or more, bad lies), when the elite rounds tend to happen, and what to practise. Worked out here, by rule. */
export function pathBack(S, elite, season, cat, lv = null, { rest = false, best = false, rk = null } = {}) {
  // (update 355) the level aimed at (picked here): its rounds (their best rounds that together reach it) against their
  // last N rounds (10 to start; changeable)
  const lvName = best ? "best stretch" : rest ? "other rounds" : lv ? `\u201c${LEVELS[lv.T]}\u201d rounds` : "best rounds"; // (update 360: the level by name: their "Contender" rounds)
  const LvCap = best ? "Best stretch" : rest ? "Other rounds" : lv ? `\u201c${LEVELS[lv.T]}\u201d rounds` : "Best rounds";
  const NN = { kept: lvName, cut: "recent rounds" };
  const N = Math.max(3, Math.min(season.length, Math.round(Number(S.st.recentN) || 12)));
  const recent = season.slice(-N);
  const eSet = new Set(elite), others = season.filter((rd) => !eSet.has(rd));
  const inCat = (x) => !cat || x.cat === cat;
  const tot = (rs) => (rs.length ? rs.reduce((t, rd) => { let s0 = 0; for (const x of rd.shots) if (inCat(x)) s0 += x.sg; return t + s0; }, 0) / rs.length : null);
  const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
  const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
  // (update 355) the gap is to the bar (what it takes to rank at that level), not to the average of the level's rounds
  const eAvg = tot(elite), rAvg = tot(recent), bar = lv?.bar ?? null;
  const gap = bar != null ? bar - rAvg : eAvg - rAvg;
  const there = bar != null && rAvg >= bar - 1e-9; // (matching it is enough to rank there)
  // where the strokes go: per part of the game and distance, a round
  const bE = bucketsOf(elite, inCat), bR = bucketsOf(recent, inCat), bU = bucketsOf(season, inCat);
  const keys = new Set([...bE.keys(), ...bR.keys()].map((k) => k.split("|").slice(0, 2).join("|")));
  // (update 345) each piece split into playing it better (per shot) and facing it more or less often (lies included)
  const gaps = [...keys].map((k) => { const sp = groupSplit(bE, elite.length, bR, recent.length, (x) => x.startsWith(`${k}|`), bU); const [c, d] = k.split("|"); return { k, c, d, e: sp.ae * sp.pe, r: sp.ab * sp.pb, g: sp.total, sp }; })
    .filter((x) => x.g > 0.04 && x.sp.ab >= 0.5).sort((a, b) => b.g - a.g).slice(0, 5); // (update 343: top 5; update 367: not shots they rarely face lately, under one every two rounds)
  // a target in plain stats for a part of the game / distance: the stat that moved most between elite and recent rounds
  const statAvg = (rs, pred) => { const m = new Map(); for (const rd of rs) for (const o of rd.obs || []) if (pred(o)) { const a = m.get(o.k) || m.set(o.k, { s: 0, w: 0 }).get(o.k); a.s += o.v * o.w; a.w += o.w; } return m; };
  const WHOLE = { OTT: /^(fwy|drive|fairway)/i, APP: /^(gir|prox)/i, ARG: /^(scramble|updown|sand)/i, PUTT: /^(putts|onePutt|threePutt|make)/i };
  // (update 341) enough attempts to trust a stat: 20 for a percentage (a make rate from 3 putts means nothing), 8 otherwise
  const enough = (def, w) => w >= (def.pct ? 20 : 8);
  // (update 447) tee shots with an iron or a wood are only ever about the fairway, never distance
  const okK = (c, d, k) => !(c === "OTT" && /iron|wood/i.test(d || "") && !/^(fwy|fairway)/i.test(k));
  const target = (c, d) => {
    // the stat for that part of the game and distance; if the file has none, the whole-round stat for that part of the game.
    // The one that moved most (better in the best rounds), only where both sets of rounds have enough attempts.
    // (update 454) a shot-by-shot file puts every stat on a distance: the part of the game is then any distance of it
    const exact = (o) => o.cat === c && (d ? o.dist === d : !o.dist);
    const anyDist = (o) => !d && o.cat === c;
    const whole = (o) => !o.cat && WHOLE[c]?.test(o.k);
    const has = (f) => elite.some((rd) => { for (const o of rd.obs || []) if (f(o)) return true; return false; });
    const pred = has(exact) ? exact : has(anyDist) ? anyDist : whole, isExact = pred !== whole;
    const mE = statAvg(elite, pred), mR = statAvg(recent, pred);
    let best = null, thin = null, anyOk = false;
    for (const [k, a] of mE) {
      const b = mR.get(k); const def = statDef(k); if (!b || def.higher == null || !okK(c, d, k)) continue;
      if (!enough(def, a.w) || !enough(def, b.w)) { thin ||= def; continue; }
      anyOk = true;
      const ve = a.s / a.w, vr = b.s / b.w; const better = def.higher !== false ? ve > vr : ve < vr; if (!better) continue;
      const rel = Math.abs(ve - vr) / (Math.abs(vr) || 1); if (!best || rel > best.rel) best = { k, def, ve, vr, rel, exact: isExact };
    }
    return best || (thin && !anyOk ? { thin } : null);
  };
  const tText = (t) => (!t ? null : t.thin ? `Not enough attempts in the ${NN.kept} and the last ${N} rounds to compare (${t.thin.label}).` : `${t.def.label}: ${fmtStat(t.def, t.vr)} now \u2192 ${fmtStat(t.def, t.ve)} in their ${NN.kept}`);
  // (update 342) the drills come from practice/plan.js (the same recipes Practice › Plan plays), each with a goal on the
  // same stat in real rounds: the plain stat when there's a target, else strokes gained for that part of the game
  const N_GOAL = N;
  const statGoal = (c, d, t) => (t && !t.thin
    ? { stat: "obs", statKey: t.k, cat: t.exact ? c : null, dist: t.exact ? d || null : null, label: t.def.label, unit: t.def.pct ? "%" : t.def.unit || "", higher: t.def.higher !== false, dp: t.def.dp ?? 1,
      target: Math.round(t.ve * (t.def.pct ? 10 : 10 ** Math.min(2, t.def.dp ?? 1))) / (t.def.pct ? 10 : 10 ** Math.min(2, t.def.dp ?? 1)), measure: "round", when: "nextN", n: N_GOAL }
    : null);
  // (update 349) the drill's goal: the elite rounds' own value of the stat that fits it (that distance's, else the
  // whole round's), whether or not it moved, as long as there are enough attempts behind it
  // (update 454) the part of the game's own stat: at that distance; or, with no distance, the part of the game's stat
  // with no distance (a summary file), else any distance of it (a shot-by-shot file has every stat on a distance)
  const hasNoDist = (c) => elite.some((rd) => (rd.obs || []).some((o) => o.cat === c && !o.dist));
  const inScope = (exactOnly, c, d, o) => (exactOnly ? o.cat === c && (d ? o.dist === d : hasNoDistM(c) ? !o.dist : true) : !o.cat);
  const noDistMemo = new Map(), hasNoDistM = (c) => (noDistMemo.has(c) ? noDistMemo.get(c) : noDistMemo.set(c, hasNoDist(c)).get(c));
  const eliteStat = (c, d) => {
    for (const re of goalStatsFor(c, d)) for (const exactOnly of [true, false]) {
      let t0 = 0, w = 0, k = null;
      for (const rd of elite) for (const o of rd.obs || []) if (re.test(o.k) && inScope(exactOnly, c, d, o)) { t0 += o.v * o.w; w += o.w; k = o.k; }
      if (k && enough(statDef(k), w)) return { k, def: statDef(k), ve: t0 / w, exact: exactOnly };
    }
    return null;
  };
  // (update 371) the plain stat to aim at for a part of the game and distance: the first (that distance's, then the whole
  // round's) where their level's rounds were better than the last N, with enough attempts in both to compare
  const targetStat = (c, d) => {
    const res = [...goalStatsFor(c, d), ...(WHOLE[c] ? [WHOLE[c]] : [])];
    for (const re of res) for (const exactOnly of [true, false]) {
      const scope = (o) => re.test(o.k) && inScope(exactOnly, c, d, o);
      const mE = statAvg(elite, scope), mR = statAvg(recent, scope);
      for (const [k, a] of mE) {
        const def = statDef(k), b = mR.get(k);
        if (!b || def.higher == null || !okK(c, d, k) || !enough(def, a.w) || b.w < (def.pct ? 8 : 5)) continue;
        const ve = a.s / a.w, vr = b.s / b.w;
        if (def.higher !== false ? ve > vr + 1e-9 : ve < vr - 1e-9) return { k, def, ve, vr, w: b.w, exact: exactOnly };
      }
    }
    return null;
  };
  const itemOf = (g) => { // (update 370: any row of the Path table, opened)
    const t = target(g.c, g.d || null), d = g.d || null;
    const goal = statGoal(g.c, d, t) || { stat: "skill", cat: g.c, dist: d, target: Math.round(g.e * 100) / 100, measure: "round", when: "nextN", n: N_GOAL };
    // how much is playing it better, and how much is facing it more or less often (strategy, or the shot before)
    const sp = g.sp, share = g.g > 0 ? sp.skill / g.g : 0;
    const kind = share >= 0.6 ? "skill" : share <= 0.3 ? "mix" : "both";
    const fewer = sp.ae < sp.ab;
    const LN = `Last ${N} rounds`; // (update 361: the number of recent rounds, not "lately")
    // their usual level here, over every round in the time frame
    let uSg = 0, uN = 0; for (const [k, v] of bU) if (k.startsWith(`${g.k}|`)) { uSg += v.sg; uN += v.n; }
    const uRound = season.length ? uSg / season.length : 0, uAtt = season.length ? uN / season.length : 0;
    // (update 361) one fact per line
    const roundLines = [`${LN}: ${f2(g.r)}`, `${LvCap}: ${f2(g.e)}`, `Average: ${f2(uRound)}`,
      `Difference: ${sgn2(g.g)}${Math.abs(sp.mix) >= 0.01 ? ` (${sgn2(sp.skill)} from hitting it better, ${sgn2(sp.mix)} from ${fewer ? "fewer" : "more"} attempts)` : " (all from hitting it better)"}`];
    const shotLines = [`${LN}: ${sgn2(sp.pb)}`, `${LvCap}: ${sgn2(sp.pe)}`, `Average: ${sgn2(sp.pu)}`];
    const oftenLines = [`${LN}: ${sp.ab.toFixed(1)} attempts a round`, `${LvCap}: ${sp.ae.toFixed(1)} attempts`, `Average: ${uAtt.toFixed(1)} attempts`];
    // (update 358) what it means, in plain words
    const amt = (v) => Math.abs(v).toFixed(2), verb = (v) => (Math.abs(v) < 0.005 ? "break even" : v > 0 ? `gain ${amt(v)}` : `lose ${amt(v)}`);
    let take;
    if (kind === "mix") take = `They\u2019re not hitting these worse in the last ${N} rounds; they\u2019re facing ${fewer ? "fewer" : "more"} of them (${sp.ab.toFixed(1)} a round, against ${sp.ae.toFixed(1)} in their ${NN.kept}). ${MIX_CAUSE[g.c] || ""}`;
    else {
      take = `Over the last ${N} rounds they ${Math.abs(sp.pb) < 0.005 ? "break even here" : `${verb(sp.pb)} strokes a shot here`}; in their ${NN.kept} they ${verb(sp.pe)}. Getting back to that is worth about ${amt(g.g)} a round${Math.abs(sp.mix) >= 0.01 ? ` (${amt(sp.skill)} from playing these shots better, ${sp.mix > 0 ? "plus" : "less"} ${amt(sp.mix)} because their ${NN.kept} had ${sp.ae < sp.ab ? "fewer" : "more"} of them)` : ""}.`; // (update 386: the same number as the table's Diff)
      const weak = sp.pu <= -0.015; // (a weak spot: they usually lose at least 0.015 a shot here)
      if (sp.pb < sp.pu - 0.01) take += weak ? ` It\u2019s usually a weak spot (${sgn2(sp.pu)} a shot), and it\u2019s been worse lately.` : ` It\u2019s a recent slump: on average they ${verb(sp.pu)} a shot here.`;
      else if (weak) take += ` It\u2019s a long-standing weak spot (${sgn2(sp.pu)} a shot on average), not just a recent one.`;
      if (kind === "both") take += ` Part of it is facing ${fewer ? "fewer" : "more"} of these, which is more strategy than practice.`;
    }
    const strategy = kind === "skill" ? null : `${kind === "mix" ? "Mostly how often, not how well:" : "Partly how often:"} ${mixLead(sp)} in ${NN.kept}${sp.pu < 0 && fewer ? ` (they usually lose ${Math.abs(sp.pu).toFixed(2)} a shot here)` : sp.pu > 0 && !fewer ? ` (they usually gain ${sp.pu.toFixed(2)} a shot here)` : ""}. ${MIX_CAUSE[g.c] || ""}`;
    // (update 361) the target: the stat their level rounds had (the same one the drill and the goal use), against the
    // last N rounds, and what the difference means in makes
    // (update 371) the target is always a plain stat (fairways, distance, proximity, greens, up and downs, makes…),
    // never strokes gained: the one their level's rounds were better at than the last N rounds, the stat for that
    // distance first, else the whole round's. None better (or too few attempts to compare): no target.
    const tgt = targetStat(g.c, d);
    const es = tgt && goalStatsFor(g.c, d).some((re) => re.test(tgt.k)) ? tgt : eliteStat(g.c, d);
    const targetLines = (() => {
      if (!tgt) return null;
      const { def } = tgt, diff = Math.abs(tgt.ve - tgt.vr), up = def.higher !== false;
      const amtTxt = def.pct ? `${diff.toFixed(1)} ${Math.round(diff * 10) === 10 ? "point" : "points"}` : fmtStat({ ...def, pct: false }, diff);
      const head = `${up ? "Raise" : "Bring down"} ${def.label} by ${amtTxt}`;
      const lines = [head, `From ${fmtStat(def, tgt.vr)} over the last ${N} rounds to ${fmtStat(def, tgt.ve)} (their ${NN.kept})`];
      if (def.pct) { const extra = (diff / 100) * (tgt.w / recent.length); if (extra > 0.001) lines.push(extra >= 1 ? `That\u2019s about ${Math.round(extra)} more a round` : `That\u2019s 1 more every ${Math.max(1, Math.round(1 / extra))} ${Math.round(1 / extra) === 1 ? "round" : "rounds"}`); }
      return lines;
    })();
    const thinLately = false; // (update 369: shots they rarely face are already left out of the list)
    const goal2 = tgt ? statGoal(g.c, d, tgt) : es ? statGoal(g.c, d, { ...es, exact: es.exact }) : goal;
    return { head: `${catName(g.c)}${g.d ? ` \u00b7 ${g.d}` : ""}`, better: `${sgn2(g.g)} a round better in their ${NN.kept}`, roundLines, shotLines, oftenLines, strategy, take, targetLines: kind === "mix" ? null : targetLines,
      drills: kind === "mix" || thinLately ? [] : [{ drill: (() => { const dr = drillFor(g.c, d, es); if (dr) dr.from = NN.kept; return dr; })(), goal: goal2 }].filter((x) => x.drill) };
  };
  const prios = gaps.map(itemOf);
  // when elite rounds happen: after a week off, early or late in the event
  const evKey = (rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`;
  const starts = new Map(); for (const rd of season) { const k = evKey(rd); const d0 = String(rd.date || "").slice(0, 10); if (!starts.has(k) || d0 < starts.get(k).first) starts.set(k, { first: d0, last: d0 }); if (d0 > starts.get(k).last) starts.get(k).last = d0; }
  const evs = [...starts.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first));
  const rested = new Set(); evs.forEach(([k, v], i) => { if (i === 0) return; const gapDays = (Date.parse(v.first) - Date.parse(evs[i - 1][1].last)) / 86400000; if (gapDays >= 10) rested.add(k); });
  const share = (rs, f) => (rs.length ? rs.filter(f).length / rs.length : 0);
  const when = [];
  const rE = share(elite, (rd) => rested.has(evKey(rd))), rA = share(season, (rd) => rested.has(evKey(rd)));
  if (Math.abs(rE - rA) >= 0.15 && evs.length > 4) when.push(`${Math.round(rE * 100)}% of ${NN.kept} came after a week or more off, against ${Math.round(rA * 100)}% of all rounds${rE > rA ? ": rest seems to help" : ": they play their best when playing in a run of events"}.`);
  const early = (rd) => Number(rd.roundNo) === 1 || Number(rd.roundNo) === 2;
  const eE = share(elite, early), eA = share(season, early);
  if (Math.abs(eE - eA) >= 0.15) when.push(`${Math.round(eE * 100)}% of ${NN.kept} were Round 1 or 2, against ${Math.round(eA * 100)}% of all rounds${eE > eA ? ": they start well and fade, so weekend rounds are where to look" : ": they finish strong; the opening rounds are what to sharpen"}.`);
  // (update 342) where Practice is open: add a drill (or all of them) to the practice plan, with a goal for each
  const shown = there ? [] : prios.flatMap((p) => p.drills);
  const sig = (x) => `${S.me?.key}|${x.drill.kind}|${x.drill.dist || ""}|${x.drill.lie || ""}`;
  const canAdd = practiceOpen(S.me?.key); // (update 371: the admin, or a coach of this player with Allow coaching)
  const mineNow = isMine(S.me?.key);
  const whose = mineNow || !S.me?.label ? "your" : `${S.me.label}\u2019s`;
  const status = el("p", { class: "muted small bs-plan-status" });
  if (S.st.planMsg && S.st.planMsg.key === S.me?.key && Date.now() - S.st.planMsg.at < 120000) { const { n, g } = S.st.planMsg;
    mount(status, [`Added ${n} ${n === 1 ? "drill" : "drills"} to ${whose} practice plan${g ? ` and ${g} ${g === 1 ? "goal" : "goals"} to ${S.me?.label ? `${S.me.label}\u2019s` : "the"} Goals` : ""}. `,
      el("a", { href: mineNow ? "#/practice?tool=PLAN" : `#/practice?tool=PLAN&player=${encodeURIComponent(S.me?.key || "")}`, class: "link" }, "Open Practice \u2192")]); }
  // (update 387) which drills are really in the plan (one taken out in Practice can be added again): read now and then
  if (canAdd && S.me?.key) syncPlan(S.me.key, () => S.draw()); // (update 699: shared, and re-read after Practice deletes one)
  const add = (list, btns) => planEditor(list, whose, (edited) => send(edited, btns));
  const send = async (list, btns) => {
    btns.forEach((b) => { b.disabled = true; });
    try {
      const { addToPlan } = await import("./practice/plan.js");
      const n = await addToPlan(getState(), { items: list.map((x) => ({ ...x })), playerKey: S.me?.key, playerLabel: S.me?.label });
      list.forEach((x) => PLAN_ADDED.add(sig(x)));
      const g = list.filter((x) => x.goal).length;
      S.st.planMsg = { key: S.me?.key, n, g, at: Date.now() }; // (update 387: redrawn, with Remove under each one added)
      S.draw();
    } catch (err) { console.error(err); btns.forEach((b) => { b.disabled = false; }); mount(status, "Couldn\u2019t add that just now. Try again."); }
  };
  const rowBtns = [];
  function drillRow(x) {
    const line = kv("Practice", drillLine(x.drill), "bs-drill");
    if (!canAdd) return line;
    const on = PLAN_ADDED.has(sig(x));
    const b = el("button", { type: "button", class: `bs-plan-add${on ? " done" : ""}`, disabled: on }, on ? "\u2713 In practice plan" : "\uFF0B Add to practice plan");
    b.addEventListener("click", () => add([x], [b]));
    rowBtns.push({ b, x });
    // (update 387) and out again
    const rm = on ? el("button", { type: "button", class: "link small bs-plan-rm" }, "Remove from practice plan") : null;
    rm?.addEventListener("click", async () => {
      rm.disabled = true;
      try {
        const { removeFromPlan } = await import("./practice/plan.js");
        await removeFromPlan(getState(), { drill: x.drill, playerKey: S.me?.key });
        PLAN_ADDED.delete(sig(x)); PLAN_SEEN.at = 0; S.draw();
      } catch (err) { console.error(err); rm.disabled = false; mount(status, "Couldn\u2019t take that out just now. Try again."); }
    });
    return el("div", { class: "bs-drill-row" }, [line, el("div", { class: "bs-plan-btns" }, [b, rm])]);
  }
  const addAll = canAdd && shown.length > 1 ? (() => { const b = el("button", { type: "button", class: "btn ghost small bs-plan-all" }, "\uFF0B Add all to practice plan");
    b.addEventListener("click", () => { const left = shown.filter((x) => !PLAN_ADDED.has(sig(x))); if (!left.length) return; add(left, [b, ...rowBtns.filter((r) => left.some((x) => sig(x) === sig(r.x))).map((r) => r.b)]); }); return b; })() : null;
  const nIn = el("input", { type: "number", class: "peak-len", min: "3", max: "200", step: "1", value: String(N), inputmode: "numeric", "aria-label": "How many recent rounds to compare" });
  const setN = () => { const v = Math.round(Number(nIn.value)); if (Number.isFinite(v) && v >= 3) { S.st.recentN = v; S.draw(); } else nIn.value = String(N); };
  nIn.addEventListener("change", setN); nIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nIn.blur(); } });
  // which level to aim at: the next one up to start (from where they sit now), or any level they reach in some rounds
  const lvPick = lv ? (() => {
    const sel = el("select", { class: "bs-lv-pick", "aria-label": "Which level next" }, [...lv.reach].sort((a, b) => b.target - a.target).map((r) =>
      el("option", { value: String(r.target), selected: r.target === lv.T }, `${LEVELS[r.target]} (#${r.target})${r.target === lv.nextUp ? " \u00b7 next step" : ""}`)));
    sel.addEventListener("change", () => { S.st.pathT = Number(sel.value); S.draw(); });
    return el("label", { class: "bs-lv-row" }, [el("span", { class: "muted small" }, `Now ${S.ordinal(lv.rank)} on the season${lv.formRank ? `, a #${lv.formRank} level over the last ${N}` : ""}. Aim for:`), sel]);
  })() : null;
  // (update 370) the path as a table: the last N rounds against the level's rounds, a round, for SG: Total, each part
  // of the game (tap to open its distances) and each distance (tap to see the takeaway, target and practice)
  function pathTable() {
    const lvHead = best ? "The best" : rest ? "The rest" : lv ? `\u201c${LEVELS[lv.T]}\u201d` : "Best rounds";
    const lvShort = best ? "The best" : rest ? "The rest" : lv ? ({ 1: "Best on Tour", 10: "Contender", 25: "Tour Champ.", 50: "Signature" }[lv.T] || LEVELS[lv.T]) : "Best";
    const rowOf = (match) => { const sp = groupSplit(bE, elite.length, bR, recent.length, match, bU); return { sp, r: sp.ab * sp.pb, e: sp.ae * sp.pe, g: sp.total }; };
    const topIdx = new Map(gaps.map((x, i) => [x.k, i + 1]));
    const cats = CATEGORIES.map(([c]) => c).filter((c) => [...keys].some((k) => k.startsWith(`${c}|`)));
    const catRows = cats.map((c) => ({ c, ...rowOf((x) => x.startsWith(`${c}|`)) }));
    const openCats = new Set(S.st.pathCats || []);
    const bgOf = (d, max) => { if (d == null || Math.abs(d) < 0.005 || !(max > 0)) return "color:#fff"; const t = Math.min(1, Math.abs(d) / max); return `color:#fff;background:rgba(${d > 0 ? "48,209,88" : "255,69,58"},${(0.05 + 0.4 * t * t).toFixed(3)})`; };
    const maxOf = (rs) => Math.max(0, ...rs.map((x) => Math.abs(x.g)));
    // (update 467) the what-if changes picked show in Last N and Diff: a distance's own change, a part of the game's its
    // distances' added up, the total every one of them
    const cells = (x, max, bold = false, wi = 0) => { const r = x.r + wi, g = x.g - wi, adj = Math.abs(wi) > 1e-9;
      return [el("td", { class: `num${adj ? " bs-wi-adj" : ""}`, title: adj ? `${f2(x.r)} now, ${f2(wi)} with the what-if` : null }, f2(r)), el("td", { class: `num${bold ? " strong" : ""}` }, f2(x.e)), el("td", { class: `num bs-diff${adj ? " bs-wi-adj" : ""}`, style: bgOf(-g, max) }, f2(-g))]; }; // (update 371: last N less the level: red where they're behind)
    const tapRow = (cls, open, onTap, label, rest) => {
      const tr = el("tr", { class: `sg-tap ${cls}`, role: "button", tabindex: "0", "aria-expanded": String(open) }, [el("td", {}, label), ...rest]);
      tr.addEventListener("click", onTap); tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTap(); } });
      return tr;
    };
    // (update 455) What-if: a change a round at any distance (typed, or Reach target: the difference to the other column),
    // all of them added up into the last N rounds' total, and where that total would rank on the season
    const WI = S.st.pathWI && S.st.pathWI.cat === (cat || "") ? S.st.pathWI.d : {};
    const setWI = (k, v) => { const d = { ...WI }; if (v == null || Math.abs(v) < 0.0005) delete d[k]; else d[k] = Math.round(v * 1000) / 1000; S.st.pathWI = { cat: cat || "", d }; S.draw(); };
    const fmtCh = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
    const wiChip = (k) => (WI[k] ? el("span", { class: `bs-wi-chip ${WI[k] > 0 ? "pos" : "neg"}`, title: "What-if change" }, fmtCh(WI[k])) : null);
    const whatIfBox = (g) => {
      const cur = WI[g.k] || 0;
      const inp = el("input", { type: "text", inputmode: "decimal", class: "hy-in bs-wi-in", value: cur ? fmtCh(cur).replace("\u2212", "-") : "", placeholder: "+0.25", "aria-label": `What-if change a round for ${catName(g.c)} ${g.d || ""}` });
      const parse = () => { const t = String(inp.value).trim().replace(/[\u2212\u2013]/g, "-").replace(/^\+/, ""); if (t === "") return 0; const v = Number(t.startsWith(".") || t.startsWith("-.") ? t.replace(".", "0.") : t); return Number.isFinite(v) ? v : null; };
      let done = false; // (once: Enter redraws the page, and the box going away fires change again)
      const commit = () => { if (done) return; const v = parse(); if (v == null) { inp.value = cur ? fmtCh(cur) : ""; return; } if (Math.abs(v - cur) > 1e-9) { done = true; setTimeout(() => setWI(g.k, v), 0); } };
      for (const ev of ["click", "pointerdown"]) inp.addEventListener(ev, (e) => e.stopPropagation());
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } });
      inp.addEventListener("change", commit);
      const gap = Math.round(g.g * 100) / 100;
      const reachB = gap > 0 ? (() => { const b = el("button", { type: "button", class: "bs-wi-btn" }, `Reach target (${fmtCh(gap)})`); b.addEventListener("click", (e) => { e.stopPropagation(); setWI(g.k, gap); }); return b; })() : null;
      const clr = cur ? (() => { const b = el("button", { type: "button", class: "link small" }, "Clear"); b.addEventListener("click", (e) => { e.stopPropagation(); setWI(g.k, null); }); return b; })() : null;
      return kv("What-if", el("div", { class: "bs-wi" }, [
        el("label", { class: "bs-wi-row" }, [el("span", {}, "Change a round"), inp]), reachB, clr]), "bs-whatif"); // (update 467: no explanation line)
    };
    const hypoLine = () => {
      const ks = Object.keys(WI); if (!ks.length) return null;
      const sum = ks.reduce((t, k) => t + WI[k], 0), base = rAvg ?? 0, tot = base + sum;
      const list = S.st.pathWIOpen !== false; // (update 467: open to start)
      const head = rk ? ["Hypothetical season rank: ", el("strong", {}, `${S.ordinal(rk.rankOf(tot))} of ${rk.of}`)]
        : ["Hypothetical: ", el("strong", {}, fmtCh(tot))];
      const b = el("button", { type: "button", class: "bs-wi-rank", "aria-expanded": String(!!list), title: "Show every change" }, [el("span", { class: "cmp-caret" }, list ? "\u25BE " : "\u25B8 "), ...head]);
      b.addEventListener("click", () => { S.st.pathWIOpen = !list; S.draw(); });
      // (update 467) every distance made better: its drill and goal, all at once (the same as each one's own button)
      const allPlan = canAdd ? (() => {
        const items = ks.filter((k) => WI[k] > 0).flatMap((k) => { const [c, d] = k.split("|"); const g = { k, c, d, ...rowOf((x) => x.startsWith(`${k}|`)) }; try { return itemOf(g).drills; } catch { return []; } });
        const left = items.filter((x) => !PLAN_ADDED.has(sig(x)));
        if (!items.length) return null;
        const btn = el("button", { type: "button", class: "bs-wi-btn bs-wi-all", disabled: !left.length }, left.length ? `\uFF0B Add all to practice (${left.length})` : "\u2713 All in the practice plan");
        btn.addEventListener("click", () => { if (left.length) add(left, [btn]); });
        return btn;
      })() : null;
      const reset = el("button", { type: "button", class: "link small" }, "Reset"); reset.addEventListener("click", () => { S.st.pathWI = null; S.draw(); });
      const nm = (k) => { const [c, d] = k.split("|"); return `${catName(c)} \u00b7 ${d || "Other shots"}`; };
      return el("div", { class: "bs-wi-head" }, [
        el("div", { class: "bs-wi-top" }, [b, reset]),
        rk ? el("p", { class: "bs-wi-now muted" }, `The last ${N} rounds now: ${S.ordinal(rk.rankOf(base))}`) : null,
        list ? el("ul", { class: "bs-wi-list" }, [
          ...ks.sort((a, b2) => WI[b2] - WI[a]).map((k) => el("li", {}, [nm(k), ": ", el("strong", { class: WI[k] >= 0 ? "pos" : "neg" }, `${fmtCh(WI[k])} a round`)])),
          el("li", { class: "bs-wi-tot" }, [`${cat ? catName(cat) : "SG: Total"}: ${fmtCh(base)} \u2192 `, el("strong", { class: tot >= 0 ? "pos" : "neg" }, fmtCh(tot)), ` (${fmtCh(sum)} in all)`])]) : null,
        allPlan ? el("div", { class: "bs-wi-foot" }, allPlan) : null]);
    };
    const badge = (k) => (topIdx.has(k) ? el("span", { class: "bs-top-b", title: `Number ${topIdx.get(k)} of the biggest gaps` }, `#${topIdx.get(k)}`) : null);
    const detail = (g) => {
      const sp = g.sp;
      if (g.g <= 0.005) return [el("p", { class: "muted small" }, `Their last ${N} rounds are as good as their ${NN.kept} here, or better.`), whatIfBox(g)];
      if (sp.ab < 0.5) return [whatIfBox(g), el("p", { class: "muted small" }, `They\u2019ve faced this less than once every two rounds over the last ${N} (${sp.ab.toFixed(1)} a round), so it isn\u2019t worth practising for now.`)];
      const p = itemOf(g);
      // (update 455) the takeaway gives way to the what-if: a change typed in, or Reach target (the difference)
      return [whatIfBox(g), ...(p.targetLines ? [kv("Target", p.targetLines.map((x, k) => el("div", { class: k ? "bs-tl" : "bs-th" }, x)), "bs-target")] : []), ...p.drills.map(drillRow)];
    };
    const wiSum = (pre = "") => Object.entries(WI).reduce((t, [k, v]) => t + (!pre || k.startsWith(pre) ? v : 0), 0);
    const body = [el("tr", { class: "bs-path-total" }, [el("td", {}, cat ? `${catName(cat)}` : "SG: Total"), ...cells({ r: rAvg ?? 0, e: eAvg ?? 0, g: (eAvg ?? 0) - (rAvg ?? 0) }, Math.max(0.5, Math.abs((eAvg ?? 0) - (rAvg ?? 0))), true, wiSum())])];
    const cMax = maxOf(catRows);
    for (const cr of catRows) {
      const open = openCats.has(cr.c);
      const nTop = [...topIdx.keys()].filter((k) => k.startsWith(`${cr.c}|`)).length;
      body.push(tapRow("cmp-sub", open, () => { const a = new Set(S.st.pathCats || []); a.has(cr.c) ? a.delete(cr.c) : a.add(cr.c); S.st.pathCats = [...a]; S.draw(); },
        [el("span", { class: "sg-exp", "aria-hidden": "true" }, open ? "\u25BE " : "\u25B8 "), catName(cr.c), ...(!open ? [...topIdx].filter(([k]) => k.startsWith(`${cr.c}|`)).map(([, i]) => i).sort((x, y) => x - y).map((i) => el("span", { class: "bs-top-b", title: `Number ${i} of the ${gaps.length} biggest gaps` }, `#${i}`)) : [])], cells(cr, cMax, false, wiSum(`${cr.c}|`))));
      if (!open) continue;
      const ds = [...keys].filter((k) => k.startsWith(`${cr.c}|`)).map((k) => { const d = k.split("|")[1]; return { k, c: cr.c, d, ...rowOf((x) => x.startsWith(`${k}|`)) }; })
        .sort((a, b) => (a.d ? distLead(a.d) : 1e9) - (b.d ? distLead(b.d) : 1e9) || String(a.d).localeCompare(String(b.d)));
      const dMax = maxOf(ds);
      for (const g of ds) {
        const on = S.st.pathRow === g.k;
        body.push(tapRow("cmp-sub cmp-deep", on, () => { S.st.pathRow = on ? null : g.k; S.draw(); }, [g.d || "Other shots", badge(g.k), wiChip(g.k)], cells(g, dMax, false, WI[g.k] || 0)));
        if (on) body.push(el("tr", { class: "bs-path-det" }, el("td", { colspan: 4 }, detail(g))));
      }
    }
    return el("div", { class: "bs-path-tw" }, [
      hypoLine(),
      infoTip(`${lv ? `${lvHead} rounds: their best ${elite.length}, which together reach ${LEVELS[lv.T]}. ` : ""}Each row is strokes gained a round: the last ${N} rounds, the level\u2019s rounds, and the difference: the last ${N} less the level\u2019s rounds (red: behind the level there, so there\u2019s something to gain; green: already ahead). #1 to #${gaps.length || 5} mark the biggest gaps. Tap a part of the game for its distances, and a distance for the takeaway, target and practice.`),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-full-t bs-path-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num bs-lastn" }, ["Last ", nIn]), el("th", { class: "num", title: best ? `Their best stretch: ${elite.length} rounds in a row` : rest ? `Their other ${season.length - N} rounds` : `${lvHead} rounds` }, lvShort), el("th", { class: "num" }, "Diff")])),
        el("tbody", {}, body)])),
    ]);
  }
  // (update 442) always open, right under the best-stretch line: just the table (and when the kept rounds happen)
  return el("div", { class: "bs-path bs-path-flat" }, [
    pathTable(),
    when.length ? el("p", { class: "bs-sub bs-sub2" }, `When the ${NN.kept} happen`) : null,
    when.length ? el("ul", { class: "bs-list" }, when.map((t) => el("li", {}, t))) : null,
    canAdd ? status : null,
  ]);
}
