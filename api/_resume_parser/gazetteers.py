"""
Dictionaries and grammars backing the NER engine.

Kept apart from the recognition logic so the vocabulary can grow without
touching the algorithms. Everything here is data.
"""

from __future__ import annotations

import re

# ─── Dates ───────────────────────────────────────────────────────────────────

MONTH = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?"
    r"|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
SEASON = r"spring|summer|fall|autumn|winter"
# "Present" in the languages a resume is actually written in.
PRESENT = (r"present|current(?:ly)?|now|ongoing|to\s*date|till\s*date|date"
           r"|heute|aktuell|laufend|en\s*cours|actuel(?:lement)?|aujourd'hui"
           r"|hasta\s*la\s*fecha|actualidad|nu")

MONTH_NUMBER = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

ONE_DATE = (
    rf"(?:(?:{SEASON})\s+\d{{4}}"
    rf"|(?:{MONTH})\.?\s*,?\s*'?\d{{2,4}}"
    rf"|\d{{1,2}}\s*[/.-]\s*\d{{4}}"
    rf"|\d{{4}}\s*[/.-]\s*\d{{1,2}}"
    rf"|\d{{4}})"
)

# "since March 2021" and its equivalents state a start with an open end. Read
# as a bare year it loses the fact that the job is the current one.
SINCE = r"since|as\s+of|from|seit|ab|depuis|desde|dal|sedan|vanaf|sinds"

DATE_RANGE = re.compile(
    rf"({ONE_DATE})\s*(?:[-–—~]|to|until|through)\s*({PRESENT}|{ONE_DATE})",
    re.I,
)
SINCE_DATE = re.compile(rf"(?:^|[\s(|,\t])(?:{SINCE})\s+({ONE_DATE})\b", re.I)
SINGLE_DATE = re.compile(rf"(?:^|[\s(|,\t])((?:{MONTH})\.?\s*,?\s*\d{{4}}|\d{{4}})(?:$|[\s)|,.\t])", re.I)
YEAR = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")

# ─── Contact ─────────────────────────────────────────────────────────────────

EMAIL = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
URL = re.compile(
    r"\b((?:https?://)?(?:www\.)?[A-Za-z0-9][A-Za-z0-9-]{0,61}"
    r"\.[A-Za-z]{2,}(?:\.[A-Za-z]{2,})?(?:/[^\s,;)<>\]]*)?)"
)
LINKEDIN = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/(?:in|pub|profile)/[^\s,;)|<>\]]+", re.I)
GITHUB = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9_-]+(?:/[^\s,;)|<>\]]*)?", re.I)

SOCIAL_HOSTS = re.compile(
    r"(linkedin|github|gitlab|bitbucket|twitter|x\.com|facebook|instagram|medium"
    r"|dev\.to|behance|dribbble|stackoverflow|kaggle|leetcode|orcid|hackerrank)",
    re.I,
)

# Labels that prefix a contact value and should be stripped from it.
CONTACT_LABEL = re.compile(
    r"^\s*(e-?mail|mail|phone|mobile|cell|tel(?:ephone)?|contact|address|location"
    r"|linkedin|github|portfolio|website|web|site|blog)\s*[:\-–|]\s*",
    re.I,
)

# ─── Places ──────────────────────────────────────────────────────────────────

US_STATE_ABBR = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
    "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
    "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
}

US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming",
}

COUNTRIES = {
    "usa", "u.s.a.", "u.s.", "us", "united states", "united states of america",
    "uk", "united kingdom", "england", "scotland", "wales", "ireland",
    "canada", "australia", "new zealand", "india", "pakistan", "bangladesh",
    "sri lanka", "nepal", "china", "japan", "south korea", "singapore",
    "malaysia", "indonesia", "philippines", "vietnam", "thailand",
    "germany", "france", "spain", "portugal", "italy", "netherlands",
    "belgium", "switzerland", "austria", "poland", "czech republic", "czechia",
    "hungary", "romania", "bulgaria", "greece", "turkey", "ukraine", "russia",
    "sweden", "norway", "denmark", "finland", "iceland", "estonia", "latvia",
    "lithuania", "brazil", "mexico", "argentina", "chile", "colombia", "peru",
    "south africa", "nigeria", "kenya", "ghana", "egypt", "morocco",
    "uae", "united arab emirates", "saudi arabia", "qatar", "kuwait", "israel",
}

