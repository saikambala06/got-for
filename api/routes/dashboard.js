const express = require('express');
const auth = require('../middleware/auth');
const { getUserClient } = require('../config/db');

const router = express.Router();

router.get('/stats', auth, async (req, res) => {
  try {
    const { period } = req.query;
    const now = new Date();
    const db = getUserClient(req.supabaseToken);

    const { count: allTimeCount } = await db
      .from('job_applications')
      .select('*', { count: 'exact', head: true });

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { count: monthlyCount } = await db
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .gte('applied_on', monthStart);

    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { count: weekCount } = await db
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .gte('applied_on', weekAgo.toISOString());

    let days = 7;
    if (period === 'weekly') days = 7;
    else if (period === 'monthly') days = 30;
    else if (period === 'yearly') days = 365;

    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - days);

    const { data: statsRows } = await db
      .from('stats')
      .select('date, jobs_viewed, jobs_applied')
      .gte('date', trendStart.toISOString().split('T')[0])
      .order('date', { ascending: true });

    let trendData = [];
    if (period === 'yearly') {
      const monthlyAgg = {};
      (statsRows || []).forEach(s => {
        const d = new Date(s.date);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthlyAgg[key]) monthlyAgg[key] = { jobsViewed: 0, jobsApplied: 0, label: '' };
        monthlyAgg[key].jobsViewed += s.jobs_viewed;
        monthlyAgg[key].jobsApplied += s.jobs_applied;
        monthlyAgg[key].label = d.toLocaleString('default', { month: 'short' });
      });
      trendData = Object.values(monthlyAgg);
    } else {
      trendData = (statsRows || []).map(s => ({
        jobsViewed: s.jobs_viewed,
        jobsApplied: s.jobs_applied,
        label: new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }));
    }

    res.json({
      allTimeCount: allTimeCount || 0,
      monthlyCount: monthlyCount || 0,
      weekCount: weekCount || 0,
      trendData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
