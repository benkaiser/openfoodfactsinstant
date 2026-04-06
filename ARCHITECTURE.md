# Architecture

## Overview

This project creates a condensed, client-side searchable database of food products from [Open Food Facts](https://world.openfoodfacts.org/), covering 30 countries plus a global all-countries database. Products are filtered to those with at least one community scan, compressed into Parquet files, and served as a static website with instant full-text search.

## Design Decisions

### Why Client-Side Search?

Individual country datasets (0.1–17 MB as Parquet) are small enough to load entirely in the browser. This eliminates the need for a backend server, simplifies deployment (GitHub Pages), and provides instant search with zero latency after initial load.

### Why DuckDB-WASM?

[DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) provides:
- **Parquet file support**: Loads compressed columnar data directly
- **Full-text search**: Built-in FTS extension with BM25 ranking
- **SQL interface**: Flexible querying including substring matching on barcodes
- **Browser-native**: Runs entirely in WebAssembly, no server needed

### Why Parquet?

Parquet with ZSTD compression provides dramatic size reductions compared to JSON:
- Australia: 14 MB JSON → **497 KB** Parquet (97% reduction)
- France: 384 MB JSON → **17 MB** Parquet (96% reduction)
- 30 countries total: **46 MB**, plus a global all.parquet: **43 MB**

### Why Filter to Scanned Products?

Products with zero scans are typically incomplete entries, test data, or duplicates. Filtering to ≥1 scan acts as a quality signal:
- France: 1.25M total → 585K scanned (53% reduction, better quality)
- Australia: 71K total → 20K scanned (72% reduction)

### DuckDB CLI for Processing

The data pipeline uses DuckDB CLI (not Node.js streaming) for processing:
- **Single pass**: Loads the 1.2 GB CSV once into memory, exports all 30 countries
- **Speed**: ~24 seconds total (vs ~6 minutes per country with Node.js)
- **SQL-based**: All transformations are SQL queries — easy to modify

## Data Pipeline

```
Open Food Facts CSV (1.2 GB compressed, 9 GB uncompressed)
    │
    ▼
download_and_process.mjs
    │  - Downloads CSV if not present
    │  - Single DuckDB session loads CSV into memory
    │  - Filters: ≥1 scan, valid barcode or name
    │  - Extracts essential fields with compact keys
    │  - Strips image URL prefix (reconstructed in browser)
    │  - Exports 30 country Parquet files + global all.parquet (ZSTD compressed)
    │  - Generates countries.json manifest
    ▼
docs/data/*.parquet (46 MB total)
docs/data/countries.json
    │
    ▼
Static Website (docs/index.html)
    │  - Country selector grid with download sizes
    │  - Loads Parquet via DuckDB-WASM
    │  - Builds FTS index on product names
    │  - Instant search with popularity-aware ranking
    │  - SVG pie charts for macro breakdown
    │  - Camera barcode scanner (html5-qrcode)
    ▼
GitHub Pages
```

## Project Structure

```
openfoodfactsinstant/
├── ARCHITECTURE.md          # This file
├── README.md                # Project overview and usage
├── LICENSE                  # MIT (code) + ODbL (data)
├── package.json             # Node.js dependencies and scripts
├── download_and_process.mjs # DuckDB-powered data pipeline
├── test.mjs                 # Data validation tests (DuckDB CLI)
├── test-browser.mjs         # Browser E2E tests (Playwright)
├── docs/                    # Static site (GitHub Pages root)
│   ├── index.html           # Single-page app
│   └── data/
│       ├── countries.json   # Country manifest
│       ├── all.parquet       # Global (all scanned products)
│       ├── australia.parquet
│       ├── france.parquet
│       └── ... (30 countries)
└── .gitignore
```

## Data Schema

Compact single-character keys to minimize file size:

| Key | Field | Type | Description |
|-----|-------|------|-------------|
| `c` | code | string | Barcode (EAN-13/UPC) |
| `n` | name | string | Product name |
| `i` | image | string | Image path suffix (prefix reconstructed in browser) |
| `e` | energy | float | Energy in kcal per 100g/ml |
| `f` | fat | float | Fat per 100g/ml |
| `sf` | saturated fat | float | Saturated fat per 100g/ml |
| `cb` | carbs | float | Carbohydrates per 100g/ml |
| `su` | sugars | float | Sugars per 100g/ml |
| `fi` | fiber | float | Fiber per 100g/ml |
| `p` | protein | float | Protein per 100g/ml |
| `sa` | salt | float | Salt per 100g/ml |
| `g` | grade | string | Nutri-Score grade (a–e) |
| `sc` | scans | int | Unique scan count |

Image URLs are stored as suffixes after the common prefix `https://images.openfoodfacts.org/images/products/`, which is prepended in the browser.

## Search Implementation

1. **Country selection** → fetches `<country>.parquet` (0.1–17 MB)
2. **DuckDB-WASM** loads Parquet into an in-memory table
3. **FTS index** built on product name column using BM25
4. **Text search**: Top 200 BM25 matches, re-ranked with nutrition-having products first, then by scan count
5. **Barcode search**: `LIKE '%query%'` substring match, sorted by nutrition presence then scans
6. **Default view**: All products sorted by nutrition presence then scan count
