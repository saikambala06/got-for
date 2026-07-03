const express = require('express');
const auth = require('../middleware/auth');
const { getUserClient } = require('../config/db');

const router = express.Router();

function mapUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    plan: u.plan,
    jobExtractions: u.job_extractions,
    jobExtractionsLimit: u.job_extractions_limit,
    tailoredResumes: u.tailored_resumes,
    tailoredResumesLimit: u.tailored_resumes_limit
  };
}

router.get('/profile', auth, async (req, res) => {
  try {
    const db = getUserClient(req.supabaseToken);
    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: mapUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', auth, async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const update = { updated_at: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (avatar !== undefined) update.avatar = avatar;

    const db = getUserClient(req.supabaseToken);
    const { data: user, error } = await db
      .from('users')
      .update(update)
      .eq('id', req.userId)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: mapUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/security', auth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!req.supabaseToken) {
      return res.status(400).json({ error: 'Session required to change password. Please log in again.' });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${req.supabaseToken}` } },
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { error } = await userClient.auth.updateUser({ password: newPassword });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
