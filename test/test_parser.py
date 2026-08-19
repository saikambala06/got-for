#!/usr/bin/env python3
"""
Resume parser regression suite.

Fixtures in test/fixtures cover the layouts that break naive parsers:

    ajay.pdf        hierarchical bullets — the level-1 bullet is the employer
                    and the level-2 bullets are its responsibilities
    ajay_equiv.docx  ┐ the same resume as ajay.pdf, written four ways a real
    typed_bullets.docx│ editor emits DOCX — Word numbering, typed glyph
    soft_breaks.docx  │ markers, Shift+Enter breaks, and a text box with a
    boxed.docx       ┘ content control. All four must equal the PDF's parse.
    single.pdf      classic one-column ATS resume, two pages
    twocol.pdf      sidebar + main column (reading order must be per-column)
    dense.docx      Word export with real list items and run formatting
    table.docx      entries laid out in tables, duties as plain paragraphs
    mixed.docx      body paragraphs and tables interleaved — reading order
    allcaps.pdf     letter-spaced headings, unusual section names, no bullets
    nosections.pdf  no section headings at all — bold and dates only
    scanned.pdf     image-only PDF, exercises the OCR path

Run: python3 test/test_parser.py     (or `npm test`)
"""

from __future__ import annotations

import os
import sys
import warnings

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))
FIXTURES = os.path.join(ROOT, "test", "fixtures")

from _resume_parser import ocr, pipeline, validator  # noqa: E402

PASSED = 0
FAILED = 0


def check(label: str, got, want) -> None:
    global PASSED, FAILED
    if got == want:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  ✗ {label}\n      got  {got!r}\n      want {want!r}")


def at_least(label: str, got, minimum) -> None:
    global PASSED, FAILED
    if got >= minimum:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  ✗ {label}: got {got}, want >= {minimum}")


def truthy(label: str, value) -> None:
    global PASSED, FAILED
    if value:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  ✗ {label}: expected a value, got {value!r}")


def parse(name: str) -> dict:
    with open(os.path.join(FIXTURES, name), "rb") as handle:
        return pipeline.parse_document(handle.read(), filename=name)


# ── The resume that motivated the rewrite ────────────────────────────────────

def test_ajay():
    """
    Hierarchical bullets: `• Employer <gap> Dates`, italic role beneath,
    `◦ responsibility` under that. The previous parser read every bullet as
    description text and produced no usable experience at all.
    """
    r = parse("ajay.pdf")
    c = r["contact_information"]

    check("ajay: name", c["name"], "Srinivasa Ajay Babu")
    check("ajay: email", c["email"], "ajayavula195@gmail.com")
    check("ajay: phone", c["phone"], "+1-601-909-8270")
    check("ajay: headline", c["headline"], "AI & Machine Learning Engineer")
    truthy("ajay: linkedin", c["linkedin"])
    # This resume states no city, so the location must be empty rather than
    # something scavenged from a skills line.
    check("ajay: location is empty", any(c["location"].values()), False)

    check("ajay: role count", len(r["work_experience"]), 4)
    check(
        "ajay: employers",
        [e["company"] for e in r["work_experience"]],
        ["Optum", "Wells Fargo", "Olive Crypto Solutions", "Olive Crypto Solutions"],
    )
    check(
        "ajay: positions",
        [e["position"] for e in r["work_experience"]],
        [
            "AI & Machine Learning Engineer",
            "AI & Machine Learning Engineer",
            "AI & Machine Learning Engineer",
            "Python Developer Intern",
        ],
    )
    check(
        "ajay: start dates",
        [e["start_date"] for e in r["work_experience"]],
        ["2025-08", "2025-01", "2022-06", "2022-01"],
    )
    check(
        "ajay: end dates",
        [e["end_date"] for e in r["work_experience"]],
        ["Present", "2025-07", "2023-12", "2022-05"],
    )
    check("ajay: first job is current", r["work_experience"][0]["current"], True)

    for index, job in enumerate(r["work_experience"]):
        at_least(f"ajay: job[{index}] responsibilities", len(job["responsibilities"]), 4)
        truthy(f"ajay: job[{index}] environment", job["environment"])
        # The "Environment:" line is a tech stack, not a duty.
        check(
            f"ajay: job[{index}] no environment in duties",
            any(d.lower().startswith("environment") for d in job["responsibilities"]),
            False,
        )

    check("ajay: degree count", len(r["education"]), 2)
    check(
        "ajay: institutions",
        [e["institution"] for e in r["education"]],
        ["University of Southern Mississippi", "Lakki Reddy Bali Reddy Engineering College"],
    )
    check("ajay: degrees", [e["degree"] for e in r["education"]], ["Master's", "Bachelor's"])
    check("ajay: majors", [e["major"] for e in r["education"]], ["Computer Science", "Engineering"])
    at_least("ajay: coursework captured", len(r["education"][0]["coursework"]), 4)

    at_least("ajay: skills", len(r["skills"]["technical"]), 40)
    at_least("ajay: skill categories", len(r["skills"]["categories"]), 5)
    check("ajay: certifications", len(r["certifications"]), 3)
    at_least("ajay: projects", len(r["projects"]), 4)
    at_least("ajay: summary length", len(r["summary"]), 200)
    at_least("ajay: confidence", r["confidence"]["overall"], 88)


