import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from '../js/data.js';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('PASS  ' + name); } catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; } };

t('CSV: quotes, commas, newlines in fields, CRLF, BOM', () => {
  const rows = D.parseCsv('\uFEFFa,b,c\r\n1,"x, y","line1\nline2"\r\n2,"say ""hi""",z\r\n');
  assert.deepEqual(rows, [['a','b','c'], ['1','x, y','line1\nline2'], ['2','say "hi"','z']]);
});
t('CSV: semicolon and tab delimiters detected', () => {
  assert.deepEqual(D.parseCsv('a;b\n1;2'), [['a','b'],['1','2']]);
  assert.deepEqual(D.parseCsv('a\tb\n1\t2'), [['a','b'],['1','2']]);
});
t('CSV: header names trimmed, blanks named, duplicates made unique, short rows padded', () => {
  const tb = D.tableFromCsvRows([[' id ', '', 'id'], ['1', '2']]);
  assert.deepEqual(tb.columns, ['id', 'column_2', 'id_2']);
  assert.deepEqual(tb.rows, [['1', '2', '']]);
});
t('client keys: case/space-insensitive, safe for Firestore paths', () => {
  assert.equal(D.clientKey('C1001'), D.clientKey('  c1001 '));
  assert.equal(D.clientKey('a/b'), 'c_a%2Fb');
  assert.equal(D.clientKey('a.b'), 'c_a%2Eb');
  assert.equal(D.clientKey('..'), 'c_%2E%2E');
  assert.ok(!D.clientKey('x y/z').includes('/'));
  assert.equal(D.clientKey('   '), '');
  assert.notEqual(D.clientKey('all'), 'all');
});
t('access codes: 10 chars, unambiguous alphabet, random, formatting/normalizing', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const c = D.makeCode(); assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/); seen.add(c); }
  assert.equal(seen.size, 500);
  assert.equal(D.formatCode('ABCDEFGHJK'), 'ABCDE-FGHJK');
  assert.equal(D.normalizeCode(' abcde-fghjk '), 'ABCDEFGHJK');
});

