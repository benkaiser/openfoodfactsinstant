#!/usr/bin/env node

/**
 * Downloads the latest Open Food Facts CSV export and uses DuckDB
 * to rapidly filter and export per-country JSON files.
 *
 * Columns exported (compact keys):
 *   c  = barcode (code)
 *   n  = product name
 *   i  = image path (suffix after standard OFF prefix)
 *   e  = energy kcal per 100g
 *   f  = fat per 100g
 *   sf = saturated fat per 100g
 *   cb = carbs per 100g
 *   su = sugars per 100g
 *   fi = fiber per 100g
 *   p  = protein per 100g
 *   sa = salt per 100g
 *   g  = nutriscore grade (a-e)
 *   sc = unique scan count
 *
 * Usage:
 *   node download_and_process.mjs                     # All configured countries
 *   node download_and_process.mjs --country australia
 *
 * Requires: duckdb CLI (brew install duckdb)
 */

import { existsSync, mkdirSync, createWriteStream, statSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

const CSV_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const LOCAL_GZ = 'openfoodfacts.csv.gz';
const OUTPUT_DIR = 'docs/data';
const MAX_PRODUCTS = 100000;
const IMG_PREFIX = 'https://images.openfoodfacts.org/images/products/';

const COUNTRIES = {
  'france':          { name: 'France',         flag: '🇫🇷', match: 'france' },
  'united-states':   { name: 'United States',  flag: '🇺🇸', match: 'united-states' },
  'germany':         { name: 'Germany',        flag: '🇩🇪', match: 'germany' },
  'spain':           { name: 'Spain',          flag: '🇪🇸', match: 'spain' },
  'italy':           { name: 'Italy',          flag: '🇮🇹', match: 'italy' },
  'united-kingdom':  { name: 'United Kingdom', flag: '🇬🇧', match: 'united-kingdom' },
  'canada':          { name: 'Canada',         flag: '🇨🇦', match: 'canada' },
  'switzerland':     { name: 'Switzerland',    flag: '🇨🇭', match: 'switzerland' },
  'belgium':         { name: 'Belgium',        flag: '🇧🇪', match: 'belgium' },
  'australia':       { name: 'Australia',      flag: '🇦🇺', match: 'australia' },
  'netherlands':     { name: 'Netherlands',    flag: '🇳🇱', match: 'netherlands' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const countries = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--country' && i + 1 < args.length) {
      countries.push(args[++i].toLowerCase());
    }
  }
  return countries.length > 0 ? countries : Object.keys(COUNTRIES);
}

async function downloadFile(url, dest) {
  if (existsSync(dest)) {
    const stat = statSync(dest);
    console.log(`Using existing download: ${dest} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }
  console.log(`Downloading ${url}...`);
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { follow(res.headers.location); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) process.stdout.write(`\rDownloading: ${((downloaded / total) * 100).toFixed(1)}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        });
        res.pipe(file);
        file.on('finish', () => { console.log('\nDownload complete.'); file.close(resolve); });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

function duckRun(sql) {
  return execSync('duckdb', {
    input: sql,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    timeout: 300000,
  });
}

function duckQuery(sql) {
  return execSync('duckdb -csv -noheader', {
    input: sql,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    timeout: 300000,
  }).trim();
}

function processWithDuckDB(selectedCountries) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\nProcessing ${selectedCountries.length} countries with DuckDB...\n`);
  const startTime = Date.now();

  const prefixLen = IMG_PREFIX.length;
  const validGrades = `('a','b','c','d','e')`;
  const manifest = [];

  for (const countryId of selectedCountries) {
    const info = COUNTRIES[countryId] || { name: countryId, flag: '🌐', match: countryId };
    const matchPattern = `%${info.match}%`;
    const outFile = `${OUTPUT_DIR}/${countryId}.parquet`;

    process.stdout.write(`  ${info.flag} ${info.name}...`);

    const sql = `
      COPY (
        SELECT
          code AS c,
          product_name AS n,
          CASE WHEN image_small_url LIKE '${IMG_PREFIX}%'
               THEN SUBSTRING(image_small_url, ${prefixLen + 1})
               ELSE NULL END AS i,
          CASE WHEN "energy-kcal_100g" != '' THEN ROUND(CAST("energy-kcal_100g" AS DOUBLE), 1) ELSE NULL END AS e,
          CASE WHEN fat_100g != '' THEN ROUND(CAST(fat_100g AS DOUBLE), 1) ELSE NULL END AS f,
          CASE WHEN "saturated-fat_100g" != '' THEN ROUND(CAST("saturated-fat_100g" AS DOUBLE), 1) ELSE NULL END AS sf,
          CASE WHEN carbohydrates_100g != '' THEN ROUND(CAST(carbohydrates_100g AS DOUBLE), 1) ELSE NULL END AS cb,
          CASE WHEN sugars_100g != '' THEN ROUND(CAST(sugars_100g AS DOUBLE), 1) ELSE NULL END AS su,
          CASE WHEN fiber_100g != '' THEN ROUND(CAST(fiber_100g AS DOUBLE), 1) ELSE NULL END AS fi,
          CASE WHEN proteins_100g != '' THEN ROUND(CAST(proteins_100g AS DOUBLE), 1) ELSE NULL END AS p,
          CASE WHEN salt_100g != '' THEN ROUND(CAST(salt_100g AS DOUBLE), 1) ELSE NULL END AS sa,
          CASE WHEN LOWER(nutriscore_grade) IN ${validGrades} THEN LOWER(nutriscore_grade) ELSE NULL END AS g,
          CASE WHEN unique_scans_n != '' AND CAST(unique_scans_n AS INTEGER) > 0 THEN CAST(unique_scans_n AS INTEGER) ELSE NULL END AS sc
        FROM read_csv('${LOCAL_GZ}',
          delim='\\t', header=true, quote='', ignore_errors=true, all_varchar=true
        )
        WHERE (LOWER(countries_tags) LIKE '${matchPattern}' OR LOWER(countries) LIKE '${matchPattern}')
          AND (code IS NOT NULL AND code != '' OR product_name IS NOT NULL AND product_name != '')
        ORDER BY sc DESC NULLS LAST
        LIMIT ${MAX_PRODUCTS}
      ) TO '${outFile}' (FORMAT PARQUET, COMPRESSION ZSTD);
    `;

    duckRun(sql);

    const stat = statSync(outFile);
    const sizeMB = stat.size / (1024 * 1024);

    const countResult = duckQuery(`SELECT count(*) FROM '${outFile}';`);
    const productCount = parseInt(countResult, 10);

    manifest.push({
      id: countryId,
      name: info.name,
      flag: info.flag,
      products: productCount,
      sizeMB: Math.round(sizeMB * 10) / 10,
    });

    console.log(` ${productCount.toLocaleString()} products, ${sizeMB.toFixed(1)} MB`);
  }

  manifest.sort((a, b) => b.products - a.products);
  writeFileSync(`${OUTPUT_DIR}/countries.json`, JSON.stringify(manifest, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s!`);
}

async function main() {
  const countries = parseArgs();
  await downloadFile(CSV_URL, LOCAL_GZ);
  processWithDuckDB(countries);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
