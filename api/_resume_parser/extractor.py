"""
Stage 2 — TextExtractor.

Produces a *geometric line model*, not a flat string. Position, size, weight
and indent are what make the difference between reading a resume and guessing
at it:

  - Section headings are visually distinct, so they can be found even when the
    wording is unusual ("Where I've Worked").
  - Two-column resumes read as interleaved nonsense from a plain text dump;
    detecting the gutter and reading each column top-to-bottom fixes that.
  - Bullet *level* carries meaning. In a very common layout the level-1 bullet
    is the employer and the level-2 bullets are the responsibilities; a parser
    that treats all bullets alike loses the entire structure.

Extraction strategy for PDFs, in order:
    1. pdfplumber   — word boxes with font and size. Primary.
    2. pdfminer.six — raw layout analysis when pdfplumber yields nothing.
    3. pypdf        — last-resort plain text.
    4. OCR          — when the document has no text layer at all.

DOCX uses python-docx, which exposes real paragraph styles, list levels and
run-level bold/italic — richer than converting to HTML first.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field, asdict
from io import BytesIO

MAX_PAGES = 15

# Level-1 bullets (entry-level) versus level-2 (detail-level). The distinction
# is real: many resumes put the employer on a filled bullet and each
# responsibility on a hollow sub-bullet.
BULLET_L1 = "•▪●■‣❋❖"       # • ▪ ● ■ ‣
BULLET_L2 = "◦○□⁃∙·–—"  # ◦ ○ □ ⁃ ∙ · – —
BULLET_ANY = BULLET_L1 + BULLET_L2 + "*+"

BULLET_RE = re.compile(rf"^\s*([{re.escape(BULLET_ANY)}])\s*")
DASH_BULLET_RE = re.compile(r"^\s*[-‐]\s+")
# A numbered or lettered list marker. The letter form is deliberately NOT
# case-insensitive: "D. KILBRIDE ELECTRICAL SERVICES" and "T. Hargreaves Ltd"
# are initials, and stripping them turns an employer into a bullet and loses
# the first letter of its name. Real lettered lists are written in lower case.
NUM_BULLET_RE = re.compile(r"^\s*(?:\(?\d{1,2}[.)]|\(?[a-z][.)])\s+")

# Word's second-level list marker is the letter "o" set in Courier New. Typed
# by hand rather than defined as a numbering level — which is what happens when
# someone copies a list or converts from plain text — it reaches the text layer
# as a literal "o" followed by a tab. Left in place it hides the line's real
# first word, so "o Environment: Python, …" stops being recognised as the
# environment field and becomes another responsibility.
LETTER_O_BULLET_RE = re.compile(r"^\s*o(?:\t+| {2,}|\xa0+| (?=[A-Z(]))\s*")


@dataclass
class Line:
    """One visual line of the document."""

    text: str
    page: int = 1
    column: int = 0
    x0: float = 0.0
    x1: float = 0.0
    top: float = 0.0
    size: float = 10.0
    bold: bool = False
    italic: bool = False
    bullet: bool = False
    bullet_level: int = 0        # 0 = not a bullet, 1 = top level, 2 = nested
    indent: float = 0.0
    gap_before: float = 0.0      # blank space above, in line heights
    all_caps: bool = False
    heading: bool = False
    fills_width: bool = False    # ran to the column's right margin (i.e. wrapped)
    col_right: float = 0.0       # the column's right margin, filled in by the cleaner
    # Where this line's *text* begins, as opposed to where its bullet glyph
    # does. For a hanging-indent list item the two differ, and a following line
    # that starts exactly at text_x0 is that item's continuation — the single
    # most reliable wrap signal a page offers.
    text_x0: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Document:
    """The extracted document."""

    kind: str
    lines: list[Line] = field(default_factory=list)
    page_count: int = 1
    method: str = ""             # which extractor produced this
    ocr_used: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        out = []
        for line in self.lines:
            prefix = "  " * max(0, line.bullet_level - 1) + ("• " if line.bullet else "")
            out.append(prefix + line.text)
        return "\n".join(out)


# ─── Text hygiene applied at extraction time ─────────────────────────────────

_LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
}


# A glyph whose font carries no ToUnicode map reaches the text layer as the
# literal string "(cid:127)". LaTeX output, several design tools and some Word
# exports all do this, and it lands most often on the bullet glyph -- where it
# is far more damaging than a stray character, because an unrecognised bullet
# turns every duty into a new job entry.
_CID = re.compile(r"\(cid:(\d{1,5})\)")

# Code points that carry a bullet in the encodings these fonts actually use:
# Symbol and ZapfDingbats byte values, WinAnsi 0x95, and Unicode's own bullets.
_CID_BULLETS = {8, 108, 110, 127, 129, 149, 155, 164, 165, 167, 168,
                183, 216, 252, 8226, 8227, 9679, 9702, 61607, 61623}


def _repair_cids(text: str) -> str:
    """
    Turn "(cid:N)" back into a character, or into a bullet, or drop it.

    A code point that maps to a printable character is restored; one that is a
    known bullet becomes a bullet so the list structure survives; anything else
    is removed rather than left to masquerade as a word.
    """
    def replace(match) -> str:
        code = int(match.group(1))
        if code in _CID_BULLETS:
            return "\u2022"
        if 32 <= code <= 126:
            return chr(code)
        if 161 <= code <= 0x2FFF:
            char = chr(code)
            return char if char.isprintable() and not char.isspace() else ""
        return ""

    return _CID.sub(replace, text)


def normalise(text: str) -> str:
    """Collapse whitespace and repair characters that survive PDF extraction."""
    if not text:
        return ""
    if "(cid:" in text:
        text = _repair_cids(text)
    for src, dst in _LIGATURES.items():
        text = text.replace(src, dst)
    text = text.replace(" ", " ")
    text = re.sub(r"[​-‍﻿]", "", text)
    text = re.sub(r"[‘’‛]", "'", text)
    text = re.sub(r"[“”]", '"', text)
    # Preserve the tab as a wide-gap marker (see _words_to_lines).
    text = re.sub(r"[^\S\t\n]+", " ", text)
    return text.strip()


def de_space(text: str) -> str:
    """
    Collapse letter-spaced display text: "E D U C A T I O N" -> "EDUCATION".

    A heading set with letter-spacing reaches the text layer with the gap
    between letters indistinguishable from the gap between words, so the word
    boundaries are simply gone. Joining is the best available reading.
    """
    if not text or len(text) < 5:
        return text
    groups = re.split(r" {2,}", text)
    out = []
    for group in groups:
        tokens = [t for t in group.strip().split() if t]
        if len(tokens) >= 4 and sum(1 for t in tokens if len(t) == 1) / len(tokens) >= 0.6:
            out.append("".join(tokens))
        else:
            out.append(group.strip())
    return " ".join(o for o in out if o).strip()


def _is_all_caps(text: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", text)
    return len(letters) > 1 and letters == letters.upper()


def _classify_bullet(text: str) -> tuple[str, int]:
    """Strip a leading bullet glyph and report its nesting level."""
    match = BULLET_RE.match(text)
    if match:
        glyph = match.group(1)
        level = 1 if glyph in BULLET_L1 else 2
        return text[match.end():].strip(), level
    if DASH_BULLET_RE.match(text):
        return DASH_BULLET_RE.sub("", text).strip(), 2
    if LETTER_O_BULLET_RE.match(text) and len(text) > 12:
        return LETTER_O_BULLET_RE.sub("", text).strip(), 2
    if NUM_BULLET_RE.match(text) and len(text) > 12:
        return NUM_BULLET_RE.sub("", text).strip(), 1
    return text, 0


def _text_start(row: list[dict], x0: float) -> float:
    """
    Where the words of this row begin once any list marker is skipped.

    The marker is often its own word box ("◦" at 58.5, the sentence at 66.5),
    so the difference between this and the row's own left edge is the hanging
    indent — the exact x a wrapped continuation will start at.
    """
    for word in row:
        raw = (word.get("text") or "").strip()
        if not raw or all(c in BULLET_ANY + "-‐." for c in raw):
            continue
        stripped, _ = _classify_bullet(raw)
        if stripped:
            return round(float(word["x0"]), 2)
    return x0


# ─── Column detection ────────────────────────────────────────────────────────

def _find_gutter(words: list[dict], page_width: float) -> float | None:
    """
    Locate the vertical whitespace band separating two text columns.

    Returns the gutter's centre x, or None for a single-column page.
    """
    if len(words) < 25:
        return None

    bin_size = 2.0
    bins = [0] * (int(page_width / bin_size) + 2)
    for w in words:
        start = max(0, int(w["x0"] / bin_size))
        end = min(len(bins) - 1, int(w["x1"] / bin_size))
        for i in range(start, end + 1):
            bins[i] += 1

    lo = int(page_width * 0.18 / bin_size)
    hi = int(page_width * 0.82 / bin_size)

    best = None
    run_start = None
    for i in range(lo, hi + 2):
        empty = i <= hi and bins[i] == 0
        if empty and run_start is None:
            run_start = i
        elif not empty and run_start is not None:
            width = (i - run_start) * bin_size
            if best is None or width > best[0]:
                best = (width, (run_start + i) / 2 * bin_size)
            run_start = None

    if not best or best[0] < 14:
        return None

    centre = best[1]
    left = [w for w in words if w["x1"] <= centre]
    right = [w for w in words if w["x0"] >= centre]
    if len(left) < 8 or len(right) < 8:
        return None

    def vspan(ws):
        tops = [w["top"] for w in ws]
        return max(tops) - min(tops)

    ls, rs = vspan(left), vspan(right)
    if ls <= 0 or rs <= 0 or min(ls, rs) / max(ls, rs) < 0.45:
        return None

    return centre


# ─── pdfplumber ──────────────────────────────────────────────────────────────

def _font_flags(fontname: str) -> tuple[bool, bool]:
    """Read bold/italic off the embedded PostScript font name."""
    name = (fontname or "").split("+")[-1].lower()
    bold = bool(re.search(r"bold|black|heavy|semib|demi|[-_]bd\b", name))
    italic = bool(re.search(r"italic|oblique|[-_]it\b", name))
    return bold, italic


def _words_to_lines(words: list[dict], page: int, column: int) -> list[Line]:
    """Cluster words sharing a baseline into lines, left to right."""
    if not words:
        return []

    sizes = [w.get("size", 10) for w in words if w.get("size")]
    body_size = statistics.median(sizes) if sizes else 10.0
    tolerance = max(1.5, body_size * 0.5)

    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= tolerance:
            rows[-1].append(w)
        else:
            rows.append([w])

    right_edge = max(w["x1"] for w in words)
    left_edge = min(w["x0"] for w in words)
    col_width = max(1.0, right_edge - left_edge)

    lines: list[Line] = []
    prev_bottom: float | None = None

    for row in rows:
        row.sort(key=lambda w: w["x0"])

        parts: list[str] = []
        prev_w = None
        for w in row:
            if prev_w is not None:
                gap = w["x0"] - prev_w["x1"]
                size = w.get("size", body_size)
                # A large horizontal jump on one baseline means visually
                # separate columns within the line ("Optum      Aug 2025").
                # Keeping that distinct from a space lets the field parser
                # split an employer from its dates without guessing.
                if gap > size * 1.8:
                    parts.append("\t")
                elif gap > size * 0.22:
                    parts.append(" ")
            parts.append(w["text"])
            prev_w = w

        raw = normalise("".join(parts))
        if not raw:
            continue

        text, level = _classify_bullet(raw)
        text = de_space(text) if level == 0 else text
        if not text:
            continue

        bold_chars = sum(len(w["text"]) for w in row if _font_flags(w.get("fontname", ""))[0])
        ital_chars = sum(len(w["text"]) for w in row if _font_flags(w.get("fontname", ""))[1])
        total_chars = sum(len(w["text"]) for w in row) or 1

        top = row[0]["top"]
        x0 = min(w["x0"] for w in row)
        x1 = max(w["x1"] for w in row)
        size = max((w.get("size", body_size) for w in row), default=body_size)

        gap = 0.0
        if prev_bottom is not None:
            gap = max(0.0, (top - prev_bottom) / (body_size * 1.35))

        slack = max(10.0, min(col_width * 0.12, size * 4.5))

        lines.append(Line(
            text=text,
            page=page,
            column=column,
            x0=round(x0, 2),
            x1=round(x1, 2),
            top=round(top, 2),
            size=round(size, 2),
            bold=bold_chars / total_chars > 0.6,
            italic=ital_chars / total_chars > 0.6,
            bullet=level > 0,
            bullet_level=level,
            gap_before=round(gap, 2),
            all_caps=_is_all_caps(text),
            fills_width=x1 >= right_edge - slack,
            text_x0=_text_start(row, round(x0, 2)),
        ))
        prev_bottom = max(w.get("bottom", top) for w in row)

    return lines


def _extract_pdf_pdfplumber(data: bytes) -> Document:
    import pdfplumber

    doc = Document(kind="pdf", method="pdfplumber")

    with pdfplumber.open(BytesIO(data)) as pdf:
        doc.page_count = len(pdf.pages)
        pages = pdf.pages[:MAX_PAGES]

        for index, page in enumerate(pages, start=1):
            try:
                words = page.extract_words(
                    extra_attrs=["fontname", "size"],
                    keep_blank_chars=False,
                    use_text_flow=False,
                )
            except Exception as exc:  # noqa: BLE001 - one bad page must not kill the doc
                doc.warnings.append(f"Page {index} could not be read ({exc.__class__.__name__}).")
                continue

            words = [w for w in words if (w.get("text") or "").strip()]
            if not words:
                continue

            gutter = _find_gutter(words, float(page.width))
            if gutter is None:
                doc.lines.extend(_words_to_lines(words, index, 0))
            else:
                mid = lambda w: (w["x0"] + w["x1"]) / 2  # noqa: E731
                left = [w for w in words if mid(w) < gutter]
                right = [w for w in words if mid(w) >= gutter]
                doc.lines.extend(_words_to_lines(left, index, 0))
                doc.lines.extend(_words_to_lines(right, index, 1))

    return doc


def _extract_pdf_pdfminer(data: bytes) -> Document:
    """Fallback: pdfminer.six layout analysis when pdfplumber finds nothing."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams, LTTextContainer, LTChar

    doc = Document(kind="pdf", method="pdfminer.six")
    laparams = LAParams(line_margin=0.4, char_margin=2.0, word_margin=0.1)

    for index, layout in enumerate(extract_pages(BytesIO(data), laparams=laparams), start=1):
        if index > MAX_PAGES:
            break
        page_height = layout.height
        for element in layout:
            if not isinstance(element, LTTextContainer):
                continue
            for text_line in element:
                raw = normalise(getattr(text_line, "get_text", lambda: "")())
                if not raw:
                    continue
                chars = [c for c in text_line if isinstance(c, LTChar)]
                size = statistics.median([c.size for c in chars]) if chars else 10.0
                fontname = chars[0].fontname if chars else ""
                bold, italic = _font_flags(fontname)
                text, level = _classify_bullet(raw)
                if not text:
                    continue
                doc.lines.append(Line(
                    text=de_space(text) if level == 0 else text,
                    page=index,
                    column=0,
                    x0=round(text_line.x0, 2),
                    x1=round(text_line.x1, 2),
                    top=round(page_height - text_line.y1, 2),
                    size=round(size, 2),
                    bold=bold,
                    italic=italic,
                    bullet=level > 0,
                    bullet_level=level,
                    all_caps=_is_all_caps(text),
                ))
        doc.page_count = index

    return doc