WORK_MODES = {"remote", "hybrid", "on-site", "onsite", "in-office"}

# Words that look like a place in "X, Y" form but never are.
NOT_A_PLACE = re.compile(
    r"\b(bachelors?|masters?|mba|mfa|bfa|ph\.?d|b\.?\s?[sae]|m\.?\s?[sae]|b\.?tech"
    r"|m\.?tech|degree|diploma|certificate|certification|university|college"
    r"|institute|school|academy|engineer|developer|designer|manager|director"
    r"|analyst|scientist|consultant|intern|science|arts?|engineering|technology"
    r"|management|administration|studies|design|honou?rs?|gpa|cgpa|present)\b",
    re.I,
)

# ─── Organisations ───────────────────────────────────────────────────────────

COMPANY_SUFFIX = re.compile(
    r"\b(inc\.?|llc|l\.l\.c\.?|ltd\.?|limited|corp\.?|corporation|company|co\.?"
    r"|gmbh|pvt\.?|private|plc|s\.a\.?|b\.v\.?|n\.v\.?|ag|sarl|oy|ab|as"
    r"|technologies|technology|tech|solutions|systems|services|labs?"
    r"|laboratories|group|holdings|partners|ventures|capital|consulting"
    r"|associates|agency|studio|media|networks?|software|digital|global"
    r"|international|industries|enterprises|foundation|bank|insurance"
    # Most employers are not technology companies. Healthcare, education, the
    # public sector and the trades name themselves with their own words, and a
    # vocabulary drawn only from software leaves every one of them unrecognised.
    r"|hospital|healthcare|health|medical|clinic|centers?|centres?|nursing"
    r"|care|hospice|pharmacy|dental|surgery|practice"
    r"|contractors?|construction|engineering|electrical|plumbing|facilities"
    r"|logistics|transport|haulage|manufacturing|motors?|works"
    r"|council|authority|department|ministry|agency|bureau|trust|board"
    r"|district|municipality|commission|association|society|union"
    r"|retail|stores?|supermarkets?|hotels?|resorts?|restaurants?"
    r"|museum|library|gallery|theatre|theater|church|charity)\b",
    re.I,
)

INSTITUTION = re.compile(
    r"\b(universit(?:y|e|at|ä|y of)|universidad|università|college|institute"
    r"|institut|school|academy|polytechnic|iit|nit|iiit|iim|bits|ecole|école"
    r"|campus|seminary|conservatory|gymnasium|hochschule)\b",
    re.I,
)

# ─── Roles ───────────────────────────────────────────────────────────────────

ROLE_WORDS = re.compile(
    r"\b(engineer|developer|programmer|architect|analyst|scientist|designer"
    r"|manager|director|lead|head|chief|officer|president|vp|vice\s+president"
    r"|consultant|specialist|coordinator|administrator|associate|assistant"
    r"|intern|trainee|apprentice|founder|co-?founder|owner|partner|principal"
    r"|senior|junior|staff|executive|supervisor|strategist|researcher"
    r"|technician|advisor|writer|editor|marketer|recruiter|accountant|auditor"
    r"|attorney|nurse|physician|teacher|professor|instructor|freelance"
    r"|contractor|sde|swe|cto|ceo|coo|cfo|cio|pm|tpm|em|practitioner"
    r"|therapist|paralegal|clerk|agent|representative|operator|foreman)\b",
    re.I,
)

SENIORITY = re.compile(
    r"\b(intern|junior|jr\.?|associate|mid|senior|sr\.?|staff|principal|lead"
    r"|head|director|vp|chief|executive)\b",
    re.I,
)

EMPLOYMENT_TYPE = re.compile(
    r"\b(full[-\s]?time|part[-\s]?time|contract|contractor|freelance|internship"
    r"|temporary|permanent|seasonal|volunteer)\b",
    re.I,
)

# ─── Education ───────────────────────────────────────────────────────────────

