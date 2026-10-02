// Strokes-gained analysis for shot-level data (one row per shot), used by Data → Analyze.
// Column names are matched loosely (case, spaces and underscores ignored) so files from different
// sources work without renaming. Anything missing just hides the charts that need it.

export const CATEGORIES = [
  ["OTT", "Off-the-Tee"],
  ["APP", "Approach"],
  ["ARG", "Around-the-Green"],
  ["PUTT", "Putting"],
];

const ALIASES = {
  category: ["category", "shotcategory", "sgcategory", "shottype"],
  sg: ["cdsg", "sg", "strokesgained", "sgshot", "sgvalue", "sgtotal"],
  // Aggregated files: strokes gained per attempt, times the number of attempts in that row.
  sgPerAttempt: ["strokesgainedattempt", "strokesgainedperattempt", "sgattempt", "sgperattempt", "sgpershot"],
  attempts: ["attempts", "shots", "numshots", "shotcount"],
  date: ["date", "rounddate", "eventdate"],
  year: ["year", "season"],
  event: ["tournament", "event", "eventname", "tournamentname"],
  round: ["playerrndname", "roundid", "round", "roundnumber", "rnd"],
  hole: ["hole", "holenumber"],
  distanceRange: ["distancerange", "distancebucket", "distance"],
  lie: ["lie", "startlie"],
  dogleg: ["dogleg"],
  pin: ["pinlocation", "pin", "pinposition"],
  puttBreak: ["putttotalbreak", "puttbreak", "break"],
  missDir: ["fwymissdirection", "missdirection", "fairwaymiss"],
  hitFwy: ["hitfwy", "fairwayhit", "hitfairway"],
  dispersion: ["dispersionleave", "lateralleave", "leftright"],
  distLeave: ["distanceleave", "longshort", "depthleave"],
  proximity: ["endproximity", "proximity", "proximityft", "leave"],
  onGreen: ["endongreen", "hitgreen", "gir", "ongreen"],
  holeOut: ["holeout", "holed", "made"],
  upDown: ["upanddown", "updown", "scrambling"],
  driveDist: ["drivedistance", "drivingdistance", "carrydistance", "totaldistance"],
  startDist: ["startdistance", "distancetopin", "puttlength", "shotdistance"],
  headSpeed: ["headspeed", "clubspeed", "clubheadspeed"],
  ballSpeed: ["ballspeed"],
  smash: ["smashfactor", "smash"],
  launch: ["launchangle", "launch"],
  spin: ["backspin", "spinrate", "spin"],
  club: ["club", "clubused", "clubtype", "clubname"],
};

// A club's bag group from its name ("Driver", "3w"/"3 Wood", "4H"/"4 Hybrid", "7i"/"7 Iron", "56°"/"SW"…).
export function clubGroup(name) {
  const s = String(name).toLowerCase().replace(/\s+/g, "");
  if (/driver|^1w$/.test(s)) return "Driver";
  if (/putter/.test(s)) return "Putter";
  if (/^\d+w$|wood/.test(s)) return "Fairway Wood";
  if (/^\d+h$|hybrid|rescue/.test(s)) return "Hybrid";
  if (/wedge|^(gw|sw|lw|aw|uw)$|°|deg/.test(s)) return "Wedge";
  if (/^\d+i$|iron|^pw$/.test(s)) return "Iron";
  return "Other";
}

// Clubs in bag order: driver, woods, hybrids, irons, wedges, putter.
const clubOrder = (s) => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, "")) || 0;
  return /^driver/i.test(s) ? n / 100 : /^\d+w$/i.test(s) ? 1 + n / 100 : /^\d+H$/.test(s) ? 2 + n / 100 : /^\d+i$/i.test(s) ? 3 + n / 100
    : /^PW$/i.test(s) ? 3.99 : /wedge/i.test(s) ? 4 + n / 1000 : /putter/i.test(s) ? 5 : 6;
};
const LIE_ORDER = ["teebox", "tee", "fairway", "firstcut", "rough", "bunker", "sand", "recovery", "fringe", "green"];
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map our field names to column indexes in this file. */
export function detectColumns(columns) {
  const names = columns.map((c) => squash(typeof c === "string" ? c : c.name));
  const idx = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const i = aliases.map((a) => names.indexOf(a)).find((n) => n >= 0);
    if (i !== undefined) idx[field] = i;
  }
  return idx;
}

