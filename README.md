# JobTrail

A completely free job-application tracker dashboard — no paywalls, no "upgrade" prompts.
Built with vanilla HTML/CSS/JavaScript on the frontend and Node.js (Express) + MongoDB
on the backend. All application data, resumes, and account info live in MongoDB —
nothing is stored in `localStorage`/`sessionStorage`. The login session itself is kept
in a secure, httpOnly cookie (not in the browser's storage APIs).

## Features

- Email/password authentication (bcrypt-hashed passwords, JWT in an httpOnly cookie)
- Dashboard overview: all-time / monthly / 7-day stats, an application trend chart, and a
  pipeline breakdown (Applied / Interviewing / Offer / Rejected / Archived)
- Job Tracker: add, edit, delete, favorite, search, and filter job applications
- Resumes: create and maintain multiple resume profiles, mark one as default
- Account: edit profile details and change password
- Fully responsive, dark "command center" UI — distinct from typical SaaS dashboards
- 100% free — there is no billing, no plan limits, no paid tier anywhere in the code

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript, Chart.js (via CDN) for the trend chart
- Backend: Node.js, Express
- Database: MongoDB (via Mongoose) — use a free MongoDB Atlas cluster
- Auth: JWT stored in an httpOnly cookie, passwords hashed with bcrypt
- Deployment: Vercel (serverless function for the API + static hosting for the frontend)

## Project structure

```
jobtrail/
├── api/
│   └── index.js          # Express app (entry point for Vercel's serverless function)
├── routes/
│   ├── auth.js            # register / login / logout / me
│   ├── jobs.js             # job application CRUD + stats
│   ├── resumes.js          # resume CRUD
│   └── account.js          # profile + password updates
├── models/                 # Mongoose schemas: User, Job, Resume
├── middleware/auth.js       # JWT cookie auth guard
├── utils/db.js              # cached Mongo connection helper
├── public/                  # static frontend (HTML/CSS/JS)
├── server.js                 # local dev entry point
├── vercel.json                # Vercel routing config
└── package.json
```

## 1. Set up MongoDB (free)

1. Create a free cluster at https://www.mongodb.com/cloud/atlas/register (the M0 free tier
   is enough for this app).
2. Create a database user and password.
3. Under Network Access, allow access from anywhere (`0.0.0.0/0`) so Vercel's serverless
   functions can connect.
4. Copy your connection string, it looks like:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/jobtrail?retryWrites=true&w=majority`

## 2. Run locally

```bash
npm install
cp .env.example .env
# edit .env and paste your MONGODB_URI + a random JWT_SECRET
npm run dev
```

Visit `http://localhost:4000`. You'll land on the login page; create a free account to
get started, all data is written straight to your MongoDB database.

## 3. Deploy to Vercel (free)

1. Push this project to a GitHub repository.
2. Go to https://vercel.com, click **New Project**, and import the repository.
3. In the Vercel project's **Environment Variables** settings, add:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — any long random string (used to sign login sessions)
   - `NODE_ENV` — `production`
4. Click **Deploy**. Vercel will build the project using `vercel.json`, which routes
   `/api/*` to the Express serverless function and serves everything in `/public`
   as static files.
5. Once deployed, open your Vercel URL — you'll see the JobTrail login page, ready to use.

No further configuration is needed, and there is nothing to pay for: Vercel's free
(Hobby) tier and MongoDB Atlas's free (M0) tier are both sufficient to run this app.

## Notes

- Passwords are never stored in plain text (bcrypt with 10 salt rounds).
- The session cookie is httpOnly and `secure` in production, so it can't be read or
  tampered with by client-side JavaScript.
- All CRUD endpoints under `/api/jobs`, `/api/resumes`, and `/api/account` require a
  valid session and only ever read/write the logged-in user's own data.
