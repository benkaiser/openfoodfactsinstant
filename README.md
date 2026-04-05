# Open Food Facts Instant

A condensed, client-side searchable database of food products from [Open Food Facts](https://world.openfoodfacts.org/), filtered by country.

Browse and search ~75,000 Australian food products (default) instantly in your browser — no server required. Easily configurable for other countries.

## Features

- **Instant search**: Full-text search across product names and barcodes
- **No backend needed**: Runs entirely in the browser using DuckDB-WASM
- **Compact data**: ~75k products compressed to a few MB Parquet file
- **Nutritional info**: Energy, fat, carbs, protein, sugars, fiber, salt, sodium, Nutri-Score
- **Product images**: Thumbnails and full-size image links
- **Substring barcode search**: Find products by partial barcode

## Live Demo

Visit the [GitHub Pages site](https://benkaiser.github.io/openfoodfactsinstant/) to search the database.

## Updating the Data

The data processing script downloads the latest Open Food Facts CSV export and filters it to Australian products.

### Prerequisites

- Node.js 18+
- npm

### Steps

```bash
# Install dependencies
npm install

# Download and process the latest data (default: Australia)
node download_and_process.mjs

# Or specify a different country
node download_and_process.mjs --country "united-states"

# Or multiple countries
node download_and_process.mjs --country australia --country "new-zealand"
```

This will:
1. Download the latest Open Food Facts CSV export (~0.9GB compressed)
2. Filter to the specified country's products (default: Australia)
3. Extract essential fields (barcode, name, images, nutrition)
4. Output `docs/data/products.json`

## Development

The static site is in the `docs/` folder and can be served locally:

```bash
# Using Python
cd docs && python -m http.server 8000

# Then open http://localhost:8000
```

## Data Source

Data is from [Open Food Facts](https://world.openfoodfacts.org/), licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1.0/).

Images are under [Creative Commons Attribution ShareAlike](https://creativecommons.org/licenses/by-sa/3.0/).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.
