#!/usr/bin/env node

/**
 * End-to-end test script for the Open Food Facts Instant pipeline.
 *
 * Validates:
 *  1. products.json exists and is valid JSON
 *  2. Contains a reasonable number of products (>10k for Australia)
 *  3. Every record has at least a barcode or product name
 *  4. Essential fields schema is correct (nutrition values are numbers)
 *  5. No unexpected nulls in critical fields
 *  6. Barcode format looks right (mostly numeric strings)
 *  7. Image URLs are valid when present
 *  8. Nutrition grade values are valid (a-e) when present
 *
 * Run:  node test.mjs
 * Exit: 0 on success, 1 on failure
 */

import fs from 'fs';
import path from 'path';

const DATA_FILE = 'docs/data/products.json';
const MIN_PRODUCTS = 10000; // Australia should have ~75k

const NUTRITION_FIELDS = ['kcal', 'kj', 'fat', 'sat_fat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'sodium'];
const VALID_GRADES = new Set(['a', 'b', 'c', 'd', 'e']);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Load data ───────────────────────────────────────────

console.log('\n━━━ Open Food Facts Instant — End-to-End Tests ━━━\n');

console.log('1. Data file validation\n');

let products;

test('products.json exists', () => {
  assert(fs.existsSync(DATA_FILE), `${DATA_FILE} not found. Run: node download_and_process.mjs`);
});

test('products.json is valid JSON', () => {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  products = JSON.parse(raw);
  assert(Array.isArray(products), 'Expected a JSON array');
});

test(`contains ≥ ${MIN_PRODUCTS.toLocaleString()} products`, () => {
  assert(products.length >= MIN_PRODUCTS,
    `Only ${products.length.toLocaleString()} products (expected ≥ ${MIN_PRODUCTS.toLocaleString()})`);
});

const fileSize = fs.statSync(DATA_FILE).size;
test('file size is reasonable (1–50 MB)', () => {
  const mb = fileSize / (1024 * 1024);
  assert(mb >= 1 && mb <= 50, `File is ${mb.toFixed(2)} MB — outside expected range`);
});

// ─── Schema validation ───────────────────────────────────

console.log('\n2. Schema validation\n');

test('every record has a barcode or product name', () => {
  const bad = products.filter(p => !p.code && !p.name);
  assert(bad.length === 0, `${bad.length} records have neither code nor name`);
});

test('majority of records have a product name', () => {
  const withName = products.filter(p => p.name && p.name.trim().length > 0);
  const pct = (withName.length / products.length * 100).toFixed(1);
  assert(withName.length > products.length * 0.5,
    `Only ${pct}% of records have a name`);
  console.log(`      (${pct}% have names)`);
});

test('majority of records have a barcode', () => {
  const withCode = products.filter(p => p.code);
  const pct = (withCode.length / products.length * 100).toFixed(1);
  assert(withCode.length > products.length * 0.8,
    `Only ${pct}% of records have a barcode`);
  console.log(`      (${pct}% have barcodes)`);
});

test('barcodes are numeric strings', () => {
  const withCode = products.filter(p => p.code);
  const nonNumeric = withCode.filter(p => !/^\d+$/.test(String(p.code)));
  const pct = (nonNumeric.length / withCode.length * 100).toFixed(1);
  assert(nonNumeric.length < withCode.length * 0.05,
    `${pct}% of barcodes are non-numeric (expected < 5%)`);
});

test('nutrition values are numbers when present', () => {
  let badCount = 0;
  for (const p of products) {
    for (const field of NUTRITION_FIELDS) {
      if (p[field] !== undefined && typeof p[field] !== 'number') {
        badCount++;
      }
    }
  }
  assert(badCount === 0, `${badCount} nutrition values are not numbers`);
});

test('nutrition grade is valid (a-e) when present', () => {
  const withGrade = products.filter(p => p.grade);
  const invalid = withGrade.filter(p => !VALID_GRADES.has(p.grade));
  assert(invalid.length === 0,
    `${invalid.length} records have invalid grades: ${[...new Set(invalid.map(p => p.grade))].join(', ')}`);
  console.log(`      (${withGrade.length.toLocaleString()} products have a Nutri-Score grade)`);
});

test('image URLs are valid when present', () => {
  const withImg = products.filter(p => p.img);
  const badUrls = withImg.filter(p => !p.img.startsWith('http'));
  assert(badUrls.length === 0, `${badUrls.length} image URLs don't start with http`);
  console.log(`      (${withImg.length.toLocaleString()} products have images)`);
});

// ─── Data quality stats ──────────────────────────────────

console.log('\n3. Data quality stats\n');

const stats = {};
const fieldNames = ['code', 'name', 'common_name', 'img', 'img_sm', 'grade', ...NUTRITION_FIELDS];
for (const field of fieldNames) {
  const count = products.filter(p => p[field] !== undefined && p[field] !== '').length;
  const pct = (count / products.length * 100).toFixed(1);
  stats[field] = { count, pct };
}

console.log(`  Total products: ${products.length.toLocaleString()}`);
console.log(`  File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
console.log('');
console.log('  Field coverage:');
for (const [field, { count, pct }] of Object.entries(stats)) {
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(`    ${field.padEnd(14)} ${bar} ${pct.padStart(5)}% (${count.toLocaleString()})`);
}

// ─── Sample records ──────────────────────────────────────

console.log('\n4. Sample records\n');

const samples = products
  .filter(p => p.name && p.code && p.img)
  .slice(0, 3);

for (const s of samples) {
  console.log(`  📦 ${s.name}`);
  console.log(`     Code: ${s.code} | Grade: ${s.grade || 'n/a'}`);
  if (s.kcal !== undefined) console.log(`     Energy: ${s.kcal} kcal | Protein: ${s.protein ?? 'n/a'}g | Fat: ${s.fat ?? 'n/a'}g | Carbs: ${s.carbs ?? 'n/a'}g`);
  console.log('');
}

// ─── Summary ─────────────────────────────────────────────

console.log('━━━ Results ━━━\n');
console.log(`  ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
