const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const connectDB = require('../utils/db');

const authRoutes = require('../routes/auth');
const jobRoutes = require('../routes/jobs');
const resumeRoutes = require('../routes/resumes');
const accountRoutes = require('../routes/account');
const aiRoutes = require('../routes/ai');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// AI routes don't need the database, so mount before the DB-connect gate.
app.use('/api/ai', aiRoutes);

// Ensure DB connection before handling API requests only (skip static files)
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed. Please try again shortly.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/account', accountRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve static frontend (used for local dev; Vercel serves /public directly)
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
