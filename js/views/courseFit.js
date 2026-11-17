// (update 815) Course Fit: who suits a course. What wins there (the top 10's edge over the rest of the field in each of the
// data's distance ranges, strokes gained a shot, × how often each comes up there), then each player's projected strokes
// gained a round there: their season a shot in each range × how often it comes up there, plus their driving. Ranked, with
// the key ranges against the top 10 and their own rounds there. The next event's course to start; any course with shots.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { whoCanBePicked, card, samp, sg2, sg3, cls, ord } from "./insightPages.js";

export async function render(main, { previewClient = null } = {}) {
  const wrap = el("div", { class: "ip" }, el("p", { class: "muted" }, "Loading…")); mount(main, wrap);
  const who = await whoCanBePicked(previewClient);
  const list = (await import("../courseHeat.js").then((m) => m.listHeatCourses()).catch(() => [])).filter((c) => c.rawChunks).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const want = new URLSearchParams(location.hash.split("?")[1] || "").get("course"); // (update 816: from Search)
  let meta = list.find((c) => c.id === want) || PI.nextCourse(list) || list[0] || null, alive = true, run = 0;
  window.addEventListener("hashchange", () => { alive = false; }, { once: true });
  const players = (who.self ? [who.self] : who.favs.length ? who.favs : [...who.labels.keys()]).slice(0, 14);
  const fieldP = PI.loadField(who.state).catch(() => ({ field: [] }));

  async function draw() {
    const my = ++run;
    const sel = el("select", { class: "ip-sel", "aria-label": "Course" }, list.map((c) => el("option", { value: c.id }, c.name))); if (meta) sel.value = meta.id;
    sel.addEventListener("change", () => { meta = list.find((c) => c.id === sel.value) || meta; draw(); });
    const head = el("header", { class: "ip-head" }, [el("div", {}, [el("p", { class: "ip-kick", style: "color:#64d2ff" }, `Course fit${meta && PI.nextCourse(list)?.id === meta.id ? ` · next event: ${PI.NEXT.name}` : ""}`), el("h1", { class: "ip-h" }, meta ? `Who suits ${meta.name}?` : "Course Fit")]), el("div", { class: "ip-ctl" }, list.length ? [sel] : [])]);
    if (!meta) { mount(wrap, [head, el("p", { class: "muted" }, "No course in Strategy Maps has its shots uploaded yet.")]); return; }
    const status = el("p", { class: "muted ip-wait" }, "Reading your players’ shots…");
    mount(wrap, [head, status]);
    // each player's shots (one after another; a phone holds a few at a time). (update 816) The course is read as soon as the
    // first player is in, and the table fills in as each player arrives, best fit first, instead of waiting for everyone.
    const { field } = await fieldP, profs = []; let C = null;
    for (const [i, k] of players.entries()) { if (!alive || my !== run) return;
      const name = who.labels.get(k) || k.replace(/^c_/, ""), rounds = await PI.loadShots(k, name); if (!alive || my !== run) return;
      if (rounds.length) { const tours = [...new Set(rounds.map((r) => r.tour).filter(Boolean))], tour = [...tours].sort((a, b) => rounds.filter((r) => r.tour === b).length - rounds.filter((r) => r.tour === a).length)[0] || null;
        const years = [...new Set(rounds.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort(), year = years.at(-1);
        profs.push({ k, name, P: PI.profile(rounds, { year, tour, field, key: k }), year, tour }); }
      if (!C && profs.length) { mount(status, `Reading ${meta.name}’s shots…`); C = await PI.loadCourse(meta, profs.map((p) => p.P.rs)).catch((e) => { console.warn(e); return null; }); if (!alive || my !== run) return;
        if (!C || !C.ranges.length) { mount(status, `${meta.name}'s shots couldn't be read, or there aren't enough by distance yet.`); return; } }
      if (C) paint(C, profs, i + 1 < players.length ? `Reading shots: ${i + 1} of ${players.length} players…` : null); }
    if (!C) mount(status, "None of these players has shot-by-shot rounds yet.");
    function paint(C, profs, more) {
    const rows = profs.map((p) => ({ ...p, fit: PI.fitFor(p.P, C, p.k, p.name) })).filter((r) => r.fit.coverage >= 0.3).sort((a, b) => b.fit.proj - a.fit.proj);
    const key3 = C.ranges.filter((x) => x.share > 0).slice(0, 3), yrsT = C.yrs.length > 1 ? `${C.yrs[0]}-${C.yrs.at(-1).slice(2)}` : C.yrs[0] || "";
    const chips = el("div", { class: "ip-chips" }, [el("b", {}, "What wins here:"), ...C.ranges.filter((x) => x.share >= 0.05).slice(0, 5).map((x, i) => el("span", { class: `ip-chip${i === 0 ? " on" : ""}` }, `${PI.CATN[x.c]} ${x.l} · ${Math.round(x.share * 100)}%`))]);
    const lo = Math.min(0, ...rows.map((r) => r.fit.proj)), hi = Math.max(0.01, ...rows.map((r) => r.fit.proj));
    const table = el("div", { class: "ip-tw" }, el("table", { class: "ip-t ip-fit-t" }, [
      el("thead", {}, el("tr", {}, ["#", "Player", "Fit", "Projected SG a round", "Course effect", ...key3.map((x) => `${PI.CATN[x.c].replace("Around-the-Green", "Short game")} ${x.l}`), "Rounds here", "Based on"].map((h, i) => el("th", { class: i >= 3 ? "num" : null }, h)))),
      el("tbody", {}, rows.map((r, i) => el("tr", { class: i === 0 ? "top" : null }, [el("td", { class: "ip-rk" }, String(i + 1)), el("td", {}, el("a", { href: `#/dossier?player=${encodeURIComponent(r.k)}` }, r.name)),
        el("td", {}, el("span", { class: "ip-bartrack ip-fitbar" }, el("i", { class: "fit", style: `width:${Math.round(((r.fit.proj - lo) / (hi - lo || 1)) * 100)}%` }))),
        el("td", { class: `num strong ${cls(r.fit.proj)}` }, sg2(r.fit.proj)), el("td", { class: `num ${cls(r.fit.vsSeason)}` }, sg2(r.fit.vsSeason)),
        ...key3.map((x) => { const m = r.fit.key3.find((y) => y.k === x.k); return el("td", { class: `num ${m?.me != null && x.top != null ? (m.me >= x.top ? "pos" : "") : "muted"}` }, m?.me == null ? "—" : sg3(m.me)); }),
        el("td", { class: "num" }, r.fit.hereRds ? String(r.fit.hereRds) : "—"), el("td", { class: "num muted" }, `${r.year} · ${Math.round(r.fit.coverage * 100)}%`)])))]));
    const best = rows[0], gapRow = rows.map((r) => ({ r, g: key3[0] && r.fit.key3[0]?.me != null && key3[0].top != null ? key3[0].top - r.fit.key3[0].me : null })).filter((x) => x.g != null).sort((a, b) => b.g - a.g)[0];
    const notes = el("div", { class: "ip-grid2" }, [
      best ? card("Best fit", "#64d2ff", el("p", {}, [el("b", {}, best.name), ` projects ${sg2(best.fit.proj)} strokes gained a round here (${sg2(best.fit.vsSeason)} against their season)${best.fit.key3[0]?.me != null ? `, with ${sg3(best.fit.key3[0].me)} a shot from ${key3[0].l} (the top 10 here: ${sg3(key3[0].top)})` : ""}.`])) : null,
      gapRow ? card("Biggest gap to close", "#d4b483", el("p", {}, [el("b", {}, gapRow.r.name), ` is ${gapRow.g.toFixed(3)} strokes a shot short of the top 10 in ${({ APP: "approach", ARG: "short game", PUTT: "putting" })[key3[0].c]} from ${key3[0].l}, the range that decides this course (${key3[0].att.toFixed(1)} ${({ APP: "approaches", ARG: "chips and pitches", PUTT: "putts" })[key3[0].c]} a round from there). `, el("a", { href: `#/practice-week?player=${encodeURIComponent(gapRow.r.k)}` }, "Plan the week →")])) : null]);
    mount(wrap, [head, more ? el("p", { class: "muted ip-more" }, more) : null, chips, rows.length ? table : el("p", { class: "muted" }, "Not enough shots by distance for these players."), notes,
      samp(`Course: every round on record at ${meta.name} (${yrsT}, ${C.nRds} rounds); the top 10 each year against the rest, strokes gained a shot in the data's own ranges. Projected: each player's latest season on their main tour, with their own shots a round in each part of the game but the course's mix of distances, plus their driving. Course effect: projected minus their season average (what the course's mix does for them). "Based on" is how much of the course's shots by distance their data covers (30% at least to be listed). Key ranges in green: at or above the top 10's level.`)]);
    }
  }
  draw();
}
