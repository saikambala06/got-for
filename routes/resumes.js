const express = require('express');
const multer  = require('multer');
const Resume  = require('../models/Resume');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');
const { parseResumeText, normalizeDocxText, parseResumeWithAI } = require('../utils/resumeParser');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF or DOCX files are supported'), ok);
  }
});

// POST /api/resumes/parse
// Extracts structured resume data from an uploaded PDF or DOCX.
// Uses the Anthropic AI parser when ANTHROPIC_API_KEY is present;
// falls back to the rule-based regex parser otherwise.
router.post('/parse', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not read that file' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a PDF or DOCX file' });

    try {
      // ── 1. Extract raw text from the uploaded file ──────────────────────────
      let text = '';

      if (req.file.mimetype === 'application/pdf') {
        // pdf-parse v2: default export is a function that takes a Buffer
        const pdfParse = require('pdf-parse');
        const result   = await pdfParse(req.file.buffer);
        text = (result.text || '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n');
      } else {
        const mammoth  = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = normalizeDocxText(value);
      }

      if (!text || !text.trim()) {
        return res.status(422).json({
          error: "We couldn't read any text from that file. Try Build from Scratch instead."
        });
      }

      // ── 2. Parse the text into structured fields ────────────────────────────
      let parsed;

      if (process.env.ANTHROPIC_API_KEY) {
        try {
          parsed = await parseResumeWithAI(text);
        } catch (aiErr) {
          // AI call failed (rate limit, bad key, network, etc.) — degrade gracefully
          console.warn('[resume/parse] AI parser failed, using regex fallback:', aiErr.message);
          parsed = parseResumeText(text);
        }
      } else {
        parsed = parseResumeText(text);
      }

      res.json({ parsed });
    } catch (err2) {
      console.error('[resume/parse]', err2);
      res.status(500).json({ error: 'Could not process that file. Try Build from Scratch instead.' });
    }
  });
});

// GET /api/resumes
router.get('/', async (req, res) => {
  try {
    const resumes = await Resume.find({ user: req.userId }).sort({ updatedAt: -1 });
    res.json({ resumes });
  } catch (err) {
    res.status(500).json({ error: 'Could not load resumes' });
  }
});

// GET /api/resumes/:id
router.get('/:id', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    res.status(400).json({ error: 'Invalid resume id' });
  }
});

// POST /api/resumes
// Used by "Build from Scratch" (optionally pre-filled from the account
// profile) and by the "Upload Resume" flow.
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Resume name is required' });

    const count = await Resume.countDocuments({ user: req.userId });

    let personal = { name: '', email: '', phone: '', location: '', linkedin: '', portfolio: '' };
    if (req.body.personal) {
      personal = { ...personal, ...req.body.personal };
    } else if (req.body.prefillFromProfile) {
      const user = await User.findById(req.userId);
      if (user) {
        personal = {
          name:      user.name      || '',
          email:     user.email     || '',
          phone:     user.phone     || '',
          location:  user.location  || '',
          linkedin:  user.linkedin  || '',
          portfolio: user.portfolio || ''
        };
      }
    }

    const listFields = ['experience', 'education', 'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications'];
    const extra = {};
    listFields.forEach((key) => { if (Array.isArray(req.body[key])) extra[key] = req.body[key]; });

    const resume = await Resume.create({
      user: req.userId,
      title,
      isDefault: count === 0,
      personal,
      summary: req.body.summary || '',
      ...extra
    });
    res.status(201).json({ resume });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create resume' });
  }
});

// PUT /api/resumes/:id
router.put('/:id', async (req, res) => {
  try {
    if (req.body.isDefault === true) {
      await Resume.updateMany({ user: req.userId }, { $set: { isDefault: false } });
    }

    const allowed = [
      'title', 'isDefault', 'personal', 'summary', 'experience', 'education',
      'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications'
    ];
    const update = {};
    allowed.forEach((key) => { if (req.body[key] !== undefined) update[key] = req.body[key]; });

    const resume = await Resume.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update resume' });
  }
});

// DELETE /api/resumes/:id
router.delete('/:id', async (req, res) => {
  try {
    const resume = await Resume.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete resume' });
  }
});

module.exports = router;