DEGREE = re.compile(
    r"\b(bachelor'?s?|master'?s?|associate'?s?|doctorate|doctoral|ph\.?\s?d"
    r"|m\.?b\.?a|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|m\.?\s?e\b|b\.?\s?sc"
    r"|m\.?\s?sc|b\.?\s?a\b|m\.?\s?a\b|b\.?\s?s\b|m\.?\s?s\b|b\.?\s?com"
    r"|m\.?\s?com|bca|mca|llb|llm|md\b|dds|dvm|pharm\.?d|ed\.?d|mfa|bfa"
    r"|diplome?|diploma|certificate|hnd|gcse|a[-\s]?levels?|high\s+school"
    r"|secondary\s+school|post[-\s]?graduate|undergraduate)\b",
    re.I,
)

GPA = re.compile(
    r"\b(?:c?gpa|grade|score|percentage|marks?)\s*[:\-]?\s*"
    r"([0-9]{1,2}(?:\.[0-9]{1,2})?)\s*(?:/\s*([0-9]{1,3}(?:\.[0-9]{1,2})?)|%)?"
    r"|\b([0-9]\.[0-9]{1,2})\s*/\s*([0-9]{1,2}(?:\.[0-9]{1,2})?)\b",
    re.I,
)

COURSEWORK = re.compile(r"^\s*(?:relevant\s+)?course\s?work\s*:?\s*", re.I)

# ─── Skills ──────────────────────────────────────────────────────────────────

# Soft skills are separated from technical ones because the output schema
# splits them. Matching is on the whole phrase, case-insensitively.
SOFT_SKILLS = {
    "team leadership", "leadership", "communication", "written communication",
    "verbal communication", "teamwork", "collaboration", "cross-functional collaboration",
    "problem solving", "problem-solving", "critical thinking", "analytical thinking",
    "time management", "project management", "stakeholder management",
    "agile methodology", "agile", "scrum", "kanban", "mentoring", "coaching",
    "public speaking", "presentation", "negotiation", "conflict resolution",
    "adaptability", "creativity", "attention to detail", "decision making",
    "emotional intelligence", "customer service", "client relations",
    "strategic planning", "organization", "organisational skills", "multitasking",
    "interpersonal skills", "work ethic", "self-motivated", "initiative",
    "people management", "team building", "change management", "facilitation",
}

# Canonical spellings, so "nodejs", "node js" and "Node.JS" all report Node.js.
SKILL_CANONICAL = {
    "js": "JavaScript", "javascript": "JavaScript", "ts": "TypeScript",
    "typescript": "TypeScript", "nodejs": "Node.js", "node js": "Node.js",
    "node.js": "Node.js", "node": "Node.js", "reactjs": "React", "react.js": "React",
    "react": "React", "vuejs": "Vue.js", "vue": "Vue.js", "angularjs": "Angular",
    "angular": "Angular", "nextjs": "Next.js", "next.js": "Next.js",
    "postgres": "PostgreSQL", "postgresql": "PostgreSQL", "psql": "PostgreSQL",
    "mongo": "MongoDB", "mongodb": "MongoDB", "mysql": "MySQL",
    "k8s": "Kubernetes", "kubernetes": "Kubernetes", "docker": "Docker",
    "aws": "AWS", "amazon web services": "AWS", "gcp": "GCP",
    "google cloud platform": "GCP", "azure": "Azure", "ms azure": "Azure",
    "tensorflow": "TensorFlow", "pytorch": "PyTorch", "sklearn": "Scikit-learn",
    "scikit learn": "Scikit-learn", "scikit-learn": "Scikit-learn",
    "numpy": "NumPy", "pandas": "Pandas", "matplotlib": "Matplotlib",
    "powerbi": "Power BI", "power bi": "Power BI", "tableau": "Tableau",
    "c#": "C#", "c++": "C++", "csharp": "C#", "cpp": "C++",
    "golang": "Go", "go": "Go", "restapi": "REST API", "rest api": "REST API",
    "restful api": "REST API", "restful apis": "REST API", "graphql": "GraphQL",
    "ci/cd": "CI/CD", "cicd": "CI/CD", "nlp": "NLP",
    "natural language processing": "NLP", "ml": "Machine Learning",
    "machine learning": "Machine Learning", "ai": "Artificial Intelligence",
    "artificial intelligence": "Artificial Intelligence", "genai": "Generative AI",
    "generative ai": "Generative AI", "llm": "LLM", "llms": "LLM",
    "large language models": "LLM", "rag": "RAG", "langchain": "LangChain",
    "huggingface": "Hugging Face", "hugging face": "Hugging Face",
    "spacy": "spaCy", "nltk": "NLTK", "fastapi": "FastAPI", "flask": "Flask",
    "django": "Django", "spring boot": "Spring Boot", "dotnet": ".NET",
    ".net": ".NET", "html": "HTML", "css": "CSS", "sql": "SQL",
    "nosql": "NoSQL", "etl": "ETL", "snowflake": "Snowflake", "redis": "Redis",
    "kafka": "Kafka", "spark": "Spark", "airflow": "Airflow", "terraform": "Terraform",
    "git": "Git", "jira": "Jira", "figma": "Figma", "excel": "Excel",
}

