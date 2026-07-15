# SKVK Assistant — browser extension

A Chrome (Manifest V3) extension that adds a side panel to any job posting page: it
parses the job's title, company, location, salary, employment type, skills, and
qualifications directly from the page, scores it against your SKVK resume, and
lets you tailor that resume or draft a cover letter without leaving the job page.

It talks to the same backend as the SKVK web dashboard (`../api`), reusing
`/api/resumes/:id/tailor` and the accounts/resumes you already have there.

## What's included

```
browser-extension/
├── manifest.json          # MV3 manifest
├── background.js          # service worker — owns the session, proxies all API calls
├── popup.html/js/css      # toolbar popup — login + "show panel on this page"
├── content/
│   ├── skills-data.js     # skills taxonomy + benefit/sponsorship detection rules
│   ├── job-parser.js      # JSON-LD + DOM heuristics -> structured job data
│   ├── panel-ui.js        # shadow-DOM panel renderer (matches SKVK's dark UI)
│   └── content.js         # wires parser + panel + background messaging together
└── icons/                 # 16/48/128 toolbar icons
```

## How job parsing works

1. **Structured data first** — if the page embeds `schema.org/JobPosting` JSON-LD
   (LinkedIn, Indeed, Greenhouse, Lever, Workday and most ATS pages do), the panel
   reads title, company, location, employment type, salary, and the full
   description straight from that.
2. **DOM fallback** — otherwise it falls back to heuristics: the page's `<h1>`,
   a `$X - $Y` salary pattern, a `City, ST` location pattern, an
   "at Company" phrase, and the largest text block on the page as the description.
3. **Skill detection** — the description is scanned against a ~120-term skills
   taxonomy (languages, ML/AI, cloud, databases, tools, certifications) in
   `content/skills-data.js`. Matches are shown as green "matched" chips if they're
   already in your selected resume's skill list, or as tappable "+" chips if not.
4. **Qualifications** — a lightweight heading detector looks for a
   "Requirements / Qualifications / What you'll need" section and lists its
   bullet points verbatim under **Qualifications detected**.
5. **Key highlights** — regex rules flag things candidates scan for: H1B
   sponsorship language, medical/dental/vision, 401(k), remote/hybrid, equity,
   unlimited PTO, relocation, security clearance, bonus eligibility.
6. **Keyword match gauge** — `matched skills ÷ total skills found in the posting`,
   against whichever resume is selected in the dropdown.

## Tailoring a resume

Clicking **Tailor resume**:
- Sends the job title + full description, plus any skill chips you've explicitly
  confirmed you have (tap the gray "+" chips first), to
  `POST /api/resumes/:id/tailor`.
- The backend's Gemini-powered tailoring rewrites the summary, reorders/refines the
  skills list (folding in anything you confirmed), and sharpens experience bullets
  — without inventing employers, dates, or achievements.
- Review the result inline, then **Save to resume** persists it via
  `PUT /api/resumes/:id`.

**Cover letter** works the same way against the new `POST /api/resumes/:id/cover-letter`
endpoint, and gives you a copy-to-clipboard draft grounded only in your resume's
real content.

**Mark as applied** creates a row in your SKVK Job Tracker
(`POST /api/jobs`) with the parsed title/company/location/salary/skills and
`status: "Applied"`.

## Backend changes this ships with

Small, additive changes to `got-for-main` so the extension can authenticate
cross-origin (it can't read the dashboard's httpOnly cookie):

- `middleware/auth.js` — now also accepts `Authorization: Bearer <token>`.
- `routes/auth.js` — `/login` and `/register` now also return `token` in the
  JSON body (the cookie flow for the web dashboard is untouched).
- `utils/aiResumeParser.js` — `tailorResumeWithAI` accepts an optional
  `emphasizeSkills` array (the skills you tapped as confirmed); added
  `generateCoverLetterWithAI`.
- `routes/resumes.js` — passes `emphasizeSkills` through; added
  `POST /:id/cover-letter`.

No existing endpoint's behavior changed for the web dashboard.

## Install it (unpacked, for development)

1. Make sure your SKVK backend is running (`npm run dev` in the project
   root, default `http://localhost:4000`) — or note your deployed Vercel URL.
2. In Chrome, go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `browser-extension/` folder.
4. Click the SKVK icon in your toolbar, enter your API URL (defaults to
   `http://localhost:4000`) and log in with your SKVK account.
5. Visit any job posting (LinkedIn, Indeed, a company careers page, jobright.ai,
   etc.). On pages the extension recognizes as job postings, the panel opens
   automatically; on any other page, click the SKVK icon and **Show panel on
   this page**, or use the slim "SKVK" tab docked to the right edge.

## Notes / limitations

- Skill and qualification detection is pattern-based (no network call), so it's
  instant but not exhaustive — the tappable "+" chips exist so you can add any
  skill the detector missed before tailoring.
- The keyword-match percentage is `matched ÷ total skills found on this page`,
  the same metric shown in the reference design this was modeled on.
- Cover letter and tailoring both require `GEMINI_API_KEY` to be configured on the
  backend (see the main project README); without it those two calls return a
  clear "AI features are not enabled" error instead of failing silently.
