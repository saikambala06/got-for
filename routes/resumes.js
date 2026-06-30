const express = require('express');
const multer = require('multer');
const Resume = require('../models/Resume');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { parseResumeText, parseWithAI, normalizeDocxText } = require('../utils/resumeParser');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF or DOCX files are supported'), ok);
  }
});

// Extract text from the uploaded buffer (PDF or DOCX) and return it.
async function extractText(file) {
  if (file.mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(file.buffer);
    return (result.text || '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n');
  } else {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizeDocxText(value);
  }
}

// POST /api/resumes/parse — extract structured data from an uploaded PDF/DOCX.
// Tries AI parsing first, falls back to regex parser if AI is unavailable.
router.post('/parse', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not read that file' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose a PDF or DOCX file' });
    }

    let text = '';
    try {
      text = await extractText(req.file);
    } catch (e) {
      console.error('Text extraction error:', e);
      return res.status(500).json({ error: 'Could not extract text from that file. Try Build from Scratch instead.' });
    }

    if (!text || !text.trim()) {
      return res.status(422).json({ error: "We couldn't read any text from that file. Try Build from Scratch instead." });
    }

    // Try AI first — falls back to regex if ANTHROPIC_API_KEY is missing or call fails.
    let parsed;
    let usedAI = false;
    try {
      parsed = await parseWithAI(text);
      usedAI = true;
    } catch (aiErr) {
      console.warn('AI parse failed, using regex fallback:', aiErr.message);
      try {
        parsed = parseResumeText(text);
      } catch (regexErr) {
        console.error('Regex parse also failed:', regexErr);
        return res.status(500).json({ error: 'Could not process that file. Try Build from Scratch instead.' });
      }
    }

    res.json({ parsed, usedAI });
  });
});

router.get('/', async (req, res) => {
  try {
    const resumes = await Resume.find({ user: req.userId }).sort({ updatedAt: -1 });
    res.json({ resumes });
  } catch (err) {
    res.status(500).json({ error: 'Could not load resumes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    res.status(400).json({ error: 'Invalid resume id' });
  }
});

// POST /api/resumes — create a new resume (from scratch or from an upload).
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
          name: user.name || '',
          email: user.email || '',
          phone: user.phone || '',
          location: user.location || '',
          linkedin: user.linkedin || '',
          portfolio: user.portfolio || ''
        };
      }
    }

    const listFields = ['experience', 'education', 'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications'];
    const extra = {};
    listFields.forEach((key) => {
      if (Array.isArray(req.body[key])) extra[key] = req.body[key];
    });

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
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });

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
