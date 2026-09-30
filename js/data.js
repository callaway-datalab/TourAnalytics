// Pure helpers: no browser or Firebase dependencies, so they can be unit-tested in Node.

export class UserError extends Error {}

export const MAX_CHUNK_CHARS = 300000;        // JSON characters per Firestore chunk (limit is ~1 MiB per document)
export const DOC_CHUNK_CHARS = 600000;        // base64 characters per document chunk
/* Report types. Reports uploaded before types existed count as performance reports. */
export const REPORT_CATEGORIES = [['performance', 'Performance Reports'], ['course', 'Course Reports']];
export const reportCategory = (d) => (d?.category === 'course' ? 'course' : 'performance');
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // per file attached to a question or reply
export const MAX_ATTACHMENTS = 5;                      // files per message
export const MAX_DOC_BYTES = 25 * 1024 * 1024; // uploads are split into ~6 MB batches, so this is a storage-budget choice, not a Firestore limit
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

/* ---------- IDs and access codes ---------- */
export const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Firestore-safe key for a client ID. "C1001 " -> "c_c1001". Same input always gives the same key. */
export function clientKey(label) {
  const n = norm(label);
  if (!n) return '';
  return 'c_' + encodeURIComponent(n).replace(/\./g, '%2E');
}

export function makeCode(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let out = '';
  while (out.length < 10) {
    for (const b of randomBytes(16)) {
      if (b < 248 && out.length < 10) out += CODE_ALPHABET[b % 31]; // 248 = 31*8: no modulo bias
    }
  }
  return out;
}
/* ---------- Team members (coaches, caddies, ...) ---------- */
// A team member's account gets its own key, "t_<random>", so it never collides with a player's
// "c_..." key and holds no data of its own. Which players they can see lives on their profile.
export const TEAM_PREFIX = 't_';
export const isTeamKey = (k) => typeof k === 'string' && k.startsWith(TEAM_PREFIX);
export function teamKey(randomBytes) { return TEAM_PREFIX + makeCode(randomBytes).toLowerCase(); }
export const DEFAULT_ROLES = ['coach', 'caddy', 'trainer', 'physio', 'manager', 'agent'];
/** Roles are stored lowercase and used as a Firestore path segment, so strip anything unsafe there. */
export function normRole(r) {
  return String(r ?? '').trim().replace(/\s+/g, ' ').replace(/[\/.]/g, '').replace(/^_+|_+$/g, '').slice(0, 30).toLowerCase();
}
export const roleLabel = (r) => (r === ANALYST_ROLE ? 'Callaway Analyst' : r ? r.charAt(0).toUpperCase() + r.slice(1) : '');
/* Internal Callaway analysts: team-member accounts marked kind "analyst", with role "analyst" for each
   player they can see. They're managed on Player Access, never by the roster, and always see every
   report sent to their players. */
export const ANALYST_ROLE = 'analyst';

