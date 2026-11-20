// (update 916) Clutch: how players score when a tournament is on the line, from every saved scorecard (results/cards/*.json).
// For every finished event with scorecards:
//   • each round, each player's score against that round's field average (strokes better than the field: + is better);
//     his usual level is the average of all his rounds
//   • contention: within 3 shots of the lead going into the final round (having made the cut)
//   • in contention: his final round against the field that day, and his back nine (holes 10-18) of it, each against his usual
//   • the 54-hole lead (alone or shared) and whether he converted it; wins from behind and how far back he started
//   • a lead let slip: 2+ clear at some point in the final round (holes in number order) and not the winner
// Clutch = his final rounds in contention against his usual round, pulled toward 0 by how few there are (+ rises to it).
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function clutchFrom(events) {
  const P = new Map(), get = (pid, name) => P.get(pid) || P.set(pid, { pid, name, rounds: 0, gainSum: 0, cont: [], leads: 0, leadWins: 0, wins: 0, winsBehind: 0, maxBackWon: 0, blown: [], events: 0, winList: [] }).get(pid);
  for (const ev of events) {
    const C = ev.cards; if (!C?.rounds) continue;
    const R = Object.keys(C.rounds).map(Number).filter((r) => Object.keys(C.rounds[r] || {}).length).sort((a, b) => a - b);
    if (R.length < 3 || !C.final) continue;
    const par = C.par?.every((p) => p > 0) ? C.par : null; if (!par) continue;
    const parT = par.reduce((a, b) => a + b, 0), fr = R.at(-1), pre = R.slice(0, -1), nameOf = (pid) => C.names?.[pid] || pid;
    const tot = (r, pid) => { const s = C.rounds[r]?.[pid]; return s && s.length === 18 && s.every((v) => v > 0) ? s.reduce((a, b) => a + b, 0) : null; };
    // each round against its field
    const fieldAvg = {}; for (const r of R) { const xs = Object.keys(C.rounds[r]).map((p) => tot(r, p)).filter((v) => v != null); fieldAvg[r] = mean(xs); }
    for (const r of R) for (const pid of Object.keys(C.rounds[r])) { const t = tot(r, pid); if (t == null || fieldAvg[r] == null) continue; const o = get(pid, nameOf(pid)); o.rounds++; o.gainSum += fieldAvg[r] - t; }
    // into the final round: the cut-makers' scores after the earlier rounds
    const made = Object.keys(C.rounds[fr]).filter((pid) => tot(fr, pid) != null && pre.every((r) => tot(r, pid) != null));
    if (made.length < 10) continue;
    const before = new Map(made.map((pid) => [pid, pre.reduce((a, r) => a + tot(r, pid), 0)])), lead = Math.min(...before.values());
    const final = new Map(made.map((pid) => [pid, before.get(pid) + tot(fr, pid)])), best = Math.min(...final.values());
    const bWin = (ev.board || []).find((b) => /^1$/.test(String(b.pos || "").trim()));
    const winner = bWin && made.includes(String(bWin.pid)) ? String(bWin.pid) : [...final].filter(([, v]) => v === best).length === 1 ? [...final].find(([, v]) => v === best)[0] : null;
    const posOf = (pid) => { const b = (ev.board || []).find((x) => String(x.pid) === pid); if (b?.pos) return String(b.pos); const v = final.get(pid); return String(1 + [...final.values()].filter((x) => x < v).length); };
    const b9 = (r, pid) => { const s = C.rounds[r]?.[pid]; return s ? s.slice(9).reduce((a, b) => a + b, 0) : null; }, b9avg = mean(made.map((p) => b9(fr, p)).filter((v) => v != null));
    const nLead = [...before.values()].filter((v) => v === lead).length;
    for (const pid of made) { const o = get(pid, nameOf(pid)); o.events++;
      const back = before.get(pid) - lead;
      if (pid === winner) { o.wins++; o.winList.push({ ev: ev.name, year: ev.year, back, fr: tot(fr, pid), gain: fieldAvg[fr] - tot(fr, pid) }); /* (update 935: which ones) */ if (back > 0) { o.winsBehind++; o.maxBackWon = Math.max(o.maxBackWon, back); } }
      if (back === 0) { o.leads++; if (pid === winner) o.leadWins++; }
      if (back <= 3) o.cont.push({ ev: ev.name, year: ev.year, back, shared: back === 0 && nLead > 1, fr: tot(fr, pid), par: parT, gain: fieldAvg[fr] - tot(fr, pid), b9: b9avg != null ? b9avg - b9(fr, pid) : null, pos: posOf(pid), won: pid === winner }); }
    // a lead let slip in the final round (2+ clear, holes in number order)
    if (winner) { const run = new Map(made.map((pid) => [pid, before.get(pid) - pre.length * parT]));
      const slip = new Map();
      for (let h = 0; h < 18; h++) { for (const pid of made) run.set(pid, run.get(pid) + C.rounds[fr][pid][h] - par[h]);
        const xs = [...run].sort((a, b) => a[1] - b[1]); if (xs.length < 2 || xs[0][1] === xs[1][1] || xs[0][0] === winner) continue;
        const m = xs[1][1] - xs[0][1]; if (m >= 2 && m > (slip.get(xs[0][0])?.margin || 0)) slip.set(xs[0][0], { margin: m, hole: h + 1 }); }
      for (const [pid, s] of slip) get(pid, nameOf(pid)).blown.push({ ev: ev.name, year: ev.year, ...s, pos: posOf(pid) }); }
  }
  // the numbers each player gets
  for (const o of P.values()) {
    o.usual = o.rounds ? o.gainSum / o.rounds : null;
    const n = o.cont.length; o.contN = n;
    o.contGain = n ? mean(o.cont.map((c) => c.gain)) : null;
    const b9 = o.cont.map((c) => c.b9).filter((v) => v != null); o.b9Gain = b9.length ? mean(b9) : null;
    o.clutchRaw = n && o.usual != null ? o.contGain - o.usual : null;
    o.clutch = o.clutchRaw != null ? (o.clutchRaw * n) / (n + 3) : null; // (pulled toward 0: three average rounds added)
    o.contWins = o.cont.filter((c) => c.won).length;
    o.label = labelOf(o);
  }
  return P;
}

