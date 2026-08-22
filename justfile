# learner-dash task runner. `just` lists every recipe;
# README.md documents what each one does in more detail.

set shell := ["bash", "-uc"]

default:
    @just --list

# Install Node and Python dependencies.
setup:
    npm install
    cd ingest && uv sync

# Run the app in development, on :5173.
dev:
    npx vite

# Regenerate the PWA icon set into public/.
icons:
    python3 scripts/make-icons.py

# Typecheck and build the static site into dist/, ready to host anywhere.
build:
    npx tsc -p tsconfig.json --noEmit
    npx vite build
    node --experimental-strip-types scripts/copy-static.ts
    node --experimental-strip-types scripts/inject-sw-assets.ts

# Serve the built site on :4173. This is the one to test the PWA against,
# since the service worker only registers in a production build.
preview: build
    npx vite preview

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

# Write demo-progress.json, importable from the parent view for development.
seed-demo:
    node --experimental-strip-types scripts/seed-demo.ts
