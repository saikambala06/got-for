"""
Stage 4 — SectionSegmenter.

Turns a flat list of cleaned lines into titled sections, and each section into
discrete entries with an internal hierarchy.

Two ideas do most of the work.

**Headings are found visually, then named.** A line is a candidate heading
because of how it looks — larger, bolder, all-caps, preceded by whitespace —
and only then is its text matched against a vocabulary. That order matters:
"WHERE I'VE WORKED" is obviously a heading to a human before anyone recognises
the phrase, and a vocabulary-only approach misses it entirely.

**Bullet level is structural.** A very common resume layout is:

    • Optum                              Aug 2025 - Present     <- level 1
    AI & Machine Learning Engineer                              <- role, italic
    ◦ Designed and fine-tuned GPT-4 ...                         <- level 2
    ◦ Built and deployed Python models ...                      <- level 2

Here the level-1 bullet is the *entry header* and the level-2 bullets are its
responsibilities. A parser that treats every bullet as description text loses
the employer, the dates and the role all at once. The segmenter therefore
decides, per section, whether level-1 bullets are acting as entry headers, and
groups accordingly.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

from .extractor import Line

# ─── Section vocabulary ──────────────────────────────────────────────────────

SECTION_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("summary", re.compile(
        r"^(?:professional\s+|career\s+|executive\s+|personal\s+)?"
        r"(?:summary|profile|objective|about(?:\s+me)?|overview|introduction|statement)$"
        r"|^who\s+i\s+am$|^career\s+(?:summary|objective|profile)$", re.I)),
    ("experience", re.compile(
        r"^(?:work|professional|relevant|industry|employment|career|related)?\s*"
        r"(?:experience|history|employment|background)$"
        r"|^(?:employment|work)\s+history$|^professional\s+background$"
        r"|^where\s+i.?ve\s+worked$|^work$", re.I)),
    ("education", re.compile(
        r"^(?:education(?:al)?|academic)(?:\s+(?:background|history|qualifications?|details?))?$"
        r"|^qualifications?$|^academics$", re.I)),
    ("skills", re.compile(
        r"^(?:technical\s+|core\s+|key\s+|professional\s+|relevant\s+)?"
        r"(?:skills?|competenc(?:y|ies)|expertise|proficienc(?:y|ies)|technolog(?:y|ies)"
        r"|tech\s+stack|toolkit|tools?(?:\s*(?:&|and)\s*technologies)?"
        r"|areas?\s+of\s+expertise)$", re.I)),
    ("projects", re.compile(
        r"^(?:personal\s+|key\s+|notable\s+|selected\s+|academic\s+|side\s+)?projects?"
        r"(?:\s*(?:&|and)\s*(?:achievements?|accomplishments?))?$"
        r"|^portfolio$|^selected\s+work$", re.I)),
    ("certifications", re.compile(
        r"^(?:certificat(?:ion|e)s?|licen[sc]es?|credentials?|courses?|training"
        r"|professional\s+development)(?:\s*(?:&|and)\s*"
        r"(?:certificat(?:ion|e)s?|licen[sc]es?|training))?$", re.I)),
    ("achievements", re.compile(
        r"^(?:achievements?|awards?|honou?rs?|accomplishments?|recognitions?|highlights?)"
        r"(?:\s*(?:&|and)\s*(?:awards?|honou?rs?|achievements?))?$", re.I)),
    ("languages", re.compile(r"^(?:languages?|language\s+(?:skills?|proficienc(?:y|ies)))$", re.I)),
    ("publications", re.compile(
        r"^(?:publications?|papers?|research|articles?|talks?|presentations?|speaking)$", re.I)),
    ("volunteer", re.compile(
        r"^(?:volunteer(?:ing)?|community(?:\s+involvement)?|extracurriculars?"
        r"|activities|leadership)(?:\s+experience)?$", re.I)),
    ("interests", re.compile(r"^(?:interests?|hobbies|personal\s+interests?)$", re.I)),
    ("references", re.compile(r"^references?(?:\s+available.*)?$", re.I)),
    ("contact", re.compile(
        r"^(?:contact(?:\s+(?:info(?:rmation)?|details?|me))?|details?"
        r"|personal\s+(?:info(?:rmation)?|details?)|get\s+in\s+touch|reach\s+me)$", re.I)),
]

# Whitespace-free spellings, matched after stripping every non-letter.
# This is the fallback for letter-spaced headings, where the gap between
# letters is indistinguishable from the gap between words so the word
# boundaries are simply gone by the time any parser sees the text.
SECTION_COMPACT: dict[str, tuple[str, ...]] = {
    "summary": ("summary", "professionalsummary", "careersummary", "careerprofile", "profile",
                "objective", "careerobjective", "about", "aboutme", "overview",
                "executivesummary", "personalstatement", "personalprofile", "whoiam", "introduction"),
    "experience": ("experience", "workexperience", "professionalexperience", "relevantexperience",
                   "employmenthistory", "employment", "workhistory", "careerhistory",
                   "professionalbackground", "whereiveworked", "work"),
    "education": ("education", "educationalbackground", "academicbackground", "academichistory",
                  "academicqualifications", "educationalqualifications", "qualifications",
                  "academics", "educationdetails"),
    "skills": ("skills", "technicalskills", "coreskills", "keyskills", "corecompetencies",
               "competencies", "expertise", "areasofexpertise", "proficiencies", "technologies",
               "techstack", "toolstechnologies", "skillset", "toolkit"),
    "projects": ("projects", "personalprojects", "keyprojects", "notableprojects",
                 "selectedprojects", "academicprojects", "sideprojects", "portfolio",
                 "selectedwork", "keyprojectsachievements", "projectsachievements"),
    "certifications": ("certifications", "certification", "certificates", "licenses", "licences",
                       "credentials", "courses", "training", "professionaldevelopment",
                       "certificationslicenses"),
    "achievements": ("achievements", "awards", "honors", "honours", "accomplishments",
                     "recognitions", "highlights", "awardshonors", "honorsawards"),
    "languages": ("languages", "language", "languageskills", "languageproficiency"),
    "publications": ("publications", "papers", "research", "articles", "talks",
                     "presentations", "speaking"),
    "volunteer": ("volunteer", "volunteering", "volunteerexperience", "community",
                  "communityinvolvement", "extracurricular", "extracurriculars",
                  "activities", "leadership"),
    "interests": ("interests", "hobbies", "personalinterests"),
    "references": ("references", "reference"),
    "contact": ("contact", "contactinfo", "contactinformation", "contactdetails", "details",
                "personalinfo", "personalinformation", "personaldetails", "getintouch", "reachme"),
}

_COMPACT_LOOKUP: dict[str, str] = {}
for _key, _names in SECTION_COMPACT.items():
    for _name in _names:
        _COMPACT_LOOKUP.setdefault(_name, _key)

# Lines that close an entry rather than open one: the tool list a staffing
# resume puts under every job, and the client it was delivered for.
_TRAILING_METADATA = re.compile(
    r"^\s*(?:environment|environnement|technologies|tech\s+stack|tools?(?:\s+used)?"
    r"|technology\s+stack|skills\s+used|umgebung)\s*:", re.I)

# Sections whose body is a flat list rather than dated entries.
LIST_SECTIONS = {"skills", "languages", "interests", "certifications", "achievements"}
ENTRY_SECTIONS = {"experience", "education", "projects", "volunteer", "publications"}


# Keywords that name a section even when the heading wraps other words around
# them: "EMPLOYMENT CHRONICLE", "KEY SKILLS MATRIX", "ACADEMIC CREDENTIALS",
# "LICENSURE & CERTIFICATIONS", "EXPERIENCES : STAGES ET EMPLOIS ETUDIANTS".
# Resumes name their own sections freely, and an exact-match vocabulary can
# only ever recognise the phrasings someone thought to write down. Order is
# priority: the first keyword found in the heading wins, so "work experience"
# is settled before the bare "experience" and "continuing education" is a
# training section rather than a degree section.
SECTION_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("certifications", (
        "continuing education", "professional development", "certification", "certificate",
        "licensure", "licence", "license", "credential", "training", "weiterbildung",
        "accreditation", "coursework and training")),
    ("experience", (
        "employment", "work experience", "professional experience", "career history",
        "berufserfahrung", "experience professionnelle", "work history", "professional background",
        "employment chronicle", "career chronicle", "professional summary of experience",
        "experiences", "experience", "erfahrung", "parcours professionnel", "positions held",
        "career progression", "professional engagements", "assignments")),
    ("education", (
        "education", "academic", "ausbildung", "formation", "scholastic", "schooling",
        "studies", "degrees", "etudes", "apprenticeship")),
    ("skills", (
        "skill", "competenc", "expertise", "proficienc", "technolog", "tech stack",
        "toolkit", "fachkenntnisse", "kenntnisse", "compétences", "competences",
        "capabilities", "strengths", "technical summary")),
    ("publications", ("publication", "paper", "research output", "talks", "presentations")),
    ("projects", ("project", "portfolio", "selected work", "assignments undertaken")),
    ("achievements", ("achievement", "award", "honour", "honor", "accomplishment", "recognition")),
    ("languages", ("language", "sprachen", "langues")),
    ("volunteer", ("volunteer", "community", "extracurricular", "activities", "ehrenamt")),
    ("interests", ("interest", "hobbies", "hobbys", "loisirs")),
    ("references", ("reference",)),
    ("summary", (
        "summary", "profile", "objective", "about me", "overview", "introduction",
        "personal statement", "career goal", "projet professionnel", "profil")),
    # Deliberately last: "personal details" must not win over "personal profile".
    ("contact", (
        "contact", "personal details", "personal data", "personal dossier",
        "persönliche daten", "personliche daten", "personal information",
        "additional information", "sonstiges", "divers", "miscellaneous",
        "personal particulars")),
]


_NOT_A_HEADING = re.compile(
    r"\b(?:19|20)\d{2}\b"                       # a year: this is content, not a label
    r"|\b(?:bachelor|master|diplom|licence|magister|associate|doctor|ph\.?d"
    r"|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|mba|bca|mca)\b",
    re.I,
)


def _match_keyword(cleaned: str) -> str | None:
    """
    Last resort: find a section keyword inside a longer heading.

    This is what recognises "EMPLOYMENT CHRONICLE" and "KEY SKILLS MATRIX",
    which no fixed vocabulary would have listed. It is also the loosest test
    here, so it only runs on something that still looks like a label: a short
    phrase with no year in it and no degree name, because "Master of Technology
    in Computer Science 2014 - 2016" contains the word "technology" without
    being a skills heading.
    """
    if len(cleaned.split()) > 5 or _NOT_A_HEADING.search(cleaned):
        return None

    lowered = cleaned.lower()
    best: tuple[int, str] | None = None
    for key, keywords in SECTION_KEYWORDS:
        for word in keywords:
            index = lowered.find(word)
            if index >= 0:
                # Earliest keyword in the heading wins; ties break on the
                # priority order above, which is why only a strict < replaces.
                if best is None or index < best[0]:
                    best = (index, key)
                break
    return best[1] if best else None


def section_key(text: str) -> str | None:
    """
    Map a heading's text to a canonical section name, or None.

    Bilingual headings are split first: a German or French CV routinely writes
    "AUSBILDUNG / EDUCATION" or "FORMATION / EDUCATION", and either half names
    the section on its own.
    """
    cleaned = re.sub(r"[\t]", " ", text or "")
    cleaned = re.sub(r"[^A-Za-zÀ-ÿ&/'\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned or len(cleaned) > 60:
        return None

    halves = [h.strip() for h in cleaned.split("/") if h.strip()] or [cleaned]

    for half in halves:
        for key, pattern in SECTION_PATTERNS:
            if pattern.match(half):
                return key

    for half in halves:
        compact = re.sub(r"[^a-z]", "", half.lower())
        if 3 <= len(compact) <= 30 and compact in _COMPACT_LOOKUP:
            return _COMPACT_LOOKUP[compact]

    for half in halves:
        found = _match_keyword(half)
        if found:
            return found
    return None


def _looks_like_section_label(text: str) -> bool:
    """Cheap guard used before the loose keyword pass reaches content lines."""
    return bool(text) and not _NOT_A_HEADING.search(text)


# ─── Heading detection ───────────────────────────────────────────────────────

def mark_headings(lines: list[Line]) -> float:
    """
    Flag every visually emphasised line as a heading candidate.

    Returns the detected body font size, which later stages use as a baseline.
    """
    # Weight by characters, not by line count. Counting lines lets a resume
    # with many short headings and few long paragraphs report the heading size
    # as the body size, which then hides every real heading.
    weights: dict[float, int] = {}
    for line in lines:
        bucket = round(line.size * 2) / 2
        weights[bucket] = weights.get(bucket, 0) + len(line.text)

    if weights:
        body_size = max(weights.items(), key=lambda kv: kv[1])[0]
    else:
        body_size = statistics.median([l.size for l in lines] or [10.0])

    for line in lines:
        words = len(line.text.split())
        bigger = line.size >= body_size * 1.12
        short = len(line.text) <= 72 and words <= 10
        terminal = bool(re.search(r"[.,;]$", line.text))
        # A DOCX or an OCR result carries no vertical whitespace measurement,
        # so an all-caps or short bold line has to be allowed to stand alone.
        emphatic = (line.bold or line.all_caps) and (line.gap_before >= 0.25 or line.all_caps or words <= 6)

        line.heading = bool(
            not line.bullet and short and not terminal
            and (bigger or emphatic)
            and not re.fullmatch(r"\d+", line.text)
        )

    return float(body_size)


# ─── Data model ──────────────────────────────────────────────────────────────

@dataclass
class Entry:
    """One job, degree, project or award."""

    header_lines: list[Line] = field(default_factory=list)
    detail_lines: list[Line] = field(default_factory=list)

    @property
    def all_lines(self) -> list[Line]:
        return self.header_lines + self.detail_lines

    @property
    def header_text(self) -> str:
        return " \n ".join(l.text for l in self.header_lines)


@dataclass
class Section:
    """A titled region of the resume."""

    key: str
    title: str
    lines: list[Line] = field(default_factory=list)
    entries: list[Entry] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)


@dataclass
class Segmentation:
    preamble: list[Line] = field(default_factory=list)
    sections: dict[str, Section] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    body_size: float = 10.0

    def get(self, key: str) -> Section | None:
        return self.sections.get(key)

    def lines_for(self, key: str) -> list[Line]:
        section = self.sections.get(key)
        return section.lines if section else []


# ─── Entry grouping ──────────────────────────────────────────────────────────

DATE_RANGE_RE = re.compile(
    r"((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}"
    r"|\d{1,2}\s*[/-]\s*\d{4}|\d{4})"
    r"\s*(?:[-–—~]|to|until|through)\s*"
    r"(present|current(?:ly)?|now|ongoing|till\s*date|to\s*date"
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}"
    r"|\d{1,2}\s*[/-]\s*\d{4}|\d{4})",
    re.I,
)


def _has_date_range(text: str) -> bool:
    return bool(DATE_RANGE_RE.search(text))


def _group_entries(section: Section) -> list[Entry]:
    """
    Split a section's lines into entries.

    Three grouping strategies, chosen by what the section actually looks like:

    1. **Bullet-headed** — level-1 bullets act as entry headers (the layout in
       the docstring at the top of this module). Detected when level-1 bullets
       exist alongside level-2 bullets, or when the level-1 bullets carry dates.
    2. **Emphasis-headed** — bold or larger lines start entries. The common
       case for conventional resumes.
    3. **Date-headed** — nothing is emphasised, so a date range starts an
       entry. The fallback for plain-text and heavily-flattened documents.
    """
    lines = section.lines
    if not lines:
        return []

    level1 = [l for l in lines if l.bullet and l.bullet_level == 1]
    level2 = [l for l in lines if l.bullet and l.bullet_level == 2]
    non_bullet = [l for l in lines if not l.bullet]

    # Strategy 1: level-1 bullets are entry headers. That holds when a nested
    # level exists beneath them, when the bullets themselves carry the dates,
    # or when nothing else in the section does — a flat bullet list with no
    # dated heading above it is a list of items, one entry each. Where dated
    # non-bullet lines *do* exist, those are the entry headers and the bullets
    # are subordinate, which is the ordinary "employer line, then duties"
    # layout.
    bullet_headed = bool(level1) and (
        bool(level2)
        or sum(1 for l in level1 if _has_date_range(l.text)) >= max(1, len(level1) // 2)
        or not any(_has_date_range(l.text) for l in non_bullet)
    )

    if bullet_headed:
        entries: list[Entry] = []
        current: Entry | None = None
        for line in lines:
            if line.bullet and line.bullet_level == 1:
                current = Entry(header_lines=[line])
                entries.append(current)
            elif current is None:
                current = Entry(header_lines=[line])
                entries.append(current)
            elif line.bullet and line.bullet_level >= 2:
                current.detail_lines.append(line)
            else:
                # An unbulleted line directly after the header is part of the
                # header — this is where the job title lives in this layout.
                if not current.detail_lines:
                    current.header_lines.append(line)
                else:
                    current.detail_lines.append(line)
        return [e for e in entries if e.all_lines]

    # Strategy 2: emphasis starts entries.
    emphasised = [l for l in non_bullet if l.heading or l.bold]
    use_emphasis = 0 < len(emphasised) < max(1, len(non_bullet)) * 0.9

    entries = []
    current = None
    saw_bullet = False
    saw_date = False

    for line in lines:
        line_dated = _has_date_range(line.text)

        if current is None:
            starts = True
        elif line.bullet:
            starts = False
        elif _TRAILING_METADATA.match(line.text):
            # "Environment: Java, Spring, Oracle" closes the job above it. It
            # arrives after the duties, so the "a plain line after bullets
            # starts the next entry" rule would otherwise make it the header of
            # the following job and hand that job the wrong employer.
            starts = False
        elif use_emphasis and (line.heading or line.bold):
            starts = True
        elif saw_bullet:
            starts = True
        elif line_dated and saw_date:
            # Strategy 3: a second date means a second entry.
            starts = True
        elif line.gap_before >= 1.2 and (saw_date or saw_bullet):
            starts = True
        else:
            starts = False

        if starts:
            current = Entry(header_lines=[line])
            entries.append(current)
            saw_bullet = False
            saw_date = line_dated
            continue

        if line.bullet:
            current.detail_lines.append(line)
            saw_bullet = True
        elif current.detail_lines:
            current.detail_lines.append(line)
        else:
            current.header_lines.append(line)

        saw_date = saw_date or line_dated

    return [e for e in entries if e.all_lines]


# ─── Public API ──────────────────────────────────────────────────────────────

def segment(lines: list[Line]) -> Segmentation:
    """Bucket lines under their governing heading and group each into entries."""
    result = Segmentation()
    result.body_size = mark_headings(lines)

    active: str | None = None
    previous: Line | None = None

    for line in lines:
        # Crossing into a new column starts a new reading flow, so the previous
        # column's last section must not continue into it — in a two-column
        # resume that is exactly where the candidate's name usually sits. A
        # page break is NOT a reset: sections routinely run across pages.
        if previous is not None and line.column != previous.column:
            active = None
        previous = line

        key = section_key(line.text)
        looks_like_header = (
            key is not None
            and not line.bullet
            and (line.heading or line.bold or line.all_caps or line.size >= result.body_size * 1.08)
        )

        if looks_like_header:
            active = key
            if key not in result.sections:
                result.sections[key] = Section(key=key, title=line.text)
                result.order.append(key)
            continue

        if active:
            result.sections[active].lines.append(line)
        else:
            result.preamble.append(line)

    for section in result.sections.values():
        if section.key in ENTRY_SECTIONS:
            section.entries = _group_entries(section)

    return result
