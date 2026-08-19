"""
Pipeline orchestrator.

Runs the six stages in order and returns the formatted document. Each stage is
timed so a slow document can be diagnosed from the response rather than by
guesswork, and each stage's failure mode is distinct so the caller can tell a
rejected file apart from an unreadable one apart from a parser bug.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from . import cleaner, extractor, formatter, ner, segmenter, validator
from .extractor import Document, ExtractionError, Line
from .segmenter import Segmentation
from .validator import ValidationError


class PipelineError(Exception):
    """A stage failed in a way the user should be told about."""

    def __init__(self, message: str, hint: str = "", *, status: int = 422, code: str = "parse_failed"):
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.status = status
        self.code = code


def _summary_text(segmentation: Segmentation, lines: list[Line]) -> str:
    """The summary section, or the opening paragraph when there is no heading."""
    section = segmentation.get("summary")
    if section and section.lines:
        return " ".join(l.text.replace("\t", " ").strip() for l in section.lines).strip()

    # No heading: the first substantial paragraph above the first dated entry.
    first_dated = next((i for i, l in enumerate(lines) if ner.find_date_range(l.text).found), len(lines))
    head = lines[:first_dated] if first_dated else lines[:6]
    for line in head:
        text = line.text.strip()
        if (
            not line.bullet
            and len(text) > 55
            and any(p in text for p in ".!?")
            and not ner.G.EMAIL.search(text)
            and not ner.find_date_range(text).found
        ):
            return text
    return ""


def _salvage_experience(lines: list[Line]) -> list[dict]:
    """
    Recover jobs from a resume with no section headings at all.

    Structure is carried entirely by bold titles and dates in that layout, so
    the segmenter has nothing to anchor on and every line lands in the
    preamble. Dated header lines are the remaining signal.
    """
    entries: list[segmenter.Entry] = []
    current: segmenter.Entry | None = None

    for line in lines:
        dated = ner.find_date_range(line.text).found
        if dated and not line.bullet and len(line.text) < 170:
            current = segmenter.Entry(header_lines=[line])
            entries.append(current)
            continue
        if current is not None and (line.bullet or (not line.heading and len(line.text) > 40)):
            if len(current.detail_lines) < 14:
                current.detail_lines.append(line)
            continue
        if line.heading and not line.bullet:
            current = None

    out = []
    for entry in entries:
        parsed = ner.parse_experience_entry(entry)
        if (parsed["company"] or parsed["position"]) and not ner.G.DEGREE.search(parsed["position"] or ""):
            out.append(parsed)
    return out[:20]


def _salvage_education(lines: list[Line]) -> list[dict]:
    entries: list[segmenter.Entry] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        text = line.text
        if (
            not line.bullet
            and len(text) <= 170
            and not ner.G.EMAIL.search(text)
            and not __import__("re").search(r"https?://|www\.", text, __import__("re").I)
            and (ner.G.DEGREE.search(text) or ner.G.INSTITUTION.search(text))
        ):
            block = [line]
            for probe in lines[index + 1: index + 3]:
                if probe.bullet or len(probe.text) > 120:
                    break
                if ner.G.INSTITUTION.search(probe.text) or ner.find_date_range(probe.text).found or ner.find_location(probe.text):
                    block.append(probe)
                else:
                    break
            entries.append(segmenter.Entry(header_lines=block))
            index += len(block)
            continue
        index += 1

    out = []
    for entry in entries:
        parsed = ner.parse_education_entry(entry)
        if parsed["institution"] or parsed["degree"]:
            out.append(parsed)
    return out[:12]


def _salvage_skills(lines: list[Line]) -> dict:
    """A long delimited run of short noun phrases, with no heading above it."""
    best: tuple[int, Line] | None = None
    for line in lines:
        text = line.text.replace("\t", " ")
        if not 24 <= len(text) <= 400:
            continue
        if __import__("re").search(r"[.!?]\s", text):
            continue
        parts = [p.strip() for p in __import__("re").split(r"\s*[,;|·•]\s*", text) if p.strip()]
        if len(parts) < 5:
            continue
        termish = [
            p for p in parts
            if len(p.split()) <= 4 and len(p) <= 34
            and not __import__("re").search(r"\b(and|the|with|for|that|which|to)\b", p, __import__("re").I)
        ]
        if len(termish) / len(parts) < 0.8:
            continue
        if best is None or len(parts) > best[0]:
            best = (len(parts), line)

    return ner.parse_skills([best[1]]) if best else {"technical": [], "soft": [], "categories": {}}


def parse_document(
    data: bytes,
    *,
    filename: str = "",
    content_type: str = "",
    allow_ocr: bool = True,
) -> dict:
    """
    Run the full pipeline over an uploaded file.

    Returns the formatted document plus a `stages` timing breakdown.

    Raises:
        PipelineError: a stage failed; carries a user-facing message and hint.
    """
    started = time.perf_counter()
    stages: dict[str, float] = {}

    def mark(name: str, since: float) -> float:
        now = time.perf_counter()
        stages[name] = round((now - since) * 1000, 1)
        return now

    # ── 1. Validate ──
    checkpoint = started
    try:
        info = validator.validate(data, filename=filename, content_type=content_type)
    except ValidationError as exc:
        raise PipelineError(exc.message, exc.hint, status=400, code=exc.code) from exc
    checkpoint = mark("validate", checkpoint)

    # ── 2. Extract ──
    try:
        document: Document = extractor.extract(data, info.kind, allow_ocr=allow_ocr)
    except ExtractionError as exc:
        raise PipelineError(exc.message, exc.hint, status=422, code="no_text") from exc
    except Exception as exc:  # noqa: BLE001 - an unexpected library failure
        raise PipelineError(
            "This document could not be read.",
            f"{exc.__class__.__name__}: {exc}",
            status=422,
            code="extract_failed",
        ) from exc
    checkpoint = mark("extract", checkpoint)

    document.warnings = list(info.warnings) + list(document.warnings)

    # ── 3. Clean ──
    # Headings are flagged before cleaning, not after: the cleaner joins
    # wrapped lines, and without knowing what a heading looks like it will
    # happily absorb a section title into the paragraph above it. The
    # segmenter marks them again afterwards, because joining changes the text.
    segmenter.mark_headings(document.lines)
    document = cleaner.clean(document)
    checkpoint = mark("clean", checkpoint)

    if not document.lines:
        raise PipelineError(
            "Nothing readable was left after cleaning this document.",
            "The file may contain only images or decorative text.",
            status=422,
            code="empty_after_clean",
        )

    # ── 4. Segment ──
    segmentation = segmenter.segment(document.lines)
    checkpoint = mark("segment", checkpoint)

    # ── 5. Recognise entities ──
    lines = document.lines
    contact = ner.parse_contact(segmentation, lines)
    summary = _summary_text(segmentation, lines)

    experience_section = segmentation.get("experience")
    volunteer_section = segmentation.get("volunteer")
    experience_entries = list(experience_section.entries if experience_section else [])
    experience_entries += list(volunteer_section.entries if volunteer_section else [])
    experience = [ner.parse_experience_entry(e) for e in experience_entries]
    experience = ner.inherit_nested_employers(experience)
    experience = [e for e in experience if e["company"] or e["position"] or e["responsibilities"]]

    education_section = segmentation.get("education")
    education = [ner.parse_education_entry(e) for e in (education_section.entries if education_section else [])]
    education = [e for e in education if e["institution"] or e["degree"]]

    skills = ner.parse_skills(segmentation.lines_for("skills"))

    projects_section = segmentation.get("projects")
    projects = ner.parse_projects(
        projects_section.entries if projects_section else [],
        segmentation.lines_for("projects"),
    )

    certifications = ner.parse_certifications(segmentation.lines_for("certifications"))
    achievements = ner.parse_flat_list(segmentation.lines_for("achievements"), split_inline=False, limit=30)
    languages = ner.parse_flat_list(segmentation.lines_for("languages"), split_inline=True, limit=20)
    publications = ner.parse_publications(segmentation.lines_for("publications"))

    # Salvage: a resume with no headings leaves every section empty, so recover
    # what can be identified by shape alone. These only ever fill a gap.
    if not experience:
        experience = _salvage_experience(lines)
    if not education:
        education = _salvage_education(lines)
    if not skills["technical"] and not skills["soft"]:
        skills = _salvage_skills(lines)

    checkpoint = mark("recognise", checkpoint)

    # ── 6. Format ──
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    result = formatter.build(
        contact=contact,
        summary=summary,
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
        achievements=achievements,
        languages=languages,
        publications=publications,
        sections=segmentation.order,
        stats={
            "format": document.kind,
            "method": document.method,
            "ocr_used": document.ocr_used,
            "page_count": document.page_count,
            "duration_ms": duration_ms,
        },
        warnings=document.warnings,
        parsed_at=datetime.now(timezone.utc),
    )
    mark("format", checkpoint)

    result["metadata"]["stages_ms"] = stages
    result["raw_text"] = document.text
    result["stats"] = {
        "pages": document.page_count,
        "lines": len(document.lines),
        "characters": len(document.text),
        "words": len(document.text.split()),
        "bullets": sum(1 for l in document.lines if l.bullet),
        "columns": len({(l.page, l.column) for l in document.lines}) // max(1, document.page_count),
        "experience_entries": len(experience),
        "education_entries": len(education),
        "skill_count": len(skills["technical"]) + len(skills["soft"]),
    }
    return result


def parse_text(text: str) -> dict:
    """
    Run the pipeline over pasted plain text.

    Plain text has no geometry, so a synthetic line model is built and the
    same cleaner, segmenter and recogniser handle it — one parser, every input.
    """
    started = time.perf_counter()
    rows = (text or "").splitlines()

    lines: list[Line] = []
    for index, raw in enumerate(rows):
        stripped = raw.strip()
        if not stripped:
            continue
        body, level = extractor._classify_bullet(stripped)  # noqa: SLF001 - internal by design
        if not body:
            continue
        previous_blank = index > 0 and not rows[index - 1].strip()
        letters = "".join(c for c in body if c.isalpha())
        lines.append(Line(
            text=extractor.normalise(body),
            page=1,
            column=0,
            x0=20.0 if level else 0.0,
            x1=(20.0 if level else 0.0) + len(body) * 5.0,
            top=float(index),
            size=10.5,
            bullet=level > 0,
            bullet_level=level,
            indent=20.0 if level else 0.0,
            gap_before=1.0 if previous_blank else 0.0,
            all_caps=bool(letters) and letters == letters.upper(),
        ))

    if not lines:
        raise PipelineError("No readable text was found.", "Paste the full text of your resume.", status=400, code="empty_text")

    document = Document(kind="text", lines=lines, page_count=1, method="plaintext")
    segmenter.mark_headings(document.lines)
    document = cleaner.clean(document)
    segmentation = segmenter.segment(document.lines)

    body_lines = document.lines
    contact = ner.parse_contact(segmentation, body_lines)
    summary = _summary_text(segmentation, body_lines)

    experience_section = segmentation.get("experience")
    experience = ner.inherit_nested_employers(
        [ner.parse_experience_entry(e) for e in (experience_section.entries if experience_section else [])])
    experience = [e for e in experience if e["company"] or e["position"] or e["responsibilities"]]

    education_section = segmentation.get("education")
    education = [ner.parse_education_entry(e) for e in (education_section.entries if education_section else [])]
    education = [e for e in education if e["institution"] or e["degree"]]

    skills = ner.parse_skills(segmentation.lines_for("skills"))
    projects_section = segmentation.get("projects")
    projects = ner.parse_projects(
        projects_section.entries if projects_section else [],
        segmentation.lines_for("projects"),
    )

    if not experience:
        experience = _salvage_experience(body_lines)
    if not education:
        education = _salvage_education(body_lines)
    if not skills["technical"] and not skills["soft"]:
        skills = _salvage_skills(body_lines)

    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    result = formatter.build(
        contact=contact,
        summary=summary,
        skills=skills,
        experience=experience,
        education=education,
        certifications=ner.parse_certifications(segmentation.lines_for("certifications")),
        projects=projects,
        achievements=ner.parse_flat_list(segmentation.lines_for("achievements"), split_inline=False, limit=30),
        languages=ner.parse_flat_list(segmentation.lines_for("languages"), split_inline=True, limit=20),
        publications=ner.parse_publications(segmentation.lines_for("publications")),
        sections=segmentation.order,
        stats={
            "format": "text",
            "method": "plaintext",
            "ocr_used": False,
            "page_count": 1,
            "duration_ms": duration_ms,
        },
        warnings=document.warnings,
    )
    result["raw_text"] = document.text
    result["stats"] = {
        "pages": 1,
        "lines": len(document.lines),
        "characters": len(text or ""),
        "words": len((text or "").split()),
        "bullets": sum(1 for l in document.lines if l.bullet),
        "columns": 1,
        "experience_entries": len(experience),
        "education_entries": len(education),
        "skill_count": len(skills["technical"]) + len(skills["soft"]),
    }
    return result
