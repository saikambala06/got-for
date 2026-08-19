#!/usr/bin/env python3
"""
Render each corpus resume as a PDF and as a DOCX.

The point of this harness is that the corpus text and its ground truth were
written by someone other than the parser's author, and the renderer is
deliberately dumb: it turns layout hints into real typography (bold all-caps
headings, hanging-indent bullets, tab stops, two-column tables) without any
knowledge of what the parser looks for. If the parser only works because a
fixture was built to suit it, that shows up here.
"""
import html
import json
import pathlib
import re
import sys
import zipfile

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

HERE = pathlib.Path(__file__).parent
OUT = HERE / "rendered"
TRUTH = json.loads((HERE / "truth.json").read_text())

BULLET_GLYPH = {"dot": "•", "dash": "-", "arrow": "→", "numbered": "", "none": ""}
# What the source text actually starts its bullet lines with.
SOURCE_MARKERS = ("·", "•", "=>", "→", "- ", "– ")

LEFT, RIGHT, TOP, BOTTOM = 54.0, 558.0, 720.0, 54.0
GUTTER = 200.0          # x where the main column starts in a two-column layout
BODY, HEAD = 9.5, 11.0


def is_heading(text: str, style: str) -> bool:
    """A heading is short, has no sentence punctuation, and is set apart."""
    bare = re.sub(r"[^A-Za-zÀ-ÿ]", "", text.replace(" ", ""))
    if not bare or len(text) > 60 or "\t" in text:
        return False
    if text.rstrip().endswith((".", ":", ",", ";")):
        return False
    if style == "letterspaced":
        return bool(re.match(r"^(?:[A-ZÀ-Ý&/]\s){3,}[A-ZÀ-Ý&/]?\s*$", text)) or bare == bare.upper()
    return bare == bare.upper() and len(text.split()) <= 6


def strip_marker(text: str) -> tuple[str, bool]:
    stripped = text.lstrip()
    for marker in SOURCE_MARKERS:
        if stripped.startswith(marker):
            return stripped[len(marker):].strip(), True
    if re.match(r"^\d{1,2}\.\s", stripped):
        return re.sub(r"^\d{1,2}\.\s*", "", stripped), True
    return text, False


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def render_pdf(name: str, lines: list[str], layout: dict, path: pathlib.Path) -> None:
    style = layout.get("heading_style", "allcaps_bold")
    two_col = layout.get("columns") == 2
    glyph = BULLET_GLYPH.get(layout.get("bullet", "dot"), "•")

    pdf = canvas.Canvas(str(path), pagesize=LETTER)
    y = TOP

    def newpage():
        nonlocal y
        pdf.showPage()
        y = TOP

    for index, raw in enumerate(lines):
        if not raw.strip():
            y -= BODY * 0.75
            continue
        if y < BOTTOM + 40:
            newpage()

        # The first two non-blank lines are the name block.
        heading = is_heading(raw, style) and index > 1
        font = "Helvetica-Bold" if heading else "Helvetica"
        size = HEAD if heading else BODY
        if index == 0:
            font, size = "Helvetica-Bold", 17.0
        elif index == 1:
            font, size = "Helvetica-Oblique", 10.5

        body, bulleted = strip_marker(raw)

        if "\t" in raw:
            cells = [c for c in raw.split("\t")]
            left_cell, right_cell = cells[0].strip(), " ".join(c.strip() for c in cells[1:]).strip()
            if two_col:
                # A real two-column page: each cell keeps its own column.
                left_lines = wrap(left_cell, font, size, GUTTER - LEFT - 12) if left_cell else []
                right_lines = wrap(right_cell, font, size, RIGHT - GUTTER) if right_cell else []
                for offset in range(max(len(left_lines), len(right_lines))):
                    if offset < len(left_lines):
                        pdf.setFont(font, size)
                        pdf.drawString(LEFT, y, left_lines[offset])
                    if offset < len(right_lines):
                        pdf.setFont(font, size)
                        pdf.drawString(GUTTER, y, right_lines[offset])
                    y -= size * 1.32
                continue
            # One column: the tail is right-aligned, as a date column would be.
            pdf.setFont(font, size)
            pdf.drawString(LEFT, y, left_cell)
            pdf.drawRightString(RIGHT, y, right_cell)
            y -= size * 1.4
            continue

        if bulleted:
            indent = LEFT + 14
            pdf.setFont(font, size)
            if glyph:
                pdf.drawString(LEFT + 4, y, glyph)
            for offset, piece in enumerate(wrap(body, font, size, RIGHT - indent)):
                pdf.setFont(font, size)
                pdf.drawString(indent, y, piece)
                y -= size * 1.3
                if y < BOTTOM + 20:
                    newpage()
            continue

        if heading:
            y -= 5
        for piece in wrap(body, font, size, RIGHT - LEFT):
            pdf.setFont(font, size)
            pdf.drawString(LEFT, y, piece)
            y -= size * (1.5 if heading else 1.32)
            if y < BOTTOM + 20:
                newpage()

    pdf.save()


