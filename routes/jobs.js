const express = require('express');
const Job = require('../models/Job');
const requireAuth = require('../middleware/auth');

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

// Stats for dashboard overview
router.get('/stats', async (req, res) => {
  try {
    const userId = req.userId;
    const jobs = await Job.find({ user: userId });

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

    // Build a 30-day trend series
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }
    const trend = days.map((d) => {
      const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      const count = jobs.filter((j) => {
        const ad = new Date(j.appliedOn);
        return ad >= d && ad < next;
      }).length;
      return { date: d.toISOString().slice(0, 10), count };
    });

    res.json({
      total: jobs.length,
      monthly,
      last7,
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

module.exports = router;
