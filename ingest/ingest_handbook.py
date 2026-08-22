#!/usr/bin/env python3
"""
Phase 1 — extract the Tasmanian Road Rules Handbook into structured JSON.

Run it with `just ingest` (downloads the PDF) or `just ingest-local <path>`
(uses a PDF you already have). Output:

    content/handbook.json     chapters -> sections -> {id, chapter, title,
                              body, pageRef, images}
    assets/handbook/*.png     diagrams cropped out of the pages

The handbook has no machine-readable structure, so headings are found by
type size: the most common line size in the document is taken as body text,
and lines set noticeably larger than that become chapter or section
headings. That is a heuristic. Run with --report to see what it decided
before trusting the output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD_DIR = Path(__file__).resolve().parent / "downloads"
DEFAULT_OUT = REPO_ROOT / "content" / "handbook.json"
DEFAULT_ASSETS = REPO_ROOT / "assets" / "handbook"

SOURCE_TITLE = "Tasmanian Road Rules Handbook"

# Transport Services moves this file between site redesigns. Each candidate is
# tried in order; if they all fail, download the PDF by hand and use
# `just ingest-local <path>`.
CANDIDATE_URLS = [
    "https://www.transport.tas.gov.au/__data/assets/pdf_file/0020/86budget/Road_Rules_Handbook.pdf",
    "https://www.transport.tas.gov.au/__data/assets/pdf_file/0005/23792/Tasmanian_Road_Rules_Handbook.pdf",
    "https://www.transport.tas.gov.au/licensing/tasmanian_road_rules_handbook",
]

SEARCH_HINT = (
    "Could not download the handbook automatically.\n"
    "Open https://www.transport.tas.gov.au and search for "
    '"Tasmanian Road Rules Handbook" (a ~4.4 MB or ~11.9 MB PDF), save it, then run:\n'
    "    just ingest-local /path/to/handbook.pdf"
)

# Chapter and section heading thresholds, as a multiple of body text size.
CHAPTER_RATIO = 1.40
SECTION_RATIO = 1.12

# Diagrams worth keeping: anything smaller is a logo, bullet or rule line.
MIN_IMAGE_PT = 60
MIN_IMAGE_AREA = 8_000

# Page furniture that should never become a heading.
NOISE_PATTERNS = [
    re.compile(r"^\s*page\s+\d+\s*$", re.I),
    re.compile(r"^\s*\d+\s*$"),
    re.compile(r"^\s*$"),
    re.compile(r"^\s*tasmanian road rules handbook\s*$", re.I),
    re.compile(r"^\s*department of state growth\s*$", re.I),
]


def slugify(text: str, limit: int = 48) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug[:limit].rstrip("-")) or "untitled"


@dataclass
class Line:
    text: str
    size: float
    page: int
    top: float
    bold: bool


@dataclass
class Section:
    title: str
    chapter: str
    page: int
    body_parts: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)

    def to_json(self, index: int) -> dict:
        body = re.sub(r"\s+\n", "\n", " ".join(self.body_parts)).strip()
        body = re.sub(r"[ \t]{2,}", " ", body)
        return {
            "id": f"s-{slugify(self.chapter, 24)}-{index:03d}",
            "chapter": self.chapter,
            "title": self.title,
            "body": body,
            "pageRef": self.page,
            "images": self.images,
        }


@dataclass
class Chapter:
    title: str
    start_page: int
    sections: list[Section] = field(default_factory=list)

    def to_json(self) -> dict:
        end_page = max((s.page for s in self.sections), default=self.start_page)
        return {
            "title": self.title,
            "startPage": self.start_page,
            "endPage": end_page,
            "sections": [s.to_json(i) for i, s in enumerate(self.sections)],
        }


def is_noise(text: str) -> bool:
    return any(p.match(text) for p in NOISE_PATTERNS)


def download_handbook(dest_dir: Path) -> Path:
    """Fetch the handbook PDF, trying each known URL in turn."""
    import httpx

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "tasmanian-road-rules-handbook.pdf"
    errors: list[str] = []

    for url in CANDIDATE_URLS:
        try:
            print(f"[ingest] trying {url}")
            with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "pdf" not in content_type.lower() and not url.endswith(".pdf"):
                    errors.append(f"{url}: served {content_type or 'unknown type'}, not a PDF")
                    continue
                with dest.open("wb") as handle:
                    for chunk in response.iter_bytes():
                        handle.write(chunk)
        except Exception as exc:  # noqa: BLE001 - report and try the next URL
            errors.append(f"{url}: {exc}")
            continue

        if dest.exists() and dest.stat().st_size > 500_000:
            print(f"[ingest] downloaded {dest.stat().st_size / 1e6:.1f} MB -> {dest}")
            return dest
        errors.append(f"{url}: file too small to be the handbook")

    raise SystemExit(SEARCH_HINT + "\n\nTried:\n  " + "\n  ".join(errors))


def lines_on_page(page, page_number: int) -> list[Line]:
    """Group a page's words into lines, tagged with their largest type size."""
    words = page.extract_words(extra_attrs=["size", "fontname"], use_text_flow=False)
    if not words:
        return []

    rows: dict[int, list[dict]] = {}
    for word in words:
        # Words on the same visual line rarely differ by more than ~2pt in top.
        key = round(word["top"] / 3.0)
        rows.setdefault(key, []).append(word)

    lines: list[Line] = []
    for key in sorted(rows):
        row = sorted(rows[key], key=lambda w: w["x0"])
        text = " ".join(w["text"] for w in row).strip()
        if not text:
            continue
        size = max(float(w.get("size", 0) or 0) for w in row)
        bold = any("bold" in str(w.get("fontname", "")).lower() for w in row)
        lines.append(Line(text=text, size=round(size, 1), page=page_number, top=row[0]["top"], bold=bold))
    return lines


