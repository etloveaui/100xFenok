"""Link-preview image (og:image) for one edition, drawn from the edition JSON with Pillow. No AI image.

python -m briefing.og_image EDITION.json [EDITION.json ...] --out-dir DIR   ->  DIR/<edition_date>.png

1200x630 PNG: MORNING BRIEF label and date, the headline (2 lines max), S&P 500 / 나스닥 / 러셀2000 / 10년물
chips, the S&P 500 intraday line (09:30-16:00 ET) with its low/high markers, 시장 체력 and the 100x wordmark.
Drawn at 2x and downsampled, so lines and text are smooth.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .common import CFG, expand

O = CFG["og"]
W, H = O["width"], O["height"]
S = 2  # supersampling factor

INK, SUB, MUTED, LINE = "#0F172A", "#475569", "#64748B", "#E2E8F0"
BG, PANEL, BLUE, UP, DOWN = "#FFFFFF", "#F8FAFC", "#1B73D3", "#0F8A5F", "#D1344C"
PAD = 64
WEEKDAY = "월화수목금토일"
CHIPS = (("S&P 500", "S&P 500"), ("나스닥", "나스닥"), ("러셀2000", "러셀2000"))
EDGE_COLOR = {"위험 선호": UP, "중립": BLUE, "방어": DOWN}

_fonts: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """Pretendard (or the first configured Korean font) at `size` 1x pixels."""
    key = (weight, size)
    if key not in _fonts:
        for pattern in O["fonts"]:
            p = expand(pattern.format(weight=weight))
            if p.exists():
                _fonts[key] = ImageFont.truetype(str(p), size * S)
                break
        else:
            raise FileNotFoundError(f"no font for weight {weight} in {O['fonts']}")
    return _fonts[key]


def color_for(v: float | None) -> str:
    if v is None or v == 0:
        return MUTED
    return UP if v > 0 else DOWN


def pct(v: float | None) -> str:
    return "—" if v is None else f"{v:+.2f}%"


def num(v: float | None) -> str:
    return "—" if v is None else f"{v:,.2f}"


def minutes(hhmm: str) -> int:
    h, m = (int(x) for x in hhmm.split(":"))
    return h * 60 + m


class Canvas:
    def __init__(self) -> None:
        self.img = Image.new("RGB", (W * S, H * S), BG)
        self.d = ImageDraw.Draw(self.img)

    def text(self, xy, s, f, fill, anchor="ls") -> None:
        self.d.text((xy[0] * S, xy[1] * S), s, font=f, fill=fill, anchor=anchor)

    def width(self, s: str, f) -> float:
        return f.getlength(s) / S

    def rrect(self, box, r, fill, outline=None) -> None:
        self.d.rounded_rectangle([v * S for v in box], radius=r * S, fill=fill, outline=outline, width=S if outline else 0)


def wrap(c: Canvas, text: str, f, max_w: float, max_lines: int) -> tuple[list[str], bool]:
    """Greedy word wrap (character wrap for an over-long word); True when it fit without truncation."""
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}" if cur else word
        if c.width(trial, f) <= max_w:
            cur = trial
            continue
        if cur:
            lines.append(cur)
            cur = ""
        for ch in word:
            if c.width(cur + ch, f) > max_w and cur:
                lines.append(cur)
                cur = ""
            cur += ch
    if cur:
        lines.append(cur)
    if len(lines) <= max_lines:
        return lines, True
    last = lines[max_lines - 1]
    while last and c.width(last + "…", f) > max_w:
        last = last[:-1]
    return lines[: max_lines - 1] + [last.rstrip() + "…"], False


def header(c: Canvas, doc: dict) -> None:
    c.d.rectangle([0, 0, W * S, 8 * S], fill=BLUE)
    label = font("ExtraBold", 22)
    c.text((PAD, 66), "MORNING BRIEF", label, BLUE)
    d = dt.date.fromisoformat(doc["edition_date"])
    x = PAD + c.width("MORNING BRIEF", label) + 16
    c.text((x, 66), f"{d:%Y.%m.%d} ({WEEKDAY[d.weekday()]})", font("SemiBold", 22), MUTED)
    mark, tag = font("ExtraBold", 34), font("SemiBold", 18)
    right = W - PAD
    c.text((right, 66), "Market Radar", tag, MUTED, anchor="rs")
    c.text((right - c.width("Market Radar", tag) - 10, 66), "100x", mark, BLUE, anchor="rs")


def headline(c: Canvas, text: str) -> None:
    for size in (54, 50, 46):
        f = font("Bold", size)
        lines, fit = wrap(c, text, f, W - 2 * PAD, 2)
        if fit:
            break
    lh = round(size * 1.28)
    top = 146 if len(lines) == 2 else 146 + lh // 2
    for i, line in enumerate(lines):
        c.text((PAD, top + i * lh), line, f, INK)


def chips(c: Canvas, pack: dict) -> None:
    idx, rates = pack.get("indices") or {}, pack.get("rates") or {}
    gap, top, h = 14, 272, 84
    w = (W - 2 * PAD - 3 * gap) / 4
    name_f, side_f, big_f = font("SemiBold", 19), font("Medium", 17), font("Bold", 30)
    items = []
    for name, key in CHIPS:
        q = idx.get(key) or {}
        items.append((name, num(q.get("close")), pct(q.get("chg_pct")), color_for(q.get("chg_pct")), None))
    y10, prev = rates.get("us10y"), rates.get("us10y_prev")
    if y10 is None:
        y10 = ((pack.get("intraday") or {}).get("미 10년물") or {}).get("close")
    bp = round((y10 - prev) * 100) if y10 is not None and prev is not None else None
    items.append(("미 10년물", "", "—" if y10 is None else f"{y10:.2f}%", INK, bp))
    for i, (name, side, big, col, bp) in enumerate(items):
        x = PAD + i * (w + gap)
        c.rrect((x, top, x + w, top + h), 14, PANEL, LINE)
        c.text((x + 18, top + 31), name, name_f, SUB)
        if side:
            c.text((x + w - 18, top + 31), side, side_f, MUTED, anchor="rs")
        c.text((x + 18, top + 71), big, big_f, col)
        if bp is not None:
            c.text((x + 18 + c.width(big, big_f) + 10, top + 71), f"{bp:+d}bp", font("Bold", 22), color_for(bp))


def chart(c: Canvas, pack: dict) -> None:
    x0, x1, top, bottom = PAD, 812, 384, 594
    c.rrect((x0, top, x1, bottom), 18, PANEL, LINE)
    c.text((x0 + 22, top + 34), "S&P 500 장중", font("Bold", 20), INK)
    c.text((x0 + 22 + c.width("S&P 500 장중", font("Bold", 20)) + 8, top + 34), "ET", font("Medium", 16), MUTED)
    intra = (pack.get("intraday") or {}).get("S&P 500") or {}
    pts = [(minutes(t), v) for t, v in intra.get("points") or [] if isinstance(v, (int, float))]
    cx0, cx1, cy0, cy1 = x0 + 22, x1 - 22, top + 62, bottom - 40
    axis_f = font("Medium", 15)
    t0, t1 = minutes("09:30"), minutes("16:00")
    X = lambda m: cx0 + (m - t0) / (t1 - t0) * (cx1 - cx0)  # noqa: E731
    for hhmm in ("10:00", "12:00", "14:00", "16:00"):
        gx = X(minutes(hhmm))
        c.d.line([(gx * S, cy0 * S), (gx * S, cy1 * S)], fill=LINE, width=S)
        c.text((gx, bottom - 14), hhmm, axis_f, MUTED, anchor="ms" if hhmm != "16:00" else "rs")
    if len(pts) < 2:
        c.text(((cx0 + cx1) / 2, (cy0 + cy1) / 2), "장중 데이터 없음", font("Medium", 18), MUTED, anchor="mm")
        return
    q = (pack.get("indices") or {}).get("S&P 500") or {}
    prev = q["close"] / (1 + q["chg_pct"] / 100) if q.get("close") and q.get("chg_pct") is not None else None
    vals = [v for _, v in pts] + ([prev] if prev else [])
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    top_y, bottom_y = cy0 + 34, cy1 - 30  # the line stays clear of the high label above and the low label below
    Y = lambda v: bottom_y - (v - lo) / span * (bottom_y - top_y)  # noqa: E731
    line = [(X(m) * S, Y(v) * S) for m, v in pts]
    # soft fill under the line
    mask = Image.new("L", c.img.size, 0)
    ImageDraw.Draw(mask).polygon(line + [(line[-1][0], cy1 * S), (line[0][0], cy1 * S)], fill=255)
    grad = Image.linear_gradient("L").resize((1, int((cy1 - cy0) * S))).point(lambda p: int((255 - p) * 0.2))
    alpha = Image.new("L", c.img.size, 0)
    alpha.paste(grad.resize((c.img.size[0], grad.size[1])), (0, int(cy0 * S)))
    alpha = Image.composite(alpha, Image.new("L", c.img.size, 0), mask)
    c.img.paste(Image.new("RGB", c.img.size, BLUE), (0, 0), alpha)
    mark_f, ref_f = font("Bold", 16), font("Medium", 14)
    marks, boxes = [], []
    for kind, col, above in (("high", UP, True), ("low", DOWN, False)):
        v, t = intra.get(kind), intra.get(f"{kind}_time")
        if v is None or not t:
            continue
        px, py = X(minutes(t)), Y(v)
        label = f"{'고가' if kind == 'high' else '저가'} {num(v)} · {t}"
        lw = c.width(label, mark_f)
        lx = min(max(px - lw / 2, cx0), cx1 - lw)
        ly = max(py - 14, cy0 + 14) if above else min(py + 28, cy1 - 2)
        marks.append((px, py, col, lx, ly, label))
        boxes.append((lx, ly - 16, lx + lw, ly + 4))
    if prev:
        py = Y(prev) * S
        x = cx0 * S
        while x < cx1 * S:
            c.d.line([(x, py), (min(x + 8 * S, cx1 * S), py)], fill="#94A3B8", width=S)
            x += 14 * S
        ref = f"전일 종가 {num(prev)}"
        rw, ry = c.width(ref, ref_f), Y(prev) - 6
        hit = lambda bx0: any(bx0 < b[2] and bx0 + rw > b[0] and ry - 14 < b[3] and ry + 2 > b[1] for b in boxes)  # noqa: E731
        rx = next((x for x in (cx1 - rw, cx0, (cx0 + cx1 - rw) / 2) if not hit(x)), cx1 - rw)
        c.text((rx, ry), ref, ref_f, MUTED)
    c.d.line(line, fill=BLUE, width=3 * S, joint="curve")
    for px, py, col, lx, ly, label in marks:
        r = 6
        c.d.ellipse([(px - r) * S, (py - r) * S, (px + r) * S, (py + r) * S], fill=col, outline=BG, width=2 * S)
        c.rrect((lx - 5, ly - 18, lx + c.width(label, mark_f) + 5, ly + 5), 5, PANEL)
        c.text((lx, ly), label, mark_f, col)


def edge_card(c: Canvas, pack: dict) -> None:
    x0, x1, top, bottom = 836, W - PAD, 384, 594
    c.rrect((x0, top, x1, bottom), 18, PANEL, LINE)
    e = pack.get("edge") or {}
    c.text((x0 + 24, top + 34), "시장 체력", font("Bold", 20), INK)
    score, label = e.get("score"), e.get("label") or ""
    col = EDGE_COLOR.get(label, BLUE)
    big = font("ExtraBold", 72)
    s = "—" if score is None else str(round(score))
    c.text((x0 + 24, top + 122), s, big, col)
    c.text((x0 + 24 + c.width(s, big) + 12, top + 122), label, font("Bold", 28), col)
    bx0, bx1, by = x0 + 24, x1 - 24, top + 148
    c.rrect((bx0, by, bx1, by + 10), 5, LINE)
    if score is not None:
        c.rrect((bx0, by, bx0 + max(10, (bx1 - bx0) * min(max(score, 0), 100) / 100), by + 10), 5, col)
    prev = e.get("prev_score")
    if prev is not None:
        c.text((x0 + 24, top + 188), f"전일 {round(prev)}", font("Medium", 17), MUTED)
    c.text((x1 - 24, top + 188), "0-100", font("Medium", 15), MUTED, anchor="rs")


def render(doc: dict) -> Image.Image:
    c = Canvas()
    pack = doc.get("pack") or {}
    header(c, doc)
    headline(c, doc.get("headline") or "")
    chips(c, pack)
    chart(c, pack)
    edge_card(c, pack)
    return c.img.resize((W, H), Image.LANCZOS)


def render_bytes(doc: dict) -> bytes:
    """PNG bytes; palette-quantized when the full-colour PNG is over the configured size."""
    img = render(doc)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    if buf.tell() > O["max_bytes"]:
        buf = io.BytesIO()
        img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("editions", nargs="+", help="briefing-morning/v1 edition JSON files")
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args(argv)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for p in a.editions:
        doc = json.loads(Path(p).read_text(encoding="utf-8"))
        png = render_bytes(doc)
        target = out / f"{doc['edition_date']}.png"
        target.write_bytes(png)
        print(f"{target} {len(png)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
