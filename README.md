# learner-dash

An endless, adaptive stream of Tasmanian road-rules practice for one learner
driver, with a parent view showing what has actually been happening.

Local-first and installable: it is a static site with no backend. Content is
JSON, progress lives in the browser's IndexedDB, and once installed on a phone
it works with no network at all.

Built to the spec in [`docs/learner-dash-spec.md`](docs/learner-dash-spec.md).
See [Departures from the spec](#departures-from-the-spec) for where it now
differs and why.

## Running it

```sh
just setup     # npm install, plus uv sync for the ingestion script
just dev       # http://localhost:5173
```

The parent view is at `#/parent`.

To test the installable app — the service worker only registers in a
production build:

```sh
just preview   # builds, then serves dist/ on http://localhost:4173
```

To see the parent view with data in it before any real practice has happened,
run `just seed-demo` and import the resulting `demo-progress.json` from the
parent view.

## Commands

Everything runs through [`just`](https://just.systems). `just` on its own lists
the recipes; this is the same list with a bit more context.

### Setup and running

| Command | What it does |
| --- | --- |
| `just setup` | `npm install`, plus `uv sync` for the ingestion script. Run once. |
| `just dev` | Vite dev server on :5173. The usual way to work. |
| `just build` | Typecheck, build to `dist/`, copy content and assets in, wire up the service worker. |
| `just preview` | Builds, then serves `dist/` on :4173. Use this to test the PWA. |
| `just icons` | Regenerate the PWA icon set from `scripts/make-icons.py`. |

### Checks

| Command | What it does |
| --- | --- |
| `just test` | The full suite — feed engine, scenario geometry, derived stats, content invariants. |
| `just typecheck` | TypeScript only, no build. |
| `just verify-content` | Checks the question bank and scenarios: schema, duplicate ids, topic coverage, answer key balance, and whether each `ruleRef` resolves against an ingested handbook. Exits non-zero only on something the app would serve wrongly. |
| `just content` | Alias for `verify-content`. |

### Content pipeline

| Command | What it does |
| --- | --- |
| `just ingest` | Phase 1. Downloads the Tasmanian Road Rules Handbook and extracts it to `content/handbook.json` plus diagrams in `assets/handbook/`. Needs network access to transport.tas.gov.au. |
| `just ingest-local <pdf>` | Same extraction from a PDF you already have — use this when the download fails. Example: `just ingest-local ~/Downloads/handbook.pdf`. |
| `just reconcile-refs` | Fills in `ruleRef` page numbers from `content/handbook.json` where a section matches unambiguously, and leaves the rest null. Run `just ingest` first. |
| `just seed-demo` | Writes `demo-progress.json` in the app's own export format. Import it from the parent view. Development aid. |

### Typical sequences

Working on the app:

```sh
just setup
just dev
```

Bringing the real handbook in and tying the questions to it:

```sh
just ingest            # or: just ingest-local ~/Downloads/handbook.pdf
just reconcile-refs
just verify-content
```

Before committing:

```sh
just test
just typecheck
just verify-content
```

## Installing it on an iPhone

`dist/` is a plain static site. Put it on any static host — or open
`just preview` over HTTPS — then in Safari tap Share, then *Add to Home
Screen*. It gets the L-plate icon and opens as its own app, and after the
first load it needs no network for anything.

### The secure-context requirement

A service worker — which is what does the offline caching — only runs in a
**secure context**: HTTPS, or `localhost`. Over a plain-HTTP LAN address
Safari will add the app to the home screen but refuse to register the worker,
so it will need the network every time. Any HTTPS static host solves this;
so does a tunnel such as `cloudflared`, or Tailscale Serve if you would rather
not publish it.

`src/pwa.ts` checks `window.isSecureContext` and logs a note rather than
failing silently, so it is clear which mode you are in.

### iOS details that are handled

- `apple-touch-icon`, `apple-mobile-web-app-capable` and
  `apple-mobile-web-app-title` — Safari ignores the manifest's `display` mode,
  so these are what actually give a standalone window and a proper icon.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding, so the header
  clears the notch and the Next button clears the home indicator.
- `touch-action: manipulation` on buttons and the canvas, removing the
  double-tap-to-zoom delay. This matters most on hazard scenarios, where that
  delay would otherwise land inside the reaction time being measured.
- Hazard taps listen for `pointerdown` rather than `click`, for the same
  reason — `click` can lag the actual tap on touch.
- `overscroll-behavior-y: none`, because with no browser chrome the rubber-band
  bounce reads as the app coming loose.
- Export uses the iOS share sheet when it is available; a plain download link
  often just opens the JSON in a tab instead of saving it.

### Two things the service worker gets right that are easy to get wrong

Both of these were real failures caught while testing, not theoretical:

1. **Installation is atomic.** `cache.addAll()` is used for the files without
   which the app cannot start, so a partial precache fails the install and the
   previous worker stays in charge with its cache intact. Best-effort caching
   would let a worker activate with an incomplete cache, delete the old one,
   and leave the app unable to open — which is exactly what happens if someone
   opens it as a new version publishes and then loses signal.

2. **Cache lookups ignore `Vary`.** Static hosts commonly send `Vary: Origin`
   on assets. The worker's own precache fetch sends no `Origin` header but the
   page's module-script request does, so a strict `cache.match()` misses a
   bundle that is definitely cached, and the app fails to start offline with
   its own JavaScript sitting right there.

## Where progress is stored

In this browser, on this device, in IndexedDB — two object stores mirroring
the spec's two tables:

- `sessions` — `id, startedAt, endedAt, itemCount`
- `answers` — `id, sessionId, itemId, topic, correct, responseTimeMs, answeredAt`

There is no server and no sync. That has two consequences worth understanding:

**iOS evicts web app storage that goes unused**, on the order of a week. The
app asks for persistent storage on first use, which Safari grants far more
readily to an installed home-screen app than to a tab, but it is a request and
not a guarantee.

**A parent has to look at the learner's phone**, unless progress is moved.

The parent view therefore offers **Export progress**, **Import a file** and
**Erase all progress**. Export writes the app's own JSON format; import merges
it back. Answers carry a stable client-generated id, so importing the same
file twice adds nothing the second time, and importing an older backup
alongside newer practice merges rather than overwrites. Exporting occasionally
is the backup strategy, and it is also how a parent gets the numbers onto their
own device.

Sessions are re-keyed on import, because their ids autoincrement and would
otherwise collide with sessions recorded since the export.

## How it fits together

```
ingest/            Python + uv + pdfplumber: handbook PDF -> content/handbook.json
content/           questions.json, scenarios.json, handbook.json — what the app serves
assets/handbook/   diagrams cropped out of the handbook PDF
public/            manifest, icons, service worker
shared/types.ts    the data contract shared by the app and the scripts
src/content/       validate.ts (pure, shared with the scripts) and load.ts (fetch)
src/feed/          item selection: topic weighting and spaced repetition
src/store/         derive.ts (pure), idb.ts (IndexedDB), practice.ts (session)
src/scenario/      geometry and the canvas renderer
src/views/         feed view, parent view
scripts/           content verification, ref reconciliation, icons, build steps
tests/             feed engine, geometry, derived stats, and checks over the content
```

### Plain TypeScript, no framework

The spec allowed React, Preact, or plain TypeScript with a small router. There
are two screens and one canvas, so plain TypeScript with a hash router is the
smaller thing to maintain — the whole app is about 34 kB.

### Pure functions, thin storage

Everything computed from the answer history — streaks, dueness, topic accuracy,
the parent summary — lives in `src/store/derive.ts` as pure functions over
plain arrays. `idb.ts` does nothing but read and write rows.

That split is what keeps the logic testable in Node, where there is no
IndexedDB, and it means nothing derived is ever persisted: no cached streak or
mastery score can fall out of step with the answers it came from.

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

Check both at any time with `just verify-content`.

## Read this before using it to study

**Every question and scenario currently has `"verified": false.`** They were
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

Two things multiply together, in `src/feed/select.ts`:

**Topic weight**, from recent per-topic accuracy. A mastered topic bottoms out
at 0.5 and a topic being got wrong every time tops out at 2.5, so the weakest
topic comes up about five times as often as the strongest. A topic with fewer
than four answers gets an exploration boost instead of a judgement.

**Dueness**, per item. Each consecutive correct answer moves an item up a
ladder of intervals — 10 minutes, half an hour, an hour, a day, three days, a
week, three weeks. A wrong answer drops it straight back to the bottom, so a
missed question returns within the same sitting.

Unseen questions are weighted above a review that has merely come due, but
below one that is badly overdue. That ordering is what stops a session
becoming the same handful of items on a loop while most of the bank has never
been shown, without starving review.

The result is a weighted random draw rather than a strict maximum, so the feed
does not march through the pool in the same order every session. Recently seen
items are held back — a quarter of the pool, so 54 items with the bank as it
stands — and two scenarios never appear back to back.

`tests/feed.test.ts` simulates a half-hour sitting and asserts the outcome
rather than only the rules: at least 110 of 120 questions distinct, and
nothing repeating inside 20 questions. An earlier tuning passed every
unit test while repeating about a quarter of a sitting.

## Testing

```sh
just test        # 71 tests
just typecheck
```

The content tests are worth knowing about: they check that no topic is
unreachable, that the answer key is not concentrated in one position, that
every hazard is actually visible during its response window, and that vehicles
in scenarios are on the correct side of the road. That last one caught four
seed scenarios with cars driving on the wrong side.

## Departures from the spec

The spec called for SQLite via better-sqlite3 behind a minimal Node server on
localhost. The app now stores progress in the browser's IndexedDB and has no
server at all.

That was a deliberate change, made so the app can be installed on a phone and
used anywhere: an iOS home-screen app cannot reach a laptop's localhost, and
requiring the laptop to be awake and on the same network would have meant no
practice on the bus. The schema, the two-table shape and every piece of logic
above it are unchanged — the storage layer was swapped, not the design.

The costs are real and are covered under [Where progress is
stored](#where-progress-is-stored): iOS may evict the data, and a parent has to
either use the learner's phone or import an exported file.