def _extract_pdf_pypdf(data: bytes) -> Document:
    """Last resort: flat text with no geometry at all."""
    from pypdf import PdfReader

    doc = Document(kind="pdf", method="pypdf")
    reader = PdfReader(BytesIO(data), strict=False)
    doc.page_count = len(reader.pages)

    for index, page in enumerate(reader.pages[:MAX_PAGES], start=1):
        try:
            raw = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            continue
        for order, row in enumerate(raw.splitlines()):
            clean = normalise(row)
            if not clean:
                continue
            text, level = _classify_bullet(clean)
            if not text:
                continue
            doc.lines.append(Line(
                text=text,
                page=index,
                top=float(order),
                bullet=level > 0,
                bullet_level=level,
                all_caps=_is_all_caps(text),
            ))
    return doc


# ─── DOCX ────────────────────────────────────────────────────────────────────

_HEADING_SIZES = {1: 20.0, 2: 15.0, 3: 13.0, 4: 12.0, 5: 11.0, 6: 11.0}

# Average glyph width as a fraction of font size, used to give DOCX lines a
# plausible right edge. Word does not store where a line ends — only where it
# starts — so this is an estimate, and it is only ever used for relative
# comparisons (does this line reach the margin?), never as a true measurement.
_CHAR_WIDTH_RATIO = 0.5


