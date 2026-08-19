#!/usr/bin/env python3
"""
Build a small stand-in handbook PDF for exercising the ingestion script.

The real Tasmanian Road Rules Handbook cannot be committed to the repo, and
its download needs network access. This fixture reproduces the shape the
ingester relies on — chapter headings set large, section headings set
medium, body text at the modal size, and an embedded diagram — so
`ingest_handbook.py` can be tested without it.

    uv run --group dev make_fixture_pdf.py
    uv run ingest_handbook.py --pdf fixtures/fixture-handbook.pdf --report
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

from fpdf import FPDF

FIXTURES = Path(__file__).resolve().parent / "fixtures"

CHAPTERS: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "Giving way",
        [
            (
                "Give way at an intersection",
                "At an intersection without signs or traffic lights you must give way to any "
                "vehicle approaching from your right. If you are turning right you must also "
                "give way to oncoming vehicles going straight ahead or turning left.",
            ),
            (
                "Give way signs and stop signs",
                "At a stop sign you must come to a complete stop at the stop line and give way "
                "to all traffic. At a give way sign you must slow down and be ready to stop, and "
                "give way to all traffic in or approaching the intersection.",
            ),
        ],
    ),
    (
        "Roundabouts",
        [
            (
                "Entering a roundabout",
                "When entering a roundabout you must give way to any vehicle already in the "
                "roundabout. Signal left as you leave the roundabout if it is practical to do so.",
            ),
            (
                "Choosing a lane",
                "To turn left, use the left lane and signal left. To turn right, use the right "
                "lane and signal right. To go straight ahead you may use either lane unless "
                "signs or markings say otherwise.",
            ),
        ],
    ),
    (
        "Speed limits",
        [
            (
                "Default speed limits",
                "The default speed limit in a built-up area is 50 km/h unless signs say "
                "otherwise. Outside built-up areas the default limit is 100 km/h. A speed limit "
                "is a maximum, not a target.",
            ),
        ],
    ),
]


def diagram_png(path: Path) -> None:
    """A plain PNG large enough to clear the ingester's minimum size filter."""
    width, height = 320, 240
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # PNG per-scanline filter byte
        for x in range(width):
            on_road = 100 <= x <= 220 or 90 <= y <= 150
            value = (40, 40, 45) if on_road else (225, 225, 220)
            rows.extend(value)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 6))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def build() -> Path:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    image_path = FIXTURES / "fixture-diagram.png"
    diagram_png(image_path)

    pdf = FPDF(unit="pt", format="A4")
    pdf.set_margins(56, 56, 56)
    pdf.set_auto_page_break(auto=True, margin=56)

    for chapter_title, sections in CHAPTERS:
        pdf.add_page()
        pdf.set_font("helvetica", "B", 24)
        pdf.multi_cell(pdf.epw, 30, chapter_title)
        pdf.ln(8)

        for section_title, body in sections:
            pdf.set_font("helvetica", "B", 13)
            pdf.multi_cell(pdf.epw, 18, section_title)
            pdf.set_font("helvetica", "", 10)
            pdf.multi_cell(pdf.epw, 14, body)
            pdf.ln(10)

        pdf.image(str(image_path), w=260)
        pdf.ln(6)
        pdf.set_font("helvetica", "", 10)
        pdf.multi_cell(pdf.epw, 14, "Figure: a typical layout for this chapter.")

    out = FIXTURES / "fixture-handbook.pdf"
    pdf.output(str(out))
    print(f"[fixture] wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    return out


if __name__ == "__main__":
    build()