/** Can this file drive the strokes-gained view? */
export const isShotData = (idx) => idx.category !== undefined && (idx.sg !== undefined || idx.sgPerAttempt !== undefined);

export function normalizeCategory(v) {
  const s = squash(v);
  if (["ott", "offthetee", "tee", "driving", "drive"].includes(s)) return "OTT";
  if (["app", "approach", "approachthegreen", "approachgreen"].includes(s)) return "APP";
  if (["arg", "aroundthegreen", "aroundgreen", "shortgame", "chipping"].includes(s)) return "ARG";
  if (["putt", "putting", "putts"].includes(s)) return "PUTT";
  return null;
}

const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const truthy = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = squash(v);
  if (["1", "true", "yes", "y", "hit", "made", "holed"].includes(s)) return true;
  if (["0", "false", "no", "n", "miss", "missed"].includes(s)) return false;
  return null;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const lead = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : Infinity; };

/** Turn one player's rows into shots grouped by round, oldest round first. */
export function prepare(rows, idx) {
  const get = (r, f) => (idx[f] === undefined ? null : r[idx[f]]);
  const rounds = new Map();
  for (const r of rows) {
    const cat = normalizeCategory(get(r, "category"));
    // One row can stand for several shots ("attempts"); its SG is then per attempt × attempts.
    const w = idx.attempts !== undefined ? num(get(r, "attempts")) : 1;
    const per = idx.sgPerAttempt !== undefined ? num(get(r, "sgPerAttempt")) : null;
    const sg = per !== null && w !== null ? per * w : num(get(r, "sg"));
    if (!cat || sg === null || w === null || w <= 0) continue;
    const date = get(r, "date") ?? "";
    const event = get(r, "event") ?? "";
    const rnd = get(r, "round") ?? "";
    const key = idx.round !== undefined && isNaN(Number(rnd)) ? String(rnd) : `${date}|${event}|${rnd}`;
    if (!rounds.has(key)) {
      const d = new Date(date);
      const year = get(r, "year") ?? (isNaN(d) ? "" : d.getFullYear());
      rounds.set(key, { key, date: String(date), event: String(event), roundNo: isNaN(Number(rnd)) ? "" : String(Number(rnd)), year: String(year ?? ""), shots: [] });
    }
    const lie = get(r, "lie"), dist = get(r, "distanceRange"), club = get(r, "club");
    rounds.get(key).shots.push({ cat, sg, w, r, lie: lie == null ? null : String(lie), dist: dist == null ? null : String(dist),
      club: club == null || club === "" ? null : String(club), clubCat: club == null || club === "" ? null : clubGroup(String(club)) });
  }
  const list = [...rounds.values()];
  if (idx.date !== undefined) list.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return list;
}

export const lastRounds = (rounds, n) => (n > 0 ? rounds.slice(-n) : rounds);

/** SG per round for each category, plus TOTAL and T2G (tee to green). */
export function sgPerRound(rounds) {
  const n = rounds.length || 1;
  const out = { OTT: 0, APP: 0, ARG: 0, PUTT: 0 };
  for (const rd of rounds) for (const s of rd.shots) out[s.cat] += s.sg;
  for (const k of Object.keys(out)) out[k] /= n;
  out.T2G = out.OTT + out.APP + out.ARG;
  out.TOTAL = out.T2G + out.PUTT;
  out.rounds = rounds.length;
  return out;
}

/** SG per round within each value of a column (e.g. Distance Range), for one category. */
export function sgBy(rounds, idx, cat, field) {
  if (idx[field] === undefined) return null;
  cat = cat || null;
  const n = rounds.length || 1;
  const groups = new Map();
  for (const rd of rounds) for (const s of rd.shots) {
    if (cat && s.cat !== cat) continue;
    const k = field === "lie" ? s.lie : field === "distanceRange" ? s.dist : s.r?.[idx[field]];
    if (k === null || k === undefined || k === "" || squash(k) === "none") continue;
    const g = groups.get(k) || { label: String(k), sg: 0, shots: 0 };
    g.sg += s.sg; g.shots += s.w;
    groups.set(k, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, perRound: g.sg / n }));
  // Distance-like labels sort by their leading number; lies from tee to green; others by label.
  const numeric = out.every((g) => lead(g.label) !== Infinity);
  const lieRank = (l) => { const i = LIE_ORDER.indexOf(squash(l)); return i < 0 ? 99 : i; };
  const lies = field === "lie" && out.some((g) => lieRank(g.label) < 99);
  const clubRank = (l) => (squash(l) === "driver" ? 0 : 1);
  out.sort((a, b) => (numeric ? lead(a.label) - lead(b.label)
    : lies ? lieRank(a.label) - lieRank(b.label)
    : field === "distanceRange" ? clubRank(a.label) - clubRank(b.label) || a.label.localeCompare(b.label)
    : a.label.localeCompare(b.label)));
  return out.length ? out : null;
}

