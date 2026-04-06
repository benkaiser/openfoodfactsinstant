# Open Food Facts Instant

A fast, client-side searchable database of food products from [Open Food Facts](https://world.openfoodfacts.org/), covering 30 countries.

Search over 1.6 million food products instantly in your browser — no server required. Choose a specific country or search the entire global database.

**[Try it live →](https://benkaiser.github.io/openfoodfactsinstant/)**

## Features

- **Instant search**: Full-text search across product names and barcodes (including substring)
- **30 countries + global**: Individual country databases or a single 1.58M product global database
- **No backend**: Runs entirely in the browser using [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview)
- **Tiny downloads**: Parquet + ZSTD compression — Australia is 497KB, global is 43MB
- **Nutritional info**: Macro pie chart, energy, Nutri-Score grade, per 100g/ml
- **Barcode scanner**: Camera-based barcode scanning using [html5-qrcode](https://github.com/nicknisi/html5-qrcode)
- **Product links**: Click any product name to view it on Open Food Facts
- **Privacy**: All data stays in your browser, nothing is sent to any server

## How It Works

1. Select a country from the homepage
2. A small Parquet file is downloaded (0.1–17 MB depending on country)
3. DuckDB-WASM loads the data into an in-memory database and builds a full-text search index
4. Search results are sorted by relevance, with products missing nutritional data de-ranked

## Updating the Data

The processing script downloads the latest Open Food Facts CSV export and uses DuckDB to filter and compress it into per-country Parquet files.

### Prerequisites

- Node.js 18+
- [DuckDB CLI](https://duckdb.org/docs/installation/) (`brew install duckdb`)

### Steps

```bash
# Install dependencies
npm install

# Download and process all 30 countries (~24 seconds after initial download)
node download_and_process.mjs

# Or process specific countries
node download_and_process.mjs --country australia --country france
```

This will:
1. Download the Open Food Facts CSV export (~1.2 GB compressed) if not already present
2. Load the entire CSV into DuckDB in a single pass
3. Filter to products with at least one community scan
4. Export per-country Parquet files with ZSTD compression to `docs/data/`
5. Generate a `countries.json` manifest

## Testing

```bash
# Data validation tests (schema, coverage, quality)
npm test

# Browser E2E tests (Playwright — loads page, searches, verifies results)
npm run test:browser

# Both
npm run test:all
```

## Development

```bash
cd docs && python -m http.server 8000
# Open http://localhost:8000
```

## Data Processing

- **Source**: [Open Food Facts CSV export](https://world.openfoodfacts.org/data) (~9 GB uncompressed)
- **Filter**: Only products with ≥1 recorded scan (quality/relevance signal)
- **Fields**: Barcode, name, image path, energy (kcal), fat, saturated fat, carbs, sugars, fiber, protein, salt, Nutri-Score grade, scan count
- **Compression**: Parquet with ZSTD — Australia goes from ~14 MB JSON to 497 KB
- **Image URLs**: Common prefix stripped, reconstructed in the browser

## License

- **Code**: [MIT](LICENSE)
- **Data**: [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1.0/)

Contains information from [Open Food Facts](https://world.openfoodfacts.org), made available under the ODbL. The derived databases hosted here are also available under the ODbL.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.
