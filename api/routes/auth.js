const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { getUserClient } = require('../config/db');

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function generateToken(userId, supabaseToken) {
  return jwt.sign(
    { userId, supabaseToken },
    process.env.JWT_SECRET || 'fallback_secret_dev',
    { expiresIn: '30d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error: signUpError } = await anonClient.auth.signUp({
      email: email.toLowerCase(),
      password,
      options: { data: { name } }
    });

    if (signUpError) {
      if (signUpError.message.includes('already registered') || signUpError.message.includes('already exists')) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      return res.status(400).json({ error: signUpError.message });
    }

    if (!data.user) {
      return res.status(400).json({ error: 'Registration failed' });
    }

    const userId = data.user.id;
    const supabaseToken = data.session?.access_token;

    // Insert profile row using the user's own session so RLS passes
    const userClient = supabaseToken ? getUserClient(supabaseToken) : null;
    if (userClient) {
      const { error: profileError } = await userClient
        .from('users')
        .insert({ id: userId, name, email: email.toLowerCase() });
      if (profileError && !profileError.message.includes('duplicate')) {
        console.error('Profile insert error:', profileError.message);
      }
    }

    const token = generateToken(userId, supabaseToken);
    res.status(201).json({
      token,
      user: { id: userId, name, email: email.toLowerCase(), plan: 'free' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: email.toLowerCase(),
      password
    });

    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userId = data.user.id;
    const supabaseToken = data.session.access_token;

    // Fetch profile using the user's own session (satisfies RLS)
    const userClient = getUserClient(supabaseToken);
    let { data: profile } = await userClient
      .from('users')
      .select('name, email, plan')
      .eq('id', userId)
      .maybeSingle();

    // Create profile row if it doesn't exist
    if (!profile) {
      const name = data.user.user_metadata?.name || data.user.email.split('@')[0];
      await userClient.from('users').insert({
        id: userId,
        name,
        email: data.user.email.toLowerCase()
      });
      profile = { name, email: data.user.email, plan: 'free' };
    }

    const token = generateToken(userId, supabaseToken);
    res.json({
      token,
      user: {
        id: userId,
        name: profile.name,
        email: profile.email,
        plan: profile.plan || 'free'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const db = getUserClient(req.supabaseToken);
    const { data: user, error } = await db
      .from('users')
      .select('id, name, email, avatar, plan, job_extractions, job_extractions_limit, tailored_resumes, tailored_resumes_limit')
      .eq('id', req.userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user: mapUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

module.exports = router;