# ── Layout coverage ──────────────────────────────────────────────────────────

def test_single_column():
    r = parse("single.pdf")
    c = r["contact_information"]
    check("single: name", c["name"], "Priya Raghunathan")
    check("single: phone", c["phone"], "+91 98450 33127")
    check("single: website", c["website"], "https://priyar.dev")
    check("single: city", c["location"]["city"], "Bengaluru")
    check("single: roles", [e["position"] for e in r["work_experience"]],
          ["Staff Software Engineer", "Senior Software Engineer", "Software Engineer"])
    check("single: employers", [e["company"] for e in r["work_experience"]],
          ["Razorpay", "Flipkart", "Zoho Corporation"])
    check("single: degrees", [e["degree"] for e in r["education"]],
          ["Master of Technology", "Bachelor of Engineering"])
    check("single: majors", [e["major"] for e in r["education"]],
          ["Computer Science", "Information Technology"])
    check("single: publications", len(r["publications"]), 1)
    check("single: languages", len(r["languages"]), 3)
    at_least("single: confidence", r["confidence"]["overall"], 95)


def test_two_column():
    """The sidebar must be read as its own column, not interleaved."""
    r = parse("twocol.pdf")
    c = r["contact_information"]
    check("twocol: name", c["name"], "Marcus Delacroix")
    check("twocol: state", c["location"]["state"], "TX")
    check("twocol: country inferred", c["location"]["country"], "USA")
    check("twocol: employers", [e["company"] for e in r["work_experience"]],
          ["Atlassian", "Shopify", "Mailchimp"])
    check("twocol: remote location kept", r["work_experience"][1]["location"], "Remote")
    check("twocol: institutions", [e["institution"] for e in r["education"]],
          ["School of Visual Arts", "University of Texas at Austin"])
    at_least("twocol: skills from sidebar", len(r["skills"]["technical"]) + len(r["skills"]["soft"]), 9)
    at_least("twocol: confidence", r["confidence"]["overall"], 95)


def test_docx():
    r = parse("dense.docx")
    check("docx: name", r["contact_information"]["name"], "Elena Kowalski")
    check("docx: country", r["contact_information"]["location"]["country"], "Poland")
    check("docx: employers", [e["company"] for e in r["work_experience"]],
          ["Allegro", "CD Projekt Red", "Nielsen"])
    check("docx: degrees", [e["degree"] for e in r["education"]],
          ["Master of Science", "Bachelor of Science"])
    check("docx: source format", r["metadata"]["source_format"], "docx")
    at_least("docx: confidence", r["confidence"]["overall"], 95)


