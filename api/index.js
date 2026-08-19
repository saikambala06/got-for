const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const connectDB = require('../utils/db');

const authRoutes = require('../routes/auth');
const jobRoutes = require('../routes/jobs');
const resumeRoutes = require('../routes/resumes');
const accountRoutes = require('../routes/account');
const parserRoutes = require('../routes/parser');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Health probes must answer even when Mongo is unreachable — a health check
// that fails whenever the database is down cannot report that the database is
// down, and the parser page uses /api/parser/health only to ask which
// capabilities are available.
const DB_FREE_PATHS = new Set(['/health', '/parser/health']);

// Ensure DB connection before handling API requests only (skip static files)
app.use('/api', async (req, res, next) => {
  if (DB_FREE_PATHS.has(req.path)) return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(503).json({ error: 'Database connection failed. Please try again shortly.' });
  }
});

/**
 * Health and configuration probe.
 *
 * Reports which required settings are present as booleans — never their
 * values — so a deployment problem can be identified from the browser without
 * reading server logs or the source. This is the endpoint to check first when
 * login or registration returns an error.
 */
app.get('/api/health', async (req, res) => {
  const config = require('../utils/config');

  let database = 'ok';
  try {
    await connectDB();
  } catch (err) {
    database = 'unavailable';
  }

  const missing = config.missingRequired();
  const healthy = database === 'ok' && missing.length === 0;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'misconfigured',
    database,
    missing,
    config: config.status(),
    hint: missing.length
      ? `Set ${missing.join(' and ')} in Vercel → Project Settings → Environment Variables, then redeploy.`
      : ''
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/parser', parserRoutes);

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html')));
app.get('/tracker', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'tracker.html')));
app.get('/resumes', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'resumes.html')));
app.get('/tailor', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'tailor.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'account.html')));
app.get('/parse-resume', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'parse-resume.html')));


// Serve static frontend (used for local dev; Vercel serves /public directly)
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
