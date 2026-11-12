// (update 700) Practice › Launch Monitor: TrackMan and GCQuad sessions. Paste a TrackMan report link, or upload TrackMan's
// Excel export or a GCQuad CSV; every shot is kept (practice/{owner}/lm/{id}), marked with where it came from. Then:
//   filters: sessions (by date), clubs, carry from / to;
//   the dispersion map (from above: carry or total, a ring round each club's spread) and the trajectories (from the side);
//   each club's averages, opening to every shot; and any number over time, club by club.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { LM_METRICS, LM, fmtLM, fromFile, fromTrackmanJson, trackmanId, byClub, ellipse, mean } from "../practice/lmData.js";

const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("../firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));
async function listLM(owner) { const { getDocs, collection, db } = await fsP(); const s = await getDocs(collection(db, "practice", owner, "lm")); return s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(b.date).localeCompare(String(a.date))); }
async function saveLM(owner, s) { const { setDoc, doc, db } = await fsP(); const { id, ...rest } = s; return setDoc(doc(db, "practice", owner, "lm", id), JSON.parse(JSON.stringify(rest))); }
async function deleteLM(owner, id) { const { deleteDoc, doc, db } = await fsP(); return deleteDoc(doc(db, "practice", owner, "lm", id)); }
const newId = () => `lm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// a colour for each club (the same club the same colour on every chart)
const PAL = ["#ff453a", "#5e5ce6", "#ff9f0a", "#bf5af2", "#30d158", "#64d2ff", "#ffd60a", "#ff375f", "#0a84ff", "#ac8e68", "#32d74b", "#ff6482", "#8e8ef0", "#66d4cf"];
const SRC = { trackman: "TrackMan", gcquad: "GCQuad" }, VIA = { link: "Report link", excel: "Excel", csv: "CSV" };
const srcPill = (src) => el("span", { class: `lm-src ${src}` }, SRC[src] || src);
const dTxt = (d) => { const t = Date.parse(`${String(d).slice(0, 10)}T12:00:00`); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(d || ""); };
const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, kids = []) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); for (const c of [].concat(kids)) if (c != null) n.append(typeof c === "string" ? document.createTextNode(c) : c); return n; };

/** box: where it draws; owner: whose sessions; canWrite: may add and delete; flash(msg, kind). */
export async function renderLM(box, { owner, canWrite = false, flash = () => {}, who = "" } = {}) {
  let sessions = [], loading = true;
  const narrow = () => (box.clientWidth || window.innerWidth) < 640; // (a phone: the charts narrower and taller, so they're readable)
  const f = { sess: new Set(), clubs: new Set(), min: "", max: "", view: "carry", metric: "carry", open: new Set() };
  async function load() { loading = true; draw(); try { sessions = await listLM(owner); } catch (err) { console.error(err); sessions = []; } loading = false; draw(); }

  /* ---------- import ---------- */
  async function keep(sess) {
    if (!sess.shots.length) { flash("No shots found in that. Check it’s a TrackMan report or export, or a GCQuad CSV.", "error"); return; }
    const st = getState(), dup = sessions.find((x) => x.key === sess.key);
    if (dup && !confirm(`That session (${dTxt(dup.date)}, ${dup.shots.length} shots) is already here. Replace it?`)) return;
    const doc = { ...sess, id: dup?.id || newId(), addedAt: new Date().toISOString(), addedBy: { uid: st.user?.uid || null, name: st.profile?.name || (st.isAdmin ? "Callaway" : "") } };
    try { await saveLM(owner, doc); flash(`Added ${doc.shots.length} shots from ${SRC[doc.src]} (${dTxt(doc.date)}).`, "ok"); f.sess.clear(); await load(); }
    catch (err) { console.error(err); flash(err?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn’t save that session.", "error"); }
  }
  function importer() {
    if (!canWrite) return null;
    const link = el("input", { type: "url", class: "ps-in lm-link", placeholder: "Paste a TrackMan report link (web-dynamic-reports.trackmangolf.com/?r=…)", "aria-label": "TrackMan report link" });
    const go = el("button", { type: "button", class: "btn" }, "Import link");
    const file = el("input", { type: "file", accept: ".csv,.xlsx,.xlsm", style: "display:none" }), pick = el("button", { type: "button", class: "btn ghost" }, "⬆ Upload a file");
    const status = el("p", { class: "muted small", role: "status" });
    pick.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const fl = file.files?.[0]; file.value = ""; if (!fl) return;
      status.textContent = `Reading ${fl.name}…`;
      try { await keep(await fromFile(fl)); status.textContent = ""; } catch (err) { console.error(err); status.textContent = err?.message?.includes("xls") ? err.message : "Couldn’t read that file. TrackMan’s Excel export (.xlsx / .xlsm) or a GCQuad CSV, please."; }
    });
    go.addEventListener("click", async () => {
      const v = link.value.trim(); if (!trackmanId(v)) { status.textContent = "That doesn’t look like a TrackMan report link."; return; }
      const url = window.PORTAL_CONFIG?.insightsUrl;
      if (!url) { status.textContent = "Reading TrackMan links needs the portal’s AI service (insightsUrl in config.js). Upload TrackMan’s Excel export instead."; return; }
      go.disabled = true; status.textContent = "Fetching the report from TrackMan…";
      try {
        const token = await getState().user?.getIdToken?.();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ trackman: v }) });
        if (!res.ok) throw new Error(await res.text().catch(() => "") || `HTTP ${res.status}`);
        await keep(fromTrackmanJson(await res.json(), v)); link.value = ""; status.textContent = "";
      } catch (err) { console.error(err); status.textContent = `Couldn’t fetch it: ${String(err?.message || err).slice(0, 140)}`; }
      go.disabled = false;
    });
    return el("section", { class: "ps-card lm-import" }, [el("p", { class: "ps-t" }, "ADD A SESSION"),
      el("div", { class: "lm-import-row" }, [link, go]), el("div", { class: "lm-import-row" }, [pick, el("span", { class: "muted small" }, "TrackMan Excel export (.xlsx, .xlsm) or GCQuad CSV")]), file, status]);
  }

  /* ---------- the shots, filtered ---------- */
  const allShots = () => sessions.flatMap((x) => x.shots.map((sh) => ({ ...sh, sid: x.id, src: x.src, sdate: x.date })));
  const clubsAll = () => byClub(allShots()).map((c) => c.club);
  const colorOf = (club) => { const i = clubsAll().indexOf(club); return PAL[(i < 0 ? 0 : i) % PAL.length]; };
  const shown = () => {
    const lo = f.min === "" ? -Infinity : Number(f.min), hi = f.max === "" ? Infinity : Number(f.max);
    return allShots().filter((x) => !x.x && (!f.sess.size || f.sess.has(x.sid)) && (!f.clubs.size || f.clubs.has(x.c)) && (x.carry == null ? lo === -Infinity && hi === Infinity : x.carry >= lo && x.carry <= hi));
  };

  /* ---------- filters ---------- */
  function filters() {
    const chip = (on, label, click, extra = null, title = null) => { const b = el("button", { type: "button", class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), title }, [extra, label]); b.addEventListener("click", click); return b; };
    const toggle = (set, k) => { if (set.has(k)) set.delete(k); else set.add(k); draw(); };
    const lo = el("input", { type: "number", class: "ps-num", inputmode: "decimal", placeholder: "from", value: f.min, style: "width:72px", "aria-label": "Carry from" });
    const hi = el("input", { type: "number", class: "ps-num", inputmode: "decimal", placeholder: "to", value: f.max, style: "width:72px", "aria-label": "Carry to" });
    lo.addEventListener("change", () => { f.min = lo.value.trim(); draw(); }); hi.addEventListener("change", () => { f.max = hi.value.trim(); draw(); });
    return el("section", { class: "lm-filters" }, [
      el("div", { class: "lm-frow" }, [el("span", { class: "lm-flab" }, "Sessions"), chip(!f.sess.size, "All", () => { f.sess.clear(); draw(); }),
        ...sessions.map((x) => chip(f.sess.has(x.id), ` ${dTxt(x.date)} · ${x.shots.length}`, () => toggle(f.sess, x.id), el("i", { class: `lm-dot ${x.src}` }), `${SRC[x.src]} · ${VIA[x.via] || ""}`))]),
      el("div", { class: "lm-frow" }, [el("span", { class: "lm-flab" }, "Clubs"), chip(!f.clubs.size, "All", () => { f.clubs.clear(); draw(); }),
        ...clubsAll().map((c) => chip(f.clubs.has(c), ` ${c}`, () => toggle(f.clubs, c), el("i", { class: "lm-dot", style: `background:${colorOf(c)}` })))]),
      el("div", { class: "lm-frow" }, [el("span", { class: "lm-flab" }, "Carry"), lo, el("span", { class: "muted small" }, "to"), hi, el("span", { class: "muted small" }, "yds"),
        (f.min || f.max) ? chip(false, "Clear", () => { f.min = ""; f.max = ""; draw(); }) : null]),
    ]);
  }

  /* ---------- dispersion: from above ---------- */
  function dispersion(shots, clubs) {
    const tot = f.view === "total", X = (sh) => (tot ? sh.total : sh.carry), Y = (sh) => (tot ? sh.totalSide ?? sh.side : sh.side);
    const pts = shots.filter((sh) => X(sh) != null && Y(sh) != null);
    const W = narrow() ? 560 : 1000, H = narrow() ? 380 : 340, pl = 36, pr = 14, pt = 12, pb = 26;
    const maxX = Math.max(100, Math.ceil((Math.max(0, ...pts.map(X)) + 15) / 50) * 50), maxY = Math.max(30, Math.ceil((Math.max(0, ...pts.map((p) => Math.abs(Y(p))))) / 10) * 10 + 5);
    const sx = (v) => pl + (v / maxX) * (W - pl - pr), sy = (v) => pt + (H - pt - pb) / 2 + (v / maxY) * ((H - pt - pb) / 2);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "lm-svg", role: "img", "aria-label": `Dispersion, ${tot ? "total" : "carry"}` });
    svg.append(s("defs", {}, s("clipPath", { id: "lmclip" }, s("rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb }))));
    const g = s("g", { "clip-path": "url(#lmclip)" }); svg.append(g);
    g.append(s("rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: "#17171a" }));
    // the bands every 50 yds (rings round the tee, as on the range)
    const kx = (W - pl - pr) / maxX, ky = ((H - pt - pb) / 2) / maxY;
    for (let d = Math.ceil(maxX * 1.3 / 50) * 50; d >= 50; d -= 50) g.append(s("ellipse", { cx: pl, cy: sy(0), rx: d * kx, ry: d * ky, fill: (d / 50) % 2 ? "#1d1d21" : "#17171a" }));
    g.append(s("line", { x1: pl, y1: sy(0), x2: W - pr, y2: sy(0), stroke: "#3a3a3e", "stroke-width": 1.2 }));
    for (let d = 50; d < maxX; d += 50) g.append(s("text", { x: sx(d), y: sy(0) + 14, fill: "#8e8e93", "font-size": 12, "text-anchor": "middle" }, String(d)));
    for (let v = -maxY + (maxY % 10); v <= maxY; v += 10) if (v) svg.append(s("text", { x: pl - 6, y: sy(v) + 4, fill: "#6e6e73", "font-size": 11, "text-anchor": "end" }, `${Math.abs(v)}${v < 0 ? "L" : "R"}`));
    for (const c of clubs) {
      const cs = pts.filter((p) => p.c === c.club), e = ellipse(cs.map((p) => [X(p), Y(p)]));
      if (e) { const pts2 = []; for (let i = 0; i <= 48; i++) { const t = (i / 48) * 2 * Math.PI, ux = e.rx * Math.cos(t), uy = e.ry * Math.sin(t); pts2.push(`${sx(e.cx + ux * Math.cos(e.ang) - uy * Math.sin(e.ang)).toFixed(1)},${sy(e.cy + ux * Math.sin(e.ang) + uy * Math.cos(e.ang)).toFixed(1)}`); }
        g.append(s("polygon", { points: pts2.join(" "), fill: c.color, "fill-opacity": 0.08, stroke: c.color, "stroke-width": 2 })); }
      for (const p of cs) g.append(s("circle", { cx: sx(X(p)), cy: sy(Y(p)), r: 6, fill: c.color, stroke: "#0b0b0d", "stroke-width": 1.5 }, s("title", {}, `${p.c} · ${fmtLM("carry", p.carry)} carry · ${fmtLM("total", p.total)} total · ${fmtLM("side", Y(p))} · ${dTxt(p.sdate)}`)));
    }
    const seg = el("div", { class: "ps-seg sm lm-view" }, [["total", "Total"], ["carry", "Carry"]].map(([k, l]) => { const b = el("button", { type: "button", class: f.view === k ? "on" : "" }, l); b.addEventListener("click", () => { f.view = k; draw(); }); return b; }));
    return el("section", { class: "ps-card lm-card" }, [el("div", { class: "lm-head" }, [el("p", { class: "ps-t" }, "DISPERSION · FROM ABOVE"), seg]), svg,
      el("p", { class: "muted small" }, "Distance downrange across, left and right up and down. The ring round each club holds most of its shots (2 standard deviations).")]);
  }

  /* ---------- trajectories: from the side ---------- */
  function trajectory(shots, clubs) {
    const flight = (sh) => {
      if (sh.traj?.length >= 6) { const out = []; for (let i = 0; i < sh.traj.length; i += 3) out.push([sh.traj[i], sh.traj[i + 1]]); return out; }
      if (sh.carry == null || sh.height == null) return null;
      // (no flight in the data) a curve through the launch, the peak and the landing: peak a little past halfway, a steeper fall
      const p = 0.58, out = [];
      for (let i = 0; i <= 30; i++) { const t = i / 30, y = t < p ? 1 - (1 - t / p) ** 2 : 1 - ((t - p) / (1 - p)) ** 1.6; out.push([sh.carry * t, Math.max(0, sh.height * y)]); }
      if (sh.total != null && sh.total > sh.carry) out.push([sh.total, 0]);
      return out;
    };
    const lines = shots.map((sh) => ({ sh, pts: flight(sh) })).filter((x) => x.pts);
    const W = narrow() ? 560 : 1000, H = narrow() ? 340 : 300, pl = 40, pr = 14, pt = 10, pb = 26;
    const maxX = Math.max(100, Math.ceil((Math.max(0, ...lines.flatMap((x) => x.pts.map((q) => q[0]))) + 10) / 50) * 50), maxY = Math.max(20, Math.ceil(Math.max(0, ...lines.flatMap((x) => x.pts.map((q) => q[1]))) * 1.15 / 10) * 10);
    const sx = (v) => pl + (v / maxX) * (W - pl - pr), sy = (v) => H - pb - (v / maxY) * (H - pt - pb);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "lm-svg", role: "img", "aria-label": "Trajectories from the side" });
    svg.append(s("rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: "#17171a" }));
    for (let d = 50; d <= maxX; d += 50) { svg.append(s("line", { x1: sx(d), y1: pt, x2: sx(d), y2: H - pb, stroke: "#26262a" })); svg.append(s("text", { x: sx(d), y: H - 8, fill: "#8e8e93", "font-size": 12, "text-anchor": "middle" }, String(d))); }
    for (let v = 10; v <= maxY; v += 10) { svg.append(s("line", { x1: pl, y1: sy(v), x2: W - pr, y2: sy(v), stroke: "#202024" })); svg.append(s("text", { x: pl - 6, y: sy(v) + 4, fill: "#6e6e73", "font-size": 11, "text-anchor": "end" }, String(v))); }
    svg.append(s("line", { x1: pl, y1: sy(0), x2: W - pr, y2: sy(0), stroke: "#3a3a3e", "stroke-width": 1.2 }));
    for (const x of lines) svg.append(s("polyline", { points: x.pts.map(([a, b]) => `${sx(a).toFixed(1)},${sy(b).toFixed(1)}`).join(" "), fill: "none", stroke: clubs.find((c) => c.club === x.sh.c)?.color || "#888", "stroke-width": 1.6, "stroke-opacity": 0.75 }, s("title", {}, `${x.sh.c} · peak ${fmtLM("height", x.sh.height)} yds · carry ${fmtLM("carry", x.sh.carry)}`)));
    return el("section", { class: "ps-card lm-card" }, [el("p", { class: "ps-t" }, "TRAJECTORY · FROM THE SIDE"), svg,
      el("p", { class: "muted small" }, `Height (yds) up, distance across. ${lines.some((x) => !x.sh.traj) ? "Shots with no measured flight (Excel and CSV files) are drawn through their peak height and carry." : ""}`)]);
  }

  /* ---------- each club's averages, opening to every shot ---------- */
  const COLS = ["carry", "total", "side", "height", "ballSpeed", "clubSpeed", "smash", "launch", "spin", "spinAxis", "attack", "path", "face", "faceToPath", "dynLoft", "landAngle"];
  function table(clubs) {
    const cols = COLS.filter((k) => clubs.some((c) => c.avg[k] != null));
    const head = el("tr", {}, [el("th", {}, "Club"), el("th", { class: "n" }, "Shots"), ...cols.map((k) => el("th", { class: "n", title: `${LM[k].label}${LM[k].unit ? ` (${LM[k].unit})` : ""}` }, [LM[k].short, LM[k].unit ? el("span", { class: "lm-unit" }, ` ${LM[k].unit}`) : null]))]);
    const body = [];
    for (const c of clubs) {
      const open = f.open.has(c.club);
      const tr = el("tr", { class: "lm-crow", tabindex: 0, "aria-expanded": String(open) }, [el("td", {}, [el("span", { class: "ps-caret" }, open ? "▾ " : "▸ "), el("i", { class: "lm-dot", style: `background:${c.color}` }), ` ${c.club}`]), el("td", { class: "n" }, String(c.n)),
        ...cols.map((k) => el("td", { class: "n" }, [fmtLM(k, c.avg[k]), (k === "carry" || k === "side") && c.sd[k] != null ? el("span", { class: "lm-sd" }, ` ±${c.sd[k].toFixed(1)}`) : null]))]);
      const flip = () => { if (open) f.open.delete(c.club); else f.open.add(c.club); draw(); };
      tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
      body.push(tr);
      if (open) for (const sh of [...c.shots].sort((a, b) => String(a.t).localeCompare(String(b.t)))) body.push(el("tr", { class: "lm-shot" }, [el("td", {}, [srcPill(sh.src), ` ${sh.t ? new Date(sh.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : dTxt(sh.sdate)}`]), el("td", {}, ""), ...cols.map((k) => el("td", { class: "n" }, fmtLM(k, sh[k])))]));
    }
    return el("section", { class: "ps-card lm-card" }, [el("p", { class: "ps-t" }, "BY CLUB · AVERAGES (TAP A CLUB FOR EVERY SHOT)"), el("div", { class: "ps-tw lm-tw" }, el("table", { class: "lm-t" }, [el("thead", {}, head), el("tbody", {}, body)])),
      el("p", { class: "muted small" }, "Side: yards left (L) or right (R) of the target line. ± is the typical spread from shot to shot.")]);
  }

  /* ---------- over time: a number, club by club, session by session ---------- */
  function overTime(shots, clubs) {
    const sel = el("select", { class: "ps-club", "aria-label": "Number to plot" }, LM_METRICS.filter(([k]) => shots.some((sh) => sh[k] != null)).map(([k, label]) => el("option", { value: k, selected: k === f.metric }, label)));
    sel.addEventListener("change", () => { f.metric = sel.value; draw(); });
    const k = f.metric, days = [...new Set(shots.filter((sh) => sh[k] != null).map((sh) => String(sh.t || sh.sdate).slice(0, 10)))].sort();
    const series = clubs.map((c) => ({ c, pts: days.map((dd) => { const v = c.shots.filter((sh) => sh[k] != null && String(sh.t || sh.sdate).slice(0, 10) === dd).map((sh) => sh[k]); return v.length ? [dd, mean(v), v.length] : null; }).filter(Boolean) })).filter((x) => x.pts.length);
    const all = series.flatMap((x) => x.pts.map((q) => q[1]));
    const W = narrow() ? 560 : 1000, H = narrow() ? 320 : 260, pl = 54, pr = 16, pt = 14, pb = 30;
    let body;
    if (days.length < 2 || !all.length) body = el("p", { class: "muted small" }, days.length < 2 ? "Over time needs shots from at least two days." : "No values for that number.");
    else {
      const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1, y0 = lo - pad, y1 = hi + pad;
      const sx = (i) => pl + 24 + (days.length === 1 ? 0.5 : i / (days.length - 1)) * (W - pl - pr - 48), sy = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
      const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "lm-svg", role: "img", "aria-label": `${LM[k].label} over time` });
      svg.append(s("rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: "#17171a" }));
      for (let j = 0; j <= 4; j++) { const v = y0 + ((y1 - y0) * j) / 4; svg.append(s("line", { x1: pl, y1: sy(v), x2: W - pr, y2: sy(v), stroke: "#232327" })); svg.append(s("text", { x: pl - 6, y: sy(v) + 4, fill: "#6e6e73", "font-size": 11, "text-anchor": "end" }, fmtLM(k, v))); }
      const every = Math.max(1, Math.ceil(days.length / 8));
      days.forEach((dd, i) => { if (i % every === 0 || i === days.length - 1) svg.append(s("text", { x: sx(i), y: H - 10, fill: "#8e8e93", "font-size": 11, "text-anchor": "middle" }, new Date(`${dd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }))); });
      for (const x of series) {
        const P = x.pts.map(([dd, v]) => [sx(days.indexOf(dd)), sy(v)]);
        if (P.length > 1) svg.append(s("polyline", { points: P.map((q) => q.join(",")).join(" "), fill: "none", stroke: x.c.color, "stroke-width": 2.2 }));
        x.pts.forEach(([dd, v, n], i) => svg.append(s("circle", { cx: P[i][0], cy: P[i][1], r: 4.5, fill: x.c.color, stroke: "#0b0b0d", "stroke-width": 1.2 }, s("title", {}, `${x.c.club} · ${dTxt(dd)} · ${fmtLM(k, v, { unit: true })} (${n} shot${n === 1 ? "" : "s"})`))));
      }
      // the change for each club: its first day against its last
      const ch = series.filter((x) => x.pts.length > 1).map((x) => { const d0 = x.pts[0][1], d1 = x.pts.at(-1)[1]; return el("span", { class: "lm-chg" }, [el("i", { class: "lm-dot", style: `background:${x.c.color}` }), ` ${x.c.club}: ${fmtLM(k, d0)} → ${fmtLM(k, d1)}${LM[k].unit ? ` ${LM[k].unit}` : ""}`]); });
      body = [svg, ch.length ? el("div", { class: "lm-chgs" }, ch) : null];
    }
    return el("section", { class: "ps-card lm-card" }, [el("div", { class: "lm-head" }, [el("p", { class: "ps-t" }, "OVER TIME · EACH DAY’S AVERAGE"), sel]), ...[].concat(body)]);
  }

  /* ---------- the sessions ---------- */
  function sessionList() {
    if (!sessions.length) return null;
    return el("section", { class: "ps-card lm-card" }, [el("p", { class: "ps-t" }, `SESSIONS · ${sessions.length}`),
      ...sessions.map((x) => {
        const del = canWrite ? el("button", { type: "button", class: "link danger small" }, "Delete") : null;
        del?.addEventListener("click", async () => { if (!confirm(`Delete the ${SRC[x.src]} session from ${dTxt(x.date)} (${x.shots.length} shots)?`)) return; try { await deleteLM(owner, x.id); f.sess.delete(x.id); await load(); } catch (err) { console.error(err); flash("Couldn’t delete it.", "error"); } });
        const clubs = [...new Set(x.shots.map((sh) => sh.c))];
        return el("div", { class: "lm-sess" }, [el("div", {}, [srcPill(x.src), el("strong", {}, ` ${dTxt(x.date)}${x.dateTo && x.dateTo !== x.date ? ` – ${dTxt(x.dateTo)}` : ""}`),
          el("span", { class: "muted small" }, ` · ${x.shots.length} shots · ${clubs.length} club${clubs.length === 1 ? "" : "s"} · ${VIA[x.via] || ""}${x.name ? ` (${x.name})` : ""}${x.addedBy?.name ? ` · added by ${x.addedBy.name}` : ""}`),
          x.link ? el("a", { href: x.link, target: "_blank", rel: "noopener", class: "link small" }, " Open in TrackMan ↗") : null]), del]);
      })]);
  }

  function draw() {
    if (loading) { mount(box, [importer(), el("p", { class: "muted" }, "Loading launch monitor sessions…")]); return; }
    if (!sessions.length) { mount(box, [importer(), el("p", { class: "muted lm-empty" }, canWrite ? `No launch monitor sessions${who ? ` for ${who}` : ""} yet. Paste a TrackMan report link or upload a file above.` : `No launch monitor sessions${who ? ` for ${who}` : ""} yet.`)]); return; }
    const sh = shown(), clubs = byClub(sh).map((c) => ({ ...c, color: colorOf(c.club) }));
    const tiles = el("div", { class: "ps-tiles" }, [
      el("div", { class: "ps-tile" }, [el("b", {}, String(sh.length)), el("span", {}, "shots shown")]),
      el("div", { class: "ps-tile" }, [el("b", {}, String(clubs.length)), el("span", {}, `club${clubs.length === 1 ? "" : "s"}`)]),
      el("div", { class: "ps-tile" }, [el("b", {}, String(new Set(sh.map((x) => x.sid)).size)), el("span", {}, "sessions")]),
    ]);
    mount(box, [importer(), filters(), tiles, ...(sh.length ? [dispersion(sh, clubs), trajectory(sh, clubs), table(clubs), overTime(sh, clubs)] : [el("p", { class: "muted" }, "No shots match these filters.")]), sessionList()]);
  }
  await load();
}
