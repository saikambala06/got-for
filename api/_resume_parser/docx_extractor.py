"""
Real DOCX extractor — reads WordprocessingML directly.

`python-docx` is convenient but models a document as two independent lists:
`.paragraphs` and `.tables`. A resume that interleaves them — a heading, a
table of roles, another heading, another table — comes back with every heading
first and every table afterwards. Sections then swallow the wrong content: in
testing, all of a candidate's jobs were filed under "EDUCATION" and the
employer was read as their email address.

`paragraph.text` also drops anything that is not a plain run: tabs (`w:tab`),
soft line breaks (`w:br`), and symbol characters. And run formatting read
directly is `None` whenever it is inherited from a style, so headings set by
style alone look like body text.

This module walks `word/document.xml` in true document order and resolves:

  - paragraphs, tables, content controls and text boxes, interleaved correctly
  - hyperlink targets from the relationship part
  - `w:tab` as a column separator and `w:br` as a real line break
  - bold / italic / size resolved through run -> paragraph style -> defaults
  - list level and marker style from `w:numPr` and `numbering.xml`
  - indentation and tab stops as genuine geometry, in points

The result is the same `Line` model the PDF path produces, so everything
downstream — cleaner, segmenter, NER — behaves identically for both formats.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"

TWIPS_PER_POINT = 20.0        # Word measures indents in twentieths of a point
HALF_POINTS = 2.0             # and font sizes in half-points

# Symbol-font code points used as bullets by Word's default list templates.
# Wingdings 0xF0B7 is the filled round bullet; 0xF06F / 0xF0A7 are hollow and
# square sub-bullets.
SYMBOL_BULLETS = {"F0B7", "F0A7", "F06F", "F075", "F0D8", "F0FC", "F0A8"}


_DATEISH = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}"
    r"|\b(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b",
    re.I,
)


def _looks_dated(text: str) -> bool:
    """Does this cell carry a date? The signal that a row is a dated entry."""
    return bool(_DATEISH.search(text or ""))


@dataclass
class Para:
    """One resolved paragraph, before it becomes a Line."""

    text: str
    style: str = ""
    outline_level: int = 0        # from a Heading N style
    bold: bool = False
    italic: bool = False
    size: float = 10.5
    indent_pt: float = 0.0
    list_level: int = -1          # -1 = not a list item
    list_is_bullet: bool = True
    order: int = 0
    in_table: bool = False
    table_col: int = 0
    tab_stops: tuple = ()


def _first(el, tag):
    return el.find(tag) if el is not None else None


def _attr(el, name, default=None):
    if el is None:
        return default
    return el.get(name, default)


def _on(el) -> bool | None:
    """
    Read an OOXML toggle such as `w:b` or `w:i`.

    Absent means "not specified here, inherit"; present with val 0/false means
    explicitly off. Returning None for absent is what makes style inheritance
    work — treating it as False would make every inherited bold disappear.
    """
    if el is None:
        return None
    val = el.get(f"{W}val")
    if val is None:
        return True
    return val not in {"0", "false", "off"}


class DocxReader:
    """Reads the parts of a .docx needed to reconstruct its visual structure."""

    def __init__(self, data: bytes):
        self.zip = zipfile.ZipFile(BytesIO(data))
        self.rels: dict[str, str] = {}
        self.styles: dict[str, dict] = {}
        self.style_parent: dict[str, str] = {}
        self.doc_defaults: dict = {"bold": False, "italic": False, "size": 10.5}
        self.numbering: dict[tuple[str, int], dict] = {}
        self._load_rels()
        self._load_styles()
        self._load_numbering()

    # ── Parts ────────────────────────────────────────────────────────────

    def _read(self, name: str):
        try:
            return ET.fromstring(self.zip.read(name))
        except (KeyError, ET.ParseError):
            return None

    def _load_rels(self) -> None:
        root = self._read("word/_rels/document.xml.rels")
        if root is None:
            return
        for rel in root:
            rid = rel.get("Id")
            target = rel.get("Target")
            if rid and target:
                self.rels[rid] = target

    def _load_styles(self) -> None:
        root = self._read("word/styles.xml")
        if root is None:
            return

        defaults = _first(root, f"{W}docDefaults")
        if defaults is not None:
            rpr = _first(_first(defaults, f"{W}rPrDefault"), f"{W}rPr")
            resolved = self._read_rpr(rpr)
            self.doc_defaults = {
                "bold": bool(resolved.get("bold")),
                "italic": bool(resolved.get("italic")),
                "size": resolved.get("size") or 10.5,
            }

        for style in root.findall(f"{W}style"):
            style_id = style.get(f"{W}styleId")
            if not style_id:
                continue
            based_on = _attr(_first(style, f"{W}basedOn"), f"{W}val")
            if based_on:
                self.style_parent[style_id] = based_on

            name = _attr(_first(style, f"{W}name"), f"{W}val", "") or ""
            ppr = _first(style, f"{W}pPr")
            outline = _attr(_first(ppr, f"{W}outlineLvl"), f"{W}val") if ppr is not None else None

            entry = self._read_rpr(_first(style, f"{W}rPr"))
            entry["name"] = name
            entry["outline"] = int(outline) + 1 if outline is not None and outline.isdigit() else 0
            if ppr is not None:
                ind = _first(ppr, f"{W}ind")
                if ind is not None:
                    entry["indent"] = self._indent_pt(ind)
                numpr = _first(ppr, f"{W}numPr")
                if numpr is not None:
                    entry["numId"] = _attr(_first(numpr, f"{W}numId"), f"{W}val")
                    entry["ilvl"] = _attr(_first(numpr, f"{W}ilvl"), f"{W}val")
            self.styles[style_id] = entry

    def _load_numbering(self) -> None:
        """Map numId + level to its marker format and indent."""
        root = self._read("word/numbering.xml")
        if root is None:
            return

        abstract: dict[str, dict[int, dict]] = {}
        for node in root.findall(f"{W}abstractNum"):
            aid = node.get(f"{W}abstractNumId")
            levels: dict[int, dict] = {}
            for lvl in node.findall(f"{W}lvl"):
                try:
                    index = int(lvl.get(f"{W}ilvl", "0"))
                except ValueError:
                    continue
                fmt = _attr(_first(lvl, f"{W}numFmt"), f"{W}val", "bullet")
                ind = _first(_first(lvl, f"{W}pPr"), f"{W}ind")
                levels[index] = {
                    "bullet": fmt == "bullet",
                    "indent": self._indent_pt(ind) if ind is not None else None,
                }
            if aid:
                abstract[aid] = levels

        for node in root.findall(f"{W}num"):
            num_id = node.get(f"{W}numId")
            aid = _attr(_first(node, f"{W}abstractNumId"), f"{W}val")
            if not num_id or aid not in abstract:
                continue
            for index, info in abstract[aid].items():
                self.numbering[(num_id, index)] = info

    # ── Property resolution ──────────────────────────────────────────────

    @staticmethod
    def _indent_pt(ind) -> float:
        """Effective left indent in points, accounting for a hanging indent."""
        if ind is None:
            return 0.0
        try:
            left = float(ind.get(f"{W}left") or ind.get(f"{W}start") or 0)
        except ValueError:
            left = 0.0
        try:
            hanging = float(ind.get(f"{W}hanging") or 0)
        except ValueError:
            hanging = 0.0
        # A hanging indent pulls the first line back to where the marker sits,
        # which is the x-position a reader perceives as the item's left edge.
        return max(0.0, (left - hanging) / TWIPS_PER_POINT)

    def _read_rpr(self, rpr) -> dict:
        """Read a run-properties element into plain values."""
        out: dict = {}
        if rpr is None:
            return out
        out["bold"] = _on(_first(rpr, f"{W}b"))
        out["italic"] = _on(_first(rpr, f"{W}i"))
        out["caps"] = _on(_first(rpr, f"{W}caps"))
        size = _attr(_first(rpr, f"{W}sz"), f"{W}val")
        if size:
            try:
                out["size"] = float(size) / HALF_POINTS
            except ValueError:
                pass
        return out

    def resolve_style(self, style_id: str | None) -> dict:
        """Walk the basedOn chain so inherited formatting is not lost."""
        resolved: dict = {}
        seen = set()
        current = style_id
        chain = []
        while current and current not in seen:
            seen.add(current)
            chain.append(current)
            current = self.style_parent.get(current)

        # Apply from the most distant ancestor down, so nearer wins.
        for sid in reversed(chain):
            entry = self.styles.get(sid)
            if not entry:
                continue
            for key, value in entry.items():
                if value is not None:
                    resolved[key] = value
        return resolved


class BodyWalker:
    """Walks the document body in order, emitting paragraphs."""

    def __init__(self, reader: DocxReader):
        self.reader = reader
        self.paras: list[Para] = []
        self.order = 0

    # ── Inline content ───────────────────────────────────────────────────

    def _run_text(self, run) -> str:
        """
        Serialise one run, preserving structure `paragraph.text` throws away.

        `w:tab` becomes a real tab, which the field parser relies on to split
        an employer from its dates. `w:br` becomes a newline so a soft break
        inside one paragraph is treated as two lines, which is how it looks.
        """
        parts: list[str] = []
        for child in run:
            tag = child.tag
            if tag == f"{W}t":
                parts.append(child.text or "")
            elif tag == f"{W}tab":
                parts.append("\t")
            elif tag in (f"{W}br", f"{W}cr"):
                parts.append("\n")
            elif tag == f"{W}noBreakHyphen":
                parts.append("-")
            elif tag == f"{W}softHyphen":
                pass
            elif tag == f"{W}sym":
                char = (child.get(f"{W}char") or "").upper()
                # A symbol-font bullet is a marker, not content.
                parts.append("" if char in SYMBOL_BULLETS else "•")
        return "".join(parts)

    def _collect_runs(self, container, hyperlinks: list[str]) -> tuple[str, list[tuple[str, dict]]]:
        """
        Gather text and per-run formatting, descending through wrappers.

        Hyperlinks matter: their runs live inside `w:hyperlink`, not directly
        under the paragraph, so anything that only reads `w:r` children loses
        every linked LinkedIn or portfolio URL.
        """
        text_parts: list[str] = []
        formatted: list[tuple[str, dict]] = []

        for child in container:
            tag = child.tag
            if tag == f"{W}r":
                text = self._run_text(child)
                if text:
                    text_parts.append(text)
                    formatted.append((text, self.reader._read_rpr(_first(child, f"{W}rPr"))))
            elif tag == f"{W}hyperlink":
                rid = child.get(f"{R}id")
                target = self.reader.rels.get(rid) if rid else None
                if target:
                    hyperlinks.append(target)
                inner_text, inner_fmt = self._collect_runs(child, hyperlinks)
                if inner_text:
                    text_parts.append(inner_text)
                    formatted.extend(inner_fmt)
            elif tag in (f"{W}smartTag", f"{W}ins", f"{W}sdt", f"{W}sdtContent", f"{W}bookmarkStart"):
                inner_text, inner_fmt = self._collect_runs(child, hyperlinks)
                if inner_text:
                    text_parts.append(inner_text)
                    formatted.extend(inner_fmt)
            elif tag == f"{W}fldSimple":
                inner_text, inner_fmt = self._collect_runs(child, hyperlinks)
                if inner_text:
                    text_parts.append(inner_text)
                    formatted.extend(inner_fmt)
            elif tag == f"{W}del":
                # Tracked deletion — not part of the visible document.
                continue

        return "".join(text_parts), formatted

    # ── Paragraph ────────────────────────────────────────────────────────

    def _emit_paragraph(self, p, in_table: bool, table_col: int) -> None:
        hyperlinks: list[str] = []
        raw, formatted = self._collect_runs(p, hyperlinks)

        ppr = _first(p, f"{W}pPr")
        style_id = _attr(_first(ppr, f"{W}pStyle"), f"{W}val") if ppr is not None else None
        style = self.reader.resolve_style(style_id)
        style_name = str(style.get("name") or style_id or "")

        outline = int(style.get("outline") or 0)
        match = re.match(r"heading\s*(\d)", style_name.lower())
        if match:
            outline = int(match.group(1))
        elif style_name.lower() == "title":
            outline = 1

        # Numbering: paragraph-level overrides the style's.
        num_id = ilvl = None
        if ppr is not None:
            numpr = _first(ppr, f"{W}numPr")
            if numpr is not None:
                num_id = _attr(_first(numpr, f"{W}numId"), f"{W}val")
                ilvl = _attr(_first(numpr, f"{W}ilvl"), f"{W}val")
        if num_id is None:
            num_id = style.get("numId")
            ilvl = style.get("ilvl")

        list_level = -1
        list_is_bullet = True
        if num_id and num_id != "0":
            try:
                list_level = int(ilvl) if ilvl is not None else 0
            except ValueError:
                list_level = 0
            info = self.reader.numbering.get((str(num_id), list_level))
            if info:
                list_is_bullet = bool(info.get("bullet", True))

        # Indent: explicit wins, then the numbering definition, then the style.
        indent_pt = None
        if ppr is not None:
            ind = _first(ppr, f"{W}ind")
            if ind is not None:
                indent_pt = self.reader._indent_pt(ind)
        if indent_pt is None and num_id:
            info = self.reader.numbering.get((str(num_id), max(0, list_level)))
            if info and info.get("indent") is not None:
                indent_pt = info["indent"]
        if indent_pt is None:
            indent_pt = float(style.get("indent") or 0.0)

        tab_stops: list[float] = []
        if ppr is not None:
            tabs = _first(ppr, f"{W}tabs")
            if tabs is not None:
                for tab in tabs.findall(f"{W}tab"):
                    try:
                        tab_stops.append(float(tab.get(f"{W}pos") or 0) / TWIPS_PER_POINT)
                    except ValueError:
                        pass

        # Resolve formatting: run properties over style over document defaults.
        defaults = self.reader.doc_defaults
        total = sum(len(t) for t, _ in formatted) or 1

        def weighted(key: str) -> bool:
            hits = 0
            for text, props in formatted:
                value = props.get(key)
                if value is None:
                    value = style.get(key)
                if value is None:
                    value = defaults.get(key)
                if value:
                    hits += len(text)
            return hits / total > 0.6

        bold = weighted("bold")
        italic = weighted("italic")

        sizes = [p.get("size") for _, p in formatted if p.get("size")]
        if sizes:
            size = max(sizes)
        elif style.get("size"):
            size = float(style["size"])
        else:
            size = float(defaults.get("size") or 10.5)

        # A soft break inside one paragraph is two visual lines.
        for piece in raw.split("\n"):
            text = piece.strip()
            if not text and not hyperlinks:
                continue
            if not text:
                continue
            self.paras.append(Para(
                text=text,
                style=style_name,
                outline_level=outline,
                bold=bold,
                italic=italic,
                size=size,
                indent_pt=indent_pt,
                list_level=list_level,
                list_is_bullet=list_is_bullet,
                order=self.order,
                in_table=in_table,
                table_col=table_col,
                tab_stops=tuple(tab_stops),
            ))
            self.order += 1

        # A hyperlink whose visible text is not the URL would otherwise lose
        # the address entirely ("LinkedIn Profile" -> no link).
        for target in hyperlinks:
            if not target or target.startswith("#"):
                continue
            visible = target.replace("mailto:", "")
            if visible.lower() in raw.lower():
                continue
            self.paras.append(Para(
                text=visible,
                style=style_name,
                size=size,
                indent_pt=indent_pt,
                order=self.order,
                in_table=in_table,
                table_col=table_col,
            ))
            self.order += 1

    # ── Containers ───────────────────────────────────────────────────────

    def walk(self, container, in_table: bool = False, table_col: int = 0) -> None:
        """Walk a body or cell, preserving the order elements appear in."""
        for child in container:
            tag = child.tag

            if tag == f"{W}p":
                self._emit_paragraph(child, in_table, table_col)
                # Text boxes are anchored inside a paragraph's drawing.
                self._walk_textboxes(child, in_table, table_col)

            elif tag == f"{W}tbl":
                self._walk_table(child)

            elif tag in (f"{W}sdt",):
                content = _first(child, f"{W}sdtContent")
                if content is not None:
                    self.walk(content, in_table, table_col)

            elif tag == f"{MC}AlternateContent":
                chosen = _first(child, f"{MC}Fallback") or _first(child, f"{MC}Choice")
                if chosen is not None:
                    self.walk(chosen, in_table, table_col)

    def _walk_table(self, tbl) -> None:
        """
        Read a table row by row, left to right, in place.

        Reading it in place is the whole point: many Word resume templates lay
        the entire document out in tables, and appending table content after
        all the paragraphs puts every job under the wrong heading.

        Two table shapes need different handling:

        * **A row that is one visual line** — each cell holds a single
          paragraph, as in "Senior Engineer | Mar 2021 - Present". That is the
          same thing a PDF renders as one baseline with a wide gap, so the
          cells are joined with a tab and the field parser splits the role from
          the dates exactly as it does for a PDF.
        * **A sidebar layout** — one row whose cells each hold many paragraphs.
          Those really are separate reading columns, and are marked as such so
          the segmenter reads each top to bottom instead of interleaving them.
        """
        rows = tbl.findall(f"{W}tr")

        # A single row of content-heavy cells is a page layout, not a data row.
        if len(rows) == 1:
            cells = rows[0].findall(f"{W}tc")
            if len(cells) >= 2:
                counts = [len(cell.findall(f"{W}p")) for cell in cells]
                if all(count >= 5 for count in counts):
                    for index, cell in enumerate(cells):
                        self.walk(cell, in_table=True, table_col=index)
                    return

        for row in rows:
            cells = row.findall(f"{W}tc")
            if not cells:
                continue

            start = len(self.paras)
            spans: list[tuple[int, int]] = []
            for index, cell in enumerate(cells):
                cell_start = len(self.paras)
                self.walk(cell, in_table=True, table_col=index)
                spans.append((cell_start, len(self.paras)))

            produced = [self.paras[a:b] for a, b in spans]
            non_empty = [group for group in produced if group]

            # Join a one-line-per-cell row into a single tab-separated line —
            # but only when it really is one visual line. A "SKILLS | Python,
            # SQL, …" label row is two different things, and merging it hides
            # the section heading inside the content, so the section is lost.
            mergeable = (
                len(non_empty) >= 2
                and all(len(group) == 1 for group in non_empty)
                and all(len(group[0].text) <= 60 for group in non_empty)
                and any(_looks_dated(group[0].text) for group in non_empty)
            )

            if mergeable:
                merged = non_empty[0][0]
                merged.text = "\t".join(group[0].text for group in non_empty)
                merged.table_col = 0
                # Any cell being bold marks the whole line, matching how a PDF
                # reports a mixed-weight baseline.
                merged.bold = any(group[0].bold for group in non_empty)
                merged.size = max(group[0].size for group in non_empty)
                del self.paras[start:]
                merged.order = self.order = start
                self.paras.append(merged)
                self.order = start + 1
            else:
                # Keep the cells in order but as one reading column: a layout
                # table's cells belong to the same entry, not to separate flows.
                for group in produced:
                    for para in group:
                        para.table_col = 0

    def _walk_textboxes(self, node, in_table: bool, table_col: int) -> None:
        for txbx in node.iter(f"{W}txbxContent"):
            self.walk(txbx, in_table, table_col)


def _read_part_paragraphs(reader: DocxReader, name: str) -> list[Para]:
    root = reader._read(name)
    if root is None:
        return []
    walker = BodyWalker(reader)
    walker.walk(root)
    return walker.paras


def extract_paragraphs(data: bytes) -> tuple[list[Para], list[str]]:
    """
    Read a .docx into ordered paragraphs.

    Returns the paragraphs and any warnings worth surfacing.
    """
    warnings: list[str] = []
    reader = DocxReader(data)

    root = reader._read("word/document.xml")
    if root is None:
        raise ValueError("This DOCX has no readable document body.")

    body = _first(root, f"{W}body")
    if body is None:
        raise ValueError("This DOCX has no document body.")

    walker = BodyWalker(reader)
    walker.walk(body)
    paras = walker.paras

    # Some templates put the name and contact details in a page header.
    header_names = sorted(n for n in reader.zip.namelist() if re.match(r"word/header\d*\.xml$", n))
    header_paras: list[Para] = []
    for name in header_names[:2]:
        header_paras.extend(_read_part_paragraphs(reader, name))
    if header_paras:
        for index, para in enumerate(header_paras):
            para.order = -len(header_paras) + index
        paras = header_paras + paras
        warnings.append("Content from the page header was included.")

    if not paras:
        raise ValueError("This DOCX contains no readable text.")

    return paras, warnings
