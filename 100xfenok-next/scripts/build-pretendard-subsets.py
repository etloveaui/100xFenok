#!/usr/bin/env python3
"""Cut Pretendard Variable into three unicode-range subsets for self-hosting.

    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python scripts/build-pretendard-subsets.py --source PretendardVariable.woff2 [--check]

Why three and not the upstream 92-slice "dynamic subset": every extra face in
a segmented family costs main-thread time on page load (font matching plus a
relayout per slice as each one arrives). Measured on /screener with 4x CPU
throttling, 92 faces delayed data rendering by ~1.6s against no web font;
three faces cost ~0.1-0.2s. Almost every page is served by the single "core"
file; the other two download only when a page shows a rare character.

  core         Latin + common symbols + KS X 1001 Hangul (2,350) + compatibility
               Jamo + CJK punctuation + fullwidth forms
  hangul-rest  the remaining 8,822 modern syllables and conjoining Jamo
  other        everything else the font covers (Greek, Cyrillic, ...)

Writes src/app/fonts/pretendard/*.woff2, the Pretendard block of
src/app/fonts/fonts.css and the Pretendard entry of src/app/fonts/receipt.json.
Run it by hand when the font changes; the build never fetches or subsets fonts.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

APP_ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = APP_ROOT / "src/app/fonts"
SUBSET_DIR = FONT_DIR / "pretendard"
FONTS_CSS = FONT_DIR / "fonts.css"
RECEIPT = FONT_DIR / "receipt.json"
BLOCK_START = "/* Pretendard Variable — 45-920, normal, swap, unicode-range subsets (build-pretendard-subsets.py) */"
BLOCK_END = "/* JetBrains Mono 500 normal — tickers/codes only */"

HANGUL_SYLLABLES = set(range(0xAC00, 0xD7A4))
LATIN_AND_SYMBOLS = (
    set(range(0x20, 0x7F))
    | set(range(0xA0, 0x100))
    | {0x131, 0x152, 0x153, 0x2BB, 0x2BC, 0x2C6, 0x2DA, 0x2DC, 0x304, 0x308, 0x329}
    | set(range(0x2000, 0x20A0))  # general punctuation, super/subscripts
    | {0x20A9, 0x20AC, 0x2116, 0x2122}
    | set(range(0x2190, 0x2300))  # arrows, math operators
    | set(range(0x2460, 0x2700))  # enclosed alphanumerics, box drawing, shapes, misc symbols
    | {0xFEFF, 0xFFFD}
)
KOREAN_COMMON_EXTRAS = set(range(0x3000, 0x3040)) | set(range(0x3131, 0x318F)) | set(range(0xFF01, 0xFF5F))
HANGUL_REST_EXTRAS = set(range(0x1100, 0x1200)) | set(range(0xA960, 0xA980)) | set(range(0xD7B0, 0xD800))


def ks_x_1001_syllables() -> set[int]:
    # Python's euc-kr codec also emits 8-byte "make-up" sequences for syllables
    # outside KS X 1001; only the 2-byte encodings are the 2,350 common ones.
    return {cp for cp in HANGUL_SYLLABLES if len(chr(cp).encode("euc-kr")) == 2}


def unicode_range(codepoints: set[int]) -> str:
    ranges: list[tuple[int, int]] = []
    for cp in sorted(codepoints):
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1] = (ranges[-1][0], cp)
        else:
            ranges.append((cp, cp))
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)


def cut(source: Path, codepoints: set[int]) -> bytes:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    # Keep the source's head.modified so identical input gives identical bytes.
    font = TTFont(source, recalcTimestamp=False)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    font.flavor = "woff2"
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path, help="full PretendardVariable.woff2")
    parser.add_argument("--check", action="store_true", help="verify committed files instead of writing")
    args = parser.parse_args()

    source_bytes = args.source.read_bytes()
    covered = set(TTFont(args.source).getBestCmap())
    core = (LATIN_AND_SYMBOLS | ks_x_1001_syllables() | KOREAN_COMMON_EXTRAS) & covered
    rest = ((HANGUL_SYLLABLES | HANGUL_REST_EXTRAS) & covered) - core
    other = covered - core - rest
    groups = [("core", core), ("hangul-rest", rest), ("other", other)]

    faces, slices, problems = [], [], []
    for name, codepoints in groups:
        file_name = f"PretendardVariable-{name}.woff2"
        data = cut(args.source, codepoints)
        digest = hashlib.sha256(data).hexdigest()
        target = SUBSET_DIR / file_name
        if args.check:
            if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                problems.append(f"{file_name} differs from a fresh cut")
        else:
            SUBSET_DIR.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        slices.append({"file": file_name, "codepoints": len(codepoints), "bytes": len(data), "sha256": digest})
        faces.append(
            "@font-face {\n"
            "  font-family: 'Pretendard Variable';\n"
            "  font-style: normal;\n"
            "  font-weight: 45 920;\n"
            "  font-display: swap;\n"
            f"  src: url('./pretendard/{file_name}') format('woff2-variations');\n"
            f"  unicode-range: {unicode_range(codepoints)};\n"
            "}"
        )

    css = FONTS_CSS.read_text(encoding="utf-8")
    start, end = css.find(BLOCK_START), css.find(BLOCK_END)
    if start == -1 or end == -1 or end < start:
        raise SystemExit("fonts.css Pretendard block markers not found")
    next_css = css[:start] + BLOCK_START + "\n" + "\n\n".join(faces) + "\n\n" + css[end:]

    if args.check:
        if next_css != css:
            problems.append("fonts.css Pretendard block differs from a fresh cut")
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        print(f"pretendard subsets ok ({len(slices)} faces)")
        return 0

    FONTS_CSS.write_text(next_css, encoding="utf-8")
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    receipt["fonts"] = [font for font in receipt["fonts"] if font.get("family") != "Pretendard Variable"]
    receipt["fonts"].insert(0, {
        "directory": "pretendard/",
        "family": "Pretendard Variable",
        "weight": "45-920",
        "subset": "variable, three unicode-range subsets (core / hangul-rest / other)",
        "source_file": "PretendardVariable.woff2 (pretendard@1.3.9 dist/web/variable/woff2)",
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "tool": "scripts/build-pretendard-subsets.py (fonttools + brotli)",
        "license": "OFL-1.1 (pretendard/LICENSE.txt)",
        "slices": slices,
    })
    RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in slices:
        print(f"{item['file']}: {item['codepoints']} codepoints, {item['bytes']} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
