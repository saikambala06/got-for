const express = require('express');
const auth = require('../middleware/auth');
const { getUserClient } = require('../config/db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const db = getUserClient(req.supabaseToken);
    const { data: resumes, error } = await db
      .from('resumes')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ resumes: (resumes || []).map(mapResume) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, content, fileUrl, isDefault } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const db = getUserClient(req.supabaseToken);
    const { data: resume, error } = await db
      .from('resumes')
      .insert({
        name,
        content: content || '',
        file_url: fileUrl || '',
        is_default: isDefault || false
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ resume: mapResume(resume) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, content, fileUrl, isDefault } = req.body;
    const update = { updated_at: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (content !== undefined) update.content = content;
    if (fileUrl !== undefined) update.file_url = fileUrl;
    if (isDefault !== undefined) update.is_default = isDefault;

    const db = getUserClient(req.supabaseToken);
    const { data: resume, error } = await db
      .from('resumes')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume: mapResume(resume) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getUserClient(req.supabaseToken);
    const { error } = await db
      .from('resumes')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Resume deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapResume(r) {
  return {
    _id: r.id,
    id: r.id,
    name: r.name,
    content: r.content,
    fileUrl: r.file_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

module.exports = router;
