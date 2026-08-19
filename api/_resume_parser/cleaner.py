"""
Stage 3 — DataCleaner.

Repairs the artefacts that document extraction always produces, so that later
stages reason about content rather than about layout accidents:

  - page furniture (running headers, footers, page numbers) removed
  - words split across a line break by hyphenation rejoined
  - lines the page broke mid-sentence rejoined into one logical line
  - date ranges reassembled after a wide gap split them
  - control characters and duplicated whitespace removed

Everything here is conservative: when a repair is ambiguous the original text
is kept, because a wrong join is much harder to recover from downstream than a
line that is merely split.
"""

from __future__ import annotations

import re
from collections import Counter

from .extractor import Line, Document, normalise

PAGE_NUMBER_PATTERNS = [
    re.compile(r"^page\s+\d+(\s+of\s+\d+)?$", re.I),
    re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$"),
    re.compile(r"^[-–—\s]*\d{1,3}[-–—\s]*$"),
    re.compile(r"^page\s+\d+$", re.I),
]

# Text that resumes carry but that is never a field worth parsing.
NOISE_PATTERNS = [
    re.compile(r"^references\s+available\s+upon\s+request\.?$", re.I),
    re.compile(r"^curriculum\s+vitae$", re.I),
    re.compile(r"^resume$", re.I),
    re.compile(r"^confidential$", re.I),
    # A line of only punctuation, or a typographic rule. Underscores are not
    # \\W, so a "______" divider has to be named explicitly.
    re.compile(r"^[\\W_]+$"),
]

MONTHS = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?"
    r"|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)


def _drop_page_furniture(lines: list[Line]) -> list[Line]:
    """
    Remove page numbers and any short line repeated on three or more pages.

    Requiring repetition across *pages* rather than mere repetition protects
    genuinely repeated content — "Environment: Python, ..." appears under every
    job in some resumes and must survive.
    """
    by_text: dict[str, set[int]] = {}
    for line in lines:
        by_text.setdefault(line.text.strip().lower(), set()).add(line.page)

    kept: list[Line] = []
    for line in lines:
        text = line.text.strip()
        if not text:
            continue
        if any(p.match(text) for p in PAGE_NUMBER_PATTERNS):
            continue
        if any(p.match(text) for p in NOISE_PATTERNS):
            continue
        pages = by_text.get(text.lower(), set())
        if len(pages) >= 3 and len(text) < 70:
            continue
        kept.append(line)
    return kept


def _dehyphenate(lines: list[Line]) -> list[Line]:
    """
    Rejoin a word split across lines: "Python-" + "based" -> "Python-based".

    The hyphen is kept when both halves are themselves words (a real compound)
    and dropped when the first half is a fragment, which is what a purely
    typographic break produces.
    """
    out: list[Line] = []
    skip_next_prefix = ""

    for line in lines:
        text = line.text
        if skip_next_prefix:
            match = re.match(r"^(\S+)(.*)$", text)
            if match:
                head, rest = match.group(1), match.group(2)
                text = skip_next_prefix + head + rest
            else:
                text = skip_next_prefix + text
            skip_next_prefix = ""

        match = re.search(r"(\w{2,})-$", text)
        if match and line is not lines[-1]:
            stem = match.group(1)
            # Keep the hyphen for a real compound ("state-", "cross-"), drop it
            # when the stem looks like half a word.
            keep_hyphen = len(stem) <= 4 or stem.lower() in {
                "cross", "multi", "self", "well", "high", "low", "non", "pre",
                "post", "anti", "sub", "inter", "intra", "over", "under", "re",
            }
            skip_next_prefix = text[: match.start(1)] + stem + ("-" if keep_hyphen else "")
            continue

        new_line = _replace_text(line, text)
        out.append(new_line)

    if skip_next_prefix and out:
        out[-1] = _replace_text(out[-1], out[-1].text + skip_next_prefix)

    return out


def _replace_text(line: Line, text: str) -> Line:
    line.text = normalise(text)
    line.all_caps = bool(re.sub(r"[^A-Za-z]", "", line.text)) and \
        re.sub(r"[^A-Za-z]", "", line.text) == re.sub(r"[^A-Za-z]", "", line.text).upper()
    return line