# One resume, four ways a real editor writes it. Each is the exact content of
# ajay.pdf, so any difference in the parse is the DOCX reader's fault.
DOCX_RENDERINGS = {
    # Bullets as w:numPr references into a numbering definition (Symbol F0B7 at
    # level 0, Courier "o" at level 1), employer/date split by w:tab, LinkedIn
    # as a w:hyperlink whose address exists only in the relationship part, and
    # section headings on a Heading1 style reached through basedOn.
    "ajay_equiv.docx": "Word numbering, tabs, hyperlink relationships",
    # No numbering part at all: the markers are typed characters. "o" is Word's
    # own second-level marker and must not be read as the first word.
    "typed_bullets.docx": "typed glyph markers, nesting shown only by indent",
    # Shift+Enter (w:br) instead of new paragraphs — one <w:p> holding a whole
    # run of duties, which is what copying a list into Word produces.
    "soft_breaks.docx": "soft line breaks inside one paragraph",
    # Header in a text box (mc:AlternateContent) and the body inside both a
    # content control (w:sdt) and a single-cell table, as templates do.
    "boxed.docx": "text box, content control and wrapper table",
}


def test_docx_matches_pdf():
    """
    The same resume, in Word and in PDF, must parse to the same answer.

    None of these renderings survives a naive text dump, so equality here is a
    claim about the DOCX reader rather than about the files being similar.
    """
    pdf = parse("ajay.pdf")
    check("parity: pdf read by pdfplumber", pdf["metadata"]["extraction_method"], "pdfplumber")

    for name, description in DOCX_RENDERINGS.items():
        docx = parse(name)
        tag = f"parity[{description}]"

        check(f"{tag}: read as docx-xml", docx["metadata"]["extraction_method"], "docx-xml")

        for field in ("name", "email", "phone", "linkedin", "headline"):
            check(f"{tag}: contact.{field}",
                  docx["contact_information"][field], pdf["contact_information"][field])

        check(f"{tag}: summary", docx["summary"], pdf["summary"])
        check(f"{tag}: technical skills",
              sorted(docx["skills"]["technical"]), sorted(pdf["skills"]["technical"]))
        check(f"{tag}: skill categories",
              sorted(docx["skills"]["categories"]), sorted(pdf["skills"]["categories"]))
        check(f"{tag}: education", docx["education"], pdf["education"])
        check(f"{tag}: certifications", docx["certifications"], pdf["certifications"])

        check(f"{tag}: role count", len(docx["work_experience"]), len(pdf["work_experience"]))
        for index, (want, got) in enumerate(zip(pdf["work_experience"], docx["work_experience"])):
            for field in ("company", "position", "start_date", "end_date",
                          "current", "environment", "responsibilities"):
                check(f"{tag}: experience[{index}].{field}", got[field], want[field])


def test_docx_hierarchical_bullets():
    """The Word file must resolve the same structure the PDF does, on its own."""
    r = parse("ajay_equiv.docx")
    check("docx-equiv: source format", r["metadata"]["source_format"], "docx")
    check("docx-equiv: employers", [e["company"] for e in r["work_experience"]],
          ["Optum", "Wells Fargo", "Olive Crypto Solutions", "Olive Crypto Solutions"])
    check("docx-equiv: positions", [e["position"] for e in r["work_experience"]],
          ["AI & Machine Learning Engineer", "AI & Machine Learning Engineer",
           "AI & Machine Learning Engineer", "Python Developer Intern"])
    check("docx-equiv: date ranges",
          [(e["start_date"], e["end_date"]) for e in r["work_experience"]],
          [("2025-08", "Present"), ("2025-01", "2025-07"),
           ("2022-06", "2023-12"), ("2022-01", "2022-05")])
    check("docx-equiv: first job is current", r["work_experience"][0]["current"], True)
    check("docx-equiv: duties per role",
          [len(e["responsibilities"]) for e in r["work_experience"]], [8, 7, 8, 4])
    # A tab is not whitespace to be flattened: it separates two fields.
    check("docx-equiv: dates not left in the employer",
          any(char.isdigit() for e in r["work_experience"] for char in e["company"]), False)
    # The address exists only in word/_rels/document.xml.rels.
    check("docx-equiv: hyperlink target recovered",
          r["contact_information"]["linkedin"],
          "https://linkedin.com/in/srinivasa-ajay-avula-75219721a")
    truthy("docx-equiv: environment captured", r["work_experience"][0]["environment"])
    at_least("docx-equiv: confidence", r["confidence"]["overall"], 90)


