// Made-up but realistic data for the Home test page: 55 players (40 PGA, 15 DPWT), two seasons, events of 4 rounds
// (some cut after 2), strokes gained by part of the game and by distance, clubs with a few switches.
let seed = 11; export const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
const PGA = ["Scottie Scheffler","Rory McIlroy","Xander Schauffele","Sam Burns","Collin Morikawa","Ludvig Aberg","Tommy Fleetwood","Patrick Cantlay","Viktor Hovland","Hideki Matsuyama","Keegan Bradley","Russell Henley","Shane Lowry","Justin Thomas","Sungjae Im","Robert MacIntyre","Corey Conners","Wyndham Clark","Akshay Bhatia","Maverick McNealy","Harris English","Sepp Straka","Tom Kim","Jason Day","Byeong Hun An","Andrew Novak","Lucas Glover","Denny McCarthy","Brian Harman","Min Woo Lee","Si Woo Kim","Blades Brown","Erik van Rooyen","Ben Kohles","Chris Kirk","Matt Fitzpatrick","Austin Smotherman","Zac Blair","Max Homa","Cameron Young"];
const DP = ["Tom McKibbin","Tyrrell Hatton","Jon Rahm","Wenyi Ding","Rasmus Hojgaard","Adrian Meronk","Angel Hidalgo","Grant Forrest","Eugenio Chacarra","Yuto Katsuragawa","Thriston Lawrence","Laurie Canter","Matteo Manassero","Paul Waring","Thorbjorn Olesen"];
const PGA_EV = ["The American Express","Farmers Insurance Open","WM Phoenix Open","AT&T Pebble Beach Pro-Am","Genesis Invitational","Arnold Palmer Invitational","THE PLAYERS Championship","Valspar Championship","Masters Tournament","RBC Heritage","Truist Championship","PGA Championship","Charles Schwab Challenge","the Memorial Tournament","RBC Canadian Open","U.S. Open","Travelers Championship","Rocket Classic","John Deere Classic","Genesis Scottish Open","3M Open","Wyndham Championship","FedEx St. Jude Championship","BMW Championship","TOUR Championship"];
const DP_EV = ["Dubai Desert Classic","Ras al Khaimah Championship","Qatar Masters","Kenya Open","Italian Open","Soudal Open","BMW International Open","Scottish Open","Irish Open","BMW PGA Championship","Alfred Dunhill Links","Open de Espana","Genesis Championship","Abu Dhabi Championship","DP World Tour Championship"];
const APP = ["50-100 yds","100-120 yds","120-140 yds","140-160 yds","160-180 yds","180-200 yds","200-220 yds",">220 yds"], ARG = ["<30 yds"], PUTT = ["<5 ft","5-10 ft","10-15 ft","15-20 ft","20-25 ft",">25 ft"];
export const key = (n) => "c_" + n.toLowerCase().replace(/[^a-z]+/g, "");
const players = [...PGA.map((n) => [n, "PGA"]), ...DP.map((n) => [n, "DPWT"])].map(([name, tour], i) => {
  const sk = { OTT: gauss() * 0.35, APP: gauss() * 0.45, ARG: gauss() * 0.25, PUTT: gauss() * 0.35 }, base = i < 3 ? 0.6 : 0;
  return { key: key(name), name, tour, sk, base, sd: 1.4 + rnd() * 1.4 }; });