/** SG per round for one category, grouped by event, month or year (oldest first). */
export function trend(rounds, cat, by = "event") {
  if (by === "round") {
    // One bar per round, oldest first, labeled with its date (and round number when there is one).
    return rounds.map((rd) => {
      const d = new Date(rd.date);
      const day = isNaN(d) ? rd.date : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} '${String(d.getFullYear()).slice(2)}`;
      return { label: `${day}${rd.roundNo ? ` R${rd.roundNo}` : ""}`, value: rd.shots.filter((s) => !cat || s.cat === cat).reduce((a, s) => a + s.sg, 0), rounds: 1, event: rd.event };
    });
  }
  const groups = new Map();
  for (const rd of rounds) {
    const d = new Date(rd.date);
    const valid = !isNaN(d);
    const key = by === "year" ? (valid ? String(d.getFullYear()) : "Unknown")
      : by === "month" ? (valid ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "Unknown")
      : (rd.event || rd.date || rd.key);
    const g = groups.get(key) || { label: key, sg: 0, rounds: 0, first: groups.size };
    g.sg += rd.shots.filter((s) => !cat || s.cat === cat).reduce((a, s) => a + s.sg, 0);
    g.rounds++;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ label: by === "month" ? monthLabel(g.label) : g.label, value: g.sg / g.rounds, rounds: g.rounds }));
}
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : ym;
};

/** Stat definitions shown in each category's "Stat Averages" table. */
const STATS = {
  OTT: [
    { label: "SG / Round", kind: "sgPerRound", higher: true, dp: 2 },
    { label: "SG / Attempt", kind: "sgPerAttempt", higher: true, dp: 3 },
    { label: "Attempts / Round", kind: "perRound", higher: null, dp: 1 },
    { label: "Driver Use %", kind: "driverPct", higher: null },
    { label: "Avg Distance (yds)", field: "driveDist", kind: "mean", higher: true, dp: 1 },
    { label: "Hit Fwy %", field: "hitFwy", kind: "pct", higher: true, alt: "fairwayFromMiss" },
    { label: "Head Speed (mph)", field: "headSpeed", kind: "mean", higher: true, dp: 1 },
    { label: "Ball Speed (mph)", field: "ballSpeed", kind: "mean", higher: true, dp: 1 },
    { label: "Smash Factor", field: "smash", kind: "mean", higher: true, dp: 2 },
    { label: "Launch Angle (°)", field: "launch", kind: "mean", higher: null, dp: 1 },
    { label: "Back Spin (rpm)", field: "spin", kind: "mean", higher: null, dp: 0 },
  ],
  APP: [
    { label: "SG / Round", kind: "sgPerRound", higher: true, dp: 2 },
    { label: "SG / Attempt", kind: "sgPerAttempt", higher: true, dp: 3 },
    { label: "Hit Green %", field: "onGreen", kind: "pct", higher: true },
    { label: "Avg Proximity (ft)", field: "proximity", kind: "mean", higher: false, dp: 1, onlyNotHoled: true },
    { label: "Avg Start Distance (yds)", field: "startDist", kind: "mean", higher: null, dp: 1 },
    { label: "Attempts / Round", kind: "perRound", higher: null, dp: 1 },
  ],
  ARG: [
    { label: "SG / Round", kind: "sgPerRound", higher: true, dp: 2 },
    { label: "SG / Attempt", kind: "sgPerAttempt", higher: true, dp: 3 },
    { label: "Up & Down %", field: "upDown", kind: "pct", higher: true },
    { label: "Avg Proximity (ft)", field: "proximity", kind: "mean", higher: false, dp: 1, onlyNotHoled: true },
    { label: "Hole-outs", field: "holeOut", kind: "count", higher: true },
    { label: "Attempts / Round", kind: "perRound", higher: null, dp: 1 },
  ],
  PUTT: [
    { label: "SG / Round", kind: "sgPerRound", higher: true, dp: 2 },
    { label: "SG / Attempt", kind: "sgPerAttempt", higher: true, dp: 3 },
    { label: "Putts / Round", kind: "perRound", higher: false, dp: 1 },
    { label: "1-Putt %", kind: "onePutt", higher: true },
    { label: "3-Putts / Round", kind: "threePutt", higher: false, dp: 2 },
    { label: "Make %", field: "holeOut", kind: "pct", higher: true },
    { label: "Avg Putt Length (ft)", field: "startDist", kind: "mean", higher: null, dp: 1 },
  ],
};