def _repair_split_dates(lines: list[Line]) -> list[Line]:
    """
    Reassemble a date range that a wide gap or OCR turned into fragments.

    "March 2019\t- Present" and "June 2016\t- February 2019" are one range that
    the layout split; a tab in the middle of a date is never meaningful.
    """
    range_across_tab = re.compile(
        rf"((?:{MONTHS})\.?\s*,?\s*\d{{4}}|\d{{4}})\s*\t\s*([-–—]\s*)",
        re.I,
    )
    tail_across_tab = re.compile(
        rf"([-–—])\s*\t\s*((?:{MONTHS})\.?\s*,?\s*\d{{4}}|\d{{4}}|present|current)",
        re.I,
    )

    for line in lines:
        text = line.text
        text = range_across_tab.sub(r"\1 \2", text)
        text = tail_across_tab.sub(r"\1 \2", text)
        # OCR frequently reads a wide gap as a pipe or a broken bar.
        text = re.sub(r"\s*\|\s*(?=(?:%s)\.?\s*\d{4})" % MONTHS, "\t", text, flags=re.I)
        if text != line.text:
            _replace_text(line, text)
    return lines


def _next_word_would_not_fit(prev: Line, nxt: Line) -> bool:
    """
    Self-calibrating wrap test: would the next line's first word have fitted on
    the end of the previous line?

    A fixed "did it reach the right margin" threshold cannot work across
    layouts — a narrow sidebar's ragged edge is a few points, a full-width
    column's is tens of points. Measuring the specific word that would have had
    to fit adapts to both.
    """
    if not nxt.text or nxt.x1 <= nxt.x0:
        return False
    per_char = (nxt.x1 - nxt.x0) / max(1, len(nxt.text))
    first_word = nxt.text.split()[0] if nxt.text.split() else ""
    needed = per_char * (len(first_word) + 1)

    # Measure against the column's right margin, not against these two lines.
    # Using max(prev.x1, nxt.x1) is degenerate whenever the previous line is
    # the longer of the pair: the margin then equals prev.x1, so *any* next
    # word "does not fit" and every following line looks like a wrap.
    right_edge = prev.col_right or max(prev.x1, nxt.x1)
    return prev.x1 + needed > right_edge + per_char * 0.5


_DATEISH = re.compile(rf"(?:{MONTHS})\.?\s*,?\s*\d{{4}}|\b(?:19|20)\d{{2}}\b|present|current", re.I)


def _starts_new_field(prev: Line, nxt: Line) -> bool:
    """
    Does the line under this top-level bullet begin a new field?

    A filled bullet is read as an entry header because some resumes put the
    employer on one and each duty on a nested sub-bullet — there the line
    beneath is the job title, a separate field. But most resumes use a single
    bullet for everything, and there the line beneath is simply the rest of a
    sentence the page ran out of room for.

    The two are told apart by length. An entry header is a label — an employer
    and its dates, a project name — and stays short; a bullet long enough to
    have wrapped is a sentence, and what follows it is the rest of that
    sentence. Case is not reliable here: a wrapped line can easily resume on a
    proper noun ("...integrated ArgoCD for" / "GitOps based delivery").
    """
    if not prev.bullet or prev.bullet_level != 1:
        return False
    return len(prev.text) <= 60


def _continues_hanging_indent(prev: Line, nxt: Line) -> bool:
    """
    Does this line start exactly where the previous list item's *text* does?

    A hanging indent puts the marker at the item's left edge and the text a
    few points to its right, and a wrapped continuation aligns with the text,
    never with the marker. That alignment is measured geometry rather than an
    estimate, so it settles the cases where "would the next word have fitted?"
    lands within a point of the margin and gets them wrong.
    """
    hang = prev.text_x0 - prev.x0
    if hang <= 1.0:
        return False  # no hanging indent here, so alignment proves nothing
    return abs(nxt.x0 - prev.text_x0) <= 1.5


def _compute_column_edges(lines: list[Line]) -> list[Line]:
    """
    Record each column's right margin on every line in it.

    The margin is where the longest line in that column ends, which is the
    only reliable reference for "did this line run out of room?".
    """
    groups: dict[tuple[int, int], list[Line]] = {}
    for line in lines:
        groups.setdefault((line.page, line.column), []).append(line)

    for group in groups.values():
        right = max((l.x1 for l in group), default=0.0)
        for line in group:
            line.col_right = right
    return lines