def _extract_docx(data: bytes) -> Document:
    """
    Read a DOCX into the geometric line model.

    Uses docx_extractor, which walks WordprocessingML directly. python-docx
    exposes `.paragraphs` and `.tables` as separate lists, so a document that
    interleaves them loses its reading order entirely — headings collapse to
    the top and every table lands after them, filing each job under whichever
    section happened to be last.
    """
    from . import docx_extractor

    doc = Document(kind="docx", method="docx-xml")

    try:
        paras, warnings = docx_extractor.extract_paragraphs(data)
    except Exception as exc:  # noqa: BLE001 - fall back rather than fail
        doc.warnings.append(f"Structured DOCX read failed ({exc.__class__.__name__}); used a simpler reader.")
        return _extract_docx_fallback(data, doc)

    doc.warnings.extend(warnings)

    # A table column becomes a reading column, so a two-column Word layout is
    # segmented the same way a two-column PDF is.
    columns_used = {p.table_col for p in paras if p.in_table}
    multi_column = len(columns_used) > 1

    body_sizes = [p.size for p in paras if p.outline_level == 0 and not p.bold]
    body_size = statistics.median(body_sizes) if body_sizes else 10.5

    bullet_indents: list[float] = []
    glyph_bullets: list[tuple[Line, float]] = []

    for index, para in enumerate(paras):
        text = normalise(para.text)
        if not text:
            continue

        size = _HEADING_SIZES.get(para.outline_level, para.size) if para.outline_level else para.size

        lines_in_column = [q for q in paras if q.table_col == para.table_col] if multi_column else paras
        est_right = max(
            (q.indent_pt + len(q.text) * q.size * _CHAR_WIDTH_RATIO) for q in lines_in_column
        ) if lines_in_column else 0.0

        previous = paras[index - 1] if index else None
        gap = 1.0 if (previous and previous.outline_level and not para.outline_level) else 0.0
        if para.outline_level:
            gap = 1.5

        # A soft break (Shift+Enter, `w:br`) draws a new line exactly as a new
        # paragraph does, and resumes are full of them — people use one to keep
        # two bullets in a single list item. Held together as one Line the whole
        # run of duties collapses into a single sentence and the entries after
        # it lose their boundaries, so each break starts its own line here.
        for piece_index, piece in enumerate(text.split("\n")):
            piece = piece.strip()
            if not piece:
                continue

            glyph_text, glyph_level = _classify_bullet(piece)
            if glyph_level:
                piece = glyph_text
            if not piece:
                continue

            if para.list_level >= 0:
                level = min(2, para.list_level + 1)
            elif glyph_level:
                level = glyph_level
            else:
                level = 0

            if level:
                bullet_indents.append(para.indent_pt)

            # Indentation is real geometry from the file, so bullet nesting and
            # entry hierarchy are measured rather than guessed.
            x0 = para.indent_pt + (12.0 * max(0, level - 1) if level else 0.0)
            x1 = x0 + len(piece) * size * _CHAR_WIDTH_RATIO
            if para.tab_stops and piece_index == 0:
                # A tabbed line runs to its furthest tab stop.
                x1 = max(x1, max(para.tab_stops))

            line = Line(
                text=piece,
                page=1,
                column=para.table_col if multi_column else 0,
                x0=round(x0, 2),
                x1=round(x1, 2),
                # Ordering must stay stable within the paragraph as well as
                # between paragraphs, so each break advances a fraction.
                top=float(para.order) + piece_index / 1000.0,
                size=round(size, 2),
                bold=para.bold or bool(para.outline_level),
                italic=para.italic,
                bullet=level > 0,
                bullet_level=level,
                indent=round(x0, 2),
                gap_before=gap if piece_index == 0 else 0.0,
                all_caps=_is_all_caps(piece),
                fills_width=x1 >= est_right - max(10.0, size * 4.5),
                # Word models a paragraph as a whole, so its text always starts
                # at its own left edge — there is no wrapped remainder to
                # reattach.
                text_x0=round(x0, 2),
            )
            doc.lines.append(line)
            if level and para.list_level < 0:
                glyph_bullets.append((line, para.indent_pt))

    _rank_glyph_bullets(glyph_bullets, bullet_indents)

    if not doc.lines:
        raise ExtractionError(
            "No readable text was found in this Word document.",
            "The file may be empty, or its text may be inside images.",
        )

    doc.page_count = 1
    return doc