function statValue(def, rounds, idx, cat) {
  const shots = rounds.flatMap((rd) => rd.shots.filter((s) => s.cat === cat).map((s) => ({ ...s, rd })));
  const col = (s, f) => (idx[f] === undefined || !s.r ? null : s.r[idx[f]]);
  switch (def.kind) {
    case "mean": {
      if (idx[def.field] === undefined) return undefined;
      const vals = shots.filter((s) => !def.onlyNotHoled || truthy(col(s, "holeOut")) !== true)
        .map((s) => num(col(s, def.field))).filter((v) => v !== null);
      return vals.length ? mean(vals) : undefined;
    }
    case "pct": {
      let vals;
      if (idx[def.field] !== undefined) vals = shots.map((s) => truthy(col(s, def.field))).filter((v) => v !== null);
      else if (def.alt === "fairwayFromMiss" && idx.missDir !== undefined) {
        vals = shots.map((s) => col(s, "missDir")).filter((v) => v !== null && v !== "").map((v) => ["fairway", "hit", "center", "fwy"].includes(squash(v)));
      } else return undefined;
      return vals.length ? (100 * vals.filter(Boolean).length) / vals.length : undefined;
    }
    case "count":
      if (idx[def.field] === undefined) return undefined;
      return shots.filter((s) => truthy(col(s, def.field)) === true).length;
    case "perRound":
      return rounds.length ? shots.reduce((a, s) => a + s.w, 0) / rounds.length : undefined;
    case "sgPerRound":
      return rounds.length ? shots.reduce((a, s) => a + s.sg, 0) / rounds.length : undefined;
    case "sgPerAttempt": {
      const w = shots.reduce((a, s) => a + s.w, 0);
      return w ? shots.reduce((a, s) => a + s.sg, 0) / w : undefined;
    }
    case "driverPct": {
      if (idx.distanceRange === undefined) return undefined;
      const w = shots.reduce((a, s) => a + s.w, 0);
      const drv = shots.filter((s) => squash(col(s, "distanceRange")) === "driver").reduce((a, s) => a + s.w, 0);
      return w && shots.some((s) => /driver/i.test(String(col(s, "distanceRange")))) ? (100 * drv) / w : undefined;
    }
    case "onePutt":
    case "threePutt": {
      if (idx.hole === undefined) return undefined;
      const perHole = new Map();
      for (const s of shots) { const k = `${s.rd.key}|${col(s, "hole")}`; perHole.set(k, (perHole.get(k) || 0) + 1); }
      const counts = [...perHole.values()];
      if (!counts.length) return undefined;
      return def.kind === "onePutt" ? (100 * counts.filter((c) => c === 1).length) / counts.length
        : counts.filter((c) => c >= 3).length / (rounds.length || 1);
    }
    default: return undefined;
  }
}

/** Rows for the Stat Averages table: this player vs the average of all players. */
export function statTable(cat, playerRounds, fieldRoundsList, idx) {
  return STATS[cat].map((def) => {
    const mine = statValue(def, playerRounds, idx, cat);
    if (mine === undefined) return null;
    const others = fieldRoundsList.map((rs) => statValue(def, rs, idx, cat)).filter((v) => v !== undefined);
    return { ...def, value: mine, field: others.length ? mean(others) : null };
  }).filter(Boolean);
}

