// (update 815) Practice Week; (update 820) Recommended Practice: practice built from a player's current form and the event
// they're preparing for, ready to send to their practice (Custom Practice). Current form: the last 12 rounds (the DP World
// Tour: the last 3 events), each of the data's distance ranges with 10+ shots in them, strokes gained per round. The event:
// the next one by default, or any tournament picked (kept for the player on this device), and its room to gain in each
// part of the game (Course Fit: how far the field spreads out in it there against a normal week). A range's stake = what
// it's costing per round lately × the room to gain in its part there; a course in Strategy Maps adds the range that decides
// it when they're short of the top 10's level there. Most at stake first, then one strength to keep sharp; each 10 shots ×
// 3 sets with the practice page's own target. Underneath: is the practice working?
import { el, mount } from "../ui.js";
const theE = (n) => (/^the\s/i.test(String(n || "")) ? n : `the ${n}`); // (update 820: "The American Express", not "the The …")
import * as PI from "../playerInsights.js";
import { clearDiff } from "../defs.js";
import { whoCanBePicked, startKey, card, samp, sg2, sg3, cls } from "./insightPages.js";
import { lastName, onCurrent } from "../current.js";
import { statDef, fmtStat } from "../sg.js";

const AREA = { OTT: "Off the tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" };
const noun = (c) => (c === "PUTT" ? "putts" : c === "ARG" ? "chips and pitches" : "approaches");
const what = (c) => (c === "PUTT" ? "Putts" : c === "ARG" ? "Chips and pitches" : "Approaches");