def _join_wrapped(lines: list[Line], geometric: bool) -> list[Line]:
    """
    Rejoin lines that the page width broke mid-sentence.

    A PDF has no concept of a paragraph: "…improving response accuracy by" and
    "38%." are two independent lines. Left split they become two bullets, one
    of them a fragment.
    """
    if not geometric:
        return lines

    out: list[Line] = []
    for line in lines:
        if not out:
            out.append(line)
            continue

        prev = out[-1]
        same_block = prev.page == line.page and prev.column == line.column
        same_indent = abs(prev.x0 - line.x0) <= 3.0
        similar_size = abs(prev.size - line.size) / max(prev.size, line.size, 1) < 0.12
        tight = line.gap_before < 0.6

        # A bullet always starts something new; so does a heading. A level-1
        # bullet is an entry header ("• Optum"), and the line under it is the
        # job title or the degree — a separate field, never a continuation.
        structural = line.bullet or line.heading or prev.heading or _starts_new_field(prev, line)
        has_columns = "\t" in prev.text or "\t" in line.text

        prev_ran_out = prev.fills_width or _next_word_would_not_fit(prev, line)
        not_new_sentence = not re.search(r"[.!?]$", prev.text) or bool(re.match(r"^[a-z(]", line.text))
        # A line ending in a year followed by a capitalised line is two
        # finished list items, not one wrapped item.
        completed_dated = bool(re.search(r"\b(?:19|20)\d{2}\)?$", prev.text)) and bool(re.match(r"^[A-Z]", line.text))

        should_join = (
            same_block and same_indent and similar_size and tight
            and prev_ran_out and not_new_sentence and not completed_dated
            and not structural and not has_columns
            and len(prev.text) > 24
        )

        if should_join:
            _replace_text(prev, f"{prev.text} {line.text}")
        else:
            out.append(line)

    return out


def _join_wrapped_bullets(lines: list[Line]) -> list[Line]:
    """
    Fold a bullet's continuation lines into the bullet itself.

    A wrapped bullet's continuation carries no glyph and sits at the bullet's
    text indent rather than the glyph indent, so it would otherwise read as
    body prose belonging to the section instead of to the bullet.
    """
    out: list[Line] = []
    for line in lines:
        prev = out[-1] if out else None
        if (
            prev is not None
            and prev.bullet
            and not line.bullet
            and not line.heading
            # Under an entry header the next line is the job title — a
            # separate field, never a wrap.
            and not _starts_new_field(prev, line)
            # A header split into visual columns ("Optum <gap> Aug 2025") is
            # structured, so the next line starts something new.
            and "\t" not in prev.text
            and prev.page == line.page
            and prev.column == line.column
            and line.gap_before < 0.6
            and abs(prev.size - line.size) / max(prev.size, line.size, 1) < 0.12
            # The continuation is indented to at least the bullet's own text.
            and line.x0 >= prev.x0 - 2.0
            and (
                prev.fills_width
                or _next_word_would_not_fit(prev, line)
                or _continues_hanging_indent(prev, line)
            )
            and not re.search(r"[.!?]$", prev.text)
        ):
            _replace_text(prev, f"{prev.text} {line.text}")
            prev.x1 = max(prev.x1, line.x1)
            continue
        out.append(line)
    return out


def _infer_bullets_from_indent(lines: list[Line]) -> list[Line]:
    """
    Recover bullets whose glyph never reached the text layer.

    Several PDF producers (Chromium's print-to-PDF among them) draw list
    markers as vector paths, so the only remaining signal is that list items
    sit further right than body text.
    """
    groups: dict[tuple[int, int], list[Line]] = {}
    for line in lines:
        groups.setdefault((line.page, line.column), []).append(line)

    for group in groups.values():
        if any(l.bullet for l in group):
            continue  # real glyphs exist here; do not second-guess them
        tally = Counter(round(l.x0 / 2) * 2 for l in group)
        if not tally:
            continue
        base = min((indent for indent, count in tally.items() if count == max(tally.values())), default=0)
        sizes = [l.size for l in group] or [10.0]
        threshold = base + max(5.0, (sum(sizes) / len(sizes)) * 0.45)
        for line in group:
            if not line.heading and line.x0 >= threshold:
                line.bullet = True
                line.bullet_level = 2
    return lines


def clean(document: Document) -> Document:
    """
    Run the cleaning stages in order.

    Order is deliberate: furniture goes first so repeated-line detection is not
    confused by joins; hyphenation is repaired before wrapping so the rejoined
    word is measured correctly; bullets are inferred last so a fragment cannot
    skew the indent histogram.
    """
    # Only sources with real page coordinates may use the geometric wrap test.
    # python-docx and plain text model paragraphs natively (there is nothing to
    # rejoin), and their synthetic x-positions would make the "did this line
    # run out of room?" measurement meaningless. pypdf reports no geometry at
    # all.
    geometric = document.method not in {"pypdf", "python-docx", "plaintext"}

    lines = _drop_page_furniture(document.lines)
    lines = _compute_column_edges(lines)
    lines = _dehyphenate(lines)
    lines = _repair_split_dates(lines)
    lines = _join_wrapped(lines, geometric)
    lines = _join_wrapped_bullets(lines)
    lines = _infer_bullets_from_indent(lines)
    lines = [l for l in lines if l.text.strip()]

    document.lines = lines
    return document
