#!/usr/bin/env node

/**
 * End-to-end test script for the Open Food Facts Instant pipeline.
 * Uses DuckDB CLI to validate the Parquet data files.
 *
 * Run:  node test.mjs
 * Exit: 0 on success, 1 on failure
 */

import fs from 'fs';
import { execSync } from 'child_process';

const DATA_FILE = 'docs/data/australia.parquet';
const MANIFEST_FILE = 'docs/data/countries.json';
const MIN_PRODUCTS = 10000;

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}`); console.log(`    ${err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function dq(sql) {
  return execSync('duckdb -csv -noheader', { input: sql, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], maxBuffer: 10*1024*1024 }).trim();
}

console.log('\n━━━ Open Food Facts Instant — End-to-End Tests ━━━\n');
console.log('1. Data file validation\n');

test('australia.parquet exists', () => { assert(fs.existsSync(DATA_FILE), `${DATA_FILE} not found`); });
test('countries.json manifest exists', () => { assert(fs.existsSync(MANIFEST_FILE), `${MANIFEST_FILE} not found`); });

const count = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}';`), 10);
test(`contains ≥ ${MIN_PRODUCTS.toLocaleString()} products (has ${count.toLocaleString()})`, () => {
  assert(count >= MIN_PRODUCTS, `Only ${count} products`);
});

const fileSizeMB = fs.statSync(DATA_FILE).size / (1024 * 1024);
test(`file size is reasonable: ${fileSizeMB.toFixed(1)} MB (expect 0.5–20 MB)`, () => {
  assert(fileSizeMB >= 0.5 && fileSizeMB <= 20, `File is ${fileSizeMB.toFixed(2)} MB`);
});

console.log('\n2. Schema validation\n');

test('every record has a barcode or product name', () => {
  const bad = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE (c IS NULL OR c = '') AND (n IS NULL OR n = '');`), 10);
  assert(bad === 0, `${bad} records have neither code nor name`);
});

const withName = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE n IS NOT NULL AND n != '';`), 10);
const namePct = (withName / count * 100).toFixed(1);
test(`majority have product name (${namePct}%)`, () => { assert(withName > count * 0.5, `Only ${namePct}%`); });

const withCode = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE c IS NOT NULL AND c != '';`), 10);
const codePct = (withCode / count * 100).toFixed(1);
test(`majority have barcode (${codePct}%)`, () => { assert(withCode > count * 0.8, `Only ${codePct}%`); });

test('nutrition values are proper doubles', () => {
  const badTypes = dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE typeof(e) NOT IN ('DOUBLE','NULL') OR typeof(f) NOT IN ('DOUBLE','NULL');`);
  assert(parseInt(badTypes,10) === 0, `Bad nutrition types found`);
});

test('nutriscore grades are valid (a-e) when present', () => {
  const invalid = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE g IS NOT NULL AND g NOT IN ('a','b','c','d','e');`), 10);
  assert(invalid === 0, `${invalid} invalid grades`);
});

const withImg = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE i IS NOT NULL AND i != '';`), 10);
test(`image paths present (${(withImg/count*100).toFixed(1)}%)`, () => { assert(withImg > 0, 'No images'); });

test('image paths are relative (no full URL)', () => {
  const fullUrls = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE i LIKE 'http%';`), 10);
  assert(fullUrls === 0, `${fullUrls} images still have full URL prefix`);
});

const withScans = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE sc IS NOT NULL AND sc > 0;`), 10);
test(`scan counts present (${(withScans/count*100).toFixed(1)}%)`, () => { assert(withScans > 0, 'No scan data'); });

test('data is sorted by scans descending', () => {
  const topScans = dq(`SELECT sc FROM '${DATA_FILE}' WHERE sc IS NOT NULL LIMIT 5;`).split('\n').map(Number);
  for (let i = 1; i < topScans.length; i++) {
    assert(topScans[i] <= topScans[i-1], `Not sorted: ${topScans[i-1]} then ${topScans[i]}`);
  }
});

console.log('\n3. Data quality stats\n');

const fields = ['c','n','i','e','f','sf','cb','su','fi','p','sa','g','sc'];
const labels = ['code','name','img','energy','fat','sat_fat','carbs','sugars','fiber','protein','salt','grade','scans'];
console.log(`  Total products: ${count.toLocaleString()}`);
console.log(`  File size: ${fileSizeMB.toFixed(2)} MB\n`);
console.log('  Field coverage:');
for (let idx = 0; idx < fields.length; idx++) {
  const fc = parseInt(dq(`SELECT count(*) FROM '${DATA_FILE}' WHERE ${fields[idx]} IS NOT NULL AND CAST(${fields[idx]} AS VARCHAR) != '';`), 10);
  const pct = (fc / count * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(`    ${labels[idx].padEnd(10)} ${bar} ${pct.padStart(5)}% (${fc.toLocaleString()})`);
}

console.log('\n4. Sample records\n');
const samples = dq(`SELECT c, n, e, p AS protein, f AS fat, cb AS carbs, g, sc FROM '${DATA_FILE}' WHERE n IS NOT NULL AND c IS NOT NULL AND i IS NOT NULL LIMIT 3;`);
console.log(samples.split('\n').map(line => {
  const [code, name, energy, protein, fat, carbs, grade, scans] = line.split(',');
  return `  📦 ${name}\n     Code: ${code} | Grade: ${grade||'n/a'} | Scans: ${scans||'n/a'}${energy ? `\n     Energy: ${energy} kcal | Protein: ${protein}g | Fat: ${fat}g | Carbs: ${carbs}g` : ''}`;
}).join('\n\n'));

console.log('\n\n5. Manifest validation\n');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
test(`manifest has ${manifest.length} countries`, () => { assert(manifest.length >= 2, 'Too few countries'); });
for (const c of manifest) {
  test(`${c.flag} ${c.name}: ${c.products.toLocaleString()} products, ${c.sizeMB} MB`, () => {
    assert(fs.existsSync(`docs/data/${c.id}.parquet`), `Missing ${c.id}.parquet`);
    assert(c.products > 0, 'No products');
  });
}

console.log('\n━━━ Results ━━━\n');
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
