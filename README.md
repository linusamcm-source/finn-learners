# learner-dash

An endless, adaptive stream of Tasmanian road-rules practice for one learner
driver, with a parent view showing what has actually been happening.

Local only: no accounts, no cloud, no deployment. It runs on localhost against
a SQLite file.

Built to the spec in [`docs/learner-dash-spec.md`](docs/learner-dash-spec.md).

## Running it

```sh
just setup     # npm install, plus uv sync for the ingestion script
just dev       # API on :8787, app on :5173
```

Then open http://localhost:5173. The parent view is at `#/parent`.

For a single-process run, `just build && just serve` serves the built app and
the API together on :8787.

To see the parent view with data in it before any real practice has happened:

```sh
just seed-demo
```

## How it fits together

```
ingest/          Python + uv + pdfplumber: handbook PDF -> content/handbook.json
content/         questions.json, scenarios.json, handbook.json — what the app serves
assets/handbook/ diagrams cropped out of the handbook PDF
shared/types.ts  the data contract shared by the server, the app and the scripts
server/          Node API, SQLite storage, feed selection, parent stats
src/             the SPA: feed view, parent view, canvas scenario renderer
scripts/         content verification, rule-reference reconciliation, demo seed
tests/           feed engine, geometry, stats, and checks over the content itself
```

`just --list` shows every task.

### Plain TypeScript, no framework

The spec allowed React, Preact, or plain TypeScript with a small router. There
are two screens and one canvas, so plain TypeScript with a hash router is the
smaller thing to maintain — the whole SPA is about 20 kB.

## The content pipeline

**Phase 1** is `just ingest`. It downloads the handbook and recovers its
structure by type size, since the PDF has no machine-readable outline. See
[`ingest/README.md`](ingest/README.md) for how that works and how to tune it.

**Phase 2** is `content/questions.json` — 200 questions across nine topics,
plain JSON, meant to be edited by hand.

**Phase 3** is `content/scenarios.json` — 16 animated scenarios, 8 hazard
perception and 8 rules questions. The renderer reads only the schema, so a new
scenario is a JSON entry and never a code change. `scripts/make-seed-scenarios.ts`
laid out the seeds; the JSON is the source of truth once generated.

Check both at any time:

```sh
just verify-content
```

## Read this before using it to study

**Every question and scenario currently has `"verified": false`.** They were
written from the Australian Road Rules and general road-safety knowledge, not
transcribed from the Tasmanian handbook, because the handbook could not be
downloaded in the environment where this was built.

That matters differently by topic:

- **Nationally harmonised material** — giving way, roundabouts, turns, signs,
  line markings, sharing the road, speed limit principles, alcohol and fatigue
  — is consistent across Australian states and is very likely correct.
- **Tasmania-specific licensing rules** — the `learner-p-plater` topic, and
  anything naming a threshold, a holding period or a demerit point count — is
  where an error is most likely. Deliberately, no question states a demerit
  point threshold or a minimum licence-holding period, because those change and
  could not be checked. Where a rule was uncertain it was left out rather than
  guessed at.

`ruleRef.page` is `null` everywhere for the same reason: a confidently wrong
page reference is worse than none. Once you have run `just ingest`:

```sh
just reconcile-refs   # fill in page numbers where a section matches clearly
just verify-content   # report anything that still does not resolve
```

Then work through the bank against the handbook and set `"verified": true` as
you confirm each item. The parent view shows how many are still outstanding.

## How the feed chooses what to show next

Two things multiply together, in `server/feed.ts`:

**Topic weight**, from recent per-topic accuracy. A mastered topic bottoms out
at 0.5 and a topic being got wrong every time tops out at 2.5, so the weakest
topic comes up about five times as often as the strongest. A topic with fewer
than four answers gets an exploration boost instead of a judgement.

**Dueness**, per item. Each consecutive correct answer moves an item up a
ladder of intervals — 90 seconds, 10 minutes, an hour, a day, three days, a
week, three weeks. A wrong answer drops it straight back to the bottom, so a
missed question returns within the same sitting.

The result is a weighted random draw rather than a strict maximum, so the feed
does not march through the pool in the same order every session. Recently seen
items are held back, and two scenarios never appear back to back.

Spaced repetition state is derived from the `answers` table rather than cached
in its own table, so it cannot drift out of step with the answer history.

## Testing

```sh
just test        # 64 tests: feed engine, geometry, stats, content invariants
just typecheck
```

The content tests are worth knowing about: they check that no topic is
unreachable, that the answer key is not concentrated in one position, that
every hazard is actually visible during its response window, and that vehicles
in scenarios are on the correct side of the road. That last one caught four
seed scenarios with cars driving on the wrong side.

## Storage

`data/learner-dash.db`, created on first run. Two tables, per the spec:

- `sessions` — `id, startedAt, endedAt, itemCount`
- `answers` — `id, sessionId, itemId, topic, correct, responseTimeMs, answeredAt`

`just reset-db` deletes it and all progress with it.
