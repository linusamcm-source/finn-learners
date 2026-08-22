# learner-dash task runner. `just` lists every recipe;
# README.md documents what each one does in more detail.

set shell := ["bash", "-uc"]

default:
    @just --list

# Install Node and Python dependencies.
setup:
    npm install
    cd ingest && uv sync

# Run the API server and the Vite dev server together.
dev:
    npx concurrently -n api,web -c blue,green "just serve" "npx vite"

# API server only, on :8787.
serve:
    node --experimental-strip-types server/index.ts

# SPA dev server only, on :5173.
web:
    npx vite

# Regenerate the PWA icon set into public/.
icons:
    python3 scripts/make-icons.py

# Typecheck and build the SPA into dist/, then wire up the service worker.
build:
    npx tsc -p tsconfig.json --noEmit
    npx vite build
    node --experimental-strip-types scripts/inject-sw-assets.ts

# Typecheck without emitting anything.
typecheck:
    npx tsc -p tsconfig.json --noEmit

# Run the test suite.
test:
    node --experimental-strip-types --test tests/*.test.ts

# ---------------------------------------------------------------------------
# Content pipeline
# ---------------------------------------------------------------------------

# Phase 1: download the handbook into content/handbook.json (needs network).
ingest:
    cd ingest && uv run ingest_handbook.py

# Re-extract from an already-downloaded PDF, skipping the download.
# The path is resolved before cd'ing, so relative paths work from anywhere.
ingest-local pdf:
    cd ingest && uv run ingest_handbook.py --pdf {{absolute_path(pdf)}}

# Check questions and scenarios: schema, ids, and handbook rule references.
verify-content:
    node --experimental-strip-types scripts/verify-content.ts

# Fill in ruleRef page numbers from an ingested content/handbook.json.
reconcile-refs:
    node --experimental-strip-types scripts/reconcile-refs.ts

# Everything the app reads, checked.
content: verify-content

# Remove the session database. Destroys all progress.
reset-db:
    rm -f data/learner-dash.db data/learner-dash.db-wal data/learner-dash.db-shm

# Fill the database with demo practice history, so the parent view has data.
seed-demo:
    node --experimental-strip-types scripts/seed-demo.ts