export async function render(main, { previewClient = null, key: key0 = null, label: label0 = null } = {}) { // (update 817: Stats' Practice & Goals tab hands over its player)
  const wrap = el("div", { class: "ip" }, el("p", { class: "muted" }, "Loading…")); mount(main, wrap);
  const who = await whoCanBePicked(previewClient);
  if (key0 && label0 && !who.labels.has(key0)) who.labels.set(key0, label0);
  let key = key0 || startKey(who), size = 4, alive = true;
  window.addEventListener("hashchange", () => { alive = false; }, { once: true });
  const fieldP = PI.loadField(who.state).catch(() => ({ field: [] })),
    // (update 884) every player's rounds with their stats by distance (the tour's thresholds for each range)
    detailP = fieldP.then((f) => (f?.ds ? import("../fieldStore.js").then((m) => m.getFieldDetail(f.ds.id, f.ds.uploadedAt?.toMillis?.() ?? 0)) : null)).catch(() => null), heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).catch(() => []);
  const [PS, PL] = await Promise.all([import("./practiceSimple.js"), import("../practice/plan.js")]);

  async function draw() {
    if (!alive) return;
    if (!key) { mount(wrap, [el("h2", { class: "ip-h" }, "Recommended Practice"), el("p", { class: "muted" }, "Pick a player at the top of the page.")]); return; }
    const name = who.labels.get(key) || key.replace(/^c_/, ""), self = PI.isSelfKey(key) || who.self === key, last = self ? "You" : lastName(name); // (update 834: "your" on your own)
    const possT = self ? "Your" : `${last}\u2019${/s$/i.test(last) ? "" : "s"}`, possN = self ? "your" : possT; // (update 954: the player's name, not they or their)
    mount(wrap, [el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted ip-wait" }, "Building the week from the data…")]);
    const [{ field }, rounds] = await Promise.all([fieldP, PI.loadShots(key, name)]); if (!alive) return;
    if (!rounds.length) { mount(wrap, [el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted" }, `No shot-by-shot rounds on record for ${name}.`)]); return; }
    const tours = [...new Set(rounds.map((r) => r.tour).filter(Boolean))], tour = [...tours].sort((a, b) => rounds.filter((r) => r.tour === b).length - rounds.filter((r) => r.tour === a).length)[0] || null;
    // (update 884) no tour data ("Me": rounds entered by hand, no tour events): the same picks, without the tournament ones
    const noTour = !rounds.some((r) => !r.entered && r.tour && r.tour !== "Practice");
    const year = [...new Set(rounds.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1), P = PI.profile(rounds, { year, tour, field, key });
    // (update 820) the event they're preparing for: the next one, or the one picked (kept per player on this device)
    const { evs: EV } = PI.eventRoom(field, tour), names = EV.map((e) => e.name).sort((a, b) => a.localeCompare(b));
    // (update 823) the schedule's next event on their tour, or the one picked here or with Overview's Change (shared)
    const nx = await PI.nextEventFor(key, tour, names, name), evPick = nx.name, stName = evPick ? PI.matchEventName(evPick, names) : null;
    const E0 = EV.find((e) => e.name === stName) || null, E = E0 ? { ...E0, name: evPick } : null, room = (c) => (E ? E.room[c] : 1);
    const heat = await heatP, meta = PI.heatCourseFor(heat, nx);
    const C = meta ? await PI.loadCourse(meta, [P.rs]).catch(() => null) : null; if (!alive) return;
    const fit = C ? PI.fitFor(P, C, key, name) : null, courseR = fit?.key3.find((x) => x.c !== "OTT" && x.top != null && (x.me == null || x.me < x.top));
    // current form: each range over the last 12 rounds (the DP World Tour: 3 events), strokes gained per round
    const F = P.form, formRs = F?.last || P.rs.slice(-12), nF = Math.max(1, formRs.length), fm = new Map();
    for (const r of formRs) for (const sh of r.shots || []) { if (!sh.dist || sh.cat === "OTT") continue; const k = `${sh.cat}|${sh.dist}`, o = fm.get(k) || fm.set(k, { c: sh.cat, d: sh.dist, sg: 0, n: 0 }).get(k); o.sg += sh.sg || 0; o.n += sh.w || 1; }
    const formR = [...fm.values()].filter((o) => o.n >= 10).map((o) => ({ ...o, rd: o.sg / nF, shot: o.sg / o.n }));
    const fl = F?.lbl || `${nF} rounds`, roomT = (c) => (E ? `, and ${PI.CATN[c].toLowerCase()} ${Math.abs(room(c) - 1) < 0.03 ? "matters about as much as usual" : `is ${room(c).toFixed(2)}× as impactful as usual`} at ${theE(E.name).trim()}` : ""); // (update 838: plain words)
    // (update 882) five picks, each for its own reason: (1) a range they've struggled with all season, (2) a different one
    // they're struggling with lately, (3, 4) two for the tournament picked (what it takes to win there, or a range that has
    // cost them there in past years), (5) a range they're doing really well in lately. Each can be ticked to add to practice.
    const agg = (rs, minN) => { const m = new Map(), n = Math.max(1, rs.length); for (const r of rs) for (const sh of r.shots || []) { if (!sh.dist || sh.cat === "OTT") continue; const k = `${sh.cat}|${sh.dist}`, o = m.get(k) || m.set(k, { c: sh.cat, d: sh.dist, sg: 0, n: 0 }).get(k); o.sg += sh.sg || 0; o.n += sh.w || 1; }
      return [...m.values()].filter((o) => o.n >= minN).map((o) => ({ ...o, rd: o.sg / n, shot: o.sg / o.n })); };
    const seasonR = agg(P.rs, 20), used = new Set(), K = (o) => `${o.c}|${o.d}`, free = (o) => o && !used.has(K(o)), plan = [], take = (o) => { if (!o) return; used.add(K(o)); plan.push(o); };
    // 1. all season
    const s1 = [...seasonR].filter((o) => o.rd < 0).sort((a, b) => a.rd - b.rd)[0];
    if (s1) take({ c: s1.c, d: s1.d, tone: "neg", tag: `All season`, why: `${possT} biggest leak in ${year}: ${Math.abs(s1.rd).toFixed(2)} strokes lost per round (${sg3(s1.shot)} a shot, ${Math.round(s1.n)} shots over ${P.rs.length} rounds)` });
    // 2. lately (a different range)
    const s2 = [...formR].filter((o) => o.rd < 0 && free(o)).sort((a, b) => a.rd - b.rd)[0];
    if (s2) { const sea = seasonR.find((x) => K(x) === K(s2)); take({ c: s2.c, d: s2.d, tone: "late", tag: "Lately", why: `Costing ${Math.abs(s2.rd).toFixed(2)} strokes per round over the last ${fl} (${sg3(s2.shot)} a shot, ${Math.round(s2.n)} shots)${sea ? `, against ${sg2(sea.rd)} per round over the season` : ""}` }); }
    // (update 883) trending down: the range that dropped the most from the 12 rounds before to the last 12 (the DP World
    // Tour: 3 events against the 3 before), strokes gained per round in each window (8+ shots in each)
    if (F?.last?.length && F?.prev?.length) { const before = new Map(agg(F.prev, 8).map((o) => [K(o), o]));
      const tr = agg(F.last, 8).map((o) => ({ ...o, b: before.get(K(o)) })).filter((o) => o.b && free(o)).map((o) => ({ ...o, dd: o.rd - o.b.rd })).filter((o) => o.dd < -0.03).sort((a, b) => a.dd - b.dd)[0];
      if (tr) take({ c: tr.c, d: tr.d, tone: "trend", tag: "Trending down", why: `Down ${Math.abs(tr.dd).toFixed(2)} strokes per round: ${sg2(tr.rd)} per round over the last ${fl}, against ${sg2(tr.b.rd)} over the ${F.lbl || "rounds"} before (${Math.round(tr.n)} and ${Math.round(tr.b.n)} shots)` }); }
    // 3, 4. the tournament: (a) a range that has cost them at this event in past years, (b) what decides it on the course,
    // (c) their weakest range in the part of the game that matters most there (Course Fit's room to gain)
    const evTag = E ? `For ${E.name}` : "For the event", evRounds = stName ? P.all.filter((rd) => PI.evName(rd.event) === stName) : [], evPicks = [];
    if (noTour) evRounds.length = 0;
    if (evRounds.length >= 2) { const hereR = agg(evRounds, 6), norm = new Map(agg(P.all, 20).map((o) => [K(o), o]));
      const past = hereR.map((o) => ({ ...o, vs: o.shot - (norm.get(K(o))?.shot ?? 0) })).filter((o) => o.rd < 0 && free(o)).sort((a, b) => a.rd - b.rd)[0];
      if (past) evPicks.push({ c: past.c, d: past.d, tone: "event", tag: evTag, why: `It has cost ${self ? "you" : last} here: ${Math.abs(past.rd).toFixed(2)} strokes per round in ${evRounds.length} rounds at ${theE(stName)} (${sg3(past.shot)} a shot${past.vs < -0.005 ? `, ${Math.abs(past.vs).toFixed(3)} worse than ${possN} usual from there` : ""})` }); }
    if (!noTour && courseR && free({ c: courseR.c, d: courseR.l }) && evPicks.length < 2) evPicks.push({ c: courseR.c, d: courseR.l, tone: "event", tag: evTag, why: `What wins ${meta.name}: ${courseR.att.toFixed(1)} ${noun(courseR.c)} per round from here; ${last} ${courseR.me == null ? (self ? "have too few shots on record" : "has too few shots on record") : `${sg3(courseR.me)} strokes gained a shot`} against the top 10's ${sg3(courseR.top)} there` });
    if (E && !noTour) for (const c of ["APP", "ARG", "PUTT"].sort((a, b) => room(b) - room(a))) { if (evPicks.length >= 2) break;
      const w = [...seasonR, ...formR].filter((o) => o.c === c && free(o) && !evPicks.some((x) => K(x) === K(o))).sort((a, b) => a.rd - b.rd)[0]; if (!w) continue;
      evPicks.push({ c: w.c, d: w.d, tone: "event", tag: evTag, why: `${PI.CATN[c]} ${Math.abs(room(c) - 1) < 0.03 ? "matters about as much as usual" : room(c) > 1 ? `is ${room(c).toFixed(2)}\u00d7 as impactful as usual` : `matters less than usual (${room(c).toFixed(2)}\u00d7)`} at ${theE(E.name)}, and this is ${possN} ${w.rd < 0 ? `weakest range in it (${sg2(w.rd)} per round)` : `least strong range in it (${sg2(w.rd)} per round)`}` }); }
    for (const x of evPicks.slice(0, 2)) take(x);
    // 5. doing really well lately
    const s5 = [...formR].filter((o) => o.rd > 0 && free(o)).sort((a, b) => b.rd - a.rd)[0];
    if (s5) take({ c: s5.c, d: s5.d, tone: "pos", tag: "Keep it sharp", why: `${possT} best lately: +${s5.rd.toFixed(2)} strokes gained per round over the last ${fl} (${Math.round(s5.n)} shots)${E && room(s5.c) > 1.03 ? `, and ${PI.CATN[s5.c].toLowerCase()} is ${room(s5.c).toFixed(2)}\u00d7 as impactful as usual at ${theE(E.name)}` : ""}` });
    // the choices: what's coming up on the schedule, then any tournament on record
    const SO = await PI.scheduleOrder(names, tour); // (update 836: the record in the schedule's order)
    const up = nx.upcoming.map((e) => e.name), opts = [...new Set([...up, ...names])], fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
    const evSel = opts.length && !noTour ? (() => { const og = (lbl, xs, f) => (xs.length ? el("optgroup", { label: lbl }, xs.map((n) => el("option", { value: n }, f(n)))) : null);
      const sel = el("select", { class: "ip-sel", "aria-label": "Preparing for" }, [el("option", { value: "" }, up[0] ? `Next on the schedule (${up[0]})` : "The next event"), og("Coming up", up, (n) => { const e = nx.upcoming.find((x) => x.name === n); return `${n}${e?.start ? ` · ${fmt(e.start)}` : ""}`; }), og("Any tournament on record (schedule order)", SO.on.map((o) => o.name).filter((n) => !up.includes(n)), (n) => n), og("Not on the current schedule", SO.off.filter((n) => !up.includes(n)), (n) => n)]);
      sel.value = PI.pickedNext(key) || ""; sel.addEventListener("change", () => { PI.setPickedNext(key, sel.value || null); draw(); }); return el("label", { class: "rp-ev" }, [el("span", {}, "Preparing for"), sel]); })() : null;
    // (update 884) each session's target from the data: the range's own stat (Made Putt % from 5-10 ft, Good Lag %, Proximity …),
    // where they are on it, and the tour's levels this season (average, top 25, top 10 among players with enough attempts);
    // the target is the next level up they haven't reached, turned into a set of 10
    const det = await detailP; if (!alive) return;
    // (no tour data: against the tour's latest season, every tour)
    const dYrs = noTour ? [...new Set((det?.players || []).flatMap((pl) => (pl.rounds || []).map(PI.yrOf)))].sort() : [], SY = noTour ? (dYrs.includes(String(year)) ? String(year) : dYrs.at(-1)) : String(year);
    const onT = (r) => (noTour || !tour || r.tour === tour) && PI.yrOf(r) === SY && !r.eventLevel;
    const statOf = (rs, c, d) => { for (const re of PL.goalStatsFor(c, d)) { const m = new Map(); for (const r of rs) for (const o of r.obs || []) if (re.test(o.k) && o.cat === c && o.dist === d) { const a = m.get(o.k) || m.set(o.k, [0, 0]).get(o.k); a[0] += o.v * o.w; a[1] += o.w; }
        const best = [...m].sort((a, b) => b[1][1] - a[1][1])[0]; if (best) return { k: best[0], v: best[1][0] / best[1][1], w: best[1][1] }; } return null; };
    const fieldOf = (c, d, k, def) => { if (!det?.players?.length) return null; const need = def.pct ? 15 : 10, vs = [];
      for (const pl of det.players) { if (pl.key === key) continue; let s0 = 0, w = 0; for (const r of pl.rounds || []) { if (!onT(r)) continue; for (const o of r.obs || []) if (o.k === k && o.cat === c && o.dist === d) { s0 += o.v * o.w; w += o.w; } } if (w >= need) vs.push(s0 / w); }
      if (vs.length < 20) return null; const up = def.higher !== false; vs.sort((a, b) => (up ? b - a : a - b));
      const mid = Math.floor(vs.length / 2); // (top 25 / top 10 only where they're above the middle player: a small field has no top 25)
      return { n: vs.length, avg: vs[mid], t25: 24 < mid ? vs[24] : null, t10: 9 < mid ? vs[9] : null, up }; };
    // (update 954) every stat the range could be judged on, in order (putts from 20-25 ft: Good Lag %, else Made Putt %): the
    // first one with both the player's number and the tour's; it had stopped at the first, so a range whose file keeps the other
    // said "No tour numbers for this range"
    const statsOf = (rs, c, d) => { const out = []; for (const re of [...PL.goalStatsFor(c, d), ...(c === "PUTT" ? [/^make$/, /^goodLag$/] : [])]) { const m = new Map(); for (const r of rs) for (const o of r.obs || []) if (re.test(o.k) && o.cat === c && o.dist === d) { const a = m.get(o.k) || m.set(o.k, [0, 0]).get(o.k); a[0] += o.v * o.w; a[1] += o.w; }
        for (const [k, a] of [...m].sort((x, y) => y[1][1] - x[1][1])) if (!out.some((o) => o.k === k)) out.push({ k, v: a[0] / a[1], w: a[1] }); } return out; };
    const thrOf = (p) => { const rs = ["late", "trend", "pos"].includes(p.tone) ? (F?.last || P.rs.slice(-12)) : P.rs;
      let me = null, def = null, T = null;
      for (const cand of [...statsOf(rs, p.c, p.d), ...statsOf(P.rs, p.c, p.d)]) { const d0 = statDef(cand.k), t0 = fieldOf(p.c, p.d, cand.k, d0); if (t0) { me = cand; def = d0; T = t0; break; } }
      if (!me) return null;
      const better = (a, b) => (T.up ? a > b + 1e-9 : a < b - 1e-9), steps = [["the tour average", T.avg], ["top 25 on tour", T.t25], ["top 10 on tour", T.t10]].filter((x) => x[1] != null);
      // (update 954) a level they're nearly at (within 2 points of a %, or 4% of a distance) is no target: the next one up
      const near = (v) => Math.abs(me.v - v) <= (def.pct ? 2 : 0.04 * Math.abs(v));
      let i = steps.findIndex(([, v]) => !better(me.v, v) && Math.abs(me.v - v) > 1e-9);
      while (i >= 0 && i < steps.length - 1 && near(steps[i][1])) i++;
      const nxt = i >= 0 ? steps[i] : [`${steps.at(-1)[0]} (hold it)`, steps.at(-1)[1]];
      return { k: me.k, def, me: me.v, meW: me.w, T, aim: nxt[1], aimL: nxt[0], win: rs === P.rs ? `${year}` : `last ${fl}` }; };
    void size; const week = plan.map((p, i) => { const label = `${AREA[p.c]} · ${p.d}`, thr = thrOf(p), kind = ({ make: "make", goodLag: "lag", prox: "prox", hitGreen: "green", gir: "green", fwy: "fairway" })[thr?.k] || PS.TARGET_KIND(p.c, label);
      // the set of 10: a % stat → that many of 10 (rounded up so it's at least the level); proximity → inside that many feet
      let goal = PS.TARGET_DEF(kind, label), fromData = false;
      if (thr) { if (thr.def.pct && kind !== "prox") { goal = Math.max(1, Math.min(10, Math.ceil(thr.aim / 10 - 1e-9))); fromData = true; } else if (!thr.def.pct && kind === "prox") { goal = Math.max(1, Math.floor(thr.aim)); fromData = true; } }
      const thrTxt = thr ? `${thr.def.label} from ${p.d}: ${self ? "you" : last} ${fmtStat(thr.def, thr.me)} (${thr.win}) \u00b7 tour average ${fmtStat(thr.def, thr.T.avg)}${thr.T.t25 != null ? ` \u00b7 top 25 ${fmtStat(thr.def, thr.T.t25)}` : ""}${thr.T.t10 != null ? ` \u00b7 top 10 ${fmtStat(thr.def, thr.T.t10)}` : ""}. Aim: ${thr.aimL}, ${fmtStat(thr.def, thr.aim)}${fromData ? "" : " (the set's target below is a rule of thumb)"}` : "No tour numbers for this range yet: the set's target is a rule of thumb";
      return { ...p, n: i + 1, label, thrTxt, item: { key: `${p.c}|${p.d}`, cat: p.c, label, mode: "sets", shots: 10, sets: 3, minutes: 15, setsDone: 0, secs: 0, done: false, target: { kind, goal, reps: 10, cat: p.c, unit: kind === "prox" ? "ft" : null, ...(thr && fromData ? { src: `${thr.aimL}: ${fmtStat(thr.def, thr.aim)}` } : {}) } },
        target: PL.goalText({ kind, goal, reps: 10, unit: kind === "prox" ? "ft" : null, cat: p.c }) }; });
    const toneC = { neg: "#ff453a", late: "#ff9f0a", trend: "#bf5af2", event: "#64d2ff", course: "#64d2ff", pos: "#30d158" };
    const picked = new Set(week.map((w) => w.n)); // (update 882) every pick ticked to start
    const sizeT = null; // (update 882: no session count: tick the ones to add)
    const msg = el("span", { class: "muted small" }), send = el("button", { type: "button", class: "ip-btn" }, who.self || self ? "Add the ticked ones to my practice" : `Send the ticked ones to ${last}`);
    // (update 954) sending practice to a player: only with Coaching ticked on User Access (and the admin); a player adds their own
    { const own = !!(who.self || self), ok = () => own || !!who.state?.isAdmin || !!window.__taCoach; send.hidden = !ok();
      if (!ok() && who.state?.profile?.inviteCode) import("../store.js").then((m) => m.myCoachAccess(who.state.profile.inviteCode)).then((on) => { if (on) { window.__taCoach = true; send.hidden = false; } }).catch(() => {}); }
    send.addEventListener("click", async () => { send.disabled = true; mount(msg, "Sending…");
      try { const owner = PL.planOwnerFor(who.state, key), mine = PL.isMine(key) || who.self === key, by = mine ? { self: true, name: "you" } : { uid: who.state.user?.uid || null, name: who.state.profile?.name || (who.state.isAdmin ? "Callaway" : "Coach") };
        const chosenW = week.filter((w) => picked.has(w.n)); if (!chosenW.length) { send.disabled = false; mount(msg, "Tick at least one to add."); return; }
        for (const w of chosenW) await PL.savePlanItem(owner, { id: PL.newPlanId(), type: "session", title: `${w.n}. ${w.label}`, createdAt: new Date().toISOString(), playerKey: key, createdBy: by, fromWeek: true, items: [w.item], run: null, secs: 0 });
        mount(msg, ["Sent: ", el("a", { href: mine ? "#/practice" : `#/practice?player=${encodeURIComponent(key)}` }, `${chosenW.length} ${chosenW.length === 1 ? "session" : "sessions"} on the Practice page →`)]); }
      catch (e) { console.warn(e); send.disabled = false; mount(msg, e?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn't send it just now."); } });
    const sessions = el("div", { class: "ip-week" }, week.map((w) => { const box = el("input", { type: "checkbox", class: "rp-tick", checked: true, "aria-label": `Add ${w.label}` });
      box.addEventListener("change", () => { if (box.checked) picked.add(w.n); else picked.delete(w.n); sec.classList.toggle("off", !box.checked); });
      const sec = el("section", { class: "ip-sess", style: `--ipc:${toneC[w.tone]}` }, [el("label", { class: "ip-day rp-day" }, [box, ` ${w.tag}`]), el("h3", { class: "ip-h3" }, `${what(w.c)} from ${w.d}`), el("p", {}, `3 sets of 10. ${w.target}.`), el("p", { class: "rp-thr" }, w.thrTxt), el("p", { class: "ip-why" }, w.why)]); return sec; }));
    const working = card("Is the practice working?", "#d4b483", el("p", { class: "muted" }, "Checking the practice plan…"));
    mount(wrap, [el("header", { class: "ip-head" }, [el("div", {}, [el("p", { class: "ip-kick", style: "color:#ffcc00" }, `Recommended practice · current form · ${noTour ? "" : tour || ""} ${year}`), el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted" }, `${week.length} sessions: a season-long leak, a recent one, one trending down, ${noTour ? "" : evPick ? `two for ${theE(evPick)}${!E ? " (not in the stats file yet: by current form alone)" : ""}, ` : ""}and a strength to keep sharp${noTour ? " (no tournament picks: there's no tour data here)" : ""}. Each target is the next tour level up from where ${self ? "you are" : `${last} is`}. Tick the ones to add.`)]), el("div", { class: "ip-ctl" }, [evSel, sizeT, send])]), msg,
      week.length ? sessions : el("p", { class: "muted" }, "Not enough recent shots by distance to recommend practice yet."), working,
      card("How it's built", "#8e8e93", el("ol", { class: "ip-bul" }, [el("li", {}, `All season: the distance range costing the most strokes per round in ${year} (20+ shots)`), el("li", {}, `Lately: a different range costing the most over the last ${fl} (10+ shots)`), el("li", {}, `Trending down: the range that dropped the most from the ${fl} before to the last ${fl}, strokes gained per round (8+ shots in each)`), noTour ? null : el("li", {}, "For the tournament picked above (two): a range that has cost them at that event in past years (6+ shots there), what decides the course in Strategy Maps when they're short of the top 10 there, else their weakest range in the part of the game that matters most at that event (Course Edge)"), el("li", {}, `Keep it sharp: their best range over the last ${fl}`), el("li", {}, `Each is 3 sets of 10. The target comes from the range's own stat (Made Putt %, Good Lag %, Proximity, Green Hit %): ${possN} number (season for the season and tournament picks, the last ${fl} for the rest) against the tour's ${noTour ? "latest season" : `${year} season`}, among players with enough attempts there (15+ for a %, 10+ for proximity): the average (the middle player), top 25 and top 10. The aim is the next level not reached yet; at top 10 already, hold it. A % becomes that many of 10, rounded up; proximity becomes inside that many feet. Where there aren't 20+ tour players with enough attempts, or no stat for the range, it falls back to the practice page's rule of thumb and says so`)]))]);
    // is the practice working: ranges practised in sessions made 2+ weeks ago, tournament shots before and after
    (async () => { const owner = PL.planOwnerFor(who.state, key), items = await PL.listPlan(owner).catch(() => []); if (!alive) return;
      const t0 = new Map(); for (const s of items.filter((x) => x.type === "session")) for (const it of s.items || []) { if (!/^(APP|ARG|PUTT)\|/.test(it.key || "")) continue; const at = Date.parse(s.createdAt); if (!Number.isFinite(at) || Date.now() - at < 14 * 864e5) continue; if (!t0.has(it.key) || at < t0.get(it.key)) t0.set(it.key, at); }
      const rowsW = [...t0].map(([k, at]) => { const [c, d] = k.split("|"), side = (after) => { const xs = []; for (const r of P.all) { if ((Date.parse(r.date) >= at) !== after) continue; for (const s of r.shots || []) if (s.cat === c && s.dist === d) xs.push(s.sg || 0); } return { v: xs.length >= 10 ? xs.reduce((t, v) => t + v, 0) / xs.length : null, n: xs.length, xs }; };
        const b = side(false), a = side(true); return { c, d, at, b, a, sure: clearDiff(a.xs, b.xs, 10).clear }; }).filter((x) => x.a.v != null && x.b.v != null);
      mount(working, [el("p", { class: "ip-kick" }, "Is the practice working?"), rowsW.length ? el("div", { class: "ip-tw ip-tw0" }, el("table", { class: "ip-t" }, [el("thead", {}, el("tr", {}, ["Range practised", "Since", "Before (a shot)", "After (a shot)", "Change", "Verdict"].map((h, i) => el("th", { class: i >= 2 ? "num" : null }, h)))),
        el("tbody", {}, rowsW.map((x) => el("tr", {}, [el("td", {}, `${AREA[x.c]} · ${x.d}`), el("td", {}, new Date(x.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })), el("td", { class: "num" }, `${sg3(x.b.v)} (${Math.round(x.b.n)})`), el("td", { class: "num" }, `${sg3(x.a.v)} (${Math.round(x.a.n)})`), el("td", { class: `num strong ${cls(x.a.v - x.b.v)}` }, sg3(x.a.v - x.b.v)), el("td", { class: x.sure ? cls(x.a.v - x.b.v) : "muted" }, x.sure ? (x.a.v > x.b.v ? "Better, clearly" : "Worse, clearly") : "Too close to call")])))]))
        : el("p", { class: "muted" }, "Nothing to judge yet: this needs a range practised in a session made 2+ weeks ago, with 10+ tournament shots from it before and after."),
        samp("Tournament shots from each range before the first session that practised it, and since; strokes gained a shot (the shots in brackets). \"Clearly\" means the change is bigger than the shot-to-shot noise (a t-test at about 90%); anything else is too close to call, and other things change too (courses, fields, the clubs).")]); })();
  }
  // (update 817) the header's player changes: the week follows (on its own page; in Stats the tab is drawn again)
  if (!key0) { const off = onCurrent((c) => { if (!wrap.isConnected) { off(); return; } if (c?.key && c.key !== key) { key = c.key; draw(); } }); }
  draw();
}