def test_docx_tables_and_unbulleted_duties():
    """
    Word resumes lay entries out in tables and write duties as plain paragraphs.

    Reading order is the trap: a table's cells are stored apart from the body
    text, so a reader that walks paragraphs and tables as separate lists files
    every job under whichever heading happened to come last.
    """
    r = parse("table.docx")
    # Fields are reported as the document writes them, casing included.
    check("table: name", r["contact_information"]["name"], "PRIYA NARAYANAN")
    check("table: employers", [e["company"] for e in r["work_experience"]],
          ["Monzo Bank", "Revolut"])
    check("table: positions", [e["position"] for e in r["work_experience"]],
          ["Senior Product Manager", "Product Manager"])
    check("table: locations", [e["location"] for e in r["work_experience"]],
          ["London, United Kingdom", "London, United Kingdom"])
    # Unbulleted paragraphs inside a cell are still the role's duties.
    check("table: unbulleted duties",
          [len(e["responsibilities"]) for e in r["work_experience"]], [2, 1])
    check("table: duty text kept whole",
          r["work_experience"][0]["responsibilities"][0],
          "Owned the lending product line, growing balances from £40M to £310M.")
    check("table: institutions", [e["institution"] for e in r["education"]],
          ["University of Oxford", "University of Warwick"])
    check("table: degrees", [e["degree"] for e in r["education"]], ["MSc", "BSc"])
    check("table: majors", [e["major"] for e in r["education"]],
          ["Financial Economics", "Economics"])
    at_least("table: skills", len(r["skills"]["technical"]), 6)
    at_least("table: confidence", r["confidence"]["overall"], 90)


def test_docx_mixed_layout():
    """Body paragraphs and table rows interleaved: order must survive."""
    r = parse("mixed.docx")
    check("mixed: name", r["contact_information"]["name"], "MARCUS OKAFOR")
    check("mixed: employers", [e["company"] for e in r["work_experience"]],
          ["Snowflake", "Zillow"])
    check("mixed: positions", [e["position"] for e in r["work_experience"]],
          ["Staff Data Engineer", "Data Engineer"])
    # The degree belongs to EDUCATION even though a job's table sits above it.
    check("mixed: education not swallowed by experience",
          [e["institution"] for e in r["education"]], ["University of Washington"])
    check("mixed: degree", r["education"][0]["degree"], "MS")
    check("mixed: major", r["education"][0]["major"], "Computer Science")
    check("mixed: locations", [e["location"] for e in r["work_experience"]],
          ["Seattle, WA", "Seattle, WA"])


