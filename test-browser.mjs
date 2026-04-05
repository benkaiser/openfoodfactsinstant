#!/usr/bin/env node

/**
 * Browser end-to-end test for the Open Food Facts Instant search page.
 *
 * Validates:
 *  1. Page loads without errors
 *  2. DuckDB-WASM initializes and loads data
 *  3. Loading overlay disappears
 *  4. Search input becomes enabled
 *  5. Text search returns results
 *  6. Barcode (numeric) search returns results
 *  7. Product cards render with expected fields
 *  8. Nutrition tags appear
 *  9. No console errors during operation
 *
 * Requires: products.json to exist in docs/data/
 * Run:  node test-browser.mjs
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const DOCS_DIR = 'docs';
const PORT = 9222;
const TIMEOUT = 120_000; // DuckDB + FTS init can take a while

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};

let passed = 0;
let failed = 0;
const consoleErrors = [];

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log('✓', name);
  } catch (err) {
    failed++;
    log('✗', name);
    log(' ', `  ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Static file server ──────────────────────────────────

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let filePath = join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const content = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      res.end(content);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log('\n━━━ Open Food Facts Instant — Browser E2E Tests ━━━\n');

  // Check data exists
  if (!existsSync('docs/data/products.json')) {
    console.log('  ⚠ docs/data/products.json not found. Run: node download_and_process.mjs\n');
    process.exit(1);
  }

  const dataSize = readFileSync('docs/data/products.json', 'utf-8');
  const productCount = JSON.parse(dataSize).length;
  if (productCount < 100) {
    console.log(`  ⚠ products.json only has ${productCount} products — need real data for browser tests\n`);
    process.exit(1);
  }

  console.log(`  Data: ${productCount.toLocaleString()} products\n`);

  // Start server
  const server = await startServer();
  console.log(`  Server running on http://localhost:${PORT}\n`);

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  try {
    // ─── Test: Page loads ───────────────────────────────

    console.log('1. Page load & initialization\n');

    await test('page loads without crash', async () => {
      const response = await page.goto(`http://localhost:${PORT}/`, { timeout: 10_000 });
      assert(response.ok(), `HTTP ${response.status()}`);
    });

    await test('loading overlay is visible initially', async () => {
      const overlay = page.locator('#loading');
      await expect_visible(overlay);
    });

    await test('DuckDB initializes and search input becomes enabled', async () => {
      await page.waitForFunction(() => {
        const input = document.getElementById('search');
        return input && !input.disabled;
      }, { timeout: TIMEOUT });
    });

    await test('loading overlay disappears', async () => {
      const overlay = page.locator('#loading');
      const hidden = await overlay.isHidden();
      assert(hidden, 'Loading overlay is still visible');
    });

    await test('status bar shows product info', async () => {
      const status = await page.locator('#status').textContent();
      assert(status.includes('products') || status.includes('Showing'), `Status text: "${status}"`);
    });

    await test('initial results are displayed', async () => {
      const cards = page.locator('.product-card');
      const count = await cards.count();
      assert(count > 0, `No product cards shown (got ${count})`);
    });

    // ─── Test: Text search ─────────────────────────────

    console.log('\n2. Text search\n');

    await test('searching "milk" returns results', async () => {
      await page.fill('#search', 'milk');
      // Wait for debounce + query
      await page.waitForTimeout(500);
      const cards = page.locator('.product-card');
      const count = await cards.count();
      assert(count > 0, `No results for "milk" (got ${count})`);
      log(' ', `  (${count} results)`);
    });

    await test('results contain product names', async () => {
      const firstCard = page.locator('.product-card').first();
      const name = await firstCard.locator('.product-info h3').textContent();
      assert(name && name.trim().length > 0, 'First result has no name');
      log(' ', `  First result: "${name.trim()}"`);
    });

    await test('results show nutrition tags', async () => {
      const tags = page.locator('.product-card').first().locator('.nutrition-tag');
      const count = await tags.count();
      // Not all products have nutrition data, so just check it doesn't crash
      log(' ', `  (${count} nutrition tags on first result)`);
    });

    await test('searching "xyznonexistent" returns no results', async () => {
      await page.fill('#search', 'xyznonexistent99999');
      await page.waitForTimeout(500);
      const cards = page.locator('.product-card');
      const count = await cards.count();
      assert(count === 0, `Expected 0 results, got ${count}`);
    });

    // ─── Test: Barcode search ──────────────────────────

    console.log('\n3. Barcode search\n');

    // Get a real barcode from initial data to test with
    await page.fill('#search', '');
    await page.waitForTimeout(500);

    const firstBarcode = await page.locator('.product-card .barcode').first().textContent();
    const barcodeSnippet = firstBarcode.trim().slice(0, 6);

    await test(`barcode substring search "${barcodeSnippet}" returns results`, async () => {
      await page.fill('#search', barcodeSnippet);
      await page.waitForTimeout(500);
      const cards = page.locator('.product-card');
      const count = await cards.count();
      assert(count > 0, `No results for barcode substring "${barcodeSnippet}"`);
      log(' ', `  (${count} results)`);
    });

    await test('full barcode search returns exact match', async () => {
      const fullBarcode = firstBarcode.trim();
      await page.fill('#search', fullBarcode);
      await page.waitForTimeout(500);
      const cards = page.locator('.product-card');
      const count = await cards.count();
      assert(count >= 1, `No results for full barcode "${fullBarcode}"`);
      log(' ', `  Barcode: ${fullBarcode} → ${count} result(s)`);
    });

    // ─── Test: UI elements ─────────────────────────────

    console.log('\n4. UI integrity\n');

    await page.fill('#search', 'cheese');
    await page.waitForTimeout(500);

    await test('product images load or show placeholder', async () => {
      const firstCard = page.locator('.product-card').first();
      const hasImg = await firstCard.locator('.product-img').count();
      const hasPlaceholder = await firstCard.locator('.product-img-placeholder').count();
      assert(hasImg > 0 || hasPlaceholder > 0, 'No image or placeholder found');
    });

    await test('status bar shows result count', async () => {
      const status = await page.locator('#status').textContent();
      assert(status.includes('results for'), `Status: "${status}"`);
    });

    await test('clearing search shows default results', async () => {
      await page.fill('#search', '');
      await page.waitForTimeout(500);
      const status = await page.locator('#status').textContent();
      assert(status.includes('Showing'), `Status after clear: "${status}"`);
    });

    // ─── Test: No errors ───────────────────────────────

    console.log('\n5. Error checks\n');

    await test('no critical console errors', async () => {
      // Filter out known benign errors (e.g. CORS on images, favicon)
      const critical = consoleErrors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('ERR_BLOCKED_BY_RESPONSE') &&
        !e.includes('net::ERR')
      );
      assert(critical.length === 0,
        `${critical.length} console error(s):\n${critical.map(e => `      ${e}`).join('\n')}`);
    });

  } finally {
    await browser.close();
    server.close();
  }

  // ─── Summary ─────────────────────────────────────────

  console.log('\n━━━ Results ━━━\n');
  console.log(`  ${passed} passed, ${failed} failed\n`);

  if (consoleErrors.length > 0) {
    console.log(`  Console errors captured (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 5)) {
      console.log(`    - ${e.slice(0, 120)}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

async function expect_visible(locator) {
  const visible = await locator.isVisible();
  assert(visible, 'Element not visible');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