/* ---------- Team roster file ---------- */
// The roster is a CSV the admin keeps: one row per team member per player.
//   email,name,role,player_id
//   mike@example.com,Mike Smith,Coach,C1001
// A player_id cell may list several players separated by ";" or "|".
// Anyone not in the roster has no team: only the player sees their own data.
export const ROSTER_COLUMNS = ['email', 'name', 'role', 'player_id'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Returns { entries: [{email, name, role, playerLabel, playerKey}], problems: [string] }.
 *  Any problem means the file should be rejected as a whole, so a typo never silently
 *  drops someone's access. */
export function parseTeamRoster(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new UserError('That file is empty.');
  const header = rows[0].map((h) => norm(h).replace(/[\s-]+/g, '_'));
  const find = (...names) => header.findIndex((h) => names.includes(h));
  const iEmail = find('email', 'email_address', 'e_mail');
  const iName = find('name', 'full_name', 'team_member');
  const iRole = find('role', 'title', 'position');
  const iPlayer = find('player_id', 'player', 'player_ids', 'client_id', 'players');
  const missing = [[iEmail, 'email'], [iRole, 'role'], [iPlayer, 'player_id']].filter(([i]) => i < 0).map(([, n]) => n);
  if (missing.length) {
    throw new UserError(`The roster needs these columns: ${ROSTER_COLUMNS.join(', ')}. Missing: ${missing.join(', ')}.`);
  }
  const entries = [];
  const problems = [];
  const seen = new Set();
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const cell = (i) => (i < 0 ? '' : String(r[i] ?? '').trim());
    if (r.every((v) => String(v ?? '').trim() === '')) return;
    const email = cell(iEmail).toLowerCase();
    const role = normRole(cell(iRole));
    const players = cell(iPlayer).split(/[;|]/).map((p) => p.trim()).filter(Boolean);
    if (!EMAIL_RE.test(email)) { problems.push(`Row ${line}: "${cell(iEmail)}" isn't an email address.`); return; }
    if (!role) { problems.push(`Row ${line}: no role for ${email}.`); return; }
    if (!players.length) { problems.push(`Row ${line}: no player_id for ${email}.`); return; }
    const name = cell(iName) || email;
    for (const playerLabel of players) {
      const playerKey = clientKey(playerLabel);
      const dup = `${email}|${playerKey}`;
      if (seen.has(dup)) { problems.push(`Row ${line}: ${email} is listed for ${playerLabel} more than once.`); continue; }
      seen.add(dup);
      entries.push({ email, name, role, playerLabel, playerKey });
    }
  });
  return { entries, problems };
}

/** entries -> Map(email -> { name, access: { [playerKey]: { role, label } } }).
 *  labels (optional): player key -> name to show, instead of the ID in the file. */
export function rosterByEmail(entries, labels) {
  const out = new Map();
  for (const e of entries) {
    if (!out.has(e.email)) out.set(e.email, { name: e.name, access: {} });
    out.get(e.email).access[e.playerKey] = { role: e.role, label: labels?.get(e.playerKey) || e.playerLabel };
  }
  return out;
}

export function sameAccess(a = {}, b = {}) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k].role === b[k].role && a[k].label === b[k].label);
}

export const normalizeCode = (raw) => String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const formatCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

/* ---------- CSV ---------- */
function detectDelimiter(text) {
  const firstLine = text.slice(0, Math.max(0, text.search(/\r?\n/)) || text.length);
  let best = ',', bestCount = 0;
  for (const d of [',', ';', '\t']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0, n = text.length; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function tableFromCsvRows(rows) {
  if (!rows.length) throw new UserError('That file is empty.');
  const seen = new Set();
  const columns = rows[0].map((h, i) => {
    let name = String(h).trim() || `column_${i + 1}`;
    while (seen.has(name)) name += '_2';
    seen.add(name);
    return name;
  });
  const width = columns.length;
  const data = rows.slice(1).map((r) => (r.length === width ? r : Array.from({ length: width }, (_, i) => r[i] ?? '')));
  return { columns, rows: data };
}

/** objects from a Parquet reader -> same table shape as CSV */
export function tableFromObjects(objects) {
  if (!objects.length) throw new UserError('That file has no rows.');
  const columns = Object.keys(objects[0]);
  return { columns, rows: objects.map((o) => columns.map((c) => o[c])) };
}

export function toCsv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.name ?? c)).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}

/* ---------- Type inference ---------- */
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const isBlank = (v) =>
  v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && v.trim() === '');
const pad = (n) => String(n).padStart(2, '0');

function dateParts(v) {
  if (v instanceof Date) {
    return isNaN(v) ? null : { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate(), h: v.getUTCHours(), mi: v.getUTCMinutes() };
  }
  const m = DATE_RE.exec(String(v).trim());
  return m ? { y: +m[1], m: +m[2], d: +m[3], h: m[4] === undefined ? null : +m[4], mi: m[5] === undefined ? null : +m[5] } : null;
}

