// Built from src.js by build.sh - edit src.js (and the portal's js/), not this file.

// src.js
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

// ../../js/data.js
var UserError = class extends Error {
};
var MAX_CHUNK_CHARS = 3e5;
var DOC_CHUNK_CHARS = 6e5;
var MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
var MAX_DOC_BYTES = 25 * 1024 * 1024;
var norm = (v) => String(v ?? "").trim().toLowerCase();
function clientKey(label) {
  const n = norm(label);
  if (!n) return "";
  return "c_" + encodeURIComponent(n).replace(/\./g, "%2E");
}
var TEAM_PREFIX = "t_";
var isTeamKey = (k) => typeof k === "string" && k.startsWith(TEAM_PREFIX);
function detectDelimiter(text) {
  const firstLine = text.slice(0, Math.max(0, text.search(/\r?\n/)) || text.length);
  let best = ",", bestCount = 0;
  for (const d of [",", ";", "	"]) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
function parseCsv(text) {
  if (text.charCodeAt(0) === 65279) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0, n = text.length; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}
function tableFromCsvRows(rows) {
  if (!rows.length) throw new UserError("That file is empty.");
  const seen = /* @__PURE__ */ new Set();
  const columns = rows[0].map((h, i) => {
    let name = String(h).trim() || `column_${i + 1}`;
    while (seen.has(name)) name += "_2";
    seen.add(name);
    return name;
  });
  const width = columns.length;
  const data = rows.slice(1).map((r) => r.length === width ? r : Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { columns, rows: data };
}
function tableFromObjects(objects) {
  if (!objects.length) throw new UserError("That file has no rows.");
  const columns = Object.keys(objects[0]);
  return { columns, rows: objects.map((o) => columns.map((c) => o[c])) };
}
var NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
var DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
var isBlank = (v) => v === null || v === void 0 || typeof v === "number" && Number.isNaN(v) || typeof v === "string" && v.trim() === "";
var pad = (n) => String(n).padStart(2, "0");
function dateParts(v) {
  if (v instanceof Date) {
    return isNaN(v) ? null : { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate(), h: v.getUTCHours(), mi: v.getUTCMinutes() };
  }
  const m = DATE_RE.exec(String(v).trim());
  return m ? { y: +m[1], m: +m[2], d: +m[3], h: m[4] === void 0 ? null : +m[4], mi: m[5] === void 0 ? null : +m[5] } : null;
}
function inferColumn(values) {
  const present = values.filter((v) => !isBlank(v));
  const blankTo = (fn) => (v) => isBlank(v) ? null : fn(v);
  if (!present.length) return { type: "text", convert: () => null };
  if (present.every((v) => typeof v === "number" && isFinite(v) || typeof v === "bigint")) {
    return { type: "number", convert: blankTo((v) => Number(v)) };
  }
  const dateLike = present.every((v) => v instanceof Date || typeof v === "string" && DATE_RE.test(v.trim()));
  if (dateLike) {
    const parts = present.map(dateParts);
    if (parts.every(Boolean)) {
      const withTime = parts.some((p) => p.h !== null && (p.h !== 0 || p.mi !== 0));
      return {
        type: "date",
        convert: blankTo((v) => {
          const p = dateParts(v);
          const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
          return withTime ? `${day} ${pad(p.h ?? 0)}:${pad(p.mi ?? 0)}` : day;
        })
      };
    }
  }
  if (present.every((v) => typeof v === "string" && NUM_RE.test(v.trim()) && !/^[+-]?0\d/.test(v.trim()))) {
    return { type: "number", convert: blankTo((v) => Number(String(v).trim())) };
  }
  return { type: "text", convert: blankTo((v) => typeof v === "bigint" ? v.toString() : String(v)) };
}
var NAME_COLUMNS = ["player", "playername", "name", "golfer", "fullname", "playerfullname"];
function resolveIdColumn(columns, input) {
  const want = String(input ?? "").trim();
  let i = columns.indexOf(want);
  if (i < 0) i = columns.findIndex((c) => c.trim().toLowerCase() === want.toLowerCase());
  return i;
}
var idString = (v) => isBlank(v) ? "" : typeof v === "number" || typeof v === "bigint" ? String(v) : norm(v);
function buildDataset(table, idInput) {
  const { columns, rows } = table;
  const idCol = resolveIdColumn(columns, idInput);
  if (idCol < 0) {
    throw new UserError(`There's no column named "${idInput}". Columns in this file: ${columns.slice(0, 25).join(", ")}`);
  }
  if (!rows.length) throw new UserError("That file has no rows.");
  const cols = [], converters = [];
  columns.forEach((name, i) => {
    if (i === idCol) return;
    const { type, convert } = inferColumn(rows.map((r) => r[i]));
    cols.push({ name, type });
    converters.push([i, convert]);
  });
  const squashName = (c) => String(c).toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameCol = columns.findIndex((c, i) => i !== idCol && NAME_COLUMNS.includes(squashName(c)));
  const byClient = /* @__PURE__ */ new Map();
  let blankIdRows = 0;
  for (const r of rows) {
    const id = idString(r[idCol]);
    if (!id) {
      blankIdRows++;
      continue;
    }
    const key = clientKey(id);
    let g = byClient.get(key);
    if (!g) byClient.set(key, g = { label: id, rows: [] });
    if (nameCol >= 0 && !g.name && !isBlank(r[nameCol])) g.name = String(r[nameCol]).trim();
    g.rows.push(converters.map(([i, convert]) => convert(r[i])));
  }
  if (!byClient.size) throw new UserError(`Every value in "${columns[idCol]}" is blank, so no row can be matched to a person.`);
  return { idColumn: columns[idCol], columns: cols, byClient, rowCount: rows.length, blankIdRows };
}
function chunkRows(rows, maxChars = MAX_CHUNK_CHARS) {
  const chunks = [];
  let parts = [], size = 2;
  for (const row of rows) {
    const s = JSON.stringify(row);
    if (s.length + 2 > 8e5) throw new UserError("One row in this file is too large to store.");
    if (parts.length && size + s.length + 1 > maxChars) {
      chunks.push(`[${parts.join(",")}]`);
      parts = [];
      size = 2;
    }
    parts.push(s);
    size += s.length + 1;
  }
  if (parts.length || !chunks.length) chunks.push(`[${parts.join(",")}]`);
  return chunks;
}
function splitString(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out.length ? out : [""];
}

// ../../js/sg.js
var ALIASES = {
  // The stats file: player / playerID / year / date / tour / tournament / round / category / distance / lie /
  // stat type / stat value / attempts. "stat type" is "strokes gained" (value per attempt) or a round stat
  // such as "driving distance" or "hit fwy %". Tours other than the PGA TOUR have "null" distance and lie.
  statType: ["stattype", "statname", "metric", "stat"],
  successes: ["successes", "success"],
  statValue: ["statvalue", "statval", "metricvalue"],
  tour: ["tour", "tourname", "league"],
  category: ["category", "shotcategory", "sgcategory", "shottype"],
  sg: ["cdsg", "sg", "strokesgained", "sgshot", "sgvalue", "sgtotal"],
  // Aggregated files: strokes gained per attempt, times the number of attempts in that row.
  sgPerAttempt: ["strokesgainedattempt", "strokesgainedperattempt", "sgattempt", "sgperattempt", "sgpershot"],
  attempts: ["attempts", "shots", "numshots", "shotcount"],
  date: ["date", "rounddate", "eventdate"],
  year: ["year", "season"],
  event: ["tournament", "event", "eventname", "tournamentname"],
  course: ["course", "coursename", "venue", "golfcourse"],
  // (update 160)
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
  club: ["club", "clubused", "clubtype", "clubname"]
};
function clubGroup(name) {
  const s = String(name).toLowerCase().replace(/\s+/g, "");
  if (/driver|^1w$/.test(s)) return "Driver";
  if (/putter/.test(s)) return "Putter";
  if (/^\d+w$|wood/.test(s)) return "Fairway Wood";
  if (/^\d+h$|hybrid|rescue/.test(s)) return "Hybrid";
  if (/wedge|^(gw|sw|lw|aw|uw)$|°|deg/.test(s)) return "Wedge";
  if (/^\d+i$|iron|^pw$/.test(s)) return "Iron";
  return "Other";
}
var squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function detectColumns(columns) {
  const names = columns.map((c) => squash(typeof c === "string" ? c : c.name));
  const idx = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const i = aliases.map((a) => names.indexOf(a)).find((n) => n >= 0);
    if (i !== void 0) idx[field] = i;
  }
  return idx;
}
var isShotData = (idx) => idx.statType !== void 0 && idx.statValue !== void 0 || idx.category !== void 0 && (idx.sg !== void 0 || idx.sgPerAttempt !== void 0);
var SG_TYPES = ["strokesgained", "sg", "strokesgainedattempt", "strokesgainedperattempt", "sgperattempt"];
var STAT_TYPES = {
  drive: ["drivingdistance", "drivedistance", "avgdrivingdistance", "driving", "drivingdistanceyds"],
  fwy: ["hitfwy", "hitfairway", "fairwayshit", "fairwayhit", "fwy", "fwyhit", "drivingaccuracy", "fairways"],
  gir: ["gir", "greensinregulation", "hitgir", "girpct"],
  hitGreen: ["hitgreen", "greenshit", "hitgreenpct"],
  putts: ["puttsperround", "putts", "puttsround", "puttsrd"],
  scoring: ["scoringaverage", "scoringavg", "score", "scoring"],
  threePutt: ["3puttavoidance", "threeputtavoidance", "3putt", "threeputt"],
  ud: ["updown", "upanddown", "updownpct", "scrambling"],
  birdie: ["birdiepct", "birdie", "birdiepercentage", "birdies"],
  bogey: ["bogeyavoidance", "bogey"],
  prox: ["proximity", "approachproximity", "proximityft", "proximitytohole", "avgproximity"],
  make: ["make", "makepct", "puttsmade", "makepercentage", "puttmake", "madeputt", "madeputtpct", "madeputts", "puttmade"],
  scramble: [],
  parOrBetter: ["parorbetter", "parorbetterpct"],
  par3: ["par3scoringavg", "par3scoringaverage", "par3scoring", "par3avg", "par3average", "par3scoringavgstrokes"],
  par4: ["par4scoringavg", "par4scoringaverage", "par4scoring", "par4avg", "par4average", "par4scoringavgstrokes"],
  par5: ["par5scoringavg", "par5scoringaverage", "par5scoring", "par5avg", "par5average", "par5scoringavgstrokes"],
  pinHigh: ["pinhigh", "pinhighpct"],
  onLine: ["online", "onlinepct"],
  goodLag: ["goodlag", "goodlagpct", "lag"],
  eagles: ["eaglesround", "eaglesperround"],
  birdiesRd: ["birdiesround", "birdiesperround"],
  parsRd: ["parsround", "parsperround"],
  bogeysRd: ["bogeysround", "bogeysperround"],
  dblBogeysRd: ["dblbogeysround", "doublebogeysround", "dblbogeysperround", "doublebogeysperround", "doublebogeyorworseround"],
  owgr: ["owgr", "worldranking"]
};
var STAT_DEFS = {
  sg: { label: "Strokes Gained", higher: true, dp: 2, help: "Strokes gained against the baseline, per round." },
  scoring: { label: "Scoring Avg", higher: false, dp: 2, help: "Strokes per 18 holes. Lower is better." },
  par3: { label: "Par 3 Scoring Avg", higher: false, dp: 2, help: "Average score on par 3s. Lower is better." },
  par4: { label: "Par 4 Scoring Avg", higher: false, dp: 2, help: "Average score on par 4s. Lower is better." },
  par5: { label: "Par 5 Scoring Avg", higher: false, dp: 2, help: "Average score on par 5s. Lower is better." },
  eagles: { label: "Eagles / Round", higher: true, dp: 2, help: "Eagles (or better) per round." },
  birdiesRd: { label: "Birdies / Round", higher: true, dp: 2, help: "Birdies per round." },
  parsRd: { label: "Pars / Round", higher: null, dp: 2, help: "Pars per round. Not marked better or worse (fewer pars can mean more birdies)." },
  bogeysRd: { label: "Bogeys / Round", higher: false, dp: 2, help: "Bogeys per round. Lower is better." },
  dblBogeysRd: { label: "Double Bogeys / Round", higher: false, dp: 2, help: "Double bogeys (or worse, as the data file counts them) per round. Lower is better." },
  birdie: { label: "Birdie %", pct: true, higher: true, help: "Holes played in birdie or better." },
  parOrBetter: { label: "Par or Better %", pct: true, higher: true, help: "Holes played in par or better." },
  bogey: { label: "Bogey Avoidance", pct: true, higher: false, help: "Holes with bogey or worse, as a percentage (the PGA TOUR measure). Lower is better." },
  gir: { label: "GIR %", pct: true, higher: true, help: "Greens hit in regulation." },
  scramble: { label: "Scrambling %", pct: true, higher: true, help: "Missed the green in regulation and still made par or better." },
  putts: { label: "Putts / Round", higher: false, dp: 2, help: "Putts per 18 holes. Lower is better." },
  fwy: { label: "Hit Fairway %", pct: true, higher: true, help: "Tee shots on par 4s and 5s that finished in the fairway." },
  drive: { label: "Driving Distance", unit: " yds", dp: 1, higher: true, help: "Average tee shot distance in yards." },
  hitGreen: { label: "Hit Green %", pct: true, higher: true, help: "Approach and around-the-green shots that finished on the green (or in the hole)." },
  pinHigh: { label: "Pin-High %", pct: true, higher: true, help: "Shots that finished pin high: within 10 ft short or long of the hole." },
  onLine: { label: "On-Line %", pct: true, higher: true, help: "Shots that finished on line: within 10 ft left or right of the hole." },
  prox: { label: "Proximity", unit: " ft", dp: 1, higher: false, help: "Average distance from the hole, in feet, for shots that finished on the green (holed = 0). Lower is better." },
  ud: { label: "Up & Down %", pct: true, higher: true, help: "From the first shot around the green, holed out in two strokes or fewer." },
  make: { label: "Made Putt %", pct: true, higher: true, help: "Putts holed." },
  goodLag: { label: "Good Lag %", pct: true, higher: true, help: "Long putts left close enough for an easy next putt, as the data file counts them." },
  threePutt: { label: "3-Putt Avoidance", pct: true, higher: false, help: "Holes with three or more putts, as a percentage (the PGA TOUR measure). Lower is better." },
  owgr: { label: "OWGR", higher: false, dp: 0, help: "Official World Golf Ranking. Lower is better." }
};
var STAT_ORDER = Object.keys(STAT_DEFS);
var xLabels = /* @__PURE__ */ new Map();
function statDef(key) {
  if (STAT_DEFS[key]) return { key, ...STAT_DEFS[key] };
  const raw = xLabels.get(key) || String(key).replace(/^x:/, "");
  const pct = /%|pct|percent/i.test(raw);
  const label = raw.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return { key, label, pct, higher: null, dp: 2, help: "From the data file. Higher and lower aren't marked better or worse." };
}
var memo = (fn) => {
  const m = /* @__PURE__ */ new Map();
  return (v) => {
    if (m.has(v)) return m.get(v);
    const r = fn(v);
    if (m.size < 2e4) m.set(v, r);
    return r;
  };
};
var statKeyOf = (t) => statKeyMemo(t);
var looseStatKey = (q) => {
  const par = q.match(/par([345])s?(?!\d)/);
  if (par && /scor|avg|average|perf|strokes/.test(q) && !/gir|greens?inreg|birdie|bogey|eagle|par(or|orbetter)/.test(q)) return `par${par[1]}`;
  if ((/^gir/.test(q) || /gir(pct|percent|percentage)?$/.test(q) || /greens?inreg/.test(q)) && !/par3(?!\d)/.test(q)) return "gir";
  return null;
};
var statKeyOfRaw = (t) => {
  const q = squash(t);
  if (!q || SG_TYPES.includes(q)) return null;
  for (const [k, list] of Object.entries(STAT_TYPES)) if (list.includes(q)) return k;
  const loose = looseStatKey(q);
  if (loose) return loose;
  if (!xLabels.has(`x:${q}`)) xLabels.set(`x:${q}`, String(t).trim());
  return `x:${q}`;
};
var isNullRaw = (v) => v === null || v === void 0 || v === "" || ["null", "na", "nan", "none"].includes(squash(v));
var isNullMemo = memo(isNullRaw);
var isNull = (v) => v === null || v === void 0 || v === "" ? true : isNullMemo(v);
var statKeyMemo = memo((t) => statKeyOfRaw(t));
function normalizeCategory(v) {
  const s = squash(v);
  if (["ott", "offthetee", "tee", "driving", "drive"].includes(s)) return "OTT";
  if (["app", "approach", "approachthegreen", "approachgreen"].includes(s)) return "APP";
  if (["arg", "aroundthegreen", "aroundgreen", "shortgame", "chipping"].includes(s)) return "ARG";
  if (["putt", "putting", "putts"].includes(s)) return "PUTT";
  return null;
}
var catMemo = memo((v) => normalizeCategory(v));
var clubMemo = memo((c) => clubGroup(c));
var num = (v) => v === null || v === void 0 || v === "" || isNaN(Number(v)) ? null : Number(v);
var truthy = (v) => {
  if (v === null || v === void 0 || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = squash(v);
  if (["1", "true", "yes", "y", "hit", "made", "holed"].includes(s)) return true;
  if (["0", "false", "no", "n", "miss", "missed"].includes(s)) return false;
  return null;
};
function prepare(rows, idx) {
  const get = (r, f) => idx[f] === void 0 ? null : r[idx[f]];
  const shotCols = ["onGreen", "proximity", "upDown", "holeOut", "hitFwy", "missDir", "driveDist"].some((f) => idx[f] !== void 0);
  const rounds = /* @__PURE__ */ new Map();
  const roundOf = (r) => {
    const date = get(r, "date") ?? "", event = get(r, "event") ?? "", rnd = get(r, "round") ?? "";
    const key = idx.round !== void 0 && !isNull(rnd) && isNaN(Number(rnd)) ? String(rnd) : `${date}|${event}|${isNull(rnd) ? "" : rnd}`;
    if (!rounds.has(key)) {
      const d = new Date(date);
      const year = get(r, "year") ?? (isNaN(d) ? "" : d.getFullYear());
      const tour = idx.tour !== void 0 && !isNull(get(r, "tour")) ? String(get(r, "tour")) : "";
      const course = idx.course !== void 0 && !isNull(get(r, "course")) ? String(get(r, "course")).trim() : "";
      const noRound = idx.round !== void 0 && isNull(rnd);
      rounds.set(key, { key, date: String(date), event: String(event), roundNo: noRound || isNaN(Number(rnd)) ? "" : String(Number(rnd)), year: String(year ?? ""), tour, ...course ? { course } : {}, shots: [], ...noRound ? { eventLevel: true } : {} });
    }
    return rounds.get(key);
  };
  for (const r of rows) {
    let statKey = null;
    if (idx.statType !== void 0) {
      statKey = statKeyOf(get(r, "statType"));
      if (statKey) {
        const aw = idx.attempts !== void 0 ? num(get(r, "attempts")) : null;
        let v = num(get(r, "statValue"));
        if (v === null && idx.successes !== void 0) {
          const sc = num(get(r, "successes"));
          if (sc !== null && aw) v = sc / aw;
        }
        if (v === null) continue;
        const lie2 = get(r, "lie"), dist2 = get(r, "distanceRange");
        const rd2 = roundOf(r);
        (rd2.obs ||= []).push({
          k: statKey,
          cat: catMemo(get(r, "category")),
          lie: isNull(lie2) ? null : String(lie2),
          dist: isNull(dist2) ? null : String(dist2),
          v,
          w: aw !== null && aw > 0 ? aw : 1,
          file: true
        });
        continue;
      }
    }
    const cat = catMemo(get(r, "category"));
    const w = idx.attempts !== void 0 ? num(get(r, "attempts")) : 1;
    const per = idx.statType !== void 0 ? num(get(r, "statValue")) : idx.sgPerAttempt !== void 0 ? num(get(r, "sgPerAttempt")) : null;
    const sg = per !== null && w !== null ? per * w : num(get(r, "sg"));
    if (!cat || sg === null || w === null || w <= 0) continue;
    const lie = get(r, "lie"), dist = get(r, "distanceRange"), club = get(r, "club");
    const shot = {
      cat,
      sg,
      w,
      r,
      lie: isNull(lie) ? null : String(lie),
      dist: isNull(dist) ? null : String(dist),
      club: club == null || club === "" ? null : String(club),
      clubCat: club == null || club === "" ? null : clubMemo(String(club))
    };
    const rd = roundOf(r);
    rd.shots.push(shot);
    if (shotCols) shotObs(rd, shot, r, idx);
  }
  const list = [...rounds.values()];
  for (const rd of list) {
    rd.obs ||= [];
    rd.has = new Set(rd.obs.map((o) => o.k));
    if (rd.shots.length) rd.has.add("sg");
  }
  const fracKeys = /* @__PURE__ */ new Set(), over = /* @__PURE__ */ new Set();
  for (const rd of list) for (const o of rd.obs) if (o.file && statDef(o.k).pct) {
    fracKeys.add(o.k);
    if (Math.abs(o.v) > 1.0001) over.add(o.k);
  }
  for (const k of fracKeys) if (!over.has(k)) {
    for (const rd of list) for (const o of rd.obs) if (o.k === k) o.v *= 100;
  }
  if (idx.date !== void 0) list.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return list;
}
function shotObs(rd, s, r, idx) {
  const col = (f) => idx[f] === void 0 ? null : r[idx[f]];
  const add = (k, v) => {
    if (v !== null && v !== void 0 && Number.isFinite(v)) (rd.obs ||= []).push({ k, cat: s.cat, lie: s.lie, dist: s.dist, v, w: s.w });
  };
  const holed = truthy(col("holeOut")) === true;
  if (s.cat === "APP" || s.cat === "ARG") {
    const g = truthy(col("onGreen"));
    if (g !== null) add("hitGreen", g || holed ? 100 : 0);
    const p = num(col("proximity"));
    if (p !== null && !holed) add("prox", p);
    if (s.cat === "ARG") {
      const u = truthy(col("upDown"));
      if (u !== null) add("ud", u ? 100 : 0);
    }
  }
  if (s.cat === "PUTT") {
    const h = truthy(col("holeOut"));
    if (h !== null) add("make", h ? 100 : 0);
  }
  if (s.cat === "OTT") {
    const f = truthy(col("hitFwy"));
    if (f !== null) add("fwy", f ? 100 : 0);
    else if (idx.missDir !== void 0) {
      const m = col("missDir");
      if (m !== null && m !== "") add("fwy", ["fairway", "hit", "center", "fwy"].includes(squash(m)) ? 100 : 0);
    }
    add("drive", num(col("driveDist")));
  }
}
function buildFieldSummary(players) {
  return {
    players: players.map((p) => ({
      key: p.key,
      name: p.name,
      rounds: p.rounds.map((rd) => {
        const c = {};
        for (const s of rd.shots) {
          const x = c[s.cat] ||= [0, 0];
          x[0] += s.sg;
          x[1] += s.w;
        }
        for (const k of Object.keys(c)) c[k] = [Math.round(c[k][0] * 1e3) / 1e3, c[k][1]];
        const sx = {};
        for (const o of rd.obs || []) {
          const x = (sx[o.k] ||= {})[o.cat || ""] ||= [0, 0];
          x[0] += o.v * o.w;
          x[1] += o.w;
        }
        for (const k of Object.keys(sx)) for (const c2 of Object.keys(sx[k])) sx[k][c2] = [Math.round(sx[k][c2][0] * 1e3) / 1e3, Math.round(sx[k][c2][1] * 1e3) / 1e3];
        return { d: rd.date, e: rd.event, r: rd.roundNo, y: rd.year, t: rd.tour || "", ...rd.course ? { co: rd.course } : {}, c, ...Object.keys(sx).length ? { s: sx } : {}, ...rd.eventLevel ? { ev: 1 } : {} };
      })
    }))
  };
}

// ../../js/fieldDetail.js
var MAGIC = "TAD1";
function encodeFieldDetail(players) {
  const years = /* @__PURE__ */ new Map();
  for (const p of players) for (const rd of p.rounds) {
    const y = String(rd.year ?? "");
    if (!years.has(y)) years.set(y, /* @__PURE__ */ new Map());
    const byP = years.get(y);
    if (!byP.has(p.key)) byP.set(p.key, { key: p.key, name: p.name ?? p.label ?? null, rounds: [] });
    byP.get(p.key).rounds.push(rd);
  }
  return [...years].map(([year, byP]) => ({ year, bytes: encodeYear([...byP.values()]) }));
}
function encodeYear(players) {
  const dict = [null], at = /* @__PURE__ */ new Map([[null, 0]]);
  const id = (s) => {
    const k = s === void 0 || s === null ? null : String(s);
    if (!at.has(k)) {
      at.set(k, dict.length);
      dict.push(k);
    }
    return at.get(k);
  };
  let nS = 0, nO = 0;
  for (const p of players) for (const rd of p.rounds) {
    nS += rd.shots.length;
    nO += (rd.obs || []).length;
  }
  const sI = new Uint32Array(nS * 5), sF = new Float32Array(nS * 2), oI = new Uint32Array(nO * 4), oF = new Float32Array(nO * 2);
  let a = 0, b = 0;
  const hp = players.map((p) => [p.key, p.name, p.rounds.map((rd) => {
    for (const s of rd.shots) {
      sI.set([id(s.cat), id(s.lie), id(s.dist), id(s.club), id(s.clubCat)], a * 5);
      sF[a * 2] = s.sg;
      sF[a * 2 + 1] = s.w;
      a++;
    }
    for (const o of rd.obs || []) {
      oI.set([id(o.k), id(o.cat), id(o.lie), id(o.dist)], b * 4);
      oF[b * 2] = o.v;
      oF[b * 2 + 1] = o.w;
      b++;
    }
    const plain = rd.key === `${rd.date}|${rd.event}|${rd.roundNo}`;
    return [plain ? null : rd.key, id(rd.date), id(rd.event), rd.roundNo, id(rd.tour), rd.eventLevel ? 1 : 0, rd.shots.length, (rd.obs || []).length, id(rd.course || null)];
  })]);
  const wide = dict.length > 65535, I = wide ? Uint32Array : Uint16Array;
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, year: players[0]?.rounds[0]?.year ?? "", wide, nS, nO, dict, players: hp }));
  const parts = [I.from(sI), sF, I.from(oI), oF];
  const pad4 = (n) => n + 3 & ~3;
  let size = pad4(8 + header.length);
  for (const t of parts) size = pad4(size + t.byteLength);
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let off = pad4(8 + header.length);
  for (const t of parts) {
    out.set(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), off);
    off = pad4(off + t.byteLength);
  }
  return out;
}
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
var gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));