def test_corpus_pass_rate():
    """
    Score the parser against resumes it was not written for.

    Every other fixture here was built alongside the parser, which makes them a
    poor guide to how it behaves on someone else's document. `test/corpus`
    holds eight resumes written independently — Indian and Gulf IT contractors,
    a US nurse, a UK electrician, a German engineer, a French graduate, a US
    staffing DevOps CV and a two-column designer CV — each with the fields a
    careful human reader would extract recorded alongside it. They are rendered
    to PDF and DOCX by a renderer that knows nothing about the parser.

    The threshold guards against regression rather than declaring success: the
    parser scores about 77% of the checks, and two-column PDF sidebars remain
    its weakest layout.
    """
    corpus = os.path.join(ROOT, "test", "corpus")
    if not os.path.isdir(os.path.join(corpus, "rendered")):
        print("  … corpus not present; skipping")
        return

    sys.path.insert(0, corpus)
    import score as corpus_score  # noqa: PLC0415

    passed = total = 0
    for key in sorted(corpus_score.TRUTH):
        for suffix in ("pdf", "docx"):
            path = os.path.join(corpus, "rendered", f"{key}.{suffix}")
            if not os.path.exists(path):
                continue
            import pathlib  # noqa: PLC0415
            result = corpus_score.score_one(pathlib.Path(path), corpus_score.TRUTH[key])
            passed += sum(1 for v in result["checks"].values() if v)
            total += len(result["checks"])

    rate = 100.0 * passed / max(1, total)
    at_least("corpus: independent resumes scored", round(rate), 74)
    at_least("corpus: documents scored", total, 150)
    print(f"  … corpus: {passed}/{total} checks ({rate:.1f}%)")


def test_letterspaced_headings():
    """"W H E R E  I ' V E  W O R K E D" loses its word boundaries in the PDF."""
    r = parse("allcaps.pdf")
    check("allcaps: name", r["contact_information"]["name"], "DEREK OYELARAN-ODUYA")
    check("allcaps: employers", [e["company"] for e in r["work_experience"]],
          ["Safran Aircraft Engines", "Renault Group", "Michelin"])
    check("allcaps: sections found",
          {"summary", "experience", "education", "skills"} <= set(r["metadata"]["sections_detected"]), True)
    check("allcaps: languages", len(r["languages"]), 4)
    at_least("allcaps: confidence", r["confidence"]["overall"], 90)


def test_no_section_headings():
    r = parse("nosections.pdf")
    check("nosections: name", r["contact_information"]["name"], "Aiko Tanaka-Whitfield")
    check("nosections: employers", [e["company"] for e in r["work_experience"]],
          ["Stripe", "Twilio", "Chegg"])
    check("nosections: institution", r["education"][0]["institution"], "San Jose State University")
    at_least("nosections: skills", len(r["skills"]["technical"]), 8)
    at_least("nosections: confidence", r["confidence"]["overall"], 85)


def test_ocr():
    """An image-only PDF: rotated, noisy and blurred, as a real scan would be."""
    if not ocr.available():
        print("  … OCR backend unavailable; skipping scanned-resume test")
        return
    r = parse("scanned.pdf")
    check("ocr: used", r["metadata"]["ocr_used"], True)
    truthy("ocr: name found", r["contact_information"]["name"])
    at_least("ocr: roles", len(r["work_experience"]), 2)
    at_least("ocr: education", len(r["education"]), 1)
    truthy("ocr: warns about accuracy", any("OCR" in w for w in r["warnings"]))
    at_least("ocr: confidence", r["confidence"]["overall"], 70)


# ── Validation and error handling ────────────────────────────────────────────

def test_validation():
    cases = [
        (b"", "resume.pdf", "empty_file"),
        (b"tiny", "resume.pdf", "too_small"),
        (b"x" * (16 * 1024 * 1024), "resume.pdf", "too_large"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 200, "resume.doc", "legacy_doc"),
        (b"{\\rtf1" + b"0" * 200, "resume.rtf", "rtf"),
        (b"just some plain text, not a document at all" * 5, "resume.txt", "unsupported_type"),
        (b"%PDF-1.4 then garbage that is not a pdf" * 5, "resume.pdf", "corrupt_pdf"),
        (b"PK\x03\x04" + b"0" * 200, "resume.docx", "corrupt_docx"),
    ]
    for data, name, expected_code in cases:
        try:
            validator.validate(data, filename=name)
            FAIL = f"  ✗ validation: {expected_code} was not raised for {name}"
            print(FAIL)
            globals()["FAILED"] = FAILED + 1
        except validator.ValidationError as exc:
            check(f"validation: {name} -> {expected_code}", exc.code, expected_code)
            truthy(f"validation: {name} has a hint", exc.message)