/** Fairway miss split for Off-the-Tee: [{ label, pct, count }]. */
export function missSplit(rounds, idx) {
  if (idx.missDir === undefined) return null;
  const counts = new Map();
  let total = 0;
  for (const rd of rounds) for (const s of rd.shots) {
    if (s.cat !== "OTT") continue;
    const v = s.r[idx.missDir];
    if (v === null || v === undefined || v === "") continue;
    const k = ["fairway", "hit", "center", "fwy"].includes(squash(v)) ? "Fairway" : String(v).trim();
    counts.set(k, (counts.get(k) || 0) + 1); total++;
  }
  if (!total) return null;
  const order = (l) => (/^l/i.test(l) ? 0 : l === "Fairway" ? 1 : /^r/i.test(l) ? 2 : 3);
  return [...counts.entries()].map(([label, count]) => ({ label, count, pct: (100 * count) / total }))
    .sort((a, b) => order(a.label) - order(b.label));
}

/** Where shots finished relative to the hole (ft): [{x: left(-)/right(+), y: short(-)/long(+)}]. */
export function leavePoints(rounds, idx, cat) {
  if (idx.dispersion === undefined || idx.distLeave === undefined) return null;
  const pts = [];
  for (const rd of rounds) for (const s of rd.shots) {
    if (s.cat !== cat || truthy(idx.holeOut === undefined ? null : s.r[idx.holeOut]) === true) continue;
    const x = num(s.r[idx.dispersion]), y = num(s.r[idx.distLeave]);
    if (x !== null && y !== null) pts.push({ x, y });
  }
  return pts.length ? pts : null;
}

/** Proximity buckets (ft) when there's no left/right data: [{label, count}]. */
export function leaveHistogram(rounds, idx, cat) {
  if (idx.proximity === undefined) return null;
  const edges = [0, 5, 10, 20, 30, 50, Infinity];
  const counts = edges.slice(0, -1).map(() => 0);
  for (const rd of rounds) for (const s of rd.shots) {
    if (s.cat !== cat) continue;
    const p = num(s.r[idx.proximity]);
    if (p === null || truthy(idx.holeOut === undefined ? null : s.r[idx.holeOut]) === true) continue;
    const i = edges.findIndex((e, j) => p >= e && p < edges[j + 1]);
    if (i >= 0) counts[i]++;
  }
  if (!counts.some(Boolean)) return null;
  return counts.map((count, i) => ({ label: edges[i + 1] === Infinity ? `${edges[i]}+` : `${edges[i]}-${edges[i + 1]}`, count }));
}

