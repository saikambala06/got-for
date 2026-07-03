const express = require('express');
const JobApplication = require('../models/JobApplication');
const Stats = require('../models/Stats');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/stats', auth, async (req, res) => {
  try {
    const { period } = req.query;
    const now = new Date();

    const allTimeCount = await JobApplication.countDocuments({ userId: req.userId });

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyCount = await JobApplication.countDocuments({
      userId: req.userId,
      appliedOn: { $gte: monthStart }
    });

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    const weekCount = await JobApplication.countDocuments({
      userId: req.userId,
      appliedOn: { $gte: weekStart }
    });

    let days = 7;
    if (period === 'weekly') days = 7;
    else if (period === 'monthly') days = 30;
    else if (period === 'yearly') days = 365;

    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - days);

    const stats = await Stats.find({
      userId: req.userId,
      date: { $gte: trendStart }
    }).sort({ date: 1 });

    let trendData = [];
    if (period === 'yearly') {
      const monthlyAgg = {};
      stats.forEach(s => {
        const key = `${s.date.getFullYear()}-${s.date.getMonth()}`;
        if (!monthlyAgg[key]) monthlyAgg[key] = { jobsViewed: 0, jobsApplied: 0, label: '' };
        monthlyAgg[key].jobsViewed += s.jobsViewed;
        monthlyAgg[key].jobsApplied += s.jobsApplied;
        monthlyAgg[key].label = s.date.toLocaleString('default', { month: 'short' });
      });
      trendData = Object.values(monthlyAgg);
    } else {
      trendData = stats.map(s => ({
        jobsViewed: s.jobsViewed,
        jobsApplied: s.jobsApplied,
        label: s.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }));
    }

    res.json({
      allTimeCount,
      monthlyCount,
      weekCount,
      trendData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
