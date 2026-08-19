"""
Stage 5 — NEREngine.

Named-entity recognition tuned for resumes, built from rules, gazetteers and
layout signals rather than a statistical model.

That choice is deliberate. A general-purpose NER model labels "Optum" as ORG
and "Aug 2025 - Present" as DATE, but it has no opinion about which ORG is the
*employer for this entry*, which of two capitalised phrases is the job title,
or that the line under a level-1 bullet is a position. Resume parsing is
overwhelmingly a structure problem, and structure is exactly what the
segmenter has already recovered. The recogniser's job is to name the pieces.

Entity types produced: PERSON, ORG, ROLE, DATE, GPE, SKILL, DEGREE, EMAIL,
PHONE, URL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import gazetteers as G
from .extractor import Line
from .segmenter import Entry, Segmentation


# ─── Dates ───────────────────────────────────────────────────────────────────

@dataclass
class DateRange:
    start: str = ""
    end: str = ""
    current: bool = False
    raw: str = ""

    @property
    def found(self) -> bool:
        return bool(self.start or self.end)


def _title_date(value: str) -> str:
    """Normalise a date token's casing and spacing without reformatting it."""
    text = re.sub(r"\s+", " ", (value or "").strip())
    if re.fullmatch(rf"(?:{G.PRESENT})", text, re.I):
        return "Present"
    return text[:1].upper() + text[1:] if text else ""