W_NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def runs(text: str, *, bold=False, italic=False, size=None) -> str:
    props = "<w:rPr>"
    if bold:
        props += "<w:b/>"
    if italic:
        props += "<w:i/>"
    if size:
        props += f'<w:sz w:val="{int(size * 2)}"/>'
    props += "</w:rPr>"
    return f'<w:r>{props}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def render_docx(name: str, lines: list[str], layout: dict, path: pathlib.Path) -> None:
    style = layout.get("heading_style", "allcaps_bold")
    two_col = layout.get("columns") == 2
    body: list[str] = []
    row_buffer: list[tuple[str, str]] = []

    def flush_table():
        """Two-column pages become a borderless table, exactly as Word does."""
        if not row_buffer:
            return
        cells_left = "".join(
            f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{runs(l) if l else ""}</w:p>'
            for l, _ in row_buffer)
        cells_right = "".join(
            f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{runs(rr) if rr else ""}</w:p>'
            for _, rr in row_buffer)
        body.append(
            '<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/></w:tblPr>'
            '<w:tr>'
            f'<w:tc><w:tcPr><w:tcW w:w="2900" w:type="dxa"/></w:tcPr>{cells_left}</w:tc>'
            f'<w:tc><w:tcPr><w:tcW w:w="7100" w:type="dxa"/></w:tcPr>{cells_right}</w:tc>'
            '</w:tr></w:tbl>')
        row_buffer.clear()

    for index, raw in enumerate(lines):
        if not raw.strip():
            if two_col:
                flush_table()
            body.append("<w:p/>")
            continue

        heading = is_heading(raw, style) and index > 1
        content, bulleted = strip_marker(raw)

        if two_col and "\t" in raw:
            cells = raw.split("\t")
            row_buffer.append((cells[0].strip(), " ".join(c.strip() for c in cells[1:]).strip()))
            continue
        if two_col:
            flush_table()

        if index == 0:
            body.append(f'<w:p>{runs(raw.strip(), bold=True, size=17)}</w:p>')
            continue
        if index == 1:
            body.append(f'<w:p>{runs(raw.strip(), italic=True, size=10.5)}</w:p>')
            continue

        if heading:
            body.append(
                '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="220"/></w:pPr>'
                f'{runs(content.strip(), bold=True)}</w:p>')
            continue

        if bulleted:
            body.append(
                '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>'
                f'</w:pPr>{runs(content.strip())}</w:p>')
            continue

        if "\t" in raw:
            # A real right-aligned tab stop at the text margin.
            pieces = raw.split("\t")
            inner = runs(pieces[0].strip())
            for piece in pieces[1:]:
                inner += '<w:r><w:tab/></w:r>' + runs(piece.strip())
            body.append(
                '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>'
                f'{inner}</w:p>')
            continue

        body.append(f'<w:p>{runs(raw.strip())}</w:p>')

    if two_col:
        flush_table()

    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:document {W_NS}><w:body>{"".join(body)}'
                '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
                '<w:pgMar w:top="900" w:right="1080" w:bottom="900" w:left="1080"/>'
                '</w:sectPr></w:body></w:document>')

    numbering = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering {W_NS}>
 <w:abstractNum w:abstractNumId="1">
  <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/>
   <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
   <w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr></w:lvl>
 </w:abstractNum>
 <w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>'''

    styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {W_NS}>
 <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
 <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
 <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
  <w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  <w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>'''

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                   '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
                   '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                   '</Relationships>')
        z.writestr("word/_rels/document.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
                   '</Relationships>')
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/numbering.xml", numbering)


def main() -> int:
    OUT.mkdir(exist_ok=True)
    for source in sorted(HERE.glob("*.txt")):
        key = source.stem
        if key not in TRUTH:
            print(f"  ! no ground truth for {key}, skipping")
            continue
        layout = TRUTH[key].get("layout", {})
        lines = source.read_text(encoding="utf-8").split("\n")
        render_pdf(key, lines, layout, OUT / f"{key}.pdf")
        render_docx(key, lines, layout, OUT / f"{key}.docx")
        print(f"  rendered {key}  ({layout.get('columns', 1)}col, "
              f"{layout.get('heading_style')}, {layout.get('bullet')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