def test_pipeline_errors():
    """A rejected file must produce a typed error, never a stack trace."""
    try:
        pipeline.parse_document(b"not a document", filename="x.pdf")
        print("  ✗ pipeline: expected PipelineError")
        globals()["FAILED"] = FAILED + 1
    except pipeline.PipelineError as exc:
        check("pipeline: error status", exc.status, 400)
        truthy("pipeline: error message", exc.message)


def test_text_input():
    r = pipeline.parse_text(
        "Jane Roe\njane@example.com | (415) 555-0100 | Austin, TX\n\n"
        "EXPERIENCE\nSenior Analyst\nAcme Corp, Austin, TX\nJan 2020 - Present\n"
        "- Built dashboards.\n- Cut reporting time 60%.\n\n"
        "EDUCATION\nBachelor of Science in Statistics\nUT Austin, 2014 - 2018\n\n"
        "SKILLS\nSQL, Python, Tableau, dbt, Airflow"
    )
    check("text: name", r["contact_information"]["name"], "Jane Roe")
    check("text: city", r["contact_information"]["location"]["city"], "Austin")
    check("text: roles", len(r["work_experience"]), 1)
    check("text: company", r["work_experience"][0]["company"], "Acme Corp")
    check("text: position", r["work_experience"][0]["position"], "Senior Analyst")
    check("text: start", r["work_experience"][0]["start_date"], "2020-01")
    check("text: duties", len(r["work_experience"][0]["responsibilities"]), 2)
    check("text: degree", r["education"][0]["degree"], "Bachelor of Science")
    check("text: major", r["education"][0]["major"], "Statistics")
    check("text: institution", r["education"][0]["institution"], "UT Austin")
    check("text: skills", len(r["skills"]["technical"]), 5)


def test_schema_shape():
    """Every key is always present, so consumers never test for existence."""
    r = parse("single.pdf")
    for key in ("metadata", "contact_information", "summary", "skills",
                "work_experience", "education", "certifications", "projects",
                "achievements", "languages", "publications", "confidence"):
        truthy(f"schema: {key} present", key in r)

    for key in ("name", "email", "phone", "linkedin", "github", "website", "headline", "location"):
        truthy(f"schema: contact.{key} present", key in r["contact_information"])

    for key in ("city", "state", "country"):
        truthy(f"schema: location.{key} present", key in r["contact_information"]["location"])

    for key in ("parsed_at", "parser_version", "source_format", "extraction_method",
                "ocr_used", "page_count", "sections_detected"):
        truthy(f"schema: metadata.{key} present", key in r["metadata"])

    job = r["work_experience"][0]
    for key in ("company", "position", "location", "start_date", "end_date",
                "current", "responsibilities", "environment"):
        truthy(f"schema: work_experience.{key} present", key in job)

    degree = r["education"][0]
    for key in ("institution", "degree", "major", "location", "start_date",
                "graduation_date", "gpa", "coursework"):
        truthy(f"schema: education.{key} present", key in degree)


def main() -> int:
    tests = [
        test_ajay, test_single_column, test_two_column, test_docx,
        test_docx_matches_pdf, test_docx_hierarchical_bullets,
        test_docx_tables_and_unbulleted_duties, test_docx_mixed_layout,
        test_corpus_pass_rate,
        test_letterspaced_headings, test_no_section_headings, test_ocr,
        test_validation, test_pipeline_errors, test_text_input, test_schema_shape,
    ]
    for test in tests:
        try:
            test()
        except Exception as exc:  # noqa: BLE001 - a crashing test is a failure
            globals()["FAILED"] = FAILED + 1
            print(f"  ✗ {test.__name__} raised {exc.__class__.__name__}: {exc}")

    total = PASSED + FAILED
    if FAILED:
        print(f"\n✗ FAILURES — {PASSED}/{total} passed, {FAILED} failed")
        return 1
    print(f"\n✓ ALL PASS — {PASSED} assertions across {len(tests)} tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
