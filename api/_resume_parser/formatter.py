"""
Stage 6 — JSONFormatter.

Assembles recognised entities into the public output schema and scores how
complete the parse was.

The schema is stable and every key is always present: a consumer should never
have to test for a missing field, only for an empty one. Empty means "not in
the document", never "the parser did not look".
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = "2.0.0"

# Weights for the completeness score. Roughly ordered by how much a recruiter
# or an ATS cares about the field being right.
FIELD_WEIGHTS = {
    "name": 14,
    "email": 12,
    "phone": 9,
    "location": 6,
    "linkedin": 4,
    "website": 3,
    "summary": 8,
    "work_experience": 20,
    "education": 12,
    "skills": 12,
}


def _score(parsed: dict) -> dict:
    """Per-field completeness, 0-100, plus an overall weighted score."""
    contact = parsed.get("contact_information", {}) or {}
    location = contact.get("location", {}) or {}
    detail: dict[str, float] = {
        "name": 1.0 if contact.get("name") else 0.0,
        "email": 1.0 if contact.get("email") else 0.0,
        "phone": 1.0 if contact.get("phone") else 0.0,
        "location": 1.0 if any(location.values()) else 0.0,
        "linkedin": 1.0 if contact.get("linkedin") else 0.0,
        "website": 1.0 if contact.get("website") else 0.0,
    }

    summary = parsed.get("summary") or ""
    detail["summary"] = 1.0 if len(summary) > 40 else (0.5 if summary else 0.0)

    experience = parsed.get("work_experience") or []
    if not experience:
        detail["work_experience"] = 0.0
    else:
        complete = sum(
            1 for e in experience
            if e.get("company") and e.get("position") and (e.get("start_date") or e.get("end_date"))
        )
        described = sum(1 for e in experience if e.get("responsibilities"))
        detail["work_experience"] = min(
            1.0, (complete / len(experience)) * 0.65 + (described / len(experience)) * 0.35
        )

    education = parsed.get("education") or []
    if not education:
        detail["education"] = 0.0
    else:
        complete = sum(1 for e in education if e.get("institution") and e.get("degree"))
        detail["education"] = min(1.0, complete / len(education))

    skills = parsed.get("skills", {}) or {}
    total_skills = len(skills.get("technical", [])) + len(skills.get("soft", []))
    detail["skills"] = min(1.0, total_skills / 8)

    earned = sum(FIELD_WEIGHTS[k] * detail.get(k, 0.0) for k in FIELD_WEIGHTS)
    total = sum(FIELD_WEIGHTS.values())

    return {
        "overall": round(earned / total * 100),
        "fields": {k: round(v * 100) for k, v in detail.items()},
        "missing": sorted(k for k, v in detail.items() if v < 0.5),
    }


def build(
    *,
    contact: dict,
    summary: str,
    skills: dict,
    experience: list[dict],
    education: list[dict],
    certifications: list[dict],
    projects: list[dict],
    achievements: list[str],
    languages: list[str],
    publications: list[dict],
    sections: list[str],
    stats: dict,
    warnings: list[str],
    parsed_at: datetime | None = None,
) -> dict:
    """Produce the final document."""
    now = parsed_at or datetime.now(timezone.utc)

    location = contact.get("location") or {"city": "", "state": "", "country": ""}

    parsed: dict[str, Any] = {
        "metadata": {
            "parsed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "parser_version": SCHEMA_VERSION,
            "source_format": stats.get("format", ""),
            "extraction_method": stats.get("method", ""),
            "ocr_used": bool(stats.get("ocr_used")),
            "page_count": stats.get("page_count", 0),
            "duration_ms": stats.get("duration_ms", 0),
            "sections_detected": sections,
        },
        "contact_information": {
            "name": contact.get("name", ""),
            "email": contact.get("email", ""),
            "phone": contact.get("phone", ""),
            "linkedin": contact.get("linkedin", ""),
            "github": contact.get("github", ""),
            "website": contact.get("website", ""),
            "headline": contact.get("headline", ""),
            "location": {
                "city": location.get("city", ""),
                "state": location.get("state", ""),
                "country": location.get("country", ""),
            },
        },
        "summary": summary,
        "skills": {
            "technical": skills.get("technical", []),
            "soft": skills.get("soft", []),
            "categories": skills.get("categories", {}),
        },
        "work_experience": [
            {
                "company": e.get("company", ""),
                "position": e.get("position", ""),
                "location": e.get("location", ""),
                "start_date": e.get("start_date", ""),
                "end_date": e.get("end_date", ""),
                "current": bool(e.get("current")),
                "responsibilities": e.get("responsibilities", []),
                "environment": e.get("environment", ""),
            }
            for e in experience
        ],
        "education": [
            {
                "institution": e.get("institution", ""),
                "degree": e.get("degree", ""),
                "major": e.get("major", ""),
                "location": e.get("location", ""),
                "start_date": e.get("start_date", ""),
                "graduation_date": e.get("graduation_date", ""),
                "gpa": e.get("gpa", ""),
                "coursework": e.get("coursework", []),
            }
            for e in education
        ],
        "certifications": certifications,
        "projects": projects,
        "achievements": achievements,
        "languages": languages,
        "publications": publications,
        "warnings": warnings,
    }

    parsed["confidence"] = _score(parsed)
    return parsed


def to_legacy_resume(parsed: dict) -> dict:
    """
    Map the schema onto the Mongo Resume document the portal already stores.

    Keeping this translation in one place means the storage shape and the API
    shape can evolve independently.
    """
    contact = parsed.get("contact_information", {}) or {}
    location = contact.get("location", {}) or {}
    location_text = ", ".join(p for p in (location.get("city"), location.get("state"), location.get("country")) if p)
    skills = parsed.get("skills", {}) or {}

    return {
        "personal": {
            "name": contact.get("name", ""),
            "email": contact.get("email", ""),
            "phone": contact.get("phone", ""),
            "location": location_text,
            "linkedin": contact.get("linkedin", ""),
            "portfolio": contact.get("website", ""),
        },
        "summary": parsed.get("summary", ""),
        "experience": [
            {
                "company": e.get("company", ""),
                "role": e.get("position", ""),
                "location": e.get("location", ""),
                "startDate": e.get("start_date", ""),
                "endDate": e.get("end_date", ""),
                "current": bool(e.get("current")),
                "description": "\n".join(e.get("responsibilities", [])),
            }
            for e in parsed.get("work_experience", [])
        ],
        "education": [
            {
                "school": e.get("institution", ""),
                "degree": e.get("degree", ""),
                "field": e.get("major", ""),
                "location": e.get("location", ""),
                "startDate": e.get("start_date", ""),
                "endDate": e.get("graduation_date", ""),
                "current": False,
                "description": ", ".join(e.get("coursework", [])) or (f"GPA {e['gpa']}" if e.get("gpa") else ""),
            }
            for e in parsed.get("education", [])
        ],
        "skills": list(skills.get("technical", [])) + list(skills.get("soft", [])),
        "projects": [
            {"name": p.get("name", ""), "link": p.get("link", ""), "description": p.get("description", "")}
            for p in parsed.get("projects", [])
        ],
        "certifications": [
            {"name": c.get("name", ""), "issuer": c.get("issuer", ""), "date": c.get("date", "")}
            for c in parsed.get("certifications", [])
        ],
        "achievements": parsed.get("achievements", []),
        "languages": parsed.get("languages", []),
        "publications": [
            {"title": p.get("title", ""), "link": p.get("link", ""), "date": p.get("date", "")}
            for p in parsed.get("publications", [])
        ],
    }
