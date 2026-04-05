# Architecture

## Overview

This project creates a condensed, client-side searchable database of food products from [Open Food Facts](https://world.openfoodfacts.org/), filtered by country. Currently configured for Australia (~75,000 products), but designed to support any country. Products are extracted from the full OFF database (~3M products), stripped to essential fields, and served as a static website with instant full-text search.

## Design Decisions

### Why Client-Side Search?

Individual country subsets (e.g. Australia ~75k products) are small enough to load entirely in the browser. This eliminates the need for a backend server, simplifies deployment (GitHub Pages), and provides instant search with zero latency after initial load.

### Why DuckDB-WASM?

[DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) provides:
- **Parquet file support**: Efficient columnar storage, great compression (~2-5MB for our dataset)
- **Full-text search**: Built-in FTS extension for fast text search
- **SQL interface**: Flexible querying including substring matching on barcodes
- **Browser-native**: Runs entirely in WebAssembly, no server needed

### Data Pipeline

```
Open Food Facts CSV (9GB uncompressed)
    │
    ▼
download_and_process.mjs (streaming processor)
    │  - Downloads latest CSV export
    │  - Filters by country (default: Australia)
    │  - Extracts essential fields
    │  - Outputs JSON file
    ▼
docs/data/products.json (~5-10MB)
    │
    ▼
Static Website (docs/)
    │  - Loads Parquet via DuckDB-WASM
    │  - FTS index built on first load
    │  - Instant search by name/barcode
    ▼
GitHub Pages
```

## Project Structure

```
openfoodfacts-au-clientside/
├── ARCHITECTURE.md          # This file
├── README.md                # Project overview and usage
├── package.json             # Node.js dependencies
├── download_and_process.mjs # Data pipeline script
├── docs/                    # Static site (GitHub Pages root)
│   ├── index.html           # Main search interface
│   └── data/
│       └── products.parquet # Condensed Australian product data
└── .gitignore
```

## Data Schema

### Essential Fields Extracted

| Field | Source Column | Description |
|-------|-------------|-------------|
| `code` | `code` | Barcode (EAN-13) |
| `product_name` | `product_name` | Product name |
| `generic_name` | `generic_name` | Common/generic name |
| `image_url` | `image_url` | Full-size product image URL |
| `image_small_url` | `image_small_url` | Thumbnail image URL |
| `energy_kcal_100g` | `energy-kcal_100g` | Energy in kcal per 100g |
| `energy_kj_100g` | `energy-kj_100g` | Energy in kJ per 100g |
| `fat_100g` | `fat_100g` | Fat per 100g |
| `saturated_fat_100g` | `saturated-fat_100g` | Saturated fat per 100g |
| `carbohydrates_100g` | `carbohydrates_100g` | Carbohydrates per 100g |
| `sugars_100g` | `sugars_100g` | Sugars per 100g |
| `fiber_100g` | `fiber_100g` | Fiber per 100g |
| `proteins_100g` | `proteins_100g` | Proteins per 100g |
| `salt_100g` | `salt_100g` | Salt per 100g |
| `sodium_100g` | `sodium_100g` | Sodium per 100g |
| `nutrition_grade` | `nutrition_grade_fr` | Nutri-Score grade (a-e) |

## Search Implementation

The static site uses DuckDB-WASM to:
1. Load the Parquet file into an in-memory database on page load
2. Build a full-text search index on `product_name` and `generic_name`
3. Support barcode search via `LIKE '%query%'` (substring match)
4. Support name search via FTS with ranking
5. Return results instantly with product details and nutrition info
