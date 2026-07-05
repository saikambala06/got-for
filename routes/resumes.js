const express = require('express');
const multer = require('multer');
const Resume = require('../models/Resume');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { parseResumeWithAI, tailorResumeWithAI } = require('../utils/aiResumeParser');
const { normalizeDocxText } = require('../utils/resumeParser');

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

/**
 * Clean raw extracted text before sending to AI.
 * Fixes common PDF/DOCX extraction artifacts:
 *  - Bullet symbols (•, ○, ▪, ◦, ◆, ▶, →, ✓, –) become a dash so the AI
 *    treats them as list items, not noise
 *  - Skill-category headers ("Cloud Platforms:", "DevOps Tools:") that got
 *    embedded inside the skills list are preserved as their own line so the
 *    AI can tell them apart from the actual skill names
 *  - Page numbers, headers/footers (common patterns) are stripped
 *  - Excessive blank lines are collapsed to max two
 *  - Smart quotes / special dashes are normalised to ASCII so JSON.parse
 *    never chokes on them
 */
function cleanExtractedText(raw) {
  let t = raw;

  // 1. Normalise smart quotes and special dashes to ASCII equivalents
  t = t
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2022|\u25CF|\u25AA|\u25AB|\u25E6|\u2023|\u2043|\u204C|\u204D/g, '-') // bullet symbols
    .replace(/[\u25B6\u25B8\u2192\u27A4\u27A1]/g, '-') // arrow bullets
    .replace(/[\u2713\u2714\u2611]/g, '-') // check-mark bullets
    .replace(/[\u00A0\u2002\u2003\u2009\u200B]/g, ' '); // non-breaking / zero-width spaces

  // 2. Remove page-number lines like "Page 1 of 3", "-- 2 of 5 --", "1 | 3"
  t = t.replace(/^-{0,4}\s*\d+\s*(?:of|\/)\s*\d+\s*-{0,4}$/gim, '');
  t = t.replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gim, '');

  // 3. Remove repeated lines that look like running headers/footers
  //    (same short line appearing 3+ times in the document)
  const lines = t.split('\n');
  const freq = {};
  lines.forEach(l => { const k = l.trim().toLowerCase(); if (k.length > 3 && k.length < 60) freq[k] = (freq[k] || 0) + 1; });
  const repeated = new Set(Object.keys(freq).filter(k => freq[k] >= 3));
  t = lines.filter(l => !repeated.has(l.trim().toLowerCase())).join('\n');

  // 4. Collapse 3+ consecutive blank lines to 2
  t = t.replace(/\n{3,}/g, '\n\n');

  // 5. Trim leading/trailing whitespace per line (but preserve indentation signal)
  t = t.split('\n').map(l => l.trimEnd()).join('\n');

  return t.trim();
}

// ─── Parse uploaded resume with xAI Grok ─────────────────────────────────────
router.post('/parse', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not read that file' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a PDF or DOCX file' });

    try {
      let rawText = '';

      if (req.file.mimetype === 'application/pdf') {
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(req.file.buffer);
        rawText = result.text || '';
      } else {
        // DOCX — mammoth extracts clean plain text
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
        rawText = normalizeDocxText(value);
      }

      if (!rawText || !rawText.trim()) {
        return res.status(422).json({
          error: "We couldn't read any text from that file. Try Build from Scratch instead."
        });
      }

      // Clean the text before sending to AI
      const text = cleanExtractedText(rawText);

      console.log(`[parse] extracted ${rawText.length} chars → cleaned to ${text.length} chars`);

      const parsed = await parseResumeWithAI(text);
      res.json({ parsed });
    } catch (err2) {
      console.error('[parse]', err2);
      res.status(500).json({ error: 'Could not process that file. Try Build from Scratch instead.' });
    }
  });
});

// ─── Tailor an existing resume to a job description ───────────────────────────
router.post('/:id/tailor', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const { jobTitle = '', jobDescription = '' } = req.body;
    if (!jobDescription.trim()) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    const tailored = await tailorResumeWithAI(resume, jobTitle, jobDescription);
    res.json({ tailored });
  } catch (err) {
    console.error('[tailor]', err.message);
    if (err.message.includes('XAI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server.' });
    }
    res.status(500).json({ error: 'AI tailoring failed — please try again.' });
  }
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────
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

    const listFields = [
      'experience', 'education', 'skills', 'projects',
      'certifications', 'achievements', 'languages', 'publications'
    ];
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