// src.js
var require2 = createRequire(import.meta.url);
var functions = require2("@google-cloud/functions-framework");
var { Firestore, FieldValue } = require2("@google-cloud/firestore");
var { Storage } = require2("@google-cloud/storage");
var db = new Firestore();
var gcs = new Storage();
var PREFIX = "incoming/";
var REBUILD = "incoming/_rebuild/";
var DETAIL_FORMAT = 1;
var MAX_DIRECT_BYTES = 40 * 1024 * 1024;
functions.cloudEvent("dataImport", async (event) => {
  const obj = event.data || {};
  const path = String(obj.name || "");
  if (!path.startsWith(PREFIX) || path.endsWith("/")) return;
  const bucket = gcs.bucket(obj.bucket);
  const file = bucket.file(path);
  const meta = obj.metadata || {};
  const fileName = path.slice(PREFIX.length);
  const name = String(meta.name || fileName.replace(/\.(csv\.gz|csv|parquet)$/i, "")).trim();
  if (path.startsWith(REBUILD)) return rebuild(bucket, file, meta);
  const status = db.doc(`imports/${obj.generation || Date.now()}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (Number(obj.size) > MAX_DIRECT_BYTES) {
    await set({
      file: fileName,
      name,
      status: "error",
      step: null,
      startedAt: FieldValue.serverTimestamp(),
      finishedAt: FieldValue.serverTimestamp(),
      message: `This file is ${Math.round(Number(obj.size) / 1048576)} MB, too big for the cloud to read in one go. Send it with the latest tour_upload.py (update 165 or later), which splits it on your computer first.`
    });
    await file.delete().catch(() => {
    });
    return;
  }
  const prior = await status.get();
  if (prior.exists && prior.data().status === "done") return;
  await set({ file: fileName, name, status: "running", step: "Reading the file", startedAt: FieldValue.serverTimestamp() });
  console.log(`Importing ${path} as "${name}" (${obj.size} bytes)`);
  const beat = heartbeat(status);
  try {
    const [buf] = await file.download();
    const table = await readTable(buf, fileName);
    const dataset = buildDataset(table, String(meta.idColumn || "playerID").trim() || "playerID");
    const people = dataset.byClient.size;
    await set({ step: `Saving ${people} players' rows`, rows: dataset.rowCount, people });
    const { datasetId } = await saveDataset(name, String(meta.description || ""), dataset);
    let rankings = false, detail = null;
    const idx = detectColumns(dataset.columns);
    if (isShotData(idx)) {
      await set({ step: "Updating rankings" });
      const labels = await playerLabels();
      const players = [...dataset.byClient].map(([key, g]) => ({ key, name: labels.get(key) || g.name || g.label, rounds: prepare(g.rows, idx) }));
      await publishFieldStats(datasetId, buildFieldSummary(players), Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      detail = await publishFieldDetail(bucket, datasetId, players, Date.now());
    }
    await set({
      status: "done",
      step: null,
      datasetId,
      rows: dataset.rowCount,
      people,
      blankIdRows: dataset.blankIdRows || 0,
      rankings,
      detail: detail?.skipped || (detail ? "saved" : null),
      finishedAt: FieldValue.serverTimestamp()
    });
    console.log(`Done: "${name}", ${dataset.rowCount} rows for ${people} players`);
  } catch (err) {
    console.error("Import failed", err);
    await set({ status: "error", step: null, message: String(err?.message || err), finishedAt: FieldValue.serverTimestamp() });
  } finally {
    clearInterval(beat);
    await file.delete().catch((e) => console.warn("Couldn't delete the incoming file", e?.message));
  }
});
var heartbeat = (ref) => setInterval(() => ref.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {
}), 6e4);
async function rebuild(bucket, file, meta) {
  const datasetId = String(meta.datasetId || ""), status = db.doc(`imports/${meta.statusId || `rebuild_${datasetId}`}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const beat = heartbeat(status);
  try {
    const dsSnap = await db.doc(`datasets/${datasetId}`).get();
    if (!dsSnap.exists) throw new Error("That data file isn't there any more.");
    const ds = dsSnap.data(), idx = detectColumns(ds.columns || []);
    let rankings = false, detail = null;
    if (isShotData(idx)) {
      await set({ step: "Updating rankings" });
      const labels = await playerLabels();
      const keys = ds.clientKeys || [], names = ds.playerNames || {}, players = [];
      let done = 0;
      const next = async () => {
        while (keys.length) {
          const key = keys.shift();
          const m = await db.doc(`clientData/${key}/datasets/${datasetId}`).get();
          const n = m.exists ? m.data().chunkCount || 0 : 0;
          const refs = Array.from({ length: n }, (_, i) => db.doc(`clientData/${key}/datasets/${datasetId}/chunks/${i}`));
          const snaps = refs.length ? await db.getAll(...refs) : [];
          const rows = snaps.flatMap((sn) => sn.exists ? JSON.parse(sn.data().data) : []);
          const rounds = prepare(rows, idx);
          for (const rd of rounds) for (const sh of rd.shots) delete sh.r;
          if (rounds.length) players.push({ key, name: labels.get(key) || names[key] || key.replace(/^c_/, ""), rounds });
          if (++done % 100 === 0) await set({ step: `Updating rankings (${done} of ${ds.clientKeys.length} players)` });
        }
      };
      await Promise.all(Array.from({ length: 16 }, next));
      await publishFieldStats(datasetId, buildFieldSummary(players), Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      detail = await publishFieldDetail(bucket, datasetId, players, Date.now());
    }
    await set({ status: "done", step: null, datasetId, rankings, detail: detail?.skipped || (detail ? "saved" : null), finishedAt: FieldValue.serverTimestamp() });
    console.log(`Rebuilt rankings for ${datasetId}`);
  } catch (err) {
    console.error("Rebuild failed", err);
    await set({ status: "error", step: null, message: `The rows are live, but the rankings couldn't be rebuilt: ${String(err?.message || err)}. Opening Analyze on a computer rebuilds them.`, finishedAt: FieldValue.serverTimestamp() });
  } finally {
    clearInterval(beat);
    await file.delete().catch(() => {
    });
  }
}
async function readTable(buf, fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".parquet")) {
    const { parquetReadObjects } = await import("hyparquet");
    let compressors;
    try {
      ({ compressors } = await import("hyparquet-compressors"));
    } catch {
      compressors = void 0;
    }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const objects = await parquetReadObjects({ file: ab, compressors });
    for (const o of objects) for (const k in o) {
      const v = o[k];
      if (typeof v === "bigint") o[k] = Number(v);
      else if (v instanceof Date) {
        const iso = isNaN(v) ? "" : v.toISOString();
        o[k] = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
      }
    }
    return tableFromObjects(objects);
  }
  const text = (lower.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
  return tableFromCsvRows(parseCsv(text));
}
var BATCH_LIMIT = 450;
var BATCH_BYTES = 4 * 1024 * 1024;
var sized = (op, bytes) => Object.assign(op, { bytes });
async function commitInChunks(ops) {
  let batch = db.batch(), count = 0, bytes = 0;
  for (const op of ops) {
    const b = op.bytes || 1e3;
    if (count && (count >= BATCH_LIMIT || bytes + b > BATCH_BYTES)) {
      await batch.commit();
      batch = db.batch();
      count = 0;
      bytes = 0;
    }
    op(batch);
    count++;
    bytes += b;
  }
  if (count) await batch.commit();
}
async function deleteCollection(col) {
  const snap = await col.get();
  await commitInChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
}
async function saveDataset(name, description, dataset) {
  const existing = await db.collection("datasets").where("name", "==", name).get();
  const datasetId = existing.empty ? db.collection("datasets").doc().id : existing.docs[0].id;
  const oldClientKeys = existing.empty ? [] : existing.docs[0].data().clientKeys || [];
  const pieces = new Map([...dataset.byClient].map(([k, g]) => [k, chunkRows(g.rows)]));
  const storedBytes = [...pieces.values()].flat().reduce((n, d) => n + d.length, 0);
  const newClientKeys = [...dataset.byClient.keys()];
  for (const key of /* @__PURE__ */ new Set([...oldClientKeys, ...newClientKeys])) {
    await deleteCollection(db.collection(`clientData/${key}/datasets/${datasetId}/chunks`));
  }
  const ops = [];
  ops.push((b) => b.set(db.doc(`datasets/${datasetId}`), {
    storedBytes,
    name,
    description,
    idColumn: dataset.idColumn,
    columns: dataset.columns,
    rowCount: dataset.rowCount,
    blankIdRows: dataset.blankIdRows,
    clientKeys: newClientKeys,
    playerNames: Object.fromEntries([...dataset.byClient].filter(([, g]) => g.name).map(([k, g]) => [k, g.name])),
    uploadedAt: FieldValue.serverTimestamp(),
    source: "python"
  }));
  for (const key of oldClientKeys.filter((k) => !newClientKeys.includes(k))) {
    ops.push((b) => b.delete(db.doc(`clientData/${key}/datasets/${datasetId}`)));
  }
  for (const [clientKey2, group] of dataset.byClient) {
    const chunks = pieces.get(clientKey2);
    ops.push((b) => b.set(db.doc(`clientData/${clientKey2}/datasets/${datasetId}`), {
      name,
      description,
      idColumn: dataset.idColumn,
      columns: dataset.columns,
      clientLabel: group.label,
      playerName: group.name || null,
      rowCount: group.rows.length,
      chunkCount: chunks.length,
      uploadedAt: FieldValue.serverTimestamp()
    }));
    chunks.forEach((data, i) => ops.push(sized((b) => b.set(db.doc(`clientData/${clientKey2}/datasets/${datasetId}/chunks/${i}`), { data }), data.length * 2)));
  }
  await commitInChunks(ops);
  return { datasetId };
}
async function publishFieldStats(datasetId, summary, sourceUploadedAt) {
  const ref = db.doc(`fieldStats/${datasetId}`);
  const old = await ref.get();
  const pieces = splitString(JSON.stringify(summary), DOC_CHUNK_CHARS);
  await commitInChunks(pieces.map((data, i) => sized((b) => b.set(ref.collection("chunks").doc(String(i)), { data }), data.length)));
  for (let i = pieces.length; i < (old.exists ? old.data().chunkCount || 0 : 0); i++) await ref.collection("chunks").doc(String(i)).delete();
  await ref.set({ chunkCount: pieces.length, sourceUploadedAt: sourceUploadedAt ?? null, publishedAt: FieldValue.serverTimestamp(), format: 3 });
}
async function playerLabels() {
  const [users, invites, datasets] = await Promise.all([db.collection("users").get(), db.collection("invites").get(), db.collection("datasets").get()]);
  const labels = /* @__PURE__ */ new Map();
  users.forEach((d) => {
    if (!isTeamKey(d.data().clientKey)) labels.set(d.data().clientKey, d.data().clientLabel);
  });
  invites.forEach((d) => {
    const k = d.data().clientKey;
    if (!isTeamKey(k) && !labels.has(k)) labels.set(k, d.data().clientLabel);
  });
  datasets.forEach((d) => (d.data().clientKeys || []).forEach((k) => {
    if (!labels.has(k)) labels.set(k, k.replace(/^c_/, ""));
  }));
  const ids = new Map(labels), names = /* @__PURE__ */ new Map(), count = /* @__PURE__ */ new Map();
  datasets.forEach((d) => Object.entries(d.data().playerNames || {}).forEach(([k, n]) => {
    if (n) names.set(k, n);
  }));
  for (const [k] of labels) if (names.has(k)) count.set(names.get(k).toLowerCase(), (count.get(names.get(k).toLowerCase()) || 0) + 1);
  for (const [k, id] of ids) {
    const n = names.get(k);
    if (n) labels.set(k, count.get(n.toLowerCase()) > 1 ? `${n} (${id})` : n);
  }
  return labels;
}
var detailPath = (datasetId, year) => `fieldDetail/${datasetId}/${year || "none"}.bin.gz`;
async function publishFieldDetail(bucket, datasetId, players, sourceUploadedAt) {
  const billing = await db.doc("config/billing").get();
  if (billing.exists && billing.data().paused === true) return { skipped: "paused" };
  const files = encodeFieldDetail(players);
  let bytes = 0;
  for (const f of files) {
    const gz = await gzip(f.bytes);
    bytes += gz.length;
    await bucket.file(detailPath(datasetId, f.year)).save(Buffer.from(gz), { contentType: "application/octet-stream", resumable: false });
  }
  const years = files.map((f) => f.year);
  try {
    const [items] = await bucket.getFiles({ prefix: `fieldDetail/${datasetId}/` });
    for (const it of items) if (!years.some((y) => it.name === detailPath(datasetId, y))) await it.delete();
  } catch (err) {
    console.warn("Couldn't tidy old detail files", err?.message);
  }
  await db.doc(`fieldStats/${datasetId}`).set({ detail: { years, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: DETAIL_FORMAT, builtAt: FieldValue.serverTimestamp() } }, { merge: true });
  return { years, bytes };
}
