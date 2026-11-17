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
import { whoCanBePicked, startKey, card, samp, sg3, cls } from "./insightPages.js";
import { lastName, onCurrent } from "../current.js";

const AREA = { OTT: "Off the tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" };
const noun = (c) => (c === "PUTT" ? "putts" : c === "ARG" ? "chips and pitches" : "approaches");
const what = (c) => (c === "PUTT" ? "Putts" : c === "ARG" ? "Chips and pitches" : "Approaches");

export async function render(main, { previewClient = null, key: key0 = null, label: label0 = null } = {}) { // (update 817: Stats' Practice & Goals tab hands over its player)
  const wrap = el("div", { class: "ip" }, el("p", { class: "muted" }, "Loading…")); mount(main, wrap);
  const who = await whoCanBePicked(previewClient);
  if (key0 && label0 && !who.labels.has(key0)) who.labels.set(key0, label0);
  let key = key0 || startKey(who), size = 4, alive = true;
  window.addEventListener("hashchange", () => { alive = false; }, { once: true });
  const fieldP = PI.loadField(who.state).catch(() => ({ field: [] })), heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).catch(() => []);
  const [PS, PL] = await Promise.all([import("./practiceSimple.js"), import("../practice/plan.js")]);

  async function draw() {
    if (!alive) return;
    if (!key) { mount(wrap, [el("h2", { class: "ip-h" }, "Recommended Practice"), el("p", { class: "muted" }, "Pick a player at the top of the page.")]); return; }
    const name = who.labels.get(key) || key.replace(/^c_/, ""), self = PI.isSelfKey(key) || who.self === key, last = self ? "You" : lastName(name); // (update 834: "your" on your own)
    const possT = self ? "Your" : `${last}\u2019s`;
    mount(wrap, [el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted ip-wait" }, "Building the week from the data…")]);
    const [{ field }, rounds] = await Promise.all([fieldP, PI.loadShots(key, name)]); if (!alive) return;
    if (!rounds.length) { mount(wrap, [el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted" }, `No shot-by-shot rounds on record for ${name}.`)]); return; }
    const tours = [...new Set(rounds.map((r) => r.tour).filter(Boolean))], tour = [...tours].sort((a, b) => rounds.filter((r) => r.tour === b).length - rounds.filter((r) => r.tour === a).length)[0] || null;
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
    const fl = F?.lbl || `${nF} rounds`, roomT = (c) => (E ? ` × ${room(c).toFixed(2)} the usual room to gain in ${PI.CATN[c].toLowerCase()} at ${theE(E.name)}` : "");
    const cand = [], seen = new Set(), add = (o) => { const k = `${o.c}|${o.d}`; if (seen.has(k)) return; seen.add(k); cand.push(o); };
    for (const o of formR.filter((x) => x.rd < 0)) add({ c: o.c, d: o.d, stake: -o.rd * room(o.c), why: `Costing ${Math.abs(o.rd).toFixed(2)} strokes per round over the last ${fl} (${sg3(o.shot)} a shot, ${Math.round(o.n)} shots)${roomT(o.c)} = ${(-o.rd * room(o.c)).toFixed(2)} at stake`, tone: "neg" });
    if (courseR) add({ c: courseR.c, d: courseR.l, stake: (courseR.top - (courseR.me ?? 0)) * courseR.att, why: `Decides ${meta.name}: ${courseR.att.toFixed(1)} ${noun(courseR.c)} per round from here; ${last} ${courseR.me == null ? (self ? "have too few shots on record" : "has too few shots on record") : `${sg3(courseR.me)} strokes gained a shot`} against the top 10's ${sg3(courseR.top)} there (${((courseR.top - (courseR.me ?? 0)) * courseR.att).toFixed(2)} strokes per round at stake)`, tone: "course" });
    const plan = cand.filter((o) => o.stake > 0).sort((a, b) => b.stake - a.stake).slice(0, size - 1);
    const keep = formR.filter((o) => o.rd > 0 && !seen.has(`${o.c}|${o.d}`)).sort((a, b) => b.rd * room(b.c) - a.rd * room(a.c))[0];
    if (keep && plan.length < size) plan.push({ c: keep.c, d: keep.d, stake: 0, why: `Keep it sharp: +${keep.rd.toFixed(2)} strokes gained per round over the last ${fl} (${Math.round(keep.n)} shots)${E && room(keep.c) > 1.03 ? `, and ${PI.CATN[keep.c].toLowerCase()} has ${room(keep.c).toFixed(2)}× the usual room to gain at ${theE(E.name)}` : ""}`, tone: "pos" });
    // the choices: what's coming up on the schedule, then any tournament on record
    const up = nx.upcoming.map((e) => e.name), opts = [...new Set([...up, ...names])], fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
    const evSel = opts.length ? (() => { const og = (lbl, xs, f) => (xs.length ? el("optgroup", { label: lbl }, xs.map((n) => el("option", { value: n }, f(n)))) : null);
      const sel = el("select", { class: "ip-sel", "aria-label": "Preparing for" }, [el("option", { value: "" }, up[0] ? `Next on the schedule (${up[0]})` : "The next event"), og("Coming up", up, (n) => { const e = nx.upcoming.find((x) => x.name === n); return `${n}${e?.start ? ` · ${fmt(e.start)}` : ""}`; }), og("Any tournament on record", names.filter((n) => !up.includes(n)), (n) => n)]);
      sel.value = PI.pickedNext(key) || ""; sel.addEventListener("change", () => { PI.setPickedNext(key, sel.value || null); draw(); }); return el("label", { class: "rp-ev" }, [el("span", {}, "Preparing for"), sel]); })() : null;
    const week = plan.slice(0, size).map((p, i) => { const label = `${AREA[p.c]} · ${p.d}`, kind = PS.TARGET_KIND(p.c, label), goal = PS.TARGET_DEF(kind, label);
      return { ...p, n: i + 1, label, item: { key: `${p.c}|${p.d}`, cat: p.c, label, mode: "sets", shots: 10, sets: 3, minutes: 15, setsDone: 0, secs: 0, done: false, target: { kind, goal, reps: 10, cat: p.c, unit: kind === "prox" ? "ft" : null } },
        target: PL.goalText({ kind, goal, reps: 10, unit: kind === "prox" ? "ft" : null, cat: p.c }) }; });
    const toneC = { neg: "#ff453a", course: "#64d2ff", pos: "#30d158" };
    const sizeT = el("div", { class: "ip-pills", role: "group", "aria-label": "Sessions" }, [[3, "3 sessions"], [4, "4 sessions"], [5, "5 sessions"]].map(([n, l]) => { const b = el("button", { type: "button", class: `ip-pill${n === size ? " on" : ""}`, "aria-pressed": String(n === size) }, l); b.addEventListener("click", () => { size = n; draw(); }); return b; }));
    const msg = el("span", { class: "muted small" }), send = el("button", { type: "button", class: "ip-btn" }, who.self || self ? "Add to my practice" : `Send to ${last}`);
    send.addEventListener("click", async () => { send.disabled = true; mount(msg, "Sending…");
      try { const owner = PL.planOwnerFor(who.state, key), mine = PL.isMine(key) || who.self === key, by = mine ? { self: true, name: "you" } : { uid: who.state.user?.uid || null, name: who.state.profile?.name || (who.state.isAdmin ? "Callaway" : "Coach") };
        for (const w of week) await PL.savePlanItem(owner, { id: PL.newPlanId(), type: "session", title: `${w.n}. ${w.label}`, createdAt: new Date().toISOString(), playerKey: key, createdBy: by, fromWeek: true, items: [w.item], run: null, secs: 0 });
        mount(msg, ["Sent: ", el("a", { href: mine ? "#/practice" : `#/practice?player=${encodeURIComponent(key)}` }, `${week.length} sessions on the Practice page →`)]); }
      catch (e) { console.warn(e); send.disabled = false; mount(msg, e?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn't send it just now."); } });
    const sessions = el("div", { class: "ip-week" }, week.map((w) => el("section", { class: "ip-sess", style: `--ipc:${toneC[w.tone]}` }, [el("p", { class: "ip-day" }, w.n === 1 ? "1 · Most important" : String(w.n)), el("h3", { class: "ip-h3" }, `${what(w.c)} from ${w.d}`), el("p", {}, `3 sets of 10. ${w.target}.`), el("p", { class: "ip-why" }, w.why)])));
    const working = card("Is the practice working?", "#d4b483", el("p", { class: "muted" }, "Checking the practice plan…"));
    mount(wrap, [el("header", { class: "ip-head" }, [el("div", {}, [el("p", { class: "ip-kick", style: "color:#ffcc00" }, `Recommended practice · current form · ${tour || ""} ${year}`), el("h2", { class: "ip-h" }, `${possT} recommended practice`), el("p", { class: "muted" }, `${week.length} sessions, most at stake first${evPick ? `, for ${theE(evPick)}` : ""}${evPick && !E ? " (not in the stats file yet: by current form alone)" : ""}`)]), el("div", { class: "ip-ctl" }, [evSel, sizeT, send])]), msg,
      week.length ? sessions : el("p", { class: "muted" }, "Not enough recent shots by distance to recommend practice yet."), working,
      card("How it's built", "#8e8e93", el("ol", { class: "ip-bul" }, [el("li", {}, `Current form: each distance range over the last ${fl}, strokes gained per round (10+ shots in it)`), el("li", {}, "Weighted by the room to gain in its part of the game at the event picked above (Course Fit): more room, more at stake"), el("li", {}, "A course with its shots in Strategy Maps adds the range that decides it, when they're short of the top 10's level there"), el("li", {}, "Most at stake first; then one strength to keep sharp. Each target is the practice page's own: change any of it there after sending")]))]);
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
