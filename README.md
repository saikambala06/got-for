# SKVK — Resume Tailor & Job Application Portal

A professional, Vercel-ready resume/job platform with a browser extension. The existing application flows are preserved while the interface has been refreshed with a simpler responsive design and animated interactions.

## What is included

- MongoDB + JWT authentication with cookie sessions for the web portal and Bearer-token support for the extension
- A six-stage Python resume parser (`pdfplumber`, `pdfminer.six`, `pypdf`, `python-docx`, `pytesseract`) covering PDF, DOCX and scanned documents
- Structured extraction of contact details, summary, work experience with per-role responsibilities, education, skills, projects, certifications, achievements, languages and publications
- Groq AI layer for resume tailoring, job analysis and cover-letter generation (parsing does not use AI and needs no API key)
- Reviewable tailoring diffs with accept/reject decisions
- ATS/match scoring and job tracking
- PDF export route for tailored resumes
- Quick-download defaults stored on the user account
- Browser extension that parses job pages, logs job views, analyzes job descriptions, tailors saved resumes, saves applications, and opens the portal tailor flow
- Responsive UI refresh with hover/press/focus animations, mobile navigation, cards, forms, toasts, and reduced-motion support
- Clean routes such as `/dashboard`, `/tracker`, `/resumes`, `/tailor`, `/account`, and `/parse-resume` in addition to the existing `.html` URLs
- One design system and one parser UI shared by the dashboard and the extension

## AI configuration

Groq is the only AI provider in this build. There are no Gemini, Anthropic, Grok, or OpenAI SDK integrations.

