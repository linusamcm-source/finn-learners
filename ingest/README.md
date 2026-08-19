# Ingestion — Phase 1

Turns the Tasmanian Road Rules Handbook PDF into `content/handbook.json` plus
cropped diagrams in `assets/handbook/`.

```sh
just ingest                      # download the handbook, then extract
just ingest-local ~/handbook.pdf # extract a PDF you already have
```

## The PDF is not vendored

The handbook is Crown copyright and runs to ~12 MB, so it is downloaded rather
than committed. `just ingest` tries the known Transport Services URLs in turn.
Those URLs move between site redesigns; if all of them fail the script prints
the search steps and exits without writing anything. Save the PDF by hand and
use `just ingest-local` in that case.

## How structure is recovered

The handbook carries no machine-readable outline, so headings are inferred
from type size:

1. Every line on every page is measured. The most common size, weighted by
   how much text is set in it, is taken as body text.
2. Lines at least 1.4x body size become **chapter** headings.
3. Lines at least 1.12x body size, or bold at body size, become **section**
   headings.
4. Remaining lines are body text, appended to the open section.
5. Embedded images at least 60pt on both sides are cropped out at 200 dpi and
   attached to the open section.

That is a heuristic and it will not be perfect on the real handbook. Run
`--report` to see the size distribution and the thresholds it chose before
trusting the output:

```sh
cd ingest && uv run ingest_handbook.py --pdf ~/handbook.pdf --report --max-pages 20
```

If chapters come out wrong, adjust `CHAPTER_RATIO` and `SECTION_RATIO` at the
top of `ingest_handbook.py`.

## Testing without the handbook

`make_fixture_pdf.py` builds a small stand-in PDF with the same shape — large
chapter headings, medium section headings, body text, an embedded diagram — so
the extractor can be exercised offline:

```sh
cd ingest
uv run --group dev make_fixture_pdf.py
uv run ingest_handbook.py --pdf fixtures/fixture-handbook.pdf --report \
  --out /tmp/handbook.json --assets /tmp/assets
```

This is what the extractor was developed against. It confirms the parsing,
the page references and the image cropping; it says nothing about whether the
thresholds suit the real document.
