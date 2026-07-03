const express = require('express');
const auth = require('../middleware/auth');
const { getUserClient } = require('../config/db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { status, search } = req.query;
    const db = getUserClient(req.supabaseToken);
    let query = db
      .from('job_applications')
      .select('*')
      .order('applied_on', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`company.ilike.%${search}%,title.ilike.%${search}%,location.ilike.%${search}%`);
    }

    const { data: jobs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ jobs: (jobs || []).map(mapJob) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { company, title, location, status, appliedOn, notes, url, salary } = req.body;
    if (!company || !title) return res.status(400).json({ error: 'Company and title are required' });

    const db = getUserClient(req.supabaseToken);
    const { data: job, error } = await db
      .from('job_applications')
      .insert({
        company,
        title,
        location: location || '',
        status: status || 'applied',
        applied_on: appliedOn || new Date().toISOString(),
        notes: notes || '',
        url: url || '',
        salary: salary || ''
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ job: mapJob(job) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { company, title, location, status, appliedOn, notes, url, salary } = req.body;
    const update = {};
    if (company !== undefined) update.company = company;
    if (title !== undefined) update.title = title;
    if (location !== undefined) update.location = location;
    if (status !== undefined) update.status = status;
    if (appliedOn !== undefined) update.applied_on = appliedOn;
    if (notes !== undefined) update.notes = notes;
    if (url !== undefined) update.url = url;
    if (salary !== undefined) update.salary = salary;

    const db = getUserClient(req.supabaseToken);
    const { data: job, error } = await db
      .from('job_applications')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: mapJob(job) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getUserClient(req.supabaseToken);
    const { error } = await db
      .from('job_applications')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapJob(j) {
  return {
    _id: j.id,
    id: j.id,
    company: j.company,
    title: j.title,
    location: j.location,
    status: j.status,
    appliedOn: j.applied_on,
    notes: j.notes,
    url: j.url,
    salary: j.salary,
    createdAt: j.created_at
  };
}

module.exports = router;