# Category labels used inside a Skills section, e.g. "Programming & ML: ...".
SKILL_CATEGORY = re.compile(
    r"^\s*([A-Za-z][A-Za-z&/+,.\s-]{1,44}?)\s*[:\-–]\s*(?=\S)",
)

SKILL_NOISE = re.compile(
    r"^(?:and|or|etc\.?|others?|various|including|proficient(?:\s+in)?|familiar(?:\s+with)?"
    r"|experienced?(?:\s+in)?|expert|advanced|intermediate|beginner|basic"
    r"|working\s+knowledge|strong|excellent|good|skills?|technologies|tools?)$",
    re.I,
)

# ─── Sentence-level noise ────────────────────────────────────────────────────

# Lines inside an experience entry that describe the tech stack rather than an
# accomplishment. Kept, but flagged so they are not mistaken for a duty.
# Whole dialects of resume label their fields outright, one per line:
#
#     Organisation: Al Futtaim Group Technologies LLC, Dubai
#     Designation:  Senior SAP ABAP Consultant
#     Duration:     October 2022 to Present
#
# The label says exactly which field the value belongs to, which is better
# evidence than any amount of ranking by how role-like a phrase reads.
ENTRY_LABELS: dict[str, str] = {
    "organisation": "company", "organization": "company", "company": "company",
    "employer": "company", "firm": "company", "employer name": "company",
    "designation": "position", "role": "position", "position": "position",
    "job title": "position", "title": "position", "profile": "position",
    "duration": "dates", "period": "dates", "dates": "dates", "date": "dates",
    "tenure": "dates", "from to": "dates",
    "location": "location", "place": "location", "based in": "location",
    # Recorded so the line is consumed, but never used as the employer: the
    # client is who the work was for, not who paid the salary.
    "client": "client", "project": "project", "customer": "client",
    "department": "department", "team": "department",
}

ENTRY_LABEL = re.compile(
    r"^\s*(" + "|".join(sorted((re.escape(k) for k in ENTRY_LABELS), key=len, reverse=True))
    + r")\s*[:\-–]\s*(?=\S)", re.I)

# Numbers that are identifiers, not phone numbers: a licence, a card or a
# certificate number sits in the same contact block and has the same shape.
ID_NUMBER_CONTEXT = re.compile(
    r"\b(?:card|licen[cs]e|lic|cert(?:ificate)?|reg(?:istration)?|membership"
    r"|passport|nin?|ssn|id|no|number|roll|enrol(?:l?ment)?)\b\.?\s*(?:no\.?|number|#)?\s*$",
    re.I,
)

ENVIRONMENT_LINE = re.compile(
    r"^\s*(environment|environnement|technologies|tech\s+stack|tools?(?:\s+used)?"
    r"|technology\s+stack|skills\s+used|umgebung)\s*:\s*", re.I)

# A "Label: text" prefix used on responsibility bullets.
BULLET_LABEL = re.compile(r"^([A-Z][A-Za-z&/ ,'-]{2,40})\s*:\s+(?=\S)")