def _rank_glyph_bullets(glyph_bullets: list[tuple[Line, float]], indents: list[float]) -> None:
    """
    Demote a typed bullet that sits inside another list.

    A glyph carries no level of its own. A resume that types "•" for both the
    employer and each of its duties is relying on the indent alone to show
    which is which, exactly as a reader does — so a typed bullet set deeper
    than the shallowest bullet in the document is a sub-bullet, whatever
    character was used to draw it. Levels that came from Word's own numbering
    definition are left alone, because there the answer is already recorded.
    """
    if not glyph_bullets or not indents:
        return

    base = min(indents)
    # Half of Word's 0.25" list step: deep enough to be deliberate nesting,
    # shallow enough to catch a list indented by a single tab.
    step = 9.0
    if max(indents) - base < step:
        return  # one level only; nothing to rank

    for line, indent in glyph_bullets:
        if line.bullet_level == 1 and indent >= base + step:
            line.bullet_level = 2
            line.x0 = round(line.x0 + 12.0, 2)
            line.x1 = round(line.x1 + 12.0, 2)
            line.indent = line.x0
            line.text_x0 = line.x0


def _extract_docx_fallback(data: bytes, doc: Document) -> Document:
    """
    Last-resort DOCX read: pull the text out of document.xml directly.

    Used only when the structured reader raises, so a malformed file still
    yields its content rather than nothing.
    """
    import zipfile
    from xml.etree import ElementTree as ET

    doc.method = "docx-fallback"
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(
            "This DOCX could not be read.",
            f"{exc.__class__.__name__}: {exc}",
        ) from exc

    order = 0
    for paragraph in root.iter(f"{ns}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{ns}t":
                parts.append(node.text or "")
            elif node.tag == f"{ns}tab":
                parts.append("\t")
            elif node.tag in (f"{ns}br", f"{ns}cr"):
                parts.append("\n")
        raw = normalise("".join(parts))
        if not raw:
            continue
        for piece in raw.split("\n"):
            text, level = _classify_bullet(piece.strip())
            if not text:
                continue
            doc.lines.append(Line(
                text=text, page=1, top=float(order), size=10.5,
                bullet=level > 0, bullet_level=level, all_caps=_is_all_caps(text),
            ))
            order += 1

    if not doc.lines:
        raise ExtractionError(
            "No readable text was found in this Word document.",
            "The file may be empty, or its text may be inside images.",
        )
    return doc


# ─── Public API ──────────────────────────────────────────────────────────────

def _line_count_is_usable(doc: Document) -> bool:
    """Enough real content to be worth parsing?"""
    if not doc.lines:
        return False
    chars = sum(len(line.text) for line in doc.lines)
    return chars >= 120


def extract(data: bytes, kind: str, *, allow_ocr: bool = True) -> Document:
    """
    Extract a document into the line model.

    Args:
        data: validated file bytes.
        kind: 'pdf' or 'docx', as determined by the validator.
        allow_ocr: run OCR when a PDF has no text layer.

    Returns:
        Document with at least one line.

    Raises:
        ExtractionError: nothing readable could be produced.
    """
    if kind == "docx":
        doc = _extract_docx(data)
        if not _line_count_is_usable(doc):
            raise ExtractionError(
                "No readable text was found in this Word document.",
                "The file may be empty, or its text may be inside images.",
            )
        return doc

    attempts = (
        ("pdfplumber", _extract_pdf_pdfplumber),
        ("pdfminer.six", _extract_pdf_pdfminer),
        ("pypdf", _extract_pdf_pypdf),
    )

    failures: list[str] = []
    best: Document | None = None

    for name, fn in attempts:
        try:
            doc = fn(data)
        except Exception as exc:  # noqa: BLE001 - try the next extractor
            failures.append(f"{name}: {exc.__class__.__name__}")
            continue
        if _line_count_is_usable(doc):
            if failures:
                doc.warnings.append("Recovered using " + name + " after " + "; ".join(failures) + ".")
            return doc
        if best is None or len(doc.lines) > len(best.lines):
            best = doc

    # No text layer anywhere — this is a scan.
    if allow_ocr:
        from . import ocr

        if ocr.available():
            doc = ocr.extract_pdf(data)
            if _line_count_is_usable(doc):
                return doc
            raise ExtractionError(
                "This looks like a scanned document, and OCR could not read any text from it.",
                "Try a higher-resolution scan, or upload the original text PDF or DOCX.",
            )
        raise ExtractionError(
            "This PDF has no selectable text — it looks like a scan or an image-only export.",
            ocr.unavailable_reason(),
        )

    raise ExtractionError(
        "No selectable text could be extracted from this PDF.",
        "It may be a scanned image. Upload a text PDF or the DOCX instead.",
    )


class ExtractionError(Exception):
    """Nothing readable could be extracted, with a user-facing explanation."""

    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.message = message
        self.hint = hint
