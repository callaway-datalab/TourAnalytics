// (update 815) Practice Week: a week of practice built from a player's own data, ready to send to their Practice page.
// The sessions: their biggest leaks this season (Where to Improve), the range that decides the next course (Course Fit),
// and one strength to keep sharp; each 10 shots × 3 sets with the Practice page's own target. "Send" makes them practice
// sessions there (the player's own, or a coach with Allow coaching). Underneath: is the practice working? Each range
// practised (a session made 2+ weeks ago) against tournament shots from it before and after, strokes gained a shot.
import { el, mount } from "../ui.js";
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
    if (!key) { mount(wrap, [el("h2", { class: "ip-h" }, "Practice Week"), el("p", { class: "muted" }, "Pick a player at the top of the page.")]); return; }
    const name = who.labels.get(key) || key.replace(/^c_/, ""), last = lastName(name);
    mount(wrap, [el("h2", { class: "ip-h" }, `${last}’s practice week`), el("p", { class: "muted ip-wait" }, "Building the week from the data…")]);
    const [{ field }, rounds] = await Promise.all([fieldP, PI.loadShots(key, name)]); if (!alive) return;
    if (!rounds.length) { mount(wrap, [el("h2", { class: "ip-h" }, `${last}’s practice week`), el("p", { class: "muted" }, `No shot-by-shot rounds on record for ${name}.`)]); return; }
    const tours = [...new Set(rounds.map((r) => r.tour).filter(Boolean))], tour = [...tours].sort((a, b) => rounds.filter((r) => r.tour === b).length - rounds.filter((r) => r.tour === a).length)[0] || null;
    const year = [...new Set(rounds.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1), P = PI.profile(rounds, { year, tour, field, key });
    // the course's deciding range, when it's a gap for them
    const meta = PI.nextCourse(await heatP), C = meta ? await PI.loadCourse(meta, [P.rs]).catch(() => null) : null; if (!alive) return;
    const fit = C ? PI.fitFor(P, C, key, name) : null, courseR = fit?.key3.find((x) => x.c !== "OTT" && x.top != null && (x.me == null || x.me < x.top));
    // the week
    // (update 817) no days or times: the sessions most important first, by the strokes a round at stake (a leak: what it
    // costs a round; the next course's deciding range: the gap to the top 10 there × how often it comes up), then one
    // strength to keep sharp
    const cand = [], seen = new Set(), add = (o) => { const k = `${o.c}|${o.d}`; if (seen.has(k)) return; seen.add(k); cand.push(o); };
    for (const [i, o] of P.leaks.entries()) add({ c: o.c, d: o.d, stake: -o.rd, why: `${i === 0 ? "Biggest leak" : "Leak"}: ${o.rd >= 0 ? "+" : "−"}${Math.abs(o.rd).toFixed(2)} strokes gained a round (${sg3(o.shot)} a shot, ${Math.round(o.n)} shots in ${year})`, tone: "neg" });
    if (courseR) add({ c: courseR.c, d: courseR.l, stake: (courseR.top - (courseR.me ?? 0)) * courseR.att, why: `Decides ${PI.NEXT.name}: ${courseR.att.toFixed(1)} ${noun(courseR.c)} a round from here; ${last} ${courseR.me == null ? "has too few shots on record" : `${sg3(courseR.me)} strokes gained a shot`} against the top 10's ${sg3(courseR.top)} there (${((courseR.top - (courseR.me ?? 0)) * courseR.att).toFixed(2)} strokes a round at stake)`, tone: "course" });
    const plan = cand.filter((o) => o.stake > 0).sort((a, b) => b.stake - a.stake).slice(0, size - 1);
    const keep = P.strengths.find((o) => !seen.has(`${o.c}|${o.d}`)); if (keep && plan.length < size) plan.push({ c: keep.c, d: keep.d, stake: 0, why: `Keep it sharp: +${keep.rd.toFixed(2)} strokes gained a round, the best range (${Math.round(keep.n)} shots)`, tone: "pos" });
    const week = plan.slice(0, size).map((p, i) => { const label = `${AREA[p.c]} · ${p.d}`, kind = PS.TARGET_KIND(p.c, label), goal = PS.TARGET_DEF(kind, label);
      return { ...p, n: i + 1, label, item: { key: `${p.c}|${p.d}`, cat: p.c, label, mode: "sets", shots: 10, sets: 3, minutes: 15, setsDone: 0, secs: 0, done: false, target: { kind, goal, reps: 10, cat: p.c, unit: kind === "prox" ? "ft" : null } },
        target: PL.goalText({ kind, goal, reps: 10, unit: kind === "prox" ? "ft" : null, cat: p.c }) }; });
    const toneC = { neg: "#ff453a", course: "#64d2ff", pos: "#30d158" };
    const sizeT = el("div", { class: "ip-pills", role: "group", "aria-label": "Sessions" }, [[3, "3 sessions"], [4, "4 sessions"], [5, "5 sessions"]].map(([n, l]) => { const b = el("button", { type: "button", class: `ip-pill${n === size ? " on" : ""}`, "aria-pressed": String(n === size) }, l); b.addEventListener("click", () => { size = n; draw(); }); return b; }));
    const msg = el("span", { class: "muted small" }), send = el("button", { type: "button", class: "ip-btn" }, who.self ? "Add to my practice" : `Send to ${last}`);
    send.addEventListener("click", async () => { send.disabled = true; mount(msg, "Sending…");
      try { const owner = PL.planOwnerFor(who.state, key), mine = PL.isMine(key) || who.self === key, by = mine ? { self: true, name: "you" } : { uid: who.state.user?.uid || null, name: who.state.profile?.name || (who.state.isAdmin ? "Callaway" : "Coach") };
        for (const w of week) await PL.savePlanItem(owner, { id: PL.newPlanId(), type: "session", title: `${w.n}. ${w.label}`, createdAt: new Date().toISOString(), playerKey: key, createdBy: by, fromWeek: true, items: [w.item], run: null, secs: 0 });
        mount(msg, ["Sent: ", el("a", { href: mine ? "#/practice" : `#/practice?player=${encodeURIComponent(key)}` }, `${week.length} sessions on the Practice page →`)]); }
      catch (e) { console.warn(e); send.disabled = false; mount(msg, e?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn't send it just now."); } });
    const sessions = el("div", { class: "ip-week" }, week.map((w) => el("section", { class: "ip-sess", style: `--ipc:${toneC[w.tone]}` }, [el("p", { class: "ip-day" }, w.n === 1 ? "1 · Most important" : String(w.n)), el("h3", { class: "ip-h3" }, `${what(w.c)} from ${w.d}`), el("p", {}, `3 sets of 10. ${w.target}.`), el("p", { class: "ip-why" }, w.why)])));
    const working = card("Is the practice working?", "#d4b483", el("p", { class: "muted" }, "Checking the practice plan…"));
    mount(wrap, [el("header", { class: "ip-head" }, [el("div", {}, [el("p", { class: "ip-kick", style: "color:#ffcc00" }, `Practice · built from the data · ${tour || ""} ${year}`), el("h2", { class: "ip-h" }, `${last}’s practice week`), el("p", { class: "muted" }, `${week.length} sessions, most important first${courseR ? `, ahead of ${PI.NEXT.name}` : ""}`)]), el("div", { class: "ip-ctl" }, [sizeT, send])]), msg,
      week.length ? sessions : el("p", { class: "muted" }, "Not enough shots by distance to build a week yet."), working,
      card("How the week is built", "#8e8e93", el("ol", { class: "ip-bul" }, [el("li", {}, "The biggest leaks this season, a round, from ranges with 25+ shots (Where to Improve)"), el("li", {}, `The range that decides ${PI.NEXT.name}, when it's below the top 10's level there (Course Fit)`), el("li", {}, "Listed by the strokes a round at stake, most first; then one strength to keep sharp"), el("li", {}, "Each target is the Practice page's own for that range; change any of it there after sending")]))]);
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