def body_text_size(lines: list[Line]) -> float:
    """The most common line size, weighted by how much text is set in it."""
    counter: Counter[float] = Counter()
    for line in lines:
        counter[line.size] += max(1, len(line.text))
    if not counter:
        return 10.0
    return counter.most_common(1)[0][0]


def extract_images(page, page_number: int, assets_dir: Path, chapter: str) -> list[str]:
    """Crop each sizeable embedded image out of the page and save it as PNG."""
    saved: list[str] = []
    for index, image in enumerate(page.images):
        x0, top, x1, bottom = image["x0"], image["top"], image["x1"], image["bottom"]
        width, height = x1 - x0, bottom - top
        if width < MIN_IMAGE_PT or height < MIN_IMAGE_PT or width * height < MIN_IMAGE_AREA:
            continue

        # Clamp to the page: some PDFs declare images that overhang the crop box.
        bbox = (
            max(x0, page.bbox[0]),
            max(top, page.bbox[1]),
            min(x1, page.bbox[2]),
            min(bottom, page.bbox[3]),
        )
        if bbox[2] - bbox[0] <= 1 or bbox[3] - bbox[1] <= 1:
            continue

        name = f"{slugify(chapter, 28)}-p{page_number:03d}-{index}.png"
        out_path = assets_dir / name
        try:
            page.crop(bbox).to_image(resolution=200).save(str(out_path))
        except Exception as exc:  # noqa: BLE001 - a bad image should not stop the run
            print(f"[ingest] page {page_number} image {index}: {exc}", file=sys.stderr)
            continue
        saved.append(f"assets/handbook/{name}")
    return saved


def extract(pdf_path: Path, assets_dir: Path, max_pages: int | None, report: bool) -> dict:
    assets_dir.mkdir(parents=True, exist_ok=True)

    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages[:max_pages] if max_pages else pdf.pages
        page_count = len(pdf.pages)

        all_lines: list[list[Line]] = []
        for offset, page in enumerate(pages):
            all_lines.append(lines_on_page(page, offset + 1))

        flat = [line for page_lines in all_lines for line in page_lines]
        body_size = body_text_size(flat)
        chapter_min = body_size * CHAPTER_RATIO
        section_min = body_size * SECTION_RATIO

        if report:
            sizes = Counter(line.size for line in flat)
            print(f"[ingest] body text size {body_size}pt")
            print(f"[ingest] chapter headings >= {chapter_min:.1f}pt, sections >= {section_min:.1f}pt")
            print("[ingest] line sizes seen:", dict(sorted(sizes.items())))

        chapters: list[Chapter] = []
        current_section: Section | None = None

        def ensure_chapter(title: str, page_number: int) -> Chapter:
            chapters.append(Chapter(title=title, start_page=page_number))
            return chapters[-1]

        for offset, page in enumerate(pages):
            page_number = offset + 1
            for line in all_lines[offset]:
                if is_noise(line.text):
                    continue

                if line.size >= chapter_min and len(line.text) < 90:
                    ensure_chapter(line.text.strip(), page_number)
                    current_section = None
                    continue

                if not chapters:
                    # Front matter before the first chapter heading.
                    ensure_chapter("Front matter", page_number)

                chapter = chapters[-1]
                is_section_heading = (
                    line.size >= section_min or (line.bold and line.size >= body_size)
                ) and len(line.text) < 90

                if is_section_heading:
                    current_section = Section(
                        title=line.text.strip(), chapter=chapter.title, page=page_number
                    )
                    chapter.sections.append(current_section)
                    continue

                if current_section is None:
                    current_section = Section(
                        title=chapter.title, chapter=chapter.title, page=page_number
                    )
                    chapter.sections.append(current_section)
                current_section.body_parts.append(line.text)

            images = extract_images(
                page, page_number, assets_dir, chapters[-1].title if chapters else "handbook"
            )
            if images:
                target = current_section
                if target is None and chapters and chapters[-1].sections:
                    target = chapters[-1].sections[-1]
                if target is not None:
                    target.images.extend(images)

        # Drop chapters that caught a stray large word and nothing else.
        chapters = [c for c in chapters if any(s.body_parts or s.images for s in c.sections)]

        digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()

    return {
        "source": {
            "title": SOURCE_TITLE,
            "url": CANDIDATE_URLS[0],
            "retrievedAt": date.today().isoformat(),
            "sha256": digest,
            "pageCount": page_count,
        },
        "chapters": [c.to_json() for c in chapters],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, help="use this PDF instead of downloading")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--assets", type=Path, default=DEFAULT_ASSETS)
    parser.add_argument("--max-pages", type=int, default=None, help="stop after N pages")
    parser.add_argument("--report", action="store_true", help="print heading detection detail")
    args = parser.parse_args()

    pdf_path = args.pdf or download_handbook(DOWNLOAD_DIR)
    if not pdf_path.exists():
        raise SystemExit(f"no such PDF: {pdf_path}")

    handbook = extract(pdf_path, args.assets, args.max_pages, args.report)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(handbook, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    section_count = sum(len(c["sections"]) for c in handbook["chapters"])
    image_count = sum(len(s["images"]) for c in handbook["chapters"] for s in c["sections"])
    print(
        f"[ingest] {len(handbook['chapters'])} chapters, {section_count} sections, "
        f"{image_count} images -> {args.out}"
    )
    for chapter in handbook["chapters"]:
        print(f"  p{chapter['startPage']:>4}  {chapter['title']}  ({len(chapter['sections'])} sections)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
