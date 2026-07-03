# LetMeApply - Job Application Tracker

A full-stack job application tracker built with HTML, CSS, JavaScript, Node.js/Express, and MongoDB. Deployable on Vercel.

## Features

- **Authentication** - Register and login with JWT tokens
- **Dashboard** - View application stats (all-time, monthly, 7-day) with Chart.js trend graph
- **Resumes** - Create and manage multiple resumes with personal info, summary, and skills
- **Job Tracker** - Track job applications by status (Applied, Interviewing, Offers, Rejected, Archived, Favorites)
- **Account** - Manage profile, security (password changes), and billing/usage

## Tech Stack

- **Frontend**: HTML, CSS, Vanilla JavaScript, Chart.js
- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Auth**: JWT (JSON Web Tokens) + bcryptjs
- **Deployment**: Vercel (serverless functions)

## Project Structure

```
letmeapply-clone/
├── api/
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── middleware/
│   │   └── auth.js            # JWT auth middleware
│   ├── models/
│   │   ├── User.js            # User model
│   │   ├── Resume.js          # Resume model
│   │   ├── JobApplication.js  # Job application model
│   │   └── Stats.js           # Daily stats model
│   ├── routes/
│   │   ├── auth.js            # Auth routes
│   │   ├── resumes.js         # Resume CRUD routes
│   │   ├── jobs.js            # Job CRUD routes
│   │   ├── dashboard.js       # Dashboard stats routes
│   │   └── account.js         # Account management routes
│   └── index.js               # Express app entry point
├── public/
│   ├── css/
│   │   └── style.css          # Shared styles
│   ├── js/
│   │   └── common.js          # Shared JS utilities
│   ├── images/                # Uploaded images
│   ├── login.html             # Login page
│   ├── register.html          # Registration page
│   ├── dashboard.html         # Dashboard page
│   ├── resumes.html           # Resumes page
│   ├── job-tracker.html       # Job tracker page
│   └── account.html           # Account settings page
├── package.json
├── vercel.json                # Vercel deployment config
├── .env.example               # Environment variables template
└── README.md
```

## Setup & Installation

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (copy from `.env.example`):
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_secret_key
   PORT=3000
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` in your browser

### Deploy to Vercel

1. Push this project to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Add environment variables in Vercel dashboard:
   - `MONGODB_URI` - Your MongoDB connection string
   - `JWT_SECRET` - A secret string for JWT signing
4. Deploy

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Resumes
- `GET /api/resumes` - List all resumes
- `POST /api/resumes` - Create resume
- `PUT /api/resumes/:id` - Update resume
- `DELETE /api/resumes/:id` - Delete resume

### Jobs
- `GET /api/jobs` - List jobs (supports `?status=` and `?search=` filters)
- `POST /api/jobs` - Add job
- `PUT /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Delete job

### Dashboard
- `GET /api/dashboard/stats?period=weekly|monthly|yearly` - Get dashboard stats

### Account
- `GET /api/account/profile` - Get profile
- `PUT /api/account/profile` - Update profile
- `PUT /api/account/security` - Change password

## MongoDB Setup

You can use either:
- **MongoDB Atlas** (free tier) - Get a connection string from [mongodb.com/atlas](https://www.mongodb.com/atlas)
- **Local MongoDB** - Use `mongodb://localhost:27017/letmeapply`
