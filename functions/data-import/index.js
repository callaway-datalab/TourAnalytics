// Built from src.js by build.sh - edit src.js (and the portal's js/), not this file.

// src.js
import { createRequire } from "node:module";
import { gunzipSync, gzipSync } from "node:zlib";

// ../../js/data.js
var UserError = class extends Error {
};
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
var valKey = (v) => v === null || v === void 0 ? "n" : typeof v === "string" ? "s" + v : typeof v === "number" ? "d" + v : "b" + v;
function packRows(rows) {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = [];
  for (let c = 0; c < w; c++) {
    const vals = rows.map((r) => r[c] === void 0 ? null : r[c]);
    const raw = JSON.stringify(vals);
    const pos = /* @__PURE__ */ new Map(), uniq = [];
    const idx = vals.map((v) => {
      const k = valKey(v);
      let i = pos.get(k);
      if (i === void 0) {
        i = uniq.length;
        pos.set(k, i);
        uniq.push(v);
      }
      return i;
    });
    const dict = `{"d":${JSON.stringify(uniq)},"i":${JSON.stringify(idx)}}`;
    cols.push(dict.length < raw.length ? dict : raw);
  }
  return `{"v":2,"n":${rows.length},"w":${w},"c":[${cols.join(",")}]}`;
}
function parseChunk(str) {
  const x = JSON.parse(str);
  if (Array.isArray(x)) return x;
  const cols = x.c.map((c) => Array.isArray(c) ? c : c.i.map((i) => c.d[i]));
  const rows = new Array(x.n);
  for (let r = 0; r < x.n; r++) {
    const row = new Array(x.w);
    for (let c = 0; c < x.w; c++) row[c] = cols[c][r];
    rows[r] = row;
  }
  return rows;
}
var ZIP_MAX_BYTES = 9e5;
var streamBytes = async (u8, stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
var gzipText = (str) => streamBytes(new TextEncoder().encode(str), new CompressionStream("gzip"));
var gunzipText = async (u8) => new TextDecoder().decode(await streamBytes(u8, new DecompressionStream("gzip")));
var bytesOf = (z) => z instanceof Uint8Array ? z : typeof z?.toUint8Array === "function" ? z.toUint8Array() : z?._byteString?.binaryString ? Uint8Array.from(z._byteString.binaryString, (c) => c.charCodeAt(0)) : new Uint8Array(z);
async function readChunk(d) {
  if (!d) return [];
  if (d.z != null) return parseChunk(await gunzipText(bytesOf(d.z)));
  return parseChunk(d.data);
}
async function chunkRowsZ(rows) {
  const out = [];
  const emit = async (run2) => {
    if (!run2.length) return;
    const z = await gzipText(packRows(run2));
    if (z.length <= ZIP_MAX_BYTES || run2.length === 1) {
      out.push(z);
      return;
    }
    const h = Math.ceil(run2.length / 2);
    await emit(run2.slice(0, h));
    await emit(run2.slice(h));
  };
  let run = [], size = 0;
  const budget = 6e6;
  for (const row of rows) {
    const n = JSON.stringify(row).length;
    if (run.length && size + n + 1 > budget) {
      await emit(run);
      run = [];
      size = 0;
    }
    run.push(row);
    size += n + 1;
  }
  await emit(run);
  if (!out.length) out.push(await gzipText(packRows([])));
  return out;
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
  birth: ["birthdate", "birthdata", "dob", "dateofbirth", "birthday", "born", "playerbirthdate"],
  // (update 396: for the forecaster's age; blank is fine)
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
  club: ["club", "clubused", "clubname"],
  // (update 191) the equipment on each shot: the club's type, brand and model, and the ball's brand and model
  clubType: ["clubtype", "clubcategory", "clubgroup"],
  clubBrand: ["clubbrand", "brand", "manufacturer", "clubmake", "clubmanufacturer"],
  clubModel: ["clubmodel", "model", "productmodel"],
  ballBrand: ["ballbrand", "ballmake", "ballmanufacturer"],
  ballModel: ["ballmodel", "ball", "balltype"]
};
var GEAR = /* @__PURE__ */ new Map();
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
  ballSpeed: ["ballspeed", "ballspeedmph", "driverballspeed", "avgballspeed", "ballspeeddriver"],
  // (update 402)
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
  ballSpeed: { label: "Ball Speed", unit: " mph", dp: 1, higher: true, help: "Average ball speed on tee shots with the driver, in mph. Faster is better." },
  // (update 402)
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
  if (/proxim|^prox|dist(ance)?to(the)?(pin|hole|cup)|(feet|ft)(from|to)(the)?(pin|hole|cup)/.test(q) && !/pct|percent|rank/.test(q)) return "prox";
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
function birthOf(v) {
  if (v == null || isNull(v)) return null;
  let s = String(v).trim();
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 2e4 && Number(s) < 6e4) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5);
    s = d.toISOString().slice(0, 10);
  }
  let y, mo, da;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    y = Number(s.slice(0, 4));
    mo = Number(s.slice(5, 7));
    da = Number(s.slice(8, 10));
  } else {
    const d = new Date(s.replace(/\bsept\b/i, "Sep"));
    if (isNaN(d)) return null;
    y = d.getFullYear();
    mo = d.getMonth() + 1;
    da = d.getDate();
  }
  if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;
  return y >= 1930 && y <= (/* @__PURE__ */ new Date()).getUTCFullYear() - 12 ? `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}` : null;
}
var birthOfRounds = (rounds) => {
  for (const rd of rounds || []) if (rd.birth) return rd.birth;
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
      const bd = idx.birth !== void 0 ? birthOf(get(r, "birth")) : null;
      if (bd) rounds.get(key).birth = bd;
    }
    return rounds.get(key);
  };
  const known = (v) => v == null || isNull(v) || /^(unknown|unk|n\/a|-+|\?)$/i.test(String(v).trim()) || String(v).trim() === "" ? null : String(v).trim();
  const equip = (r) => {
    const type = known(get(r, "clubType")), club = known(get(r, "club")) ?? type;
    const src = type || club;
    const clubCat = src ? /non[\s-]*driver/i.test(src) ? "Non-Driver" : clubMemo(src) : null;
    const brand = known(get(r, "clubBrand")), model = known(get(r, "clubModel"));
    const bb = known(get(r, "ballBrand")), bm = known(get(r, "ballModel"));
    const gear = brand && model ? `${clubCat || "Other"}|${brand} ${model}` : null, ball = bb && bm ? `${bb} ${bm}` : null;
    if (gear && !GEAR.has(gear)) GEAR.set(gear, { kind: clubCat || "Other", brand, model });
    if (ball && !GEAR.has(`Ball|${ball}`)) GEAR.set(`Ball|${ball}`, { kind: "Ball", brand: bb, model: bm });
    return { club, clubCat, gear, ball };
  };
  const hasEquip = ["club", "clubType", "clubBrand", "clubModel", "ballBrand", "ballModel"].some((f) => idx[f] !== void 0);
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
        const eq2 = hasEquip ? equip(r) : null;
        (rd2.obs ||= []).push({
          k: statKey,
          cat: catMemo(get(r, "category")),
          lie: isNull(lie2) ? null : String(lie2),
          dist: isNull(dist2) ? null : String(dist2),
          v,
          w: aw !== null && aw > 0 ? aw : 1,
          file: true,
          ...eq2?.gear ? { gear: eq2.gear } : {},
          ...eq2?.ball ? { ball: eq2.ball } : {}
        });
        continue;
      }
    }
    const cat = catMemo(get(r, "category"));
    const w = idx.attempts !== void 0 ? num(get(r, "attempts")) : 1;
    const per = idx.statType !== void 0 ? num(get(r, "statValue")) : idx.sgPerAttempt !== void 0 ? num(get(r, "sgPerAttempt")) : null;
    const sg = per !== null && w !== null ? per * w : num(get(r, "sg"));
    if (!cat || sg === null || w === null || w <= 0) continue;
    const lie = get(r, "lie"), dist = get(r, "distanceRange");
    const eq = hasEquip ? equip(r) : { club: null, clubCat: null, gear: null, ball: null };
    const shot = { cat, sg, w, r, lie: isNull(lie) ? null : String(lie), dist: isNull(dist) ? null : String(dist), ...eq, ...idx.hole !== void 0 ? { hole: num(get(r, "hole")) } : {} };
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
  const fracKeys = /* @__PURE__ */ new Set(), over = /* @__PURE__ */ new Set(), fk = (rd, o) => `${o.k}${rd.tour || ""}`;
  for (const rd of list) for (const o of rd.obs) if (o.file && statDef(o.k).pct) {
    fracKeys.add(fk(rd, o));
    if (Math.abs(o.v) > 1.0001) over.add(fk(rd, o));
  }
  if (fracKeys.size) for (const rd of list) for (const o of rd.obs) {
    const k = fk(rd, o);
    if (o.file && fracKeys.has(k) && !over.has(k)) o.v *= 100;
  }
  if (idx.date !== void 0) list.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return list;
}
function shotObs(rd, s, r, idx) {
  const col = (f) => idx[f] === void 0 ? null : r[idx[f]];
  const add = (k, v) => {
    if (v !== null && v !== void 0 && Number.isFinite(v)) (rd.obs ||= []).push({ k, cat: s.cat, lie: s.lie, dist: s.dist, v, w: s.w, ...s.gear ? { gear: s.gear } : {}, ...s.ball ? { ball: s.ball } : {} });
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
      ...birthOfRounds(p.rounds) ? { b: birthOfRounds(p.rounds) } : {},
      // (update 396)
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
function yearBuilder(year) {
  const dict = [null], at = /* @__PURE__ */ new Map([[null, 0]]);
  const id = (s) => {
    const k = s === void 0 || s === null ? null : String(s);
    let i = at.get(k);
    if (i === void 0) {
      i = dict.length;
      at.set(k, i);
      dict.push(k);
    }
    return i;
  };
  const grow = (a, need) => {
    if (need <= a.length) return a;
    const b = new a.constructor(Math.max(need, a.length * 2));
    b.set(a);
    return b;
  };
  let sI = new Uint32Array(7 * 4096), sF = new Float32Array(2 * 4096), oI = new Uint32Array(6 * 1024), oF = new Float32Array(2 * 1024), nS = 0, nO = 0;
  const hp = [];
  return {
    add(p, rounds) {
      const rs = [];
      for (const rd of rounds) {
        const ns = rd.shots.length, obs = rd.obs || [], no = obs.length;
        sI = grow(sI, (nS + ns) * 7);
        sF = grow(sF, (nS + ns) * 2);
        oI = grow(oI, (nO + no) * 6);
        oF = grow(oF, (nO + no) * 2);
        for (const x of rd.shots) {
          const b = nS * 7;
          sI[b] = id(x.cat);
          sI[b + 1] = id(x.lie);
          sI[b + 2] = id(x.dist);
          sI[b + 3] = id(x.club);
          sI[b + 4] = id(x.clubCat);
          sI[b + 5] = id(x.gear);
          sI[b + 6] = id(x.ball);
          sF[nS * 2] = x.sg;
          sF[nS * 2 + 1] = x.w;
          nS++;
        }
        for (const o of obs) {
          const b = nO * 6;
          oI[b] = id(o.k);
          oI[b + 1] = id(o.cat);
          oI[b + 2] = id(o.lie);
          oI[b + 3] = id(o.dist);
          oI[b + 4] = id(o.gear);
          oI[b + 5] = id(o.ball);
          oF[nO * 2] = o.v;
          oF[nO * 2 + 1] = o.w;
          nO++;
        }
        const plain = rd.key === `${rd.date}|${rd.event}|${rd.roundNo}`;
        rs.push([plain ? null : rd.key, id(rd.date), id(rd.event), rd.roundNo, id(rd.tour), rd.eventLevel ? 1 : 0, ns, no, id(rd.course || null)]);
      }
      hp.push([p.key, p.name ?? p.label ?? null, rs]);
    },
    finish() {
      const wide = dict.length > 65535, I = wide ? Uint32Array : Uint16Array;
      const header = new TextEncoder().encode(JSON.stringify({ v: 2, year, wide, nS, nO, dict, players: hp }));
      const parts = [I.from(sI.subarray(0, nS * 7)), sF.subarray(0, nS * 2), I.from(oI.subarray(0, nO * 6)), oF.subarray(0, nO * 2)];
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
  };
}
function detailBuilder() {
  const years = /* @__PURE__ */ new Map();
  return {
    add(p) {
      const by = /* @__PURE__ */ new Map();
      for (const rd of p.rounds) {
        const y = String(rd.year ?? "");
        (by.get(y) || by.set(y, []).get(y)).push(rd);
      }
      for (const [y, rs] of by) (years.get(y) || years.set(y, yearBuilder(y)).get(y)).add(p, rs);
    },
    finish() {
      return [...years].map(([year, b]) => ({ year, bytes: b.finish() }));
    }
  };
}
function mergeDetailYears(list) {
  if (list.length === 1) return list[0];
  let b = null;
  for (const bytes of list) {
    const ps = decodeFieldDetail(bytes);
    for (const p of ps) {
      b ||= yearBuilder(p.rounds[0]?.year ?? "");
      b.add(p, p.rounds);
    }
  }
  return (b || yearBuilder("")).finish();
}
var r4 = (x) => Math.round(x * 1e4) / 1e4;
var own = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
var ShotV = class {
  constructor(t, i) {
    this.t = t;
    this.i = i;
  }
  get cat() {
    return this.t.d[this.t.I[this.i * this.t.N]];
  }
  set cat(v) {
    own(this, "cat", v);
  }
  get lie() {
    return this.t.d[this.t.I[this.i * this.t.N + 1]];
  }
  set lie(v) {
    own(this, "lie", v);
  }
  get dist() {
    return this.t.d[this.t.I[this.i * this.t.N + 2]];
  }
  set dist(v) {
    own(this, "dist", v);
  }
  get club() {
    return this.t.clubs ? this.t.d[this.t.I[this.i * this.t.N + 3]] : void 0;
  }
  set club(v) {
    own(this, "club", v);
  }
  get clubCat() {
    return this.t.clubs ? this.t.d[this.t.I[this.i * this.t.N + 4]] : void 0;
  }
  set clubCat(v) {
    own(this, "clubCat", v);
  }
  get gear() {
    const x = this.t.N === 7 ? this.t.I[this.i * 7 + 5] : 0;
    return x ? this.t.d[x] : void 0;
  }
  set gear(v) {
    own(this, "gear", v);
  }
  get ball() {
    const x = this.t.N === 7 ? this.t.I[this.i * 7 + 6] : 0;
    return x ? this.t.d[x] : void 0;
  }
  set ball(v) {
    own(this, "ball", v);
  }
  get sg() {
    return r4(this.t.F[this.i * 2]);
  }
  set sg(v) {
    own(this, "sg", v);
  }
  get w() {
    return r4(this.t.F[this.i * 2 + 1]);
  }
  set w(v) {
    own(this, "w", v);
  }
  toJSON() {
    return { cat: this.cat, sg: this.sg, w: this.w, lie: this.lie, dist: this.dist, club: this.club, clubCat: this.clubCat, gear: this.gear, ball: this.ball };
  }
};
var ObsV = class {
  constructor(t, i) {
    this.t = t;
    this.i = i;
  }
  get k() {
    return this.t.d[this.t.I[this.i * this.t.N]];
  }
  set k(v) {
    own(this, "k", v);
  }
  get cat() {
    return this.t.d[this.t.I[this.i * this.t.N + 1]];
  }
  set cat(v) {
    own(this, "cat", v);
  }
  get lie() {
    return this.t.d[this.t.I[this.i * this.t.N + 2]];
  }
  set lie(v) {
    own(this, "lie", v);
  }
  get dist() {
    return this.t.d[this.t.I[this.i * this.t.N + 3]];
  }
  set dist(v) {
    own(this, "dist", v);
  }
  get gear() {
    const x = this.t.N === 6 ? this.t.I[this.i * 6 + 4] : 0;
    return x ? this.t.d[x] : void 0;
  }
  set gear(v) {
    own(this, "gear", v);
  }
  get ball() {
    const x = this.t.N === 6 ? this.t.I[this.i * 6 + 5] : 0;
    return x ? this.t.d[x] : void 0;
  }
  set ball(v) {
    own(this, "ball", v);
  }
  get v() {
    return r4(this.t.F[this.i * 2]);
  }
  set v(x) {
    own(this, "v", x);
  }
  get w() {
    return r4(this.t.F[this.i * 2 + 1]);
  }
  set w(x) {
    own(this, "w", x);
  }
  toJSON() {
    return { k: this.k, cat: this.cat, lie: this.lie, dist: this.dist, gear: this.gear, ball: this.ball, v: this.v, w: this.w };
  }
};
var StatV = class extends ObsV {
  get sg() {
    return 0;
  }
  set sg(v) {
    own(this, "sg", v);
  }
  get club() {
    return null;
  }
  set club(v) {
    own(this, "club", v);
  }
  get clubCat() {
    return null;
  }
  set clubCat(v) {
    own(this, "clubCat", v);
  }
  toJSON() {
    return { cat: this.cat, lie: this.lie, dist: this.dist, v: this.v, w: this.w, sg: 0, club: null, clubCat: null, gear: this.gear, ball: this.ball };
  }
};
var ColList = class _ColList {
  constructor(t, View, start, n, idx = null) {
    this.t = t;
    this.View = View;
    this.start = start;
    this.n = n;
    this.idx = idx;
  }
  get length() {
    return this.n;
  }
  pos(j) {
    return this.idx ? this.idx[j] : this.start + j;
  }
  at(j) {
    if (j < 0) j += this.n;
    return j >= 0 && j < this.n ? new this.View(this.t, this.pos(j)) : void 0;
  }
  [Symbol.iterator]() {
    let j = 0;
    const me = this;
    return { next: () => j < me.n ? { value: new me.View(me.t, me.pos(j++)), done: false } : { value: void 0, done: true }, [Symbol.iterator]() {
      return this;
    } };
  }
  forEach(f) {
    for (let j = 0; j < this.n; j++) f(new this.View(this.t, this.pos(j)), j, this);
  }
  map(f) {
    const out = new Array(this.n);
    for (let j = 0; j < this.n; j++) out[j] = f(new this.View(this.t, this.pos(j)), j, this);
    return out;
  }
  flatMap(f) {
    return this.map(f).flat();
  }
  filter(f) {
    const keep = new Uint32Array(this.n);
    let m = 0;
    for (let j = 0; j < this.n; j++) {
      const p = this.pos(j);
      if (f(new this.View(this.t, p), j, this)) keep[m++] = p;
    }
    return new _ColList(this.t, this.View, 0, m, keep.slice(0, m));
  }
  reduce(f, init) {
    let j = 0, acc = init;
    if (arguments.length < 2) {
      if (!this.n) throw new TypeError("Reduce of empty list with no initial value");
      acc = new this.View(this.t, this.pos(0));
      j = 1;
    }
    for (; j < this.n; j++) acc = f(acc, new this.View(this.t, this.pos(j)), j, this);
    return acc;
  }
  some(f) {
    for (let j = 0; j < this.n; j++) if (f(new this.View(this.t, this.pos(j)), j, this)) return true;
    return false;
  }
  every(f) {
    for (let j = 0; j < this.n; j++) if (!f(new this.View(this.t, this.pos(j)), j, this)) return false;
    return true;
  }
  find(f) {
    for (let j = 0; j < this.n; j++) {
      const v = new this.View(this.t, this.pos(j));
      if (f(v, j, this)) return v;
    }
    return void 0;
  }
  findIndex(f) {
    for (let j = 0; j < this.n; j++) if (f(new this.View(this.t, this.pos(j)), j, this)) return j;
    return -1;
  }
  slice(a = 0, b = this.n) {
    if (a < 0) a += this.n;
    if (b < 0) b += this.n;
    a = Math.max(0, Math.min(this.n, a));
    b = Math.max(a, Math.min(this.n, b));
    const idx = new Uint32Array(b - a);
    for (let j = a; j < b; j++) idx[j - a] = this.pos(j);
    return new _ColList(this.t, this.View, 0, b - a, idx);
  }
  concat(...more) {
    return [...this, ...more.flatMap((x) => x && typeof x[Symbol.iterator] === "function" && typeof x !== "string" ? [...x] : [x])];
  }
  sort(f) {
    return [...this].sort(f);
  }
  toArray() {
    return [...this];
  }
  /** (stats only) this round's entries of one stat, as shots, without making an object for each */
  asStat(key) {
    if (this.View !== ObsV) return null;
    const keep = new Uint32Array(this.n);
    let m = 0;
    const { d, I, N } = this.t;
    for (let j = 0; j < this.n; j++) {
      const p = this.pos(j);
      if (d[I[p * N]] === key) keep[m++] = p;
    }
    return new _ColList(this.t, StatV, 0, m, keep.slice(0, m));
  }
  toJSON() {
    return this.toArray();
  }
};
function decodeFieldDetail(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder().decode(u8.subarray(0, 4)) !== MAGIC) throw new Error("Not a field detail file");
  const hl = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
  if (h.v !== 1 && h.v !== 2) throw new Error("Unknown field detail version");
  const SN = h.v === 2 ? 7 : 5, ON = h.v === 2 ? 6 : 4;
  const pad4 = (n) => n + 3 & ~3;
  const buf = u8.byteOffset % 4 === 0 ? u8.buffer : u8.slice().buffer, base = u8.byteOffset % 4 === 0 ? u8.byteOffset : 0;
  const I = h.wide ? Uint32Array : Uint16Array, isz = h.wide ? 4 : 2;
  let off = pad4(8 + hl);
  const take = (T, n, sz) => {
    const t = new T(buf, base + off, n).slice();
    off = pad4(off + n * sz);
    return t;
  };
  const sI = take(I, h.nS * SN, isz), sF = take(Float32Array, h.nS * 2, 4), oI = take(I, h.nO * ON, isz), oF = take(Float32Array, h.nO * 2, 4);
  const d = h.dict;
  let clubs = false;
  for (let i = 0; i < h.nS && !clubs; i++) if (sI[i * SN + 3] || SN === 7 && (sI[i * SN + 5] || sI[i * SN + 6])) clubs = true;
  const st = { d, I: sI, F: sF, N: SN, clubs }, ot = { d, I: oI, F: oF, N: ON };
  const year = String(h.year ?? "");
  let a = 0, b = 0;
  return h.players.map(([key, name, rounds]) => ({
    key,
    name,
    rounds: rounds.map(([rk, di, ei, roundNo, ti, ev, ns, no, ci]) => {
      const shots = new ColList(st, ShotV, a, ns), obs = new ColList(ot, ObsV, b, no);
      const has = /* @__PURE__ */ new Set();
      for (let i = 0; i < no; i++) has.add(d[oI[(b + i) * ON]]);
      if (ns) has.add("sg");
      a += ns;
      b += no;
      const date = d[di] ?? "", event = d[ei] ?? "";
      const rd = { key: rk ?? `${date}|${event}|${roundNo}`, date, event, roundNo, year, tour: d[ti] ?? "", ...ci && d[ci] ? { course: d[ci] } : {}, shots, obs, ...ev ? { eventLevel: true } : {} };
      rd.has = has;
      return rd;
    })
  }));
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
var DETAIL_FORMAT = 2;
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
      const db0 = tourDetail();
      for (const p of players) db0.add(p);
      detail = await publishFieldDetail(bucket, datasetId, db0.finish(), Date.now());
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
var RUN_MS = Number(process.env.REBUILD_RUN_MS) || 33e4;
var MERGE_MS = Number(process.env.REBUILD_MERGE_MS) || 2e5;
var partPath = (datasetId, runId, part, what) => `rebuildParts/${datasetId}/${runId}/${part}.${what}.gz`;
async function rebuild(bucket, file, meta) {
  const T0 = Date.now();
  const datasetId = String(meta.datasetId || ""), statusId = meta.statusId || `rebuild_${datasetId}`, status = db.doc(`imports/${statusId}`);
  const set = (fields) => status.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const beat = heartbeat(status);
  const start = Math.max(0, Number(meta.start) || 0), part = Math.max(0, Number(meta.part) || 0), runId = String(meta.runId || Date.now());
  try {
    if (!part) {
      const prior = await status.get();
      if (!prior.exists) await set({ name: meta.name || null, status: "running", step: "Updating rankings", startedAt: FieldValue.serverTimestamp(), datasetId });
    }
    const dsSnap = await db.doc(`datasets/${datasetId}`).get();
    if (!dsSnap.exists) throw new Error("That data file isn't there any more.");
    const ds = dsSnap.data(), idx = detectColumns(ds.columns || []);
    let rankings = false, detail = null;
    if (isShotData(idx)) {
      await set({ status: "running", step: start ? `Updating rankings (${start} of ${(ds.clientKeys || []).length} players)` : "Updating rankings" });
      const labels = await playerLabels();
      const all = ds.clientKeys || [], names = ds.playerNames || {};
      const keys = all.slice(start), summary = [], det = tourDetail();
      let taken = start, msRead = 0, msPrep = 0, nDone = 0;
      const next = async () => {
        while (keys.length && Date.now() - T0 < RUN_MS) {
          const key = keys.shift();
          taken++;
          const m = await db.doc(`clientData/${key}/datasets/${datasetId}`).get();
          const n = m.exists ? m.data().chunkCount || 0 : 0;
          const refs = Array.from({ length: n }, (_, i) => db.doc(`clientData/${key}/datasets/${datasetId}/chunks/${i}`));
          const t1 = Date.now();
          const snaps = refs.length ? await db.getAll(...refs) : [];
          const rows = (await Promise.all(snaps.map((sn) => sn.exists ? readChunk(sn.data()) : []))).flat();
          const t2 = Date.now();
          const rounds = prepare(rows, idx);
          msRead += t2 - t1;
          msPrep += Date.now() - t2;
          nDone++;
          for (const rd of rounds) for (const sh of rd.shots) delete sh.r;
          if (rounds.length) {
            const pl = { key, name: labels.get(key) || names[key] || key.replace(/^c_/, ""), rounds };
            summary.push(buildFieldSummary([pl]).players[0]);
            det.add(pl);
          }
          if (taken % 100 === 0) await set({ step: `Updating rankings (${taken} of ${all.length} players)` });
        }
      };
      await Promise.all(Array.from({ length: Number(process.env.REBUILD_PARALLEL) || 24 }, next));
      console.log(`Rebuild ${datasetId}: ${nDone} players this run in ${Math.round((Date.now() - T0) / 1e3)}s; per player, reading ${Math.round(msRead / Math.max(1, nDone))} ms (waiting included), working out ${Math.round(msPrep / Math.max(1, nDone))} ms`);
      const files = det.finish();
      if (keys.length || part > 0 && Date.now() - T0 > MERGE_MS) {
        await bucket.file(partPath(datasetId, runId, part, "summary.json")).save(gzipSync(JSON.stringify({ players: summary, files: files.map((f) => [f.tour, f.year]) })), { resumable: false });
        for (const f of files) await bucket.file(partPath(datasetId, runId, part, `${tourSlug(f.tour)}~${f.year || "none"}.bin`)).save(gzipSync(f.bytes), { resumable: false });
        await set({ step: `Updating rankings (${taken} of ${all.length} players, part ${part + 1} saved)` });
        const mk = bucket.file(`${REBUILD}${datasetId}.p${part + 1}.json`);
        await mk.save(JSON.stringify({ datasetId }), { resumable: false, contentType: "application/json", metadata: { metadata: { kind: "rebuild", datasetId, statusId, name: meta.name || "", start: String(taken), part: String(part + 1), runId } } });
        console.log(`Rebuild ${datasetId}: part ${part} saved (${taken} of ${all.length}), handing on`);
        return;
      }
      const tk = (t, y) => `${t || ""}${y ?? ""}`;
      let players = summary, yearsMap = new Map(files.map((f) => [tk(f.tour, f.year), [f.bytes]]));
      if (part > 0) {
        await set({ step: "Joining the parts" });
        players = [];
        for (let i = 0; i < part; i++) {
          const [buf] = await bucket.file(partPath(datasetId, runId, i, "summary.json")).download();
          const pj = JSON.parse(gunzipSync(buf).toString("utf8"));
          for (const p of pj.players) players.push(p);
          for (const [t, y] of pj.files || []) {
            const [b] = await bucket.file(partPath(datasetId, runId, i, `${tourSlug(t)}~${y || "none"}.bin`)).download();
            const u = new Uint8Array(gunzipSync(b));
            const k = tk(t, y);
            (yearsMap.get(k) || yearsMap.set(k, []).get(k)).unshift(u);
          }
        }
        for (const p of summary) players.push(p);
      }
      await publishFieldStats(datasetId, { players }, Date.now());
      rankings = true;
      await set({ step: "Updating lie and distance detail" });
      const out = [...yearsMap].map(([k, list]) => {
        const [tour, year] = k.split("");
        return { tour, year: year === "" ? null : year, bytes: mergeDetailYears(list) };
      });
      yearsMap = null;
      detail = await publishFieldDetail(bucket, datasetId, out, Date.now());
      if (part > 0) {
        try {
          const [items] = await bucket.getFiles({ prefix: `rebuildParts/${datasetId}/` });
          for (const it of items) await it.delete().catch(() => {
          });
        } catch (e) {
          console.warn("Couldn't tidy the parts", e?.message);
        }
      }
    }
    await set({
      status: "done",
      step: null,
      datasetId,
      rankings,
      detail: detail?.skipped || (detail ? "saved" : null),
      finishedAt: FieldValue.serverTimestamp(),
      ...meta.statusId && !String(meta.statusId).startsWith("rebuild_") ? {} : { people: (ds.clientKeys || []).length }
    });
    console.log(`Rebuilt rankings for ${datasetId}`);
  } catch (err) {
    console.error("Rebuild failed", err);
    await set({ status: "error", step: null, message: `The rows are live, but the rankings couldn't be rebuilt: ${String(err?.message || err)}. Try "Rebuild rankings" on Upload Data.`, finishedAt: FieldValue.serverTimestamp() });
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
  const refs = await col.listDocuments();
  await commitInChunks(refs.map((r) => (b) => b.delete(r)));
}
async function saveDataset(name, description, dataset) {
  const existing = await db.collection("datasets").where("name", "==", name).get();
  const datasetId = existing.empty ? db.collection("datasets").doc().id : existing.docs[0].id;
  const oldClientKeys = existing.empty ? [] : existing.docs[0].data().clientKeys || [];
  const pieces = /* @__PURE__ */ new Map();
  for (const [k, g] of dataset.byClient) pieces.set(k, await chunkRowsZ(g.rows));
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
    chunks.forEach((z, i) => ops.push(sized((b) => b.set(db.doc(`clientData/${clientKey2}/datasets/${datasetId}/chunks/${i}`), { z: Buffer.from(z) }), z.length + 200)));
  }
  await commitInChunks(ops);
  return { datasetId };
}
async function publishFieldStats(datasetId, summary, sourceUploadedAt) {
  const ref = db.doc(`fieldStats/${datasetId}`);
  const old = await ref.get();
  const pieces = splitString(JSON.stringify(summary), DOC_CHUNK_CHARS), prefix = `${Date.now()}_`;
  await commitInChunks(pieces.map((data, i) => sized((b) => b.set(ref.collection("chunks").doc(`${prefix}${i}`), { data }), data.length)));
  await ref.set({ chunkCount: pieces.length, chunkPrefix: prefix, sourceUploadedAt: sourceUploadedAt ?? null, publishedAt: FieldValue.serverTimestamp(), format: 3 });
  const op = old.exists ? old.data().chunkPrefix || "" : null;
  if (op !== null) for (let i = 0; i < (old.data().chunkCount || 0); i++) await ref.collection("chunks").doc(`${op}${i}`).delete().catch(() => {
  });
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
var tourSlug = (t) => String(t || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "none";
var detailPath = (datasetId, tour, year) => `fieldDetail/${datasetId}/${tourSlug(tour)}~${year || "none"}.bin.gz`;
function tourDetail() {
  const by = /* @__PURE__ */ new Map();
  return {
    add(pl) {
      const rs = /* @__PURE__ */ new Map();
      for (const rd of pl.rounds) {
        const t = rd.tour || "";
        (rs.get(t) || rs.set(t, []).get(t)).push(rd);
      }
      for (const [t, rounds] of rs) (by.get(t) || by.set(t, detailBuilder()).get(t)).add({ ...pl, rounds });
    },
    finish() {
      const out = [];
      for (const [t, b] of by) for (const f of b.finish()) out.push({ tour: t, year: f.year, bytes: f.bytes });
      return out;
    }
  };
}
async function publishFieldDetail(bucket, datasetId, files, sourceUploadedAt) {
  const billing = await db.doc("config/billing").get();
  if (billing.exists && billing.data().paused === true) return { skipped: "paused" };
  let bytes = 0;
  const tours = {}, sizes = {}, paths = /* @__PURE__ */ new Set();
  for (const f of files) {
    const gz = await gzip(f.bytes);
    bytes += gz.length;
    const path = detailPath(datasetId, f.tour, f.year);
    paths.add(path);
    await bucket.file(path).save(Buffer.from(gz), { contentType: "application/octet-stream", resumable: false });
    const t = f.tour || "";
    (tours[t] ||= []).push(f.year);
    sizes[`${t}|${f.year ?? ""}`] = gz.length;
  }
  for (const t of Object.keys(tours)) tours[t].sort();
  const years = [...new Set(files.map((f) => f.year))].sort();
  try {
    const [items] = await bucket.getFiles({ prefix: `fieldDetail/${datasetId}/` });
    for (const it of items) if (!paths.has(it.name)) await it.delete();
  } catch (err) {
    console.warn("Couldn't tidy old detail files", err?.message);
  }
  await db.doc(`fieldStats/${datasetId}`).set({ detail: { years, tours, sizes, sourceUploadedAt: sourceUploadedAt ?? null, bytes, format: DETAIL_FORMAT, builtAt: FieldValue.serverTimestamp() } }, { merge: true });
  return { years, bytes };
}