const evDate = (yr, i, n) => { const d = new Date(Date.UTC(yr, 0, 18 + Math.floor((i * 300) / n))); return d.toISOString().slice(0, 10); };
const full = new Map(); // key → rounds with shots (distances, clubs)
const IRONS = ["Callaway Apex MB", "Callaway Apex MB 25"], DRIVERS = ["Callaway Paradym Ai Smoke TD", "Callaway Quantum Mini"];
for (const p of players) { const evs = p.tour === "PGA" ? PGA_EV : DP_EV, rs = [];
  for (const yr of [2025, 2026]) evs.forEach((e, ei) => { if (rnd() < 0.25) return; const cut = rnd() < 0.3, nR = cut ? 2 : 4, date0 = evDate(yr, ei, evs.length);
    if (yr === 2026 && date0 > "2026-11-14") return;
    const trend = yr === 2026 && ei > evs.length * 0.6 ? gauss() * 0.3 : 0;
    for (let r = 1; r <= nR; r++) { const d = new Date(Date.parse(date0) + (r - 1) * 864e5).toISOString().slice(0, 10), shots = [];
      const swingIron = p.name === "Sam Burns" && yr === 2026 && ei >= evs.length - 2 ? IRONS[1] : IRONS[0], drv = p.name === "Erik van Rooyen" && yr === 2026 && ei >= 12 ? DRIVERS[1] : DRIVERS[0];
      const add = (cat, dist, n, mean, gear) => { for (let s = 0; s < n; s++) shots.push({ cat, sg: (mean + gauss() * 0.35) / n * 1, w: 1, dist, lie: cat === "PUTT" ? "green" : rnd() < 0.7 ? "fairway" : "rough", gear, ball: "Chrome Tour" }); };
      const day = gauss() * p.sd * 0.35;
      { const nd = rnd() >= 0.8; add("OTT", nd ? "Non-Driver" : "Driver", 14, p.sk.OTT + day * 0.25 + trend, nd ? "Non-Driver|Callaway Elyte 3 Wood" : `Driver|${drv}`); }
      for (const ds of APP) add("APP", ds, 1 + Math.floor(rnd() * 3), (p.sk.APP + day * 0.3 + trend) / 4, `Iron|${swingIron}`);
      add("ARG", ARG[0], 4, p.sk.ARG + day * 0.15, "Wedge|Callaway Opus 56");
      for (const ds of PUTT) add("PUTT", ds, 1 + Math.floor(rnd() * 3), (p.sk.PUTT + day * 0.3 + trend) / 6, "Putter|Odyssey Ai-ONE");
      rs.push({ date: d, event: e, roundNo: String(r), year: String(yr), tour: p.tour, shots }); } });
  full.set(p.key, rs); }
export const FAVS = ["Sam Burns", "Xander Schauffele", "Akshay Bhatia", "Min Woo Lee", "Si Woo Kim", "Blades Brown", "Tom McKibbin", "Erik van Rooyen"].map(key);
export const PLAYERS = players;
export const fullRounds = (k) => full.get(k) || [];
export function summary() { return { players: players.map((p) => ({ key: p.key, name: p.name, rounds: fullRounds(p.key).map((rd) => { const c = {}; for (const s of rd.shots) { const o = c[s.cat] || (c[s.cat] = [0, 0]); o[0] += s.sg; o[1] += 1; } return { d: rd.date, e: rd.event, r: rd.roundNo, y: rd.year, t: rd.tour, c }; }) })) }; }

// (the course) Pete Dye Stadium Course, The American Express: every hole of every round there (2025 and 2026) by the PGA
// players who played it, shot by shot (lie, distance, position, the hole's score)
export const COURSE = { id: "pdsc", name: "Pete Dye Stadium Course", par: [4,4,4,4,3,5,3,4,4,4,5,4,3,4,4,4,3,4], events: [{ name: "The American Express", years: ["2025", "2026"] }], rawChunks: 1 };
let rawMemo = null;
export function courseRows() { if (rawMemo) return rawMemo; const rows = [];
  for (const p of players.filter((q) => q.tour === "PGA")) for (const rd of fullRounds(p.key).filter((r) => r.event === "The American Express")) {
    const skill = (p.sk.APP + p.sk.PUTT + p.sk.OTT) / 3;
    COURSE.par.forEach((par, hi) => { let d = par === 3 ? 160 + rnd() * 60 : par === 4 ? 380 + rnd() * 80 : 530 + rnd() * 40, lie = "tee"; const sh = [];
      for (let st = 1; st < 9; st++) { sh.push([st, lie, d]); if (lie === "green") { if (d < 3 || rnd() < 0.45 + skill * 0.2 - d / 90) break; d = Math.max(1, d * 0.1 + rnd() * 3); continue; }
        const nd = d - (lie === "tee" ? 270 + rnd() * 50 : d * (0.85 + rnd() * 0.14)); if (nd < 30 && rnd() < 0.6 + skill * 0.2) { lie = "green"; d = 3 + rnd() * 40; } else { lie = rnd() < 0.62 ? "fairway" : rnd() < 0.8 ? "rough" : "bunker"; d = Math.max(4, nd); } }
      const n = sh.length; sh.forEach(([st, l, dd], i) => { const f = 1 - Math.min(dd, 600) / 600, last = i === n - 1;
        rows.push([rd.year, 1, COURSE.name, p.name, p.name, Number(rd.roundNo), hi + 1, par, "A", l, st, last ? n - par : null, last ? 1 : 0, 100 + f * 700, 300 - f * 220, null, 820, 80, Math.round(dd), "The American Express", null, null]); }); }); }
  return (rawMemo = rows); }
