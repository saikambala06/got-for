const express = require('express');
const Job = require('../models/Job');
const JobView = require('../models/JobView');
const requireAuth = require('../middleware/auth');
const { analyzeJobWithAI } = require('../utils/aiResumeParser');

const router = express.Router();
router.use(requireAuth);

// List all jobs for user, with optional search/status filter
router.get('/', async (req, res) => {
  try {
    const { q, status, startDate, endDate } = req.query;
    const filter = { user: req.userId };
    if (status && status !== 'All') filter.status = status;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      filter.appliedOn = {};
      if (startDate) filter.appliedOn.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.appliedOn.$lte = end;
      }
    }
    const jobs = await Job.find(filter).sort({ appliedOn: -1 });
    res.json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load job tracker data' });
  }
});

// Log a "job viewed" event — called once by the browser extension each time
// it successfully parses a job posting page for a logged-in user. Deduped
// per user+URL+day so re-opening the panel or reloading the same posting
// doesn't inflate the count.
router.post('/track-view', async (req, res) => {
  try {
    const { title, company, jobUrl } = req.body || {};
    const userId = req.userId;

    if (jobUrl) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const existing = await JobView.findOne({ user: userId, jobUrl, viewedOn: { $gte: startOfDay } });
      if (existing) {
        return res.json({ view: existing, deduped: true });
      }
    }

    const view = await JobView.create({
      user: userId,
      title: title || '',
      company: company || '',
      jobUrl: jobUrl || ''
    });
    res.status(201).json({ view });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not log job view' });
  }
});

// Stats for dashboard overview
router.get('/stats', async (req, res) => {
  try {
    const userId = req.userId;
    const jobs = await Job.find({ user: userId });
    const views = await JobView.find({ user: userId });

    const counts = { Applied: 0, Interviewing: 0, Offer: 0, Rejected: 0, Archived: 0 };
    let favorites = 0;
    jobs.forEach((j) => {
      counts[j.status] = (counts[j.status] || 0) + 1;
      if (j.favorite) favorites += 1;
    });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const monthly = jobs.filter((j) => new Date(j.appliedOn) >= startOfMonth).length;
    const last7 = jobs.filter((j) => new Date(j.appliedOn) >= sevenDaysAgo).length;
    const viewedMonthly = views.filter((v) => new Date(v.viewedOn) >= startOfMonth).length;

    // Build a 30-day trend series
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }
    const trend = days.map((d) => {
      const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      // Applied — jobs whose application date falls on this day.
      const count = jobs.filter((j) => {
        const ad = new Date(j.appliedOn);
        return ad >= d && ad < next;
      }).length;
      // Viewed — real job-view events logged by the browser extension each
      // time a posting was opened (see POST /track-view).
      const viewed = views.filter((v) => {
        const vd = new Date(v.viewedOn);
        return vd >= d && vd < next;
      }).length;
      return { date: d.toISOString().slice(0, 10), count, viewed };
    });

    res.json({
      total: jobs.length,
      monthly,
      last7,
      viewedMonthly,
      counts,
      favorites,
      trend
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not compute stats' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, user: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err) {
    res.status(400).json({ error: 'Invalid job id' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.title || !body.company) {
      return res.status(400).json({ error: 'Job title and company are required' });
    }
    const job = await Job.create({
      user: req.userId,
      title: body.title,
      company: body.company,
      location: body.location || '',
      salary: body.salary || '',
      status: body.status || 'Applied',
      favorite: !!body.favorite,
      source: body.source || '',
      jobUrl: body.jobUrl || '',
      notes: body.notes || '',
      skills: Array.isArray(body.skills) ? body.skills : [],
      appliedOn: body.appliedOn ? new Date(body.appliedOn) : new Date()
    });
    res.status(201).json({ job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add job application' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update job application' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete job application' });
  }
});

// AI-powered analysis of a job posting's skills / qualifications / highlights.
// Falls back to a 503 (not an error the client should retry) if no Gemini
// key is configured — the extension keeps its regex-based extraction as
// its baseline and just skips the AI enhancement in that case.
router.post('/analyze', async (req, res) => {
  try {
    const { jobTitle = '', company = '', jobDescription = '' } = req.body;
    if (!jobDescription.trim()) return res.status(400).json({ error: 'Job description is required' });

    const analysis = await analyzeJobWithAI(jobTitle, company, jobDescription);
    res.json({ analysis });
  } catch (err) {
    console.error('[/jobs/analyze]', err.message);
    if (err.message.includes('GEMINI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (GEMINI_API_KEY is not configured).' });
    }
    res.status(502).json({ error: `AI job analysis failed: ${err.message}` });
  }
});

module.exports = router;