const sample = readFileSync(new URL('../sample_data.csv', import.meta.url), 'utf8');
t('sample CSV -> per-client split with correct types', () => {
  const ds = D.buildDataset(D.tableFromCsvRows(D.parseCsv(sample)), 'client_id');
  assert.equal(ds.rowCount, 100);
  assert.equal(ds.byClient.size, 5);
  assert.deepEqual(ds.columns.map((c) => [c.name, c.type]),
    [['month','date'],['region','text'],['revenue','number'],['orders','number'],['returns','number']]);
  assert.ok(!ds.columns.some((c) => c.name === 'client_id'), 'ID column removed');
  const g = ds.byClient.get(D.clientKey('C1001'));
  assert.equal(g.rows.length, 20);
  assert.equal(g.label, 'c1001');
  assert.equal(typeof g.rows[0][2], 'number');
  assert.equal(g.rows[0][0], '2025-01-01');
});
t('per-client rows sum back to the source (no rows lost or duplicated)', () => {
  const ds = D.buildDataset(D.tableFromCsvRows(D.parseCsv(sample)), 'CLIENT_ID');
  const total = [...ds.byClient.values()].reduce((s, g) => s + g.rows.length, 0);
  assert.equal(total, 100);
  const revenue = [...ds.byClient.values()].flatMap((g) => g.rows.map((r) => r[2])).reduce((a, b) => a + b, 0);
  const src = D.parseCsv(sample).slice(1).reduce((a, r) => a + Number(r[3]), 0);
  assert.ok(Math.abs(revenue - src) < 0.01);
});
t('IDs match ignoring case/spaces; numeric IDs stay whole numbers; blank IDs reported', () => {
  const ds = D.buildDataset({ columns: ['id', 'v'], rows: [['A1', '1'], [' a1 ', '2'], [1001, '3'], [1001.0, '4'], ['', '5'], [null, '6']] }, 'id');
  assert.equal(ds.byClient.size, 2);
  assert.equal(ds.byClient.get('c_a1').rows.length, 2);
  assert.equal(ds.byClient.get('c_1001').rows.length, 2);
  assert.equal(ds.blankIdRows, 2);
});
t('leading zeros are kept as text (zip codes, account numbers)', () => {
  const ds = D.buildDataset({ columns: ['id', 'zip'], rows: [['a', '02134'], ['a', '10001']] }, 'id');
  assert.equal(ds.columns[0].type, 'text');
  assert.equal(ds.byClient.get('c_a').rows[0][0], '02134');
});
t('mixed columns fall back to text; blanks become null', () => {
  const ds = D.buildDataset({ columns: ['id', 'x', 'y'], rows: [['a', '1', ''], ['a', 'n/a', '2']] }, 'id');
  assert.equal(ds.columns[0].type, 'text');
  assert.equal(ds.columns[1].type, 'number');
  assert.equal(ds.byClient.get('c_a').rows[0][1], null);
});
t('Parquet-style values: Date, bigint, boolean, null', () => {
  const d = new Date(Date.UTC(2026, 0, 5));
  const ds = D.buildDataset(D.tableFromObjects([{ id: 'a', when: d, n: 10n, ok: true }, { id: 'a', when: null, n: 11n, ok: false }]), 'id');
  assert.deepEqual(ds.columns.map((c) => c.type), ['date', 'number', 'text']);
  assert.deepEqual(ds.byClient.get('c_a').rows, [['2026-01-05', 10, 'true'], [null, 11, 'false']]);
});
t('date-times keep HH:MM; date-only columns stay date-only', () => {
  const ds = D.buildDataset({ columns: ['id', 'a', 'b'], rows: [['x', '2026-03-01 14:30:00', '2026-03-01'], ['x', '2026-03-02T09:05', '2026-3-2']] }, 'id');
  assert.deepEqual(ds.byClient.get('c_x').rows, [['2026-03-01 14:30', '2026-03-01'], ['2026-03-02 09:05', '2026-03-02']]);
});
t('helpful errors', () => {
  assert.throws(() => D.buildDataset({ columns: ['a', 'b'], rows: [['1', '2']] }, 'nope'), /no column named "nope".*a, b/);
  assert.throws(() => D.buildDataset({ columns: ['id'], rows: [['']] }, 'id'), /blank/);
  assert.throws(() => D.buildDataset({ columns: ['id'], rows: [] }, 'id'), /no rows/);
  assert.throws(() => D.tableFromCsvRows([]), /empty/);
});
t('chunking: every chunk parses, stays under the limit, and preserves all rows in order', () => {
  const rows = Array.from({ length: 5000 }, (_, i) => [i, 'row ' + i, 'e'.repeat(20)]);
  const chunks = D.chunkRows(rows, 20000);
  assert.ok(chunks.length > 5);
  chunks.forEach((c) => assert.ok(c.length <= 20000, 'chunk too large: ' + c.length));
  assert.deepEqual(chunks.flatMap((c) => JSON.parse(c)), rows);
  assert.deepEqual(D.chunkRows([], 100), ['[]']);
});
t('chunk sizes stay far below 1 MiB even for multi-byte text at the real limit', () => {
  const rows = Array.from({ length: 4000 }, (_, i) => [i, '\u65e5\u672c\u8a9e'.repeat(30)]);
  for (const c of D.chunkRows(rows)) assert.ok(new TextEncoder().encode(c).length < 900000);
});
t('CSV export round-trips awkward values', () => {
  const cols = [{ name: 'a' }, { name: 'b,c' }];
  const rows = [['x "q"', 'l1\nl2'], [null, 3]];
  const back = D.parseCsv(D.toCsv(cols, rows));
  assert.deepEqual(back, [['a', 'b,c'], ['x "q"', 'l1\nl2'], ['', '3']]);
});
t('document splitting round-trips', () => {
  const s = 'A'.repeat(1234567);
  const parts = D.splitString(s, D.DOC_CHUNK_CHARS);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), s);
  assert.deepEqual(D.splitString('', 10), ['']);
});
t('slugify / readableSize', () => {
  assert.equal(D.slugify('Monthly Sales (2026)!'), 'monthly-sales-2026');
  assert.equal(D.slugify('***'), 'data');
  assert.equal(D.readableSize(2 * 1048576), '2.0 MB');
  assert.equal(D.readableSize(10), '1 KB');
});
console.log(`\n${passed} checks passed` + (process.exitCode ? ' (some FAILED)' : ''));
