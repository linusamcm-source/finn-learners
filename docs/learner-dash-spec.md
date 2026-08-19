# learner-dash — Specification

## Purpose

A local single-page web application that serves one user — a Tasmanian learner driver — an endless, adaptive stream of road-rules content and questions, with session tracking so a parent can see usage and progress.

This is an MVP: plain and functional, not polished. Built for a single learner working toward the Tasmanian L1 Driver Knowledge Test and hazard perception skills.

## Stack

- **TypeScript** throughout
- Light SPA framework (React or Preact), or plain TypeScript with a small router if simpler
- **HTML canvas** for scenario animations
- **SQLite** (better-sqlite3) for local storage
- Minimal **Node/Bun** server for the API and static files
- **Just** (justfile) as the task runner
- **Python + uv + pdfplumber** for one-off content extraction
- Runs on localhost. No deployment, no authentication, no cloud services.

## Phase 1 — Content pipeline

1. Download the Tasmanian Road Rules Handbook PDF from Transport Services (transport.tas.gov.au — Tasmanian Road Rules Handbook, ~4.4 MB / 11.9 MB editions).
2. Python ingestion script (uv-managed) using pdfplumber:
   - Extract text chapter by chapter, retaining page numbers as rule references.
   - Extract embedded diagram images to `assets/handbook/`.
3. Output: `content/handbook.json` — a structured representation of the handbook:
   - `chapters[]` → `sections[]` → `{ id, chapter, title, body, pageRef, images[] }`

## Phase 2 — Question bank

Generate `content/questions.json` from the structured handbook. Target **~200 questions**. Human-editable JSON.

Each question:

```json
{
  "id": "q-giveway-014",
  "topic": "give-way",
  "text": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 2,
  "explanation": "...",
  "ruleRef": { "chapter": "Giving way", "page": 24 },
  "image": "assets/handbook/giveway-t-junction.png"
}
```

Topics to cover: speed limits, giving way and intersections, roundabouts, making turns, road signs, line markings, sharing the road (pedestrians, cyclists, heavy vehicles, buses), alcohol/drugs and fatigue, learner and P-plater rules.

Where a handbook diagram supports the question, include its image path.

## Phase 3 — Scenario spec + canvas renderer

For hazard perception, define a JSON scenario format with four blocks:

### Layout
- `roadType`: four-way intersection | roundabout | T-junction | rural road | multi-lane
- `lanes`: lane counts per approach
- `controls`: stop signs, give-way signs, traffic lights (with phase timings)

### Actors
Array of vehicles, cyclists, pedestrians:
- `startPosition` (coordinate)
- `path`: array of waypoints
- `speed`
- `appearTime` (optional — lets a hazard emerge mid-scenario)

### Ego
The learner's own vehicle: `path`, `speed`, and a flag for whether it is driver-controlled or plays out automatically.

### Assessment
Either:
- **Hazard perception**: `responseWindowMs`, correct hazard (actor id or coordinates), explanation; scored on tap/click within the window.
- **Rules question**: question text, options, correct index, rule reference.

### Renderer
- Canvas, top-down view, simple shapes (rectangles for vehicles, circles for pedestrians).
- Reads **only** the scenario schema — one renderer for every scenario.
- Generate scenarios from the handbook's give-way, intersection, and roundabout chapters.

## Phase 4 — The feed

Endless loop serving the next item: plain question, diagram question, or animated scenario.

- Selection weighted by recent per-topic performance.
- Simple spaced repetition: missed items resurface sooner; mastered topics decay in frequency.
- No fixed end — the session ends when the learner stops.

## Phase 5 — Session tracking + parent view

SQLite schema:

- `sessions`: `id, startedAt, endedAt, itemCount`
- `answers`: `id, sessionId, itemId, topic, correct, responseTimeMs, answeredAt`

Parent summary screen:

- Sessions this week
- Total items answered
- Accuracy by topic (highlighting weak areas, e.g. road signs vs give-way rules)
- Simple trend over time

## Non-goals (MVP)

- No accounts or multi-user support
- No cloud, no deployment
- No visual polish
- No real video footage — generated canvas animations only

## Build order for Claude Code

1. Scaffold repo (Vite + TS + justfile), SQLite schema, minimal server.
2. Python ingestion script → `handbook.json` + extracted images.
3. Question bank generation → `questions.json` (review/edit pass by hand).
4. Scenario schema + canvas renderer + 10–20 seed scenarios.
5. Feed engine with topic weighting and spaced repetition.
6. Session tracking + parent view.