function inferColumn(values) {
  const present = values.filter((v) => !isBlank(v));
  const blankTo = (fn) => (v) => (isBlank(v) ? null : fn(v));
  if (!present.length) return { type: 'text', convert: () => null };

  if (present.every((v) => (typeof v === 'number' && isFinite(v)) || typeof v === 'bigint')) {
    return { type: 'number', convert: blankTo((v) => Number(v)) };
  }
  const dateLike = present.every((v) => v instanceof Date || (typeof v === 'string' && DATE_RE.test(v.trim())));
  if (dateLike) {
    const parts = present.map(dateParts);
    if (parts.every(Boolean)) {
      const withTime = parts.some((p) => p.h !== null && (p.h !== 0 || p.mi !== 0));
      return {
        type: 'date',
        convert: blankTo((v) => {
          const p = dateParts(v);
          const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
          return withTime ? `${day} ${pad(p.h ?? 0)}:${pad(p.mi ?? 0)}` : day;
        }),
      };
    }
  }
  if (present.every((v) => typeof v === 'string' && NUM_RE.test(v.trim()) && !/^[+-]?0\d/.test(v.trim()))) {
    return { type: 'number', convert: blankTo((v) => Number(String(v).trim())) };
  }
  return { type: 'text', convert: blankTo((v) => (typeof v === 'bigint' ? v.toString() : String(v))) };
}

export const NAME_COLUMNS = ['player', 'playername', 'name', 'golfer', 'fullname', 'playerfullname'];

export function resolveIdColumn(columns, input) {
  const want = String(input ?? '').trim();
  let i = columns.indexOf(want);
  if (i < 0) i = columns.findIndex((c) => c.trim().toLowerCase() === want.toLowerCase());
  return i;
}

const idString = (v) => (isBlank(v) ? '' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : norm(v));

/**
 * table: { columns: string[], rows: any[][] }
 * Returns rows grouped per person, with the ID column removed.
 */
export function buildDataset(table, idInput) {
  const { columns, rows } = table;
  const idCol = resolveIdColumn(columns, idInput);
  if (idCol < 0) {
    throw new UserError(`There's no column named "${idInput}". Columns in this file: ${columns.slice(0, 25).join(', ')}`);
  }
  if (!rows.length) throw new UserError('That file has no rows.');

  const cols = [], converters = [];
  columns.forEach((name, i) => {
    if (i === idCol) return;
    const { type, convert } = inferColumn(rows.map((r) => r[i]));
    cols.push({ name, type });
    converters.push([i, convert]);
  });

  // A column with the player's name (e.g. "player"), shown instead of the ID wherever players are listed.
  const squashName = (c) => String(c).toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameCol = columns.findIndex((c, i) => i !== idCol && NAME_COLUMNS.includes(squashName(c)));

  const byClient = new Map();
  let blankIdRows = 0;
  for (const r of rows) {
    const id = idString(r[idCol]);
    if (!id) { blankIdRows++; continue; }
    const key = clientKey(id);
    let g = byClient.get(key);
    if (!g) byClient.set(key, (g = { label: id, rows: [] }));
    if (nameCol >= 0 && !g.name && !isBlank(r[nameCol])) g.name = String(r[nameCol]).trim();
    g.rows.push(converters.map(([i, convert]) => convert(r[i])));
  }
  if (!byClient.size) throw new UserError(`Every value in "${columns[idCol]}" is blank, so no row can be matched to a person.`);
  return { idColumn: columns[idCol], columns: cols, byClient, rowCount: rows.length, blankIdRows };
}

/* ---------- Chunking (Firestore documents are limited to ~1 MiB) ---------- */
export function chunkRows(rows, maxChars = MAX_CHUNK_CHARS) {
  const chunks = [];
  let parts = [], size = 2;
  for (const row of rows) {
    const s = JSON.stringify(row);
    if (s.length + 2 > 800000) throw new UserError('One row in this file is too large to store.');
    if (parts.length && size + s.length + 1 > maxChars) {
      chunks.push(`[${parts.join(',')}]`);
      parts = []; size = 2;
    }
    parts.push(s); size += s.length + 1;
  }
  if (parts.length || !chunks.length) chunks.push(`[${parts.join(',')}]`);
  return chunks;
}

export function splitString(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out.length ? out : [''];
}

export const readableSize = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