/** a plain-words label, only where the record is long enough to say it */
export function labelOf(o) {
  if (o.leads >= 2 && o.leadWins / o.leads >= 0.6 && (o.clutch ?? 0) >= 0) return { k: "closer", t: "Closer", why: `Converted ${o.leadWins} of ${o.leads} 54-hole leads` };
  if (o.contN >= 4 && (o.clutch ?? 0) >= 0.6) return { k: "riser", t: "Rises to it", why: `${fmt(o.clutchRaw)} a round better than usual in final rounds in contention (${o.contN} times)` };
  if (o.leads >= 2 && o.leadWins === 0) return { k: "fader", t: "Struggles with the lead", why: `0 of ${o.leads} 54-hole leads converted` };
  if (o.blown.length >= 2) return { k: "fader", t: "Leads slip away", why: `Let a 2+ shot final-round lead slip ${o.blown.length} times` };
  if (o.contN >= 4 && (o.clutch ?? 0) <= -0.6) return { k: "fader", t: "Fades under pressure", why: `${fmt(o.clutchRaw)} a round worse than usual in final rounds in contention (${o.contN} times)` };
  if (o.winsBehind >= 1 && o.leads >= 1 && o.leadWins === 0) return { k: "chaser", t: "Wins from behind", why: `${o.winsBehind} win${o.winsBehind === 1 ? "" : "s"} from behind, none from the front` };
  if (o.winsBehind >= 2) return { k: "chaser", t: "Comes from behind", why: `${o.winsBehind} wins from behind (up to ${o.maxBackWon} back)` };
  return null;
}
const fmt = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
export { fmt as clutchFmt };
