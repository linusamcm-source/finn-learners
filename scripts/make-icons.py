#!/usr/bin/env python3
"""
Generate the PWA icon set: an L-plate, which is the one icon a learner driver
will recognise on a home screen.

    python3 scripts/make-icons.py

No dependencies — the shapes are axis-aligned rectangles, so the PNGs are
written directly. Rerun after changing the colours below.

iOS notes:
  - apple-touch-icon.png is what iOS uses for "Add to Home Screen". It must be
    opaque, square, and unrounded; iOS applies its own corner mask.
  - the maskable icon keeps the glyph inside the middle 60% so Android's
    adaptive-icon crop cannot clip it.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public"

PLATE_YELLOW = (242, 194, 0)
GLYPH_BLACK = (24, 24, 27)


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    """pixels is RGB, row-major, no filter bytes."""
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 for each scanline
        raw.extend(pixels[y * stride : (y + 1) * stride])

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
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def render(size: int, glyph_fraction: float) -> bytes:
    """An L glyph centred on a plate-yellow field."""
    glyph_h = size * glyph_fraction
    glyph_w = glyph_h * 0.66
    left = (size - glyph_w) / 2
    top = (size - glyph_h) / 2

    stem_right = left + glyph_w * 0.30
    foot_top = top + glyph_h * 0.76
    bottom = top + glyph_h
    right = left + glyph_w

    out = bytearray()
    for y in range(size):
        in_stem_band = top <= y < bottom
        in_foot_band = foot_top <= y < bottom
        row = bytearray()
        for x in range(size):
            on_stem = in_stem_band and left <= x < stem_right
            on_foot = in_foot_band and left <= x < right
            row.extend(GLYPH_BLACK if (on_stem or on_foot) else PLATE_YELLOW)
        out.extend(row)
    return bytes(out)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # (filename, size, how much of the canvas the L fills)
    icons = [
        ("apple-touch-icon.png", 180, 0.62),
        ("icon-192.png", 192, 0.62),
        ("icon-512.png", 512, 0.62),
        ("icon-maskable-512.png", 512, 0.44),  # glyph inside the safe zone
    ]
    for name, size, fraction in icons:
        write_png(OUT / name, size, size, render(size, fraction))
        print(f"[icons] {name}  {size}x{size}")


if __name__ == "__main__":
    main()