def _iso(value: str) -> str:
    """
    Best-effort ISO-8601 for the schema's date fields.

    "Aug 2025" -> "2025-08", "2021" -> "2021", "Present" -> "Present".
    Returns the input unchanged when it cannot be normalised, because a wrong
    date is worse than an unformatted one.
    """
    text = (value or "").strip()
    if not text:
        return ""
    if re.fullmatch(rf"(?:{G.PRESENT})", text, re.I):
        return "Present"

    match = re.match(rf"({G.MONTH})\.?\s*,?\s*'?(\d{{2,4}})$", text, re.I)
    if match:
        month = G.MONTH_NUMBER.get(match.group(1)[:3].lower())
        year = match.group(2)
        if len(year) == 2:
            year = ("20" if int(year) < 50 else "19") + year
        if month:
            return f"{year}-{month:02d}"
        return year

    match = re.match(r"(\d{1,2})\s*[/.-]\s*(\d{4})$", text)
    if match:
        return f"{match.group(2)}-{int(match.group(1)):02d}"

    match = re.match(r"(\d{4})\s*[/.-]\s*(\d{1,2})$", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"

    match = re.match(r"(\d{4})$", text)
    if match:
        return match.group(1)

    return text


def find_date_range(text: str) -> DateRange:
    match = G.DATE_RANGE.search(text or "")
    if match:
        end_raw = match.group(2)
        return DateRange(
            start=_title_date(match.group(1)),
            end=_title_date(end_raw),
            current=bool(re.fullmatch(rf"(?:{G.PRESENT})", end_raw.strip(), re.I)),
            raw=match.group(0),
        )
    since = G.SINCE_DATE.search(text or "")
    if since:
        return DateRange(start=_title_date(since.group(1)), end="Present",
                         current=True, raw=since.group(0).strip())
    single = G.SINGLE_DATE.search(text or "")
    if single:
        return DateRange(end=_title_date(single.group(1)), raw=single.group(1))
    return DateRange()


def strip_dates(text: str) -> str:
    """Remove every date token, leaving the rest of the line intact."""
    out = G.DATE_RANGE.sub(" ", text or "")
    out = re.sub(rf"\b(?:{G.MONTH})\.?\s*,?\s*'?\d{{2,4}}\b", " ", out, flags=re.I)
    out = G.YEAR.sub(" ", out)
    out = re.sub(rf"\b(?:{G.PRESENT})\b", " ", out, flags=re.I)
    out = re.sub(r"\s*[|•·–—-]\s*$", "", out)
    out = re.sub(r"^\s*[|•·–—-]\s*", "", out)
    return re.sub(r"[^\S\t]{2,}", " ", out).strip(" \t,;|-–—")


# ─── Contact primitives ──────────────────────────────────────────────────────

def find_email(text: str) -> str:
    match = G.EMAIL.search(text or "")
    return match.group(0).rstrip(".,;") if match else ""


# A phone number as people actually write one: an optional country code, then
# groups of digits separated by spaces, dots, dashes or brackets. Deliberately
# a *search* pattern rather than a whole-fragment test, because a contact line
# rarely gives the number a fragment of its own — it is normally wedged between
# a label, a country annotation and an email address.
_PHONE_SHAPE = re.compile(
    r"(?<![\w.])"
    r"(\+?\d{1,3}[\s.\-]?)?"
    r"(\(\d{1,5}\)[\s.\-]?)?"
    r"\d(?:[\d\s.\-]{5,17})\d"
    r"(?:\s*(?:ext|x|extn)\.?\s*\d{1,5})?"
    r"(?![\w.])",
    re.I,
)


def find_phone(text: str) -> str:
    """
    Find a phone number without mistaking years, metrics or IDs for one.

    Numbers are searched for rather than isolated by splitting, because the
    separators differ everywhere: "Contact No: +971 55 812 4470 (UAE) / +91
    90350 77219 (India)" and "06 74 21 08 55 - m.grangier@protonmail.com" both
    hide a real number in a fragment that also holds other things. Everything
    that could be confused for a number — emails, URLs, date ranges, years — is
    removed first, and what survives is validated by digit count.
    """
    source = text or ""
    if not source:
        return ""

    # Remove the things that are made of digits but are not numbers to call.
    cleaned = G.EMAIL.sub(" ", source)
    cleaned = G.URL.sub(" ", cleaned)
    cleaned = G.DATE_RANGE.sub(" ", cleaned)
    cleaned = re.sub(r"\((?:[^()\d]{1,20})\)", " ", cleaned)  # "(UAE)", "(India)"
    cleaned = re.sub(rf"\b(?:{G.MONTH})\.?\s*,?\s*'?\d{{2,4}}\b", " ", cleaned, flags=re.I)

    for match in _PHONE_SHAPE.finditer(cleaned):
        # "ECS card no. 8472 5561" and "License No. RN.443921" sit in the same
        # contact block and have the same shape as a number to call.
        if G.ID_NUMBER_CONTEXT.search(cleaned[: match.start()]):
            continue
        candidate = re.sub(r"\s{2,}", " ", match.group(0)).strip(" .-")
        digits = re.sub(r"\D", "", candidate)
        if not 8 <= len(digits) <= 15:
            continue
        if re.fullmatch(r"(?:19|20)\d{2}", digits):
            continue
        # Four digits, a separator, four digits is a year range far more often
        # than it is a phone number.
        if re.fullmatch(r"(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}", candidate):
            continue
        return candidate
    return ""


def find_urls(text: str) -> list[str]:
    """Real URLs only — an email's domain part is not a website."""
    without_emails = G.EMAIL.sub(" ", text or "")
    out = []
    for match in G.URL.finditer(without_emails):
        url = match.group(1).rstrip(".,;:)]")
        if not re.match(r"^(?:https?://)?[^\s/]+\.[a-z]{2,}", url, re.I):
            continue
        if re.search(r"\.(?:png|jpe?g|gif|svg|webp|pdf|docx?|pptx?)$", url, re.I):
            continue
        if re.match(r"^[a-z]+\.[A-Z]", url):   # "systems.Deep" — a missing space
            continue
        out.append(url)
    return out


def normalise_url(url: str) -> str:
    value = (url or "").strip().rstrip(".,;)")
    if not value:
        return ""
    return value if re.match(r"^https?://", value, re.I) else f"https://{value}"


def find_location(text: str) -> str:
    """
    Recognise a place in "City, Region" form.

    Matching is anchored at the end of each fragment so the most specific
    trailing pair wins: unanchored, "Atlassian, Austin, TX" matches
    "Atlassian, Austin" and the employer is read as the city.
    """
    for chunk in re.split(r"[|•·\t\n]|\s{2,}", text or ""):
        chunk = G.CONTACT_LABEL.sub("", chunk.strip()).strip(" ,")
        if not chunk or len(chunk) > 60:
            continue
        if G.EMAIL.search(chunk) or re.search(r"https?:|www\.|@", chunk, re.I):
            continue
        if re.search(r"\d{4}", chunk):
            continue

        mode = re.search(r"\b(remote|hybrid|on-?site)\b", chunk, re.I)
        if mode and len(re.sub(r"[^A-Za-z]", "", chunk)) <= len(mode.group(1)) + 12:
            return mode.group(1).title()

        match = re.search(
            r"([A-Z][A-Za-z.'-]+(?:[\s-][A-Z][A-Za-z.'-]+){0,3})\s*,\s*"
            r"([A-Z]{2,3}|[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})\.?$",
            chunk,
        )
        if match:
            city, region = match.group(1).strip(), match.group(2).strip()
            known_region = (
                region.upper() in G.US_STATE_ABBR
                or region.lower() in G.COUNTRIES
                or region.lower() in G.US_STATE_NAMES
            )
            # An all-caps token is an acronym, not a place name. Without this,
            # a skills line reads "JSON, ETL Pipelines" as a city and a region.
            acronymish = _is_acronym(city) or (not known_region and _is_acronym(region))
            plausible = known_region or (
                len(region.split()) <= 2 and len(region) <= 22 and not G.NOT_A_PLACE.search(region)
            )
            if plausible and not acronymish and not G.NOT_A_PLACE.search(city):
                return f"{city}, {region}"

        if chunk.lower() in G.COUNTRIES and len(chunk.split()) <= 3:
            return chunk

    return ""


def _is_acronym(value: str) -> bool:
    """ALL-CAPS short token — an abbreviation, never a city name."""
    token = (value or "").strip()
    if not token or " " in token:
        return False
    letters = re.sub(r"[^A-Za-z]", "", token)
    return 2 <= len(letters) <= 5 and letters.isupper() and letters.upper() not in G.US_STATE_ABBR


def split_institution_location(text: str) -> tuple[str, str]:
    """
    Separate an institution from a trailing place.

    "University of Southern Mississippi, USA" is one institution and one
    country — splitting on the location match alone truncates the name to
    "University of", because "Southern Mississippi, USA" itself looks like a
    city and a country.
    """
    value = (text or "").strip()
    if "," not in value or not G.INSTITUTION.search(value):
        return value, ""

    head, _, tail = value.rpartition(",")
    head, tail = head.strip(), tail.strip()
    if not head or not tail:
        return value, ""

    tail_is_place = (
        tail.lower() in G.COUNTRIES
        or tail.upper() in G.US_STATE_ABBR
        or tail.lower() in G.US_STATE_NAMES
        or bool(find_location(tail))
    )
    if tail_is_place and G.INSTITUTION.search(head):
        return head, tail
    return value, ""


def split_location(location: str) -> dict:
    """Break "San Francisco, CA" into the schema's nested location object."""
    result = {"city": "", "state": "", "country": ""}
    value = (location or "").strip()
    if not value:
        return result

    parts = [p.strip() for p in value.split(",") if p.strip()]
    if not parts:
        return result

    if len(parts) == 1:
        only = parts[0]
        if only.lower() in G.COUNTRIES:
            result["country"] = only
        elif only.upper() in G.US_STATE_ABBR or only.lower() in G.US_STATE_NAMES:
            result["state"] = only
        else:
            result["city"] = only
        return result

    result["city"] = parts[0]
    tail = parts[1:]

    for part in tail:
        if part.lower() in G.COUNTRIES:
            result["country"] = part
        elif part.upper() in G.US_STATE_ABBR or part.lower() in G.US_STATE_NAMES:
            result["state"] = part
        elif not result["state"]:
            result["state"] = part

    # A US state implies the country even when the resume omits it.
    if result["state"] and result["state"].upper() in G.US_STATE_ABBR and not result["country"]:
        result["country"] = "USA"

    return result


# ─── PERSON ──────────────────────────────────────────────────────────────────

NAME_STOPWORDS = re.compile(
    r"\b(resume|curriculum\s+vitae|cv|profile|portfolio|contact|summary|experience"
    r"|education|skills|phone|email|address|linkedin|github|objective)\b", re.I)
CREDENTIALS = re.compile(
    r"\b(ph\.?d|m\.?b\.?a|m\.?sc|b\.?sc|md|rn|cpa|pmp|cfa|pe|esq|jr|sr|ii|iii|iv)\b\.?", re.I)

# What follows the comma after a name: post-nominals and honorifics. Everything
# from "BSN, RN" through "Dipl.-Ing." and "MSc, MRICS" attaches this way, and a
# name carrying them is otherwise rejected outright for containing a comma.
POST_NOMINAL_TAIL = re.compile(
    r",\s*(?:"
    r"[A-Z][A-Za-z]{0,4}\.?(?:\s*[.-]\s*[A-Za-z]{1,4}\.?)?"     # BSN, Dipl.-Ing.
    r"|[A-Z]{2,6}"                                              # RN, MRICS, FRCS
    r")(?:\s*,\s*(?:[A-Z][A-Za-z]{0,4}\.?|[A-Z]{2,6}))*\.?\s*$")


def looks_like_name(text: str) -> bool:
    value = re.sub(r"\t", " ", text or "").strip()
    if not 3 <= len(value) <= 48:
        return False
    if G.EMAIL.search(value) or re.search(r"https?:|www\.|@|\d", value):
        return False
    if NAME_STOPWORDS.search(value) or re.search(r"[|•·,;:/\\]", value):
        return False
    words = value.split()
    if not 2 <= len(words) <= 5:
        return False
    # Interior capitals must be allowed: "Tanaka-Whitfield", "O'Brien",
    # "McDonald" are all names.
    capped = sum(1 for w in words if re.fullmatch(r"[A-Z][A-Za-z'’.-]*", w) or re.fullmatch(r"[A-Z.'-]+", w))
    return capped / len(words) >= 0.7


def _name_candidate(text: str) -> str:
    """Strip what a resume attaches to a name before the name is tested."""
    candidate = (text or "").split("\t")[0]
    candidate = POST_NOMINAL_TAIL.sub("", candidate)
    candidate = CREDENTIALS.sub("", candidate)
    return candidate.strip(" ,.")


def find_person(lines: list[Line], preamble: list[Line]) -> str:
    """
    Find the name, preferring where it sits over how big it is.

    Size alone is not enough: a section heading is set large and bold too, and
    "EMPLOYMENT CHRONICLE" reads as a two-word capitalised name. The first
    lines of page one are checked first, and anything the segmenter would
    recognise as a section heading is refused outright.
    """
    from .segmenter import section_key

    page_one = [l for l in lines if l.page == 1]

    def usable(text: str) -> str:
        candidate = _name_candidate(text)
        if not looks_like_name(candidate) or section_key(candidate):
            return ""
        return candidate

    # Position first. A resume puts the name at the top; almost nothing else
    # that looks like a name appears there.
    for line in (preamble or page_one)[:6]:
        found = usable(line.text)
        if found:
            return found

    for line in sorted(page_one, key=lambda l: -l.size)[:5]:
        found = usable(line.text)
        if found:
            return found

    pool = preamble or lines[:12]
    for line in pool[:10]:
        for text in (line.text.split("\t")[0], line.text):
            found = usable(text)
            if found:
                return found

    # Last resort: derive it from the email's local part.
    for line in lines:
        match = G.EMAIL.search(line.text)
        if not match:
            continue
        local = match.group(0).split("@")[0]
        parts = [p for p in re.split(r"[._-]+", local) if len(p) > 1 and not any(c.isdigit() for c in p)]
        if len(parts) >= 2:
            return " ".join(p.capitalize() for p in parts[:3])
    return ""


# ─── ORG / ROLE ──────────────────────────────────────────────────────────────

def score_as_role(text: str) -> float:
    """How strongly a phrase reads as a job title rather than an employer."""
    value = (text or "").strip()
    if not value:
        return -99.0
    score = 0.0
    if G.ROLE_WORDS.search(value):
        score += 5
    if G.SENIORITY.search(value):
        score += 1.5
    if G.COMPANY_SUFFIX.search(value):
        score -= 4
    if G.INSTITUTION.search(value):
        score -= 3
    if G.EMPLOYMENT_TYPE.search(value):
        score += 1
    if re.match(r"^[a-z]", value):
        score -= 1
    words = len(value.split())
    if words <= 6:
        score += 1
    if words > 9:
        score -= 2
    return score


def score_as_company(text: str, *, all_caps: bool = False, caps_is_rare: bool = False) -> float:
    """
    How strongly a phrase reads as an employer rather than a job title.

    This is not simply the negative of `score_as_role`. An employer has
    positive evidence of its own — a legal suffix, an institution word — and
    one typographic convention is nearly decisive: a resume that sets the
    employer in capitals and everything else in mixed case has told you which
    line is the employer, in the only way plain text can.
    """
    value = (text or "").strip()
    if not value:
        return -99.0
    score = 0.0
    if G.COMPANY_SUFFIX.search(value):
        score += 5
    if G.INSTITUTION.search(value):
        score += 4
    if all_caps and caps_is_rare:
        score += 3.5
    if G.ROLE_WORDS.search(value):
        score -= 4
    if G.SENIORITY.search(value):
        score -= 1
    if re.match(r"^[a-z]", value):
        score -= 1
    words = len(value.split())
    if words > 8:
        score -= 2
    return score


def split_header_parts(text: str, *, split_at: bool = True, split_comma: bool = True) -> list[str]:
    """Split a header line on its visual separators, widest first."""
    raw = text or ""
    parts = raw.split("\t") if "\t" in raw else [raw]
    if len(parts) == 1:
        parts = re.split(r"\s{2,}", raw)
    if len(parts) == 1:
        parts = re.split(r"\s*[|•·]\s*", raw)
    if len(parts) == 1:
        parts = re.split(r"\s+[–—]\s+|\s+-\s+", raw)
    if len(parts) == 1 and split_at:
        parts = re.split(r"\s+(?:at|@|for|with)\s+", raw, flags=re.I)
    if len(parts) == 1 and split_comma and "," in raw:
        parts = raw.split(",")
    return [p.strip().strip(",;|•·-–— ") for p in parts if p.strip().strip(",;|•·-–— ")]


def _is_prose(text: str) -> bool:
    """
    Does this line read as a description rather than a header field?

    An employer, a job title and a date range are all short label-like
    fragments. A responsibility is a sentence. Ending in a full stop is the
    clearest signal, but a short line can end in one too ("Acme Corp."), so a
    length floor keeps company names out.
    """
    if len(text) > 110:
        return True
    if bool(re.search(r"[.!?]\s", text)) and len(text) > 60:
        return True
    return bool(re.search(r"[.!?]$", text)) and len(text) > 45


def read_labelled_fields(lines: list[Line]) -> dict[str, str]:
    """
    Read "Organisation: …" style lines, which name their own field.

    Where a resume labels its fields there is nothing left to infer, and an
    inferred answer would only be worse. Returns whichever of company,
    position, dates and location the entry states outright.
    """
    found: dict[str, str] = {}
    for line in lines:
        text = line.text.replace("\t", " ").strip()
        match = G.ENTRY_LABEL.match(text)
        if not match:
            continue
        field = G.ENTRY_LABELS.get(match.group(1).lower(), "")
        value = text[match.end():].strip(" .;,")
        if not field or not value or len(value) > 120:
            continue
        found.setdefault(field, value)
    return found


def inherit_nested_employers(roles: list[dict]) -> list[dict]:
    """
    Give a promotion the employer it was promoted at.

    A single employer with two titles is written as one heading and two dated
    sub-entries:

        OHIO VALLEY REHABILITATION & NURSING CENTER      06/2015 - 08/2018
        Unit Manager, Skilled Nursing (Hall B)           03/2017 - 08/2018
        Staff Registered Nurse                           06/2015 - 03/2017

    The sub-entries name no employer because the heading above already did.
    An entry is treated as belonging to the one above it only when its dates
    fall inside that entry's range — which is what makes it a sub-period of the
    same job rather than the next one.
    """
    for index, role in enumerate(roles):
        if role["company"] or not role["position"]:
            continue
        for previous in reversed(roles[:index]):
            if not previous["company"]:
                continue
            outer_start, outer_end = previous["start_date"], previous["end_date"]
            inner_start, inner_end = role["start_date"], role["end_date"]
            if not (outer_start and inner_start):
                break
            outer_end = "9999" if outer_end == "Present" else outer_end
            inner_end = "9999" if inner_end == "Present" else inner_end
            if outer_start <= inner_start and (not outer_end or not inner_end
                                               or inner_end <= outer_end):
                role["company"] = previous["company"]
                role["location"] = role["location"] or previous["location"]
            break
    return roles


def parse_experience_entry(entry: Entry) -> dict:
    """Resolve one job entry into company, position, location, dates and duties."""
    header_lines = [l for l in entry.header_lines if not _is_prose(l.text)] or entry.header_lines[:1]
    header_lines = header_lines[:6]

    labelled = read_labelled_fields(header_lines)

    dates = DateRange()
    if labelled.get("dates"):
        dates = find_date_range(labelled["dates"])
    if not dates.found:
        for line in header_lines:
            found = find_date_range(line.text)
            if found.found:
                dates = found
                break

    location = ""
    location_line: Line | None = None
    if labelled.get("location"):
        location = find_location(labelled["location"]) or labelled["location"]
    if not location:
        for line in header_lines:
            found = find_location(strip_dates(line.text))
            if found:
                location, location_line = found, line
                break

    company = ""
    if labelled.get("company"):
        stated = labelled["company"]
        place = find_location(stated)
        if place and place != stated:
            company = stated[: stated.rfind(place)].strip(" ,-–—")
            location = location or place
        else:
            company = stated

    # "Employer, City" on one line is a very common sub-heading; split it
    # rather than losing the employer to the location field.
    if location and location_line is not None:
        bare = strip_dates(location_line.text).strip()
        if bare == location and "," in bare:
            head, _, tail = bare.rpartition(",")
            head, tail = head.strip(), tail.strip()
            if head and tail and (G.COMPANY_SUFFIX.search(head) or len(head.split()) >= 2 or location_line.italic):
                company, location = head, tail

    candidates: list[dict] = []
    for index, line in enumerate(header_lines):
        cleaned = strip_dates(line.text)
        label = G.ENTRY_LABEL.match(cleaned.replace("\t", " ").strip())
        if label:
            field = G.ENTRY_LABELS.get(label.group(1).lower(), "")
            # A labelled line only ever supplies its own field. "Client: Bank
            # of America" must not become the employer, and the label itself
            # must never survive into a value.
            if field not in {"company", "position"}:
                continue
            cleaned = cleaned[label.end():]
        if location:
            cleaned = cleaned.replace(location, " ")
        if company:
            cleaned = cleaned.replace(company, " ")
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
        if not cleaned:
            continue
        for part in split_header_parts(cleaned):
            if not 2 <= len(part) <= 90:
                continue
            candidates.append({
                "text": part,
                "index": index,
                "italic": line.italic,
                "bold": line.bold,
                "all_caps": line.all_caps,
                "first": index == 0,
            })

    position = labelled.get("position", "")
    ranked = sorted(
        candidates,
        key=lambda c: (
            -(score_as_role(c["text"]) + (1.5 if c["bold"] else 0) + (1 if c["first"] else 0) - (1.5 if c["italic"] else 0)),
            c["index"],
        ),
    )

    if ranked:
        if not position:
            top = ranked[0]
            caps_rare = 0 < sum(1 for c in candidates if c["all_caps"]) < len(candidates)
            # With a single name to place, "which is it?" is a real question.
            # "OHIO VALLEY REHABILITATION & NURSING CENTER" is an employer, and
            # defaulting to the job title leaves the employer blank rather than
            # merely mislabelled.
            as_company = score_as_company(top["text"], all_caps=top["all_caps"],
                                          caps_is_rare=caps_rare)
            if not company and as_company > score_as_role(top["text"]) + 1.0:
                company = top["text"]
            else:
                position = top["text"]
            rest = sorted(ranked[1:], key=lambda c: c["index"])
        else:
            rest = sorted(ranked, key=lambda c: c["index"])

        # A place is never the employer. "Franklin Lakes, NJ" and "München"
        # sit on their own line in many layouts, and taken as a company they
        # silently replace the real one — the kind of error nobody notices
        # until they read the parsed record back.
        place_lines = {c["index"] for c in candidates if find_location(c["text"])}

        # Capitals only carry meaning when the entry does not shout throughout.
        caps_is_rare = 0 < sum(1 for c in candidates if c["all_caps"]) < len(candidates)

        if not company and rest:
            pool = [c for c in rest if c["index"] not in place_lines] or rest
            best = max(
                pool,
                key=lambda c: (
                    score_as_company(c["text"], all_caps=c["all_caps"],
                                     caps_is_rare=caps_is_rare),
                    -c["index"],
                ),
                default=None,
            )
            if best is not None:
                company = best["text"]
                rest = [c for c in rest if c is not best]
        if not location:
            location = next((find_location(c["text"]) or "" for c in rest
                             if find_location(c["text"])), "")

    # "Senior Engineer at Acme" arriving unsplit still needs separating.
    if position and not company:
        match = re.match(r"^(.*?)\s+(?:at|@|,)\s+(.+)$", position, re.I)
        if match and score_as_role(match.group(1)) >= score_as_role(match.group(2)):
            position, company = match.group(1).strip(), match.group(2).strip()

    # Everything past the header block describes the role, whether or not it
    # was written as a bullet. Word resumes frequently list duties as plain
    # paragraphs inside a table cell, and treating only bulleted lines as
    # responsibilities loses every one of them.
    consumed = {id(l) for l in header_lines}
    tail = [l for l in entry.header_lines if id(l) not in consumed]

    responsibilities: list[str] = []
    environment = ""
    for line in tail + entry.detail_lines:
        text = line.text.replace("\t", " ").strip()
        if not text:
            continue
        if G.ENVIRONMENT_LINE.match(text):
            environment = G.ENVIRONMENT_LINE.sub("", text).strip()
            continue
        responsibilities.append(text)

    return {
        "company": _clean(company),
        "position": _clean(position),
        "location": _clean(location),
        "start_date": _iso(dates.start),
        "end_date": _iso(dates.end),
        "current": dates.current,
        "responsibilities": [r for r in responsibilities if r],
        "environment": environment,
    }


def parse_education_entry(entry: Entry) -> dict:
    """Resolve one education entry into institution, degree, major and dates."""
    lines = entry.all_lines
    joined = " \n ".join(l.text for l in lines)

    dates = find_date_range(joined)
    if not dates.found:
        years = G.YEAR.findall(joined)
        if len(years) == 1:
            dates = DateRange(end=years[0])
        elif len(years) > 1:
            dates = DateRange(start=years[0], end=years[-1])

    institution = ""
    location = ""
    degree_from_line = ""

    # Resolve the institution before the location, because a school name
    # frequently contains something that reads as a place on its own
    # ("University of Southern Mississippi"). Splitting on the line's visual
    # separators first keeps "B.S. Computer Science, San Jose State University"
    # from collapsing into a single institution.
    for line in lines:
        # A level-1 bullet is an entry header in the "• Institution / Degree"
        # layout, so it must be considered here; only nested detail bullets
        # ("Relevant coursework: ...") are skipped.
        if line.bullet_level >= 2 or not G.INSTITUTION.search(line.text):
            continue

        parts = split_header_parts(strip_dates(line.text), split_at=False)
        named = next((p for p in parts if G.INSTITUTION.search(p)), "")
        if not named:
            continue

        # "Master of Science in Information Technology from University of
        # Houston" is one line naming both. Taken whole it becomes an
        # institution that is really a sentence, and the degree is lost.
        qualification, school = split_school_off(named)
        if school and G.INSTITUTION.search(school):
            named = school
            if not degree_from_line:
                degree_from_line = qualification

        institution = named
        for part in parts:
            if part is named or part == named:
                continue
            place = find_location(part) or (part if part.lower() in G.COUNTRIES else "")
            if place:
                location = place
                break
        break

    if not location:
        for line in lines:
            found = find_location(strip_dates(line.text))
            if found and (not institution or found not in institution):
                location = found
                break

    degree = degree_from_line
    extras: list[dict] = []
    degree_line = -1
    coursework: list[str] = []

    for index, line in enumerate(lines):
        text = line.text
        if G.COURSEWORK.match(text):
            body = G.COURSEWORK.sub("", text)
            coursework.extend(p.strip() for p in re.split(r"[,;]", body) if p.strip())
            continue

        body = strip_dates(text)
        if location:
            body = body.replace(location, " ").strip(" ,")

        if institution and institution in body:
            body = body.replace(institution, " ").strip(" ,")

        for part in split_header_parts(body, split_at=False):
            if len(part) < 2:
                continue
            if not institution and G.INSTITUTION.search(part):
                institution = part
                continue
            if not degree and G.DEGREE.search(part):
                degree = part
                degree_line = index
                continue
            extras.append({"text": part, "bold": line.bold, "bullet": line.bullet, "line": index})

    if not degree:
        candidate = next((e for e in extras if e["bold"] and not G.INSTITUTION.search(e["text"]) and len(e["text"]) < 70), None)
        if candidate:
            degree, degree_line = candidate["text"], candidate["line"]
            extras.remove(candidate)

    if not institution:
        candidate = next(
            (e for e in extras if not e["bullet"] and len(e["text"]) < 70
             and not find_location(e["text"]) and re.match(r"^[A-Z]", e["text"])),
            None,
        )
        if candidate:
            institution = candidate["text"]
            extras.remove(candidate)

    # "…in Information Technology from Wilmington University" names the school
    # inside the degree string. Split it off before the major is worked out, or
    # the university becomes part of the field of study and is never recovered.
    degree, school = split_school_off(degree)
    if school and (not institution or G.INSTITUTION.search(school)):
        found_place = find_location(school)
        if found_place and found_place != school:
            institution = school[: school.rfind(found_place)].strip(" ,-–—")
            location = location or found_place
        else:
            institution = school

    degree, major = split_degree_major(degree)

    if not major and degree_line >= 0:
        sibling = next(
            (e for e in extras if e["line"] == degree_line and not e["bullet"]
             and len(e["text"]) <= 60 and not re.search(r"\d", e["text"])),
            None,
        )
        if sibling:
            major = sibling["text"]
            extras.remove(sibling)

    gpa_match = G.GPA.search(joined)
    gpa = next((g for g in (gpa_match.groups() if gpa_match else []) if g), "") if gpa_match else ""

    return {
        "institution": _clean(institution),
        "degree": _clean(degree),
        "major": _clean(major),
        "location": _clean(location),
        "start_date": _iso(dates.start),
        "graduation_date": _iso(dates.end),
        "gpa": gpa,
        "coursework": coursework[:20],
    }


SCHOOL_PREPOSITION = re.compile(
    r"\s+(?:from|at)\s+(?=(?:the\s+)?\S)", re.I)


def split_school_off(raw: str) -> tuple[str, str]:
    """
    Separate "<qualification> from <institution>" into its two halves.

    "Master of Science in Information Technology from Wilmington University"
    and "B.Tech in Computer Science from JNTU Hyderabad" are how a very large
    share of resumes write a degree, and read as one string the institution
    ends up buried inside the major — so the school is never found at all.
    """
    text = _clean(raw)
    if not text:
        return "", ""
    match = SCHOOL_PREPOSITION.search(text)
    if not match:
        return text, ""
    head, tail = text[: match.start()].strip(), text[match.end():].strip()
    if len(head) < 3 or len(tail) < 3 or len(tail.split()) > 9:
        return text, ""
    return head, tail


def split_degree_major(raw: str) -> tuple[str, str]:
    """
    Separate a degree from its field of study.

    The split point is the LAST " in ", never the first: "Master of Technology
    in Computer Science" splits after "Technology". A first-match split leaves
    the degree as a bare "Master" and drags half of it into the major.
    """
    text = _clean(raw)
    if not text:
        return "", ""

    lowered = text.lower()
    index = lowered.rfind(" in ")
    if index > 0:
        degree, major = text[:index].strip(), text[index + 4:].strip()
        if len(degree) >= 2 and len(major) >= 2 and len(major.split()) <= 8:
            return degree, major

    match = re.match(r"^([^,]{2,40}),\s*(.{2,60})$", text)
    if match and G.DEGREE.search(match.group(1)) and not re.search(r"\d", match.group(2)):
        return match.group(1).strip(), match.group(2).strip()

    match = re.match(
        r"^((?:b|m)\.?\s?(?:s|a|sc|e|eng|tech|com|ba|ca)\.?|ph\.?\s?d\.?|mba|bca|mca)\s+(.{3,60})$",
        text, re.I,
    )
    if match and not re.match(r"^(?:of|in)\b", match.group(2), re.I):
        return match.group(1).strip(), match.group(2).strip()

    return text, ""


# ─── SKILL ───────────────────────────────────────────────────────────────────

def canonical_skill(value: str) -> str:
    key = re.sub(r"\s+", " ", (value or "").strip().lower())
    return G.SKILL_CANONICAL.get(key, value.strip())


def classify_skill(value: str) -> str:
    return "soft" if (value or "").strip().lower() in G.SOFT_SKILLS else "technical"


_SKILL_SEPARATORS = re.compile(r"[,;|•·]|\s{2,}|\s+/\s+|\s+[–—]\s+")


def _split_skill_list(text: str) -> list[str]:
    """
    Split a skills line on its separators, but never inside brackets.

    "AWS (S3, Lambda, EC2, Bedrock)" is one skill written with examples, not
    four. Splitting on every comma turns it into "AWS (S3" and a dangling
    "Bedrock)", which is worse than not splitting at all — the reader is left
    with fragments that match nothing.
    """
    pieces: list[str] = []
    depth = 0
    start = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char in "([{":
            depth += 1
            index += 1
            continue
        if char in ")]}":
            depth = max(0, depth - 1)
            index += 1
            continue
        if depth == 0:
            match = _SKILL_SEPARATORS.match(text, index)
            if match and match.end() > index:
                pieces.append(text[start:index])
                index = match.end()
                start = index
                continue
        index += 1
    pieces.append(text[start:])
    return [p for p in (piece.strip() for piece in pieces) if p]


def parse_skills(lines: list[Line]) -> dict:
    """
    Extract skills, keeping the resume's own categories and splitting technical
    from soft for the output schema.
    """
    technical: list[str] = []
    soft: list[str] = []
    categories: dict[str, list[str]] = {}
    seen: set[str] = set()

    def add(raw: str, category: str = "") -> None:
        value = (raw or "").replace("\t", " ").strip()
        value = re.sub(r"\s{2,}", " ", value)
        value = re.sub(r"^[\s,;|•·/–—-]+|[\s,;|•·/–—-]+$", "", value)
        value = re.sub(r"\s*\((?:advanced|intermediate|basic|beginner|expert|proficient|\d+\+?\s*(?:years?|yrs?))\)$", "", value, flags=re.I)
        if not 2 <= len(value) <= 48:
            return
        if G.SKILL_NOISE.match(value) or re.fullmatch(r"[\d\W]+", value):
            return
        if len(value.split()) > 6:
            return

        value = canonical_skill(value)
        key = re.sub(r"[^a-z0-9+#.]", "", value.lower())
        if not key or key in seen:
            return
        seen.add(key)

        if classify_skill(value) == "soft":
            soft.append(value)
        else:
            technical.append(value)
        if category:
            categories.setdefault(category, []).append(value)

    for line in lines:
        text = line.text.replace("\t", " ").strip()
        if not text:
            continue

        category = ""
        match = G.SKILL_CATEGORY.match(text)
        body = text
        if match:
            label = match.group(1).strip()
            # Only treat it as a category when the label is short and the tail
            # is a list — otherwise "Note: I enjoy ..." becomes a category.
            if len(label.split()) <= 5:
                category = label
                body = text[match.end():]

        pieces = _split_skill_list(body)
        if len(pieces) == 1 and not match:
            add(body)
        else:
            for piece in pieces:
                add(piece, category)

    return {
        "technical": technical[:80],
        "soft": soft[:30],
        "categories": {k: v for k, v in categories.items() if v},
    }


# ─── Simple list sections ────────────────────────────────────────────────────

def parse_certifications(lines: list[Line]) -> list[dict]:
    out: list[dict] = []
    for line in lines:
        text = _clean(line.text)
        if len(text) < 3:
            continue

        dates = find_date_range(text)
        date = _iso(dates.end or dates.start) if dates.found else ""
        rest = strip_dates(text) if dates.found else text

        name, issuer = rest, ""
        by_paren = re.match(r"^(.*?)\s*\(([^)]{2,60})\)\s*$", rest)
        by_issued = re.match(r"^(.*?)\s*[-–—,]?\s*(?:issued\s+by|from|by)\s+(.+)$", rest, re.I)
        by_dash = re.match(r"^(.*?)\s+[–—|]\s+(.+)$", rest)
        by_comma = re.match(r"^(.*),\s*([^,]{2,48})$", rest)

        if by_issued:
            name, issuer = by_issued.group(1), by_issued.group(2)
        elif by_dash:
            name, issuer = by_dash.group(1), by_dash.group(2)
        elif by_paren:
            name, issuer = by_paren.group(1), by_paren.group(2)
        elif by_comma and "," not in by_comma.group(2):
            name, issuer = by_comma.group(1), by_comma.group(2)

        name = _clean(name)
        if name:
            out.append({"name": name, "issuer": _clean(issuer), "date": date})
    return out[:30]


def parse_projects(entries: list[Entry], fallback_lines: list[Line]) -> list[dict]:
    out: list[dict] = []
    source = entries or [Entry(header_lines=[l]) for l in fallback_lines]

    for entry in source:
        lines = entry.all_lines
        if not lines:
            continue
        joined = " ".join(l.text for l in lines)
        urls = find_urls(joined)
        link = normalise_url(urls[0]) if urls else ""

        head = entry.header_lines[0] if entry.header_lines else lines[0]
        name = _clean(G.URL.sub("", strip_dates(head.text)))
        description = " ".join(l.text for l in lines if l is not head)

        if not description and name:
            # "Name - what it does" on a single line.
            match = re.match(r"^(.{2,70}?)\s*[–—:-]\s+(.+)$", name)
            if match:
                name, description = match.group(1).strip(), match.group(2).strip()

        name = _clean(G.URL.sub("", name))[:120]
        if not name:
            continue
        out.append({
            "name": name,
            "link": link,
            "description": _clean(G.URL.sub("", description)),
        })
    return out[:25]


def parse_flat_list(lines: list[Line], *, split_inline: bool = True, limit: int = 40) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        text = line.text.replace("\t", " ").strip()
        if not text:
            continue
        pieces = re.split(r"[,;|•·]|\s{2,}", text) if (split_inline and not line.bullet and len(text) < 140) else [text]
        for piece in pieces:
            value = _clean(piece)
            if len(value) < 2 or value.lower() in seen:
                continue
            seen.add(value.lower())
            out.append(value)
    return out[:limit]


def parse_publications(lines: list[Line]) -> list[dict]:
    out: list[dict] = []
    for line in lines:
        text = _clean(line.text)
        if len(text) < 8:
            continue
        urls = find_urls(text)
        dates = find_date_range(text)
        out.append({
            "title": _clean(G.URL.sub("", text)) or text,
            "link": normalise_url(urls[0]) if urls else "",
            "date": _iso(dates.end or dates.start) if dates.found else "",
        })
    return out[:20]


# ─── Contact block ───────────────────────────────────────────────────────────

def parse_contact(segmentation: Segmentation, all_lines: list[Line]) -> dict:
    """Assemble the contact block from the preamble, falling back to the page."""
    contact_lines = list(segmentation.preamble) + list(segmentation.lines_for("contact"))
    contact_text = "\n".join(l.text for l in contact_lines)
    whole_text = "\n".join(l.text for l in all_lines)

    name = find_person(all_lines, segmentation.preamble)
    email = find_email(contact_text) or find_email(whole_text)
    phone = find_phone(contact_text) or find_phone("\n".join(l.text for l in all_lines[:25]))

    # The fallback window is deliberately small and skips bulleted lines: a
    # skills list further down the page is full of "X, Y" pairs that look like
    # a city and a region but are not.
    location = find_location(contact_text)
    if not location:
        head = [l.text for l in all_lines[:8] if not l.bullet]
        location = find_location("\n".join(head))

    linkedin_match = G.LINKEDIN.search(contact_text) or G.LINKEDIN.search(whole_text)
    github_match = G.GITHUB.search(contact_text) or G.GITHUB.search(whole_text)

    urls = find_urls(contact_text or whole_text)
    website = next((u for u in urls if not G.SOCIAL_HOSTS.search(u)), "")
    if not website and github_match:
        website = github_match.group(0)

    # A headline is the line under the name that is not contact data.
    headline = ""
    for line in segmentation.preamble[:6]:
        text = _clean(line.text.split("\t")[0])
        if not text or len(text) > 70 or text == name:
            continue
        if G.EMAIL.search(text) or re.search(r"https?:|www\.|@", text) or find_phone(text):
            continue
        if find_location(text) == text:
            continue
        if looks_like_name(text) and text == name:
            continue
        headline = text
        break

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "linkedin": normalise_url(linkedin_match.group(0)) if linkedin_match else "",
        "github": normalise_url(github_match.group(0)) if github_match else "",
        "website": normalise_url(website),
        "location": split_location(location),
        "location_raw": location,
        "headline": headline,
    }


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _clean(value: str) -> str:
    text = (value or "").replace("\t", " ")
    # strip_dates leaves the punctuation that wrapped the date behind, e.g.
    # "University (2013 - 2017)" becomes "University ( )".
    text = re.sub(r"\(\s*[-–—,]?\s*\)", " ", text)
    text = re.sub(r"\[\s*\]", " ", text)
    text = re.sub(r"^[\s,;|•·–—-]+|[\s,;|•·–—-]+$", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()
