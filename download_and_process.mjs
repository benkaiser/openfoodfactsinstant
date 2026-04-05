#!/usr/bin/env node

/**
 * Downloads the latest Open Food Facts CSV export and filters it to
 * products from specified countries with essential fields only.
 *
 * Usage:
 *   node download_and_process.mjs                    # Default: Australia
 *   node download_and_process.mjs --country australia
 *   node download_and_process.mjs --country "united-states"
 *   node download_and_process.mjs --country australia --country "united-kingdom"
 *
 * Output: docs/data/products.json
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { createGunzip } from 'zlib';
import { parse } from 'csv-parse';
import https from 'https';
import http from 'http';
import fs from 'fs';

const CSV_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const LOCAL_GZ = 'openfoodfacts.csv.gz';
const OUTPUT_DIR = 'docs/data';
const OUTPUT_FILE = `${OUTPUT_DIR}/products.json`;

// Country configuration — maps CLI name to matching strings in countries_tags
const COUNTRY_MATCHERS = {
  'australia':       ['australia', 'en:australia'],
  'united-states':   ['united-states', 'en:united-states', 'us'],
  'united-kingdom':  ['united-kingdom', 'en:united-kingdom', 'uk'],
  'france':          ['france', 'en:france'],
  'germany':         ['germany', 'en:germany'],
  'canada':          ['canada', 'en:canada'],
  'new-zealand':     ['new-zealand', 'en:new-zealand'],
  'india':           ['india', 'en:india'],
  'japan':           ['japan', 'en:japan'],
  'spain':           ['spain', 'en:spain'],
  'italy':           ['italy', 'en:italy'],
};

// Fields we want to extract
const ESSENTIAL_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'image_url',
  'image_small_url',
  'energy-kcal_100g',
  'energy-kj_100g',
  'fat_100g',
  'saturated-fat_100g',
  'carbohydrates_100g',
  'sugars_100g',
  'fiber_100g',
  'proteins_100g',
  'salt_100g',
  'sodium_100g',
  'nutrition_grade_fr',
];

// Shorter keys for the JSON output to save space
const KEY_MAP = {
  'code': 'code',
  'product_name': 'name',
  'generic_name': 'common_name',
  'image_url': 'img',
  'image_small_url': 'img_sm',
  'energy-kcal_100g': 'kcal',
  'energy-kj_100g': 'kj',
  'fat_100g': 'fat',
  'saturated-fat_100g': 'sat_fat',
  'carbohydrates_100g': 'carbs',
  'sugars_100g': 'sugars',
  'fiber_100g': 'fiber',
  'proteins_100g': 'protein',
  'salt_100g': 'salt',
  'sodium_100g': 'sodium',
  'nutrition_grade_fr': 'grade',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const countries = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--country' && i + 1 < args.length) {
      countries.push(args[++i].toLowerCase());
    }
  }
  // Default to Australia
  if (countries.length === 0) {
    countries.push('australia');
  }
  return countries;
}

function buildCountryFilter(countries) {
  const matchStrings = [];
  for (const country of countries) {
    if (COUNTRY_MATCHERS[country]) {
      matchStrings.push(...COUNTRY_MATCHERS[country]);
    } else {
      // Generic fallback: match the name directly and en: prefixed
      matchStrings.push(country, `en:${country}`);
    }
  }
  return (record) => {
    const countriesField = (record.countries_tags || record.countries || '').toLowerCase();
    return matchStrings.some(m => countriesField.includes(m));
  };
}

function extractEssentials(record) {
  const out = {};
  for (const field of ESSENTIAL_FIELDS) {
    const val = record[field];
    if (val !== undefined && val !== '' && val !== null) {
      const key = KEY_MAP[field];
      // Try to parse numeric fields
      if (field.includes('_100g')) {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          out[key] = num;
        }
      } else {
        out[key] = val;
      }
    }
  }
  // Skip products with no name and no barcode
  if (!out.code && !out.name) return null;
  return out;
}

async function downloadFile(url, dest) {
  if (existsSync(dest)) {
    const stat = fs.statSync(dest);
    console.log(`Using existing download: ${dest} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }

  console.log(`Downloading ${url}...`);
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\rDownloading: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          console.log('\nDownload complete.');
          file.close(resolve);
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function processData(countries) {
  const countryLabel = countries.join(', ');
  console.log(`Processing CSV for countries: ${countryLabel}...`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const matchesCountry = buildCountryFilter(countries);
  const products = [];
  let totalRows = 0;
  let matchedRows = 0;

  const parser = parse({
    delimiter: '\t',
    columns: true,
    quote: null,      // OFF CSV has inconsistent quoting
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    cast: false,
  });

  parser.on('readable', () => {
    let record;
    while ((record = parser.read()) !== null) {
      totalRows++;
      if (totalRows % 100000 === 0) {
        process.stdout.write(`\rProcessed ${totalRows.toLocaleString()} rows, found ${matchedRows.toLocaleString()} matching products...`);
      }

      if (!matchesCountry(record)) continue;

      const product = extractEssentials(record);
      if (product) {
        products.push(product);
        matchedRows++;
      }
    }
  });

  const inputStream = createReadStream(LOCAL_GZ).pipe(createGunzip());

  await new Promise((resolve, reject) => {
    inputStream.pipe(parser);
    parser.on('end', resolve);
    parser.on('error', reject);
    inputStream.on('error', reject);
  });

  console.log(`\n\nTotal rows processed: ${totalRows.toLocaleString()}`);
  console.log(`Matching products (${countryLabel}): ${matchedRows.toLocaleString()}`);

  // Write JSON output
  console.log(`Writing ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products));

  const stat = fs.statSync(OUTPUT_FILE);
  console.log(`Output: ${OUTPUT_FILE} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log('Done!');
}

async function main() {
  const countries = parseArgs();
  await downloadFile(CSV_URL, LOCAL_GZ);
  await processData(countries);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