Set these environment variables:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/skvk
JWT_SECRET=<long-random-secret>
GROQ_API_KEY=<your-groq-key>
GROQ_API_KEYS=<optional-comma-separated-keys>
GROQ_MODEL=openai/gpt-oss-120b
APP_BASE_URL=http://localhost:4000
PORT=4000
```

`GROQ_API_KEYS` can contain multiple keys so the existing key-pool logic can rotate when a key is rate-limited.

The resume parser uses **no AI and no API key** — it is deterministic. `JWT_SECRET` is the only variable it needs, and it must match the one the Node API uses so sessions verify.

## Required environment variables

| Variable | Required | Used for |
| --- | --- | --- |
| `MONGODB_URI` | yes | All data. Without it every API call returns 503. |
| `JWT_SECRET` | yes | Signing and verifying sessions. Min 16 chars. Without it **login and registration return 503**. |
| `GROQ_API_KEY` / `GROQ_API_KEYS` | no | Tailoring, job analysis, cover letters. Resume parsing does not use AI. |

On Vercel these go in **Project Settings → Environment Variables**, then
redeploy. A local `.env` file is never uploaded.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Checking the deployment's configuration

`GET /api/health` reports which required settings are present — as booleans,
never values — so a misconfiguration can be identified from the browser:

```jsonc
{
  "status": "misconfigured",
  "database": "ok",
  "missing": ["JWT_SECRET"],
  "hint": "Set JWT_SECRET in Vercel → Project Settings → Environment Variables, then redeploy."
}
```

`"status": "ok"` means everything required is present.

Missing configuration is reported as **503 with the variable named**, never as
a generic 500. A deployment fault and a user mistake must not look the same:
"Could not log in. Please try again." is advice that can never work when the
real problem is an unset secret.

## Important backend routes

### Authentication
`POST /api/auth/register`
`POST /api/auth/login`
`POST /api/auth/logout`
`GET /api/auth/me`

### Resumes
`GET /api/resumes`
`POST /api/resumes`
`GET /api/resumes/:id`
`PUT /api/resumes/:id`
`DELETE /api/resumes/:id`
`POST /api/resumes/:id/tailor` — saved resume tailoring
`POST /api/resumes/tailor` — compatibility route for the interactive tailoring workspace
`POST /api/resumes/:id/cover-letter` — AI cover letter
`POST /api/resumes/download-pdf` — PDF export

### Resume parser

Parsing runs in a **Python pipeline** (`api/parser/*.py`), deployed as Vercel
Python functions alongside the Node API. Saving stays in Node because that is
where the Mongoose models and the session middleware live.

`GET  /api/parser/health` — capabilities: libraries, limits, OCR backend  *(Python)*
`POST /api/parser/upload` — parse an uploaded PDF or DOCX  *(Python)*
`POST /api/parser/text` — parse pasted resume text  *(Python)*
`POST /api/parser/save` — save a parsed result into My Resumes  *(Node)*

Both Python endpoints authenticate with the same session the Node API issues —
the `jt_token` cookie for the dashboard, or an `Authorization: Bearer` header
for the extension.

#### The six stages

| Stage | Module | What it does |
| --- | --- | --- |
| **FileValidator** | `validator.py` | Identifies the file from its *magic bytes*, not its extension. Rejects legacy `.doc`, RTF, renamed `.pptx`/`.xlsx`, password-protected and corrupt files, each with a message the user can act on. |
| **TextExtractor** | `extractor.py` + `docx_extractor.py` | `pdfplumber` for word boxes with font and size → `pdfminer.six` for complex layouts → `pypdf` as a last resort. Word is read by walking `word/document.xml` directly (see below). Both produce the same *geometric line model*, not a flat string. |
| **OCREngine** | `ocr.py` | Runs only when a PDF has no text layer. Rasterises with `pypdfium2`, deskews and binarises with an Otsu threshold, then reads word boxes and confidences with `pytesseract`. |
| **DataCleaner** | `cleaner.py` | Removes running headers, footers and page numbers; rejoins hyphenated words; rejoins lines the page broke mid-sentence; reassembles date ranges split by a wide gap. |
| **SectionSegmenter** | `segmenter.py` | Finds headings *visually first*, then names them, so "WHERE I'VE WORKED" is recognised. Groups each section into entries using bullet hierarchy, emphasis or dates. |
| **NEREngine** | `ner.py` + `gazetteers.py` | Rule- and gazetteer-based recognition of PERSON, ORG, ROLE, DATE, GPE, SKILL and DEGREE, using the structure the segmenter recovered. |
| **JSONFormatter** | `formatter.py` | Emits the stable output schema and scores per-field completeness. |

`pipeline.py` wires them together and reports per-stage timings in
`metadata.stages_ms`.

#### Why rules rather than a model for NER

A general-purpose NER model labels "Optum" as ORG and "Aug 2025 - Present" as
DATE, but has no opinion about *which* ORG is the employer for a given entry,
which of two capitalised phrases is the job title, or that the italic line under
a bullet is a position. Resume parsing is overwhelmingly a structure problem,
and the segmenter has already recovered the structure. Rules are also small
enough to fit Vercel's 250 MB function limit, which a spaCy model plus its
dependencies is not.

#### Bullet hierarchy

A very common layout carries all of its structure in bullet *level*:

```
• Optum                                  Aug 2025 - Present   <- entry header
AI & Machine Learning Engineer                                <- position (italic)
  ◦ Designed and fine-tuned GPT-4 …                           <- responsibility
  ◦ Built and deployed Python models …                        <- responsibility
```

A parser that treats every bullet as description text loses the employer, the
dates and the role at once. The segmenter detects when level-1 bullets are
acting as entry headers and groups accordingly.

#### Reading Word

`docx_extractor.py` walks `word/document.xml` in document order rather than
using `python-docx`'s separate `.paragraphs` and `.tables` collections, which
report a document's body text and its tables as two independent lists. A resume
that lays each job out in a table — most Word templates do — comes back from
those lists with every heading first and every job after, so each role gets
filed under whichever section heading happened to be last.

Walking the XML also makes Word's own structure available instead of guessing
at it:

| In the file | Read as |
| --- | --- |
| `w:numPr` / `w:ilvl` + `numbering.xml` | bullet level, so nesting is known rather than inferred from the glyph |
| `w:tab`, `w:tabs` | a column break — "Optum ⇥ Aug 2025" is two fields, not one sentence |
| `w:br`, `w:cr` | a new line: Shift+Enter draws one, so it must start one |
| `w:hyperlink` + relationships | the LinkedIn or GitHub address, which is stored only in `document.xml.rels` and appears nowhere in the text |
| `w:ind` (left, hanging), `w:tabs` | real indent geometry in points, shared with the PDF line model |
| `w:tbl` / `w:tr` / `w:tc` | reading columns for a sidebar layout, or a row's fields where the cells are short and one holds a date |
| `w:sdt`, `w:txbxContent`, `mc:AlternateContent` | content controls, text boxes and shapes — where template resumes keep the name and contact block |
| `w:ins` / `w:del` | accepted and rejected revisions, so tracked changes do not appear twice |
| style `basedOn` chains, `docDefaults` | inherited bold, italic, size and outline level |

Bullets typed as characters rather than defined as a numbering level are ranked
by indent, because that is the only thing distinguishing them — a resume using
`•` for both the employer and each duty is relying on the indent exactly as a
reader does. Word's second-level marker is the letter `o` in Courier New, which
is stripped rather than read as the line's first word.

The test suite parses the same resume as a PDF and as four different DOCX
renderings — Word numbering, typed glyph markers, Shift+Enter breaks, and a
text box with a content control — and asserts all five produce an identical
result, field for field.

#### Measuring against resumes it was not written for

Fixtures written alongside a parser flatter it. `test/corpus` holds eight
resumes written independently — Indian and Gulf IT contractors, a US nurse, a
UK electrician, a German engineer, a French graduate, a US staffing DevOps CV
and a two-column designer CV — each with the fields a careful human reader
would extract recorded next to it. `render.py` turns them into PDFs and DOCX
files without any knowledge of the parser; `score.py` compares the parse to
that ground truth field by field.

```bash
npm run corpus
```

The parser currently passes **132 of 172 checks (77%)**, up from 49% when the
corpus was first run. `npm test` fails if that drops below 74%.

The weakest layout is a **two-column PDF whose sidebar sits close to the main
column**: the gutter detector needs a clear vertical channel, and when a long
sidebar line reaches into it the page reads as one column, so sidebar text can
surface inside a job entry. The same document parses correctly as DOCX.

#### OCR for scanned resumes

OCR is fully implemented and tested, but **it does not run on Vercel**:
`pytesseract` shells out to the `tesseract` binary, and Vercel's Python runtime
does not ship one. The pipeline detects this and returns a clear "upload a text
PDF or DOCX" message rather than failing.

To enable it, run the identical pipeline in a container — `Dockerfile` and
`requirements-ocr.txt` are included and install tesseract:

```bash
docker build -t skvk-parser .
docker run -p 8080:8080 -e JWT_SECRET=<same-secret-as-node> skvk-parser
```

Deploy that to Render, Railway, Fly.io or Cloud Run and point the portal's
parser calls at it; scanned resumes start working with no code change.

#### Output schema

```jsonc
{
  "metadata":    { "parsed_at", "parser_version", "source_format",
                   "extraction_method", "ocr_used", "page_count",
                   "sections_detected", "stages_ms" },
  "contact_information": {
    "name", "email", "phone", "linkedin", "github", "website", "headline",
    "location": { "city", "state", "country" }
  },
  "summary":     "",
  "skills":      { "technical": [], "soft": [], "categories": {} },
  "work_experience": [{ "company", "position", "location", "start_date",
                        "end_date", "current", "responsibilities": [],
                        "environment" }],
  "education":   [{ "institution", "degree", "major", "location",
                    "start_date", "graduation_date", "gpa", "coursework": [] }],
  "certifications": [{ "name", "issuer", "date" }],
  "projects":       [{ "name", "link", "description" }],
  "achievements": [], "languages": [], "publications": [],
  "confidence":  { "overall", "fields": {}, "missing": [] }
}
```

Every key is always present. Empty means "not in the document", never "the
parser did not look". Dates are normalised to ISO where possible
(`Aug 2025` → `2025-08`) and left verbatim when they cannot be.

### Jobs
`GET /api/jobs`
`POST /api/jobs`
`PUT /api/jobs/:id`
`DELETE /api/jobs/:id`
`GET /api/jobs/stats`
`POST /api/jobs/track-view`
`POST /api/jobs/analyze`

### Account
`PUT /api/account/profile`
`PUT /api/account/password`
`GET /api/account/quick-download-defaults`
`PUT /api/account/quick-download-defaults`

## Local development

```bash
npm install
pip install -r requirements.txt
npm start
```

Open `http://localhost:4000`.

The Node server does not include the parser — it is a separate Python runtime.
For the full stack locally, either use `vercel dev`, or run the parser beside
Node in a second terminal:

```bash
npm run parser:dev     # serves /api/parser/{health,upload,text} on :8080
```

Set `JWT_SECRET` to the same value the Node API uses so sessions verify; for a
quick local run, `PARSER_ALLOW_ANONYMOUS=true` (already set by the script)
skips the check.

## Tests

```bash
npm test          # parser suite + UI contract check
npm run corpus    # score against eight independently written resumes
```

342 assertions across twelve fixtures — hierarchical bullets, one-column,
two-column, letter-spaced headings, heading-less, an image-only scan that
exercises OCR, Word files laid out in tables and with duties written as plain
paragraphs, and one resume rendered as both a PDF and four different DOCX
files that must all parse to the same answer — plus file validation, error
typing, pasted text and schema shape. Assertions are on exact values
(employers, positions, dates, degrees), not just "it did not crash".

## Browser extension

1. Open Chrome → Extensions → Developer mode.
2. Choose **Load unpacked** and select `browser-extension/`.
3. Open the extension settings and set the deployed portal origin (for example, your Vercel URL).
4. Log in from the popup.
5. Click **Parse a resume** to open the extension's parser page, or open a job posting and click **Show panel on this page**.

The extension keeps the JWT in `chrome.storage.local` and the configurable portal origin in `chrome.storage.sync`. The content scripts do not directly call the backend; the service worker proxies authenticated API requests. The parser page (`parse.html`) is the exception — it uploads the file directly, because a `File` cannot be sent through `chrome.runtime.sendMessage`.

### Shared UI

The extension and the web portal use the same design system and the same parser
UI. `theme.css` (tokens, components and the motion library), `parser.css`,
`motion.js` and `parser-ui.js` live in `public/` and are copied into
`browser-extension/` — run `./sync-shared.sh` after editing any of them so the
two copies never drift.

## Vercel

`vercel.json` declares three builds: the Express API (`@vercel/node`), the
parser functions (`@vercel/python`) and the static frontend. Routes send
`/api/parser/{health,upload,text}` to Python and everything else under `/api`
to Node.

Set `MONGODB_URI`, `JWT_SECRET` and the Groq keys in Project Settings. Vercel
injects them into both runtimes, so the Python functions verify the same
session the Node API issues.

### Pinning Python dependencies

Vercel resolves `requirements.txt` with `uv`, which fails the build on any
conflict rather than silently picking a version.

**Never pin `pdfminer.six`.** `pdfplumber` depends on an *exact* pdfminer.six
release, so an explicit pin of your own will contradict it:

```
Because pdfplumber==0.11.4 depends on pdfminer-six==20231228
and your project depends on pdfminer-six==20240706,
we can conclude that your project and pdfplumber==0.11.4 are incompatible.
```

pdfminer.six arrives transitively and `extractor.py` imports it as its fallback
engine. The same applies to `pypdfium2`, which pdfplumber also brings in.

Before changing a pin, check the resolution the way the build does:

```bash
uv pip compile requirements.txt --python-version 3.12
```

The current set is resolved and tested against Python 3.12 — the version
Vercel uses — with pdfplumber 0.11.7, pdfminer.six 20250506, pypdf 5.1.0 and
Pillow 11.3.0.

## Latest reliability fixes

- PDF export no longer captures an off-screen DOM; browser-extension PDF rendering keeps the source inside the viewport before html2canvas capture.
- The portal download script has a fixed JavaScript syntax error and delays Blob URL cleanup.
- The extension's **No, not yet** job-confirmation action now shows the loading state and reloads/re-parses the current job page.
- **Fixed `DOMMatrix is not defined`**, which made every PDF upload fail in production. PDF.js reaches for browser graphics APIs that do not exist in a serverless Node runtime; the polyfills are now installed before it loads. That code path has since been replaced by the Python parser, but the fix is kept for any remaining PDF.js use.
- **The resume parser was rebuilt in Python.** `/api/resumes/parse`, `/api/resumes/parse-and-save` and `/api/resumes/parse-text` are gone, replaced by `/api/parser/*` (see **Resume parser** above). The old page also ran a second, duplicate parser in the browser via CDN copies of pdf.js and mammoth — removed; there is now one parser.
- **Hierarchical bullets are understood.** The previous parser treated every bullet as description text, so a resume that puts the employer on a `•` bullet and its duties on `◦` sub-bullets produced empty or wrong experience and education. Bullet level is now structural.
- Parsing uses no AI and no API key. It is deterministic, and the same input always produces the same output.
- OCR for scanned resumes is implemented and tested; see the note above about running it outside Vercel.
- **Fixed the Vercel build failure** caused by pinning `pdfminer.six` alongside `pdfplumber`, which pins it exactly. See **Pinning Python dependencies** above.
- Groq GPT-OSS 120B remains the default production model, with Groq JSON output mode and a smaller GPT-OSS 20B fallback for model availability.
