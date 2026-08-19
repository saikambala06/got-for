# Changes in this build

Everything below is already applied in this archive.

---

## 0. "It only works for one resume" — measured, then fixed

You were right, and the previous build had no way to notice. Every test fixture
had been written alongside the parser, so the suite could pass completely while
the parser failed on anyone else's document.

### What the video showed

Three separate faults, only one of them in the parser:

**The Overview panel reported "not found" for every field** — full name, email,
phone, location, LinkedIn, headline — on a resume whose name, email and
LinkedIn were displayed in the header directly above it. The panel read
`p.personal`; the adapter produces `p.person`. In JavaScript a key that does
not exist is silently `undefined`, so nothing threw and nothing logged. Two
neighbouring bugs of the same kind: **Sections detected** read `data.sections`
instead of `data.metadata.sections_detected`, and the **Extracted text** tab
read `data.rawText` instead of `data.raw_text`, so it was always blank.

Fixed in `public/js/parser-ui.js` and the extension's copy. `npm run check:ui`
now fails the build if the UI reads a key the parser does not emit.

**`Master of Science in Information Technology from Wilmington University`** was
returned whole, with no degree and no institution — the "… from <university>"
phrasing was never split.

**52% confidence** was honest. The rest of this section is why.

### How it was measured

Eight resumes were written independently of the parser, each with the fields a
careful human reader would extract recorded alongside it:

| | |
| --- | --- |
| Indian IT staffing | 11 years, numbered summary, `Client:` and `Role:` lines |
| Gulf SAP consultant | `Organisation:` / `Designation:` / `Duration:` labels, skills matrix |
| US registered nurse | licence numbers, a career break, two titles at one employer |
| UK electrician | dates above the employer, trade qualifications, no degree |
| German engineer | bilingual headings, dates in a left column, `seit 04/2021` |
| French graduate | education first, internships only, accented text |
| US DevOps staffing | 7 employers, `Environment:` after every job — your video's format |
| Two-column designer | narrow sidebar, employer under the job title |

They are rendered to PDF **and** DOCX by a renderer that knows nothing about
the parser, then scored field by field against that ground truth.

**Before: 85/172 checks — 49.4%. After: 132/172 — 76.7%.**

```bash
npm run corpus          # the full report, per file
```

### What was actually broken

| Fault | Effect |
| --- | --- |
| `(cid:127)` — what pdfplumber emits for a font with no ToUnicode map | every bullet unrecognised, so every duty became its own job |
| One flat bullet list read as an entry hierarchy | a job shattered into one entry per sentence |
| `Organisation:` / `Designation:` / `Duration:` labels not understood | an entire resume dialect parsed as prose |
| `Environment:` treated as the start of the next job | that job took the wrong employer |
| A city accepted as the employer | "Franklin Lakes" replaced "Cognizant Technology Solutions" |
| Only software words counted as employer names | hospitals, councils, colleges and contractors unrecognised |
| Section names matched against a fixed list | "EMPLOYMENT CHRONICLE", "ACADEMIC CREDENTIALS", "AUSBILDUNG / EDUCATION" all missed |
| Phone matching assumed US formatting | `+971 55 812 4470`, `07700 900412`, `06 74 21 08 55` all missed |
| `D. KILBRIDE ELECTRICAL SERVICES` | the initial read as a lettered list marker, so the employer became a bullet |
| Skills split on every comma | `AWS (S3, Lambda, EC2, Bedrock)` became `AWS (S3` and `Bedrock)` |
| A name with post-nominals | `DANIELLE R. OKAFOR, BSN, RN` rejected, name guessed from the email as "Dokafor Rn" |
| Two titles at one employer | the promotion recorded with no employer at all |

Each is fixed at the cause. The parser now also reads `since 2021` / `seit
04/2021` / `depuis 2020` as open-ended ranges, and treats a heading's keyword
rather than its exact wording.

### What is still weak

**Two-column PDFs where the sidebar sits close to the main column.** The gutter
detector needs a clear vertical channel; when a long sidebar line reaches into
it, the page reads as one column and sidebar text can appear inside a job
entry. The same résumé parses correctly as DOCX. This is the lowest score in
the corpus (6/11) and is called out rather than hidden.

The corpus is committed, so this number cannot quietly regress — `npm test`
fails if it drops below 74%.

---

## 1. DOCX parsed differently from PDF — fixed

**The same resume now returns the same answer as a PDF and as a Word file.**
That is asserted, not asserted-ish: the test suite parses one resume five ways
and compares every field.

### What was wrong

`python-docx` exposes a document as two independent lists — `.paragraphs` and
`.tables`. Most Word resume templates put each job in a table, so reading those
lists returns every heading first and every job afterwards. The reading order
is destroyed, and each role gets filed under whichever section heading happened
to come last. That is why jobs were showing up under EDUCATION.

### What replaced it

**`api/_resume_parser/docx_extractor.py`** *(new)* walks `word/document.xml`
itself, in true document order, and reads Word's own structure rather than
guessing at it:

| In the file | Now read as |
| --- | --- |
| `w:numPr` / `w:ilvl` + `numbering.xml` | bullet level — nesting is known, not inferred from the glyph |
| `w:tab`, `w:tabs` | a column break: "Optum ⇥ Aug 2025" is two fields, not one sentence |
| `w:br`, `w:cr` | a new line — Shift+Enter draws one, so it starts one |
| `w:hyperlink` + relationships | your LinkedIn address, which is stored **only** in `document.xml.rels` and appears nowhere in the text |
| `w:ind` (left, hanging) | real indent geometry in points, shared with the PDF line model |
| `w:tbl` / `w:tr` / `w:tc` | reading columns for a sidebar, or a row's fields when the cells are short and one holds a date |
| `w:sdt`, `w:txbxContent`, `mc:AlternateContent` | content controls, text boxes and shapes — where templates keep the name and contact block |
| `w:ins` / `w:del` | accepted and rejected revisions, so tracked changes never appear twice |
| style `basedOn` chains, `docDefaults` | inherited bold, italic, size and outline level |

Three further defects found while testing against the ways real editors write
DOCX, each now fixed and covered:

- **Word's second-level marker is the letter `o`** in Courier New. Typed by
  hand rather than defined as a numbering level, it reached the text layer as
  the line's first word — so `o Environment: Python, …` stopped being
  recognised as the environment field and became another responsibility.
- **Shift+Enter collapsed a whole list into one line.** A `w:br` draws a new
  line exactly as a new paragraph does; held together, every duty under a job
  merged into a single sentence and the entries after it lost their boundaries.
- **Typed bullets carry no level.** A resume using `•` for both the employer
  and each duty is relying on the indent alone, exactly as a reader does, so
  typed markers are now ranked by indent. Levels that came from Word's own
  numbering are left alone — there the answer is already recorded.

Two wrapped lines in the **PDF** path were also being left as fragments
(`instruction optimization.` and `automated data workflows with ETL pipelines.`
were appearing as responsibilities of their own). A wrapped line starts at its
item's *text* indent, never at the marker's, and that alignment is now measured
directly instead of estimating whether the next word would have fitted.

### Verified

One resume, five files, identical output — 91% confidence, 4 roles with correct
employers and dates, 27 responsibilities, 57 skills, 2 degrees, 3
certifications, from each of:

```
ajay.pdf             pdfplumber
ajay_equiv.docx      Word numbering, tabs, hyperlink relationships
typed_bullets.docx   typed glyph markers, nesting shown only by indent
soft_breaks.docx     Shift+Enter breaks inside one paragraph
boxed.docx           text box, content control and wrapper table
```

Plus `table.docx` (entries in tables, duties as plain paragraphs) and
`mixed.docx` (body text and tables interleaved). Suite is now **340
assertions**, passing on Python 3.11 and 3.12.

---

## 2. Login / registration returning 500 — fixed

**Cause: `JWT_SECRET` is not set in your Vercel environment.**

The status codes in your browser console prove it. `409` on register means the
database query ran and found an existing user — so **MongoDB is connected and
fine**. The `500` happens *after* that, at the one step both register and login
share: signing the session token.

| Request | Without `JWT_SECRET` | Your console |
| --- | --- | --- |
| register, existing email | 409 | 409 |
| register, new email | 500 | 500 |
| login, wrong password | 401 | 401 |
| login, correct password | 500 | 500 |

Server-side the error was `secretOrPrivateKey must have a value`.

### What you need to do

Add **`JWT_SECRET`** in Vercel → Project Settings → Environment Variables, then
redeploy. It must be at least 16 characters; 64+ random hex is ideal:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Generate your own rather than reusing one from a chat or screenshot.

`MONGODB_URI` is already set correctly — the 409 proves it.

### What changed in the code

A missing setting should never have looked like a user error. Now:

- **`utils/config.js`** (new) validates required settings and raises a typed
  `ConfigError` naming the variable at fault.
- **`routes/auth.js`** returns **503** with that message and a hint telling you
  exactly what to set — instead of a generic 500 saying "Please try again",
  advice that could never work.
- **`middleware/auth.js`** no longer reports a misconfigured server as
  "Invalid or expired session", which sent users to re-login pointlessly.
- **`GET /api/health`** now reports which required settings are present, as
  booleans only — never values — so this is diagnosable from the browser:

  ```jsonc
  { "status": "misconfigured", "database": "ok", "missing": ["JWT_SECRET"],
    "hint": "Set JWT_SECRET in Vercel → Project Settings → …" }
  ```

- **`public/login.html`** shows the server's hint under the error message.
- `GET /api/auth/me` gained the error handling it was missing entirely.

Check `/api/health` first after deploying. `"status": "ok"` means everything
required is present.

---

## 3. Vercel build failure — fixed

**File: `requirements.txt`**

`pdfplumber` depends on an *exact* `pdfminer.six` release. The previous file
also pinned `pdfminer.six` to a different release, so `uv` — the resolver
Vercel uses — could not satisfy both and failed the build:

```
Because pdfplumber==0.11.4 depends on pdfminer-six==20231228
and your project depends on pdfminer-six==20240706,
we can conclude that your project and pdfplumber==0.11.4 are incompatible.
```

The corrected file does not pin `pdfminer.six` at all. It installs
transitively at whatever version pdfplumber requires, and `extractor.py` still
imports it as its fallback engine.

```
pdfplumber==0.11.7
pypdf==5.1.0
python-docx==1.1.2
Pillow>=10.4.0,<12
PyJWT==2.9.0
```

Verified with `uv pip compile requirements.txt --python-version 3.12`, the same
resolver and Python version Vercel uses. Resolves to pdfminer.six 20250506,
Pillow 11.3.0, pypdfium2 5.13.0.

> After deploying, confirm the deployment's commit hash is **not** `aa41baa`.
> That commit contains the old file, and rebuilding it will fail again with the
> identical message no matter how many times it is retried.

**File: `.python-version`** *(new)*

Contains `3.12`. Pins the runtime to the version this was tested against and
clears the build warning `No Python version specified in .python-version`.

**File: `vercel.json`**

`includeFiles` widened from `api/_resume_parser/**` to `api/**`, so the shared
parser package is guaranteed to be bundled with each Python function. A miss
there would have produced a runtime `ModuleNotFoundError` rather than a build
error — much harder to diagnose.

**File: `.vercelignore`**

Keeps the test suite, its ~1.4 MB of resume fixtures, the Dockerfile and the
OCR requirements out of the deployment.

---

## 4. Resume parsing — rebuilt in Python

`/api/resumes/parse`, `/api/resumes/parse-and-save` and
`/api/resumes/parse-text` are gone. Parsing now runs as Vercel Python functions
in a six-stage pipeline:

| Stage | Module |
| --- | --- |
| FileValidator | `api/_resume_parser/validator.py` |
| TextExtractor | `api/_resume_parser/extractor.py` |
| OCREngine | `api/_resume_parser/ocr.py` |
| DataCleaner | `api/_resume_parser/cleaner.py` |
| SectionSegmenter | `api/_resume_parser/segmenter.py` |
| NEREngine | `api/_resume_parser/ner.py` + `gazetteers.py` |
| JSONFormatter | `api/_resume_parser/formatter.py` |

Endpoints: `GET /api/parser/health`, `POST /api/parser/upload`,
`POST /api/parser/text` (Python) and `POST /api/parser/save` (Node, because
that is where the Mongoose models and session middleware live).

Parsing uses **no AI and no API key**. It is deterministic.

### The bug that broke your resume

`Ajay_Babu_Resume.pdf` puts the employer on a `•` bullet and each duty on a
`◦` sub-bullet:

```
• Optum                            Aug 2025 - Present   <- employer + dates
AI & Machine Learning Engineer                          <- role (italic)
  ◦ Designed and fine-tuned GPT-4 …                     <- responsibility
```

The old parser treated every bullet as description text, so the employer, the
dates and the role were all lost at once. Bullet *level* is now structural.

That resume now returns 4 roles with correct employers, dates and every
responsibility; 2 degrees with major and coursework; 57 skills across 7
categories — from the PDF and from Word alike (see section 0).

---

## 5. `DOMMatrix is not defined` — fixed

PDF.js reaches for browser graphics APIs that do not exist in a serverless Node
runtime. The polyfills are installed before it loads, and one unreadable page no
longer fails the whole document.

---

## 6. UI

One design system (`theme.css` + `motion.js`) shared by the dashboard and the
browser extension, which now loads the identical parser UI. Animated dropzone,
live six-stage pipeline, confidence ring, per-field completeness meters.

---

## Tests

```bash
npm test          # parser suite + UI contract check
npm run corpus    # score against the eight independent resumes
```

342 assertions over twelve built-in fixtures plus the eight-resume corpus — hierarchical bullets (your resume),
one-column, two-column, letter-spaced headings, heading-less, an image-only
scan exercising OCR, Word files laid out in tables and with duties written as
plain paragraphs, and one resume rendered as a PDF plus four different DOCX
files that must all parse to the same answer — plus file validation, error
typing, pasted text and schema shape. Assertions are on exact values, not "it
did not crash".

Passing on Python 3.12 with the pins above, and on 3.11 with newer libraries.

---

## Local development

```bash
npm install
pip install -r requirements.txt
npm start                 # Node app on :4000
npm run parser:dev        # Python parser on :8080 (second terminal)
```

`npm start` alone has no parser — it is a separate runtime. Use `vercel dev`
for the full stack in one process.

## OCR

Implemented and tested, but it **cannot run on Vercel**: `pytesseract` shells
out to a `tesseract` binary that Vercel's Python runtime does not ship. The
pipeline detects this and returns a clear "upload a text PDF or DOCX" message.

To enable it, use the included `Dockerfile` (installs tesseract) with
`requirements-ocr.txt` and host it anywhere that runs containers — same code,
no changes.