/** Rank players by a value (higher first). Returns [{ key, label, value, rank }]. */
export function rank(entries) {
  return [...entries].sort((a, b) => b.value - a.value).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Grade colors from worst to best, by percentile 0..1 (1 = best): a refined red → amber → green ramp. */
const GRADES = ["#ff453a", "#ff6a3d", "#ff9f0a", "#ffb340", "#ffd60a", "#c9d64a", "#8fd45c", "#5ed25f", "#30d158"];
export const gradeColor = (pct) => GRADES[Math.max(0, Math.min(GRADES.length - 1, Math.round(pct * (GRADES.length - 1))))];
export const sgColor = (v) => (v >= 0 ? "#30d158" : "#ff453a");
export const fmtSG = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "\u2014";
  const r = Math.round(v * 100) / 100 || 0; // no "-0.00"
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}`;
};


/* ======================= Filters (year, tournament, round, category, lie, distance) ======================= */

/** Values present for each filter, for the dropdowns. Lie and distance follow the chosen category. */
export function filterOptions(rounds, cat) {
  const uniq = (vals) => [...new Set(vals.filter((v) => v !== null && v !== undefined && v !== ""))];
  const cats = !cat ? null : Array.isArray(cat) ? (cat.length ? cat : null) : [cat];
  const shots = rounds.flatMap((rd) => rd.shots.filter((s) => !cats || cats.includes(s.cat)));
  const byNum = (a, b) => lead(a) - lead(b) || a.localeCompare(b);
  const lieRank = (l) => { const i = LIE_ORDER.indexOf(squash(l)); return i < 0 ? 99 : i; };
  const dists = uniq(shots.map((s) => s.dist));
  const clubs = uniq(shots.map((s) => s.club));
  const clubCats = {};
  for (const s of shots) if (s.club && !clubCats[s.club]) clubCats[s.club] = s.clubCat || "Other";
  return {
    club: clubs.sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b)),
    clubCats, // club -> its bag group (Driver, Fairway Wood, Hybrid, Iron, Wedge, Putter)
    year: uniq(rounds.map((r) => r.year)).sort().reverse(),
    event: uniq(rounds.map((r) => r.event)),
    roundNo: uniq(rounds.map((r) => r.roundNo)).sort(byNum),
    lie: uniq(shots.map((s) => s.lie)).sort((a, b) => lieRank(a) - lieRank(b) || a.localeCompare(b)),
    dist: dists.every((d) => lead(d) !== Infinity) ? dists.sort(byNum) : dists.sort((a, b) => (squash(a) === "driver" ? -1 : squash(b) === "driver" ? 1 : a.localeCompare(b))),
  };
}

/**
 * Apply filters. Year / tournament / round pick which rounds count (the "per round" denominator);
 * category / lie / distance pick which shots count. f = { year, event, roundNo, cats: [...], lie, dist, span }.
 */
export function applyFilters(rounds, f = {}) {
  // Each filter can hold one value or several (any of them matches); empty means "all".
  const set = (v) => { const a = Array.isArray(v) ? v : v ? [v] : []; return a.length ? new Set(a.map(String)) : null; };
  const years = set(f.year), events = set(f.event), roundNos = set(f.roundNo), lies = set(f.lie), clubs = set(f.club);
  let rs = rounds.filter((rd) => (!years || years.has(rd.year)) && (!events || events.has(rd.event)) && (!roundNos || roundNos.has(rd.roundNo)));
  if (f.span > 0) rs = rs.slice(-f.span);
  const cats = f.cats?.length ? f.cats : f.cat ? [f.cat] : null; // one or several categories
  // Distances are "CAT|label" pairs. A category with distances picked keeps only those; others are unaffected.
  const dists = Array.isArray(f.dist) ? f.dist : f.dist ? [`${f.cat || ""}|${f.dist}`] : [];
  const byCat = new Map();
  for (const d of dists) { const [c, ...rest] = String(d).split("|"); const l = rest.join("|"); if (!byCat.has(c)) byCat.set(c, new Set()); byCat.get(c).add(l); }
  const distOk = (s) => { if (!byCat.size) return true; const want = byCat.get(s.cat) || byCat.get(""); return !want || want.has(s.dist); };
  return rs.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => (!cats || cats.includes(s.cat)) && (!lies || lies.has(s.lie)) && (!clubs || clubs.has(s.club)) && distOk(s)) }));
}

/** Strokes gained per round, attempts per round and SG per attempt for a (filtered) set of rounds. */
export function sliceTotals(rounds) {
  const n = rounds.length;
  let sg = 0, w = 0;
  for (const rd of rounds) for (const s of rd.shots) { sg += s.sg; w += s.w; }
  return { rounds: n, sgPerRound: n ? sg / n : null, attemptsPerRound: n ? w / n : null, sgPerAttempt: w ? sg / w : null, attempts: w };
}

/* ======================= Field summary (what players may see of each other) ======================= */
// Per player, per round, per category: total strokes gained and attempts. Enough for rankings by
// year / tournament / round / category, without sharing anyone's lie- or distance-level detail.

export function buildFieldSummary(players) {
  return {
    players: players.map((p) => ({
      key: p.key, name: p.name,
      rounds: p.rounds.map((rd) => {
        const c = {};
        for (const s of rd.shots) { const x = (c[s.cat] ||= [0, 0]); x[0] += s.sg; x[1] += s.w; }
        for (const k of Object.keys(c)) c[k] = [Math.round(c[k][0] * 1000) / 1000, c[k][1]];
        return { d: rd.date, e: rd.event, r: rd.roundNo, y: rd.year, c };
      }),
    })),
  };
}

/** Turn a published summary back into the { key, name, rounds } shape the dashboard uses. */
export function summaryPlayers(summary) {
  return (summary?.players || []).map((p) => ({
    key: p.key, name: p.name, summaryOnly: true,
    rounds: p.rounds.map((rd, i) => ({
      key: `${rd.d}|${rd.e}|${rd.r}|${i}`, date: rd.d, event: rd.e, roundNo: rd.r, year: rd.y,
      shots: Object.entries(rd.c).map(([cat, [sg, w]]) => ({ cat, sg, w, lie: null, dist: null })),
    })),
  }));
}
