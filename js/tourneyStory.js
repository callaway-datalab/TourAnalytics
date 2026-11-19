// (update 915) How a tournament played out, from every player's hole-by-hole scorecard (the live feed's results/cards/{T_ID}.json):
// the leaderboard after every hole (every player who'd played that many holes; holes taken in number order, so with two
// tees in the early rounds a "hole" is the same hole for everyone, not the same moment), who led when and by how much,
// the lead changes, whether the winner went wire to wire or came from behind, who let a lead slip, the charges and the low
// rounds. cards: { par: [18], rounds: { "1": { pid: [18 strokes] } }, names: { pid } }; board: the official leaderboard
// rows [{ pid, name, pos, total }] (for the finishing places).
const ord = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
const tp = (v) => (v === 0 ? "E" : v > 0 ? `+${v}` : `−${-v}`);

export function tourneyStory(cards, board = []) {
  const R = Object.keys(cards?.rounds || {}).map(Number).filter((r) => Object.keys(cards.rounds[r] || {}).length).sort((a, b) => a - b);
  if (!R.length) return null;
  // par: the file's, else each hole's most common score
  const par = (cards.par && cards.par.every((p) => p > 0)) ? cards.par : Array.from({ length: 18 }, (_, h) => { const c = new Map(); for (const r of R) for (const s of Object.values(cards.rounds[r])) { const v = s[h]; if (v > 0) c.set(v, (c.get(v) || 0) + 1); } return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || 4; });
  const pids = [...new Set(R.flatMap((r) => Object.keys(cards.rounds[r])))];
  const nameOf = (pid) => cards.names?.[pid] || board.find((b) => String(b.pid) === String(pid))?.name || pid;
  const last = (n) => String(nameOf(n)).trim().split(/\s+/).slice(-1)[0];
  // each player's running score to par after every hole (null once he stops: missed cut, withdrew, not yet played)
  const NC = R.length * 18, cum = new Map(), rnd = new Map();
  for (const pid of pids) { const a = new Array(NC).fill(null), rr = {}; let t = 0, alive = true;
    R.forEach((r, ri) => { const s = cards.rounds[r]?.[pid]; let rs = 0, done = 0;
      for (let h = 0; h < 18; h++) { const v = s?.[h]; if (alive && v > 0) { t += v - par[h]; rs += v; done++; a[ri * 18 + h] = t; } else alive = false; }
      if (done === 18) rr[r] = rs; });
    cum.set(pid, a); rnd.set(pid, rr); }
  // the board after every hole
  const steps = Array.from({ length: NC }, (_, c) => { const xs = pids.map((p) => [p, cum.get(p)[c]]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]); if (!xs.length) return null;
    const best = xs[0][1], leaders = xs.filter((x) => x[1] === best).map((x) => x[0]), second = xs.find((x) => x[1] > best)?.[1];
    return { c, r: R[Math.floor(c / 18)], h: (c % 18) + 1, best, leaders, margin: leaders.length === 1 && second != null ? second - best : 0, field: xs }; });
  const lastStep = steps.filter(Boolean).at(-1); if (!lastStep) return null;
  const finished = lastStep.c === NC - 1;
  // the winner: the official leaderboard's 1st, else the lowest score after the last hole
  const bWin = board.find((b) => /^1$/.test(String(b.pos || "").trim()) && b.pid), winner = bWin && pids.includes(String(bWin.pid)) ? String(bWin.pid) : lastStep.leaders[0];
  const posOf = (pid) => { const b = board.find((x) => String(x.pid) === String(pid)); if (b?.pos) return String(b.pos); const xs = lastStep.field, i = xs.findIndex((x) => x[0] === pid); return i < 0 ? null : String(1 + xs.filter((x) => x[1] < xs[i][1]).length); };
  const behind = (pid, c) => { const s = steps[c], v = cum.get(pid)[c]; return s && v != null ? v - s.best : null; };
  const W = winner, Wn = nameOf(W), Wl = last(W), at = (c) => `No. ${steps[c].h} in round ${steps[c].r}`;
  const ends = R.map((r, i) => (i + 1) * 18 - 1).filter((c) => steps[c]);
  const out = { winner: W, winnerName: Wn, finished, facts: [], series: null, roundLeaders: [] };
  // after each round: who led, by how much, and where the winner stood
  for (const c of ends) { const s = steps[c], wb = behind(W, c), wpos = 1 + s.field.filter((x) => x[1] < cum.get(W)[c]).length;
    out.roundLeaders.push({ r: s.r, leaders: s.leaders.map(nameOf), score: s.best, margin: s.margin, winnerBack: wb, winnerPos: wpos }); }
  // share of the lead, wire to wire, lead changes, taking the lead for good
  const live = steps.filter(Boolean), led = live.filter((s) => s.leaders.includes(W)), soloLed = live.filter((s) => s.leaders.length === 1 && s.leaders[0] === W);
  const wire = finished && ends.every((c) => steps[c].leaders.includes(W)), wireSolo = wire && ends.every((c) => steps[c].leaders.length === 1);
  let changes = 0, prev = null; for (const s of live) { if (s.leaders.length !== 1) continue; if (prev && s.leaders[0] !== prev) changes++; prev = s.leaders[0]; }
  let forGood = null; for (let i = live.length - 1; i >= 0; i--) { if (!(live[i].leaders.length === 1 && live[i].leaders[0] === W)) { forGood = live[i + 1] || null; break; } if (i === 0) forGood = live[0]; }
  // the winner's deepest hole, and where he started the final round
  let deep = { back: 0, c: null }; for (const s of live) { const b = behind(W, s.c); if (b != null && b > deep.back) deep = { back: b, c: s.c }; }
  const preFinal = ends.length >= 2 ? ends[ends.length - 2] : null, backFinal = preFinal != null ? behind(W, preFinal) : null;
  // the biggest lead of the week
  const bigLead = live.reduce((m, s) => (s.margin > (m?.margin || 0) ? s : m), null);
  // a lead let slip: anyone else who led alone by 2+ in the final round (or into it), and where he finished
  const finalR = R.at(-1), slips = [];
  if (finished) { const byP = new Map(); for (const s of live) { if (s.r !== finalR && s.c !== preFinal) continue; if (s.leaders.length !== 1 || s.leaders[0] === W || s.margin < 2) continue; const p = s.leaders[0], o = byP.get(p); if (!o || s.margin > o.margin) byP.set(p, { pid: p, margin: s.margin, c: s.c }); }
    for (const o of byP.values()) slips.push({ ...o, name: nameOf(o.pid), pos: posOf(o.pid), holesLeft: NC - 1 - o.c }); slips.sort((a, b) => b.margin - a.margin); }
  // the final-round charge: the biggest climb into the top 10 from the start of the final round
  let charge = null; if (finished && preFinal != null) { const rankAt = (pid, c) => { const v = cum.get(pid)[c]; return v == null ? null : 1 + steps[c].field.filter((x) => x[1] < v).length; };
    for (const pid of pids) { const a = rankAt(pid, preFinal), b = rankAt(pid, NC - 1); if (a == null || b == null || b > 10) continue; const up = a - b; if (up > (charge?.up || 0)) charge = { pid, name: nameOf(pid), from: a, to: b, up, rs: rnd.get(pid)[finalR] }; } }
  // the low round of the week
  let low = null; for (const pid of pids) for (const [r, s] of Object.entries(rnd.get(pid))) if (!low || s < low.s) low = { pid, name: nameOf(pid), r: Number(r), s };
  const parT = par.reduce((a, b) => a + b, 0);
  // the story, in plain words
  const F = out.facts, lb = (s) => (s.leaders.length === 1 ? `${last(s.leaders[0])}` : `${s.leaders.length} players`);
  if (finished) {
    const pct = Math.round((100 * led.length) / Math.max(1, live.length));
    if (wire) F.push({ k: "lead", t: `${Wn} won wire to wire: ${wireSolo ? "the outright leader" : "leading or sharing the lead"} after every round, and ahead (or level) for ${pct}% of the holes.` });
    else if (backFinal != null && backFinal >= 3) F.push({ k: "comeback", t: `A comeback: ${Wn} started the final round ${backFinal} back${deep.back > backFinal ? ` (he'd been as many as ${deep.back} back, after ${at(deep.c)})` : ""} and won. He led or shared the lead for only ${pct}% of the holes.` });
    else F.push({ k: "lead", t: `${Wn} led or shared the lead for ${pct}% of the holes${soloLed.length ? ` (alone for ${Math.round((100 * soloLed.length) / live.length)}%)` : ""}${deep.back >= 3 ? `, and was as many as ${deep.back} back after ${at(deep.c)}` : ""}.` });
    if (forGood && forGood.c > 0) F.push({ k: "turn", t: `He took the lead for good on ${at(forGood.c)}${forGood.c >= NC - 18 ? `, with ${NC - 1 - forGood.c} holes to play` : ""}.` });
    if (slips.length) { const s0 = slips[0]; F.push({ k: "slip", t: `${s0.name} let it slip: ${s0.margin} clear after ${at(s0.c)}${s0.holesLeft ? ` with ${s0.holesLeft} to play` : ""}, he finished ${s0.pos ? (/^\d+$/.test(s0.pos) ? ord(Number(s0.pos)) : s0.pos) : "out of it"}.` }); }
    const fin = steps[NC - 1], win2 = fin.field.find((x) => x[0] !== W)?.[1];
    if (win2 != null) { const m = win2 - cum.get(W)[NC - 1]; F.push({ k: "margin", t: m <= 0 ? `It went to a playoff (tied at ${tp(cum.get(W)[NC - 1])}).` : m === 1 ? `Won by a single shot.` : `Won by ${m} shots.` }); }
  } else F.push({ k: "lead", t: `Under way: ${lb(lastStep)} lead${lastStep.leaders.length === 1 ? "s" : ""} at ${tp(lastStep.best)} after ${at(lastStep.c)}${lastStep.margin ? ` by ${lastStep.margin}` : ""}.` });
  if (changes >= 1) F.push({ k: "changes", t: `The outright lead changed hands ${changes} time${changes === 1 ? "" : "s"}.` });
  if (bigLead && bigLead.margin >= 3) F.push({ k: "big", t: `Biggest lead of the week: ${last(bigLead.leaders[0])}, ${bigLead.margin} clear after ${at(bigLead.c)}${bigLead.leaders[0] !== W && finished ? `, and he didn't win (${(() => { const p = posOf(bigLead.leaders[0]); return p ? (/^\d+$/.test(p) ? ord(Number(p)) : p) : "—"; })()})` : ""}.` });
  if (charge && charge.up >= 8) F.push({ k: "charge", t: `Final-round charge: ${charge.name} went from ${ord(charge.from)} to ${ord(charge.to)}${charge.rs ? ` with a ${charge.rs} (${tp(charge.rs - parT)})` : ""}.` });
  if (low) F.push({ k: "low", t: `Low round of the week: ${low.name}, ${low.s} (${tp(low.s - parT)}) in round ${low.r}.` });
  // the race chart: the top five finishers' strokes behind the lead after every hole
  const top = finished ? [...steps[NC - 1].field].slice(0, 5).map((x) => x[0]) : lastStep.field.slice(0, 5).map((x) => x[0]);
  if (!top.includes(W)) top.unshift(W);
  out.series = { n: NC, rounds: R, lines: top.slice(0, 5).map((pid) => ({ pid, name: nameOf(pid), win: pid === W, pts: steps.map((s, c) => (s && cum.get(pid)[c] != null ? cum.get(pid)[c] - s.best : null)) })) };
  out.roundsOf = (pid) => rnd.get(String(pid)) || null;
  out.par = parT;
  return out;
}
