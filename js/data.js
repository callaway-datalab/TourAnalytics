// Pure helpers: no browser or Firebase dependencies, so they can be unit-tested in Node.

export class UserError extends Error {}

export const MAX_CHUNK_CHARS = 300000;        // JSON characters per Firestore chunk (limit is ~1 MiB per document)
export const DOC_CHUNK_CHARS = 600000;        // base64 characters per document chunk
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
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

  const byClient = new Map();
  let blankIdRows = 0;
  for (const r of rows) {
    const id = idString(r[idCol]);
    if (!id) { blankIdRows++; continue; }
    const key = clientKey(id);
    let g = byClient.get(key);
    if (!g) byClient.set(key, (g = { label: id, rows: [] }));
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
