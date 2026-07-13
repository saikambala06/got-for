# SKVK

A free job-application tracker dashboard — no paywalls, no upgrade prompts.
Built with vanilla HTML/CSS/JavaScript on the frontend and Node.js (Express) + MongoDB on the backend. All application data, resumes, and account info live in MongoDB — nothing is stored in `localStorage`/`sessionStorage`. The login session is kept in a secure, httpOnly cookie.

## Features

- Email/password authentication (bcrypt-hashed passwords, JWT in an httpOnly cookie)
- Dashboard overview: all-time / monthly / 7-day stats, application trend chart, and pipeline breakdown (Applied / Interviewing / Offer / Rejected / Archived)
- Job Tracker: add, edit, delete, favourite, search, and filter job applications
- Resumes: create and maintain multiple resume profiles, mark one as default, and upload an existing PDF/DOCX — **Gemini AI accurately extracts every field** for you
- **✨ Tailor to Job** — paste any job description and Gemini AI rewrites your summary, reorders your skills, and sharpens your bullet points to match the role (without inventing anything)
- Account: edit profile details and change password
- Fully responsive, dark "command center" UI
- 100% free — no billing, no plan limits, no paid tier in the code

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript, Chart.js (CDN) for the trend chart
- Backend: Node.js, Express
- Database: MongoDB via Mongoose — use a free MongoDB Atlas cluster
- AI: Google Gemini (`gemini-2.5-flash`) for resume parsing and tailoring, with a regex fallback if the key is absent
- Auth: JWT in an httpOnly cookie, bcrypt-hashed passwords
- Deployment: Vercel (serverless function + static hosting)

## Project structure

```
skvk/
├── api/
│   └── index.js           # Express app (Vercel serverless entry point)
├── routes/
│   ├── auth.js            # register / login / logout / me
│   ├── jobs.js            # job application CRUD + stats
│   ├── resumes.js         # resume CRUD + /parse (AI) + /:id/tailor (AI)
│   └── account.js         # profile + password updates
├── models/                # Mongoose schemas: User, Job, Resume
├── middleware/auth.js      # JWT cookie auth guard
├── utils/
│   ├── db.js              # cached Mongo connection helper
│   ├── aiResumeParser.js  # Gemini-powered parse + tailor (with regex fallback)
│   └── resumeParser.js    # rule-based regex fallback parser
├── public/                # static frontend (HTML / CSS / JS)
├── server.js              # local dev entry point
├── vercel.json            # Vercel routing config
├── .env.example           # required environment variables
└── package.json
```

## 1. Set up MongoDB (free)

1. Create a free cluster at https://www.mongodb.com/cloud/atlas/register (M0 tier is enough).
2. Create a database user and password.
3. Under Network Access, allow `0.0.0.0/0` so Vercel's serverless functions can connect.
4. Copy your connection string:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/skvk?retryWrites=true&w=majority`

## 2. Get a Gemini API key

1. Sign up at https://aistudio.google.com/apikey and create an API key.
2. Add it to your environment as `GEMINI_API_KEY` (see below).

The app gracefully degrades — if the key is absent, resume parsing falls back to a regex-based extractor and the "Tailor to Job" button returns a clear error.

### Using multiple keys (recommended — avoids 429 quota errors)

The free tier's daily quota is easy to hit. The app supports configuring several
keys — when one runs out, it automatically rotates to the next. Use **any one**
of these (they can also be combined):

| Env var | Format | Example |
|---|---|---|
| `GEMINI_API_KEYS` | comma or newline separated list | `GEMINI_API_KEYS=AIzaSy...abc,AIzaSy...def,AIzaSy...ghi` |
| `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ... | one key per numbered var | `GEMINI_API_KEY_1=AIzaSy...abc`<br>`GEMINI_API_KEY_2=AIzaSy...def` |
| `GEMINI_API_KEY` | single key (still works, counts as one of the pool) | `GEMINI_API_KEY=AIzaSy...abc` |

**Important:** the variable names must match exactly (`GEMINI_API_KEY_1`, not
`GEMINI_KEY_1` or `GEMINI_API_KEY2` without the underscore) or that key silently
won't be picked up.

**Check what the server actually loaded** by calling (while logged in):

```
GET /api/resumes/ai-status
```

This returns how many keys were detected and each one's cooldown status — use
it to confirm the count matches what you configured before assuming the app is
broken. If `configuredKeys` is lower than expected, the extra vars aren't
named correctly (or, on Vercel, weren't added/redeployed — see below).

## 3. Run locally

```bash
npm install
cp .env.example .env
# Edit .env — paste your MONGODB_URI, JWT_SECRET, and GEMINI_API_KEY
npm run dev
```

Visit `http://localhost:4000`. Create an account to get started.

## 4. Deploy to Vercel (free)

1. Push this project to a GitHub repository.
2. Go to https://vercel.com, click **New Project**, and import the repo.
3. Under **Environment Variables** add:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — any long random string
   - `GEMINI_API_KEY` (and, optionally, `GEMINI_API_KEYS` or `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ... for multiple keys — see above)
   - `NODE_ENV` — `production`
4. Click **Deploy**.

> **A local `.env` file only affects `npm run dev` on your machine.** Vercel
> never reads it. If you add or change keys, add them in the Vercel project's
> **Settings → Environment Variables** and then **redeploy** (or run
> `vercel env add GEMINI_API_KEY_2`) — otherwise the running deployment keeps
> using whatever it already had, no matter how many keys are sitting in a
> local `.env`.

## AI resume features

### Upload & auto-fill
Upload any PDF or DOCX resume and Gemini AI will extract your name, contact info, work experience (with bullet points), education, skills, certifications, projects, and more — all mapped directly into the resume builder.

### Tailor to Job
With a resume open in the builder, click **✨ Tailor to Job** in the footer bar. Paste a job description (and optionally the job title), then hit **Tailor with AI**. Gemini will:
- Rewrite your professional summary to reflect the target role
- Reorder and refine your skills list, prioritising the most relevant ones first
- Sharpen your experience bullet points with keywords from the job posting

The changes are applied to your draft — review them in the builder, then click **Save Changes** to persist.

## Notes

- Passwords are never stored in plain text (bcrypt, 10 rounds).
- The session cookie is httpOnly and `secure` in production.
- All CRUD endpoints require a valid session and only ever touch the logged-in user's own data.
- The regex fallback parser (`utils/resumeParser.js`) is retained as a zero-cost safety net for environments where the Gemini key is not configured.
