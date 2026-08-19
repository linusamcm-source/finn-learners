# learner-dash task runner.
#   just            list recipes
#   just setup      install node + python deps
#   just dev        run the API and the SPA together

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

# Typecheck and build the SPA into dist/.
build:
    npx tsc -p tsconfig.json --noEmit
    npx vite build

typecheck:
    npx tsc -p tsconfig.json --noEmit

test:
    node --experimental-strip-types --test tests/*.test.ts

# ---------------------------------------------------------------------------
# Content pipeline
# ---------------------------------------------------------------------------

# Phase 1: download the handbook and extract it to content/handbook.json.
# Needs network access to transport.tas.gov.au.
ingest:
    cd ingest && uv run ingest_handbook.py

# Re-extract from an already-downloaded PDF, skipping the download.
ingest-local pdf:
    cd ingest && uv run ingest_handbook.py --pdf {{pdf}}

# Check questions and scenarios: schema, duplicate ids, and whether each
# ruleRef resolves to a real chapter and page in the ingested handbook.
verify-content:
    node --experimental-strip-types scripts/verify-content.ts

# Fill in ruleRef page numbers from content/handbook.json where they can be
# matched unambiguously. Writes back to content/questions.json.
reconcile-refs:
    node --experimental-strip-types scripts/reconcile-refs.ts

# Everything the app reads, checked.
content: verify-content

# Remove the session database. Destroys all progress.
reset-db:
    rm -f data/learner-dash.db data/learner-dash.db-wal data/learner-dash.db-shm

# Fill the database with plausible sessions so the parent view has something
# to draw. Development aid only.
seed-demo:
    node --experimental-strip-types scripts/seed-demo.ts
