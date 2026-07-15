const express = require('express');
const multer  = require('multer');
const Resume  = require('../models/Resume');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');
const { parseResumeWithAI, parseRawResumeTextWithAI, tailorResumeWithAI, tailorRawTextWithAI, generateCoverLetterWithAI } = require('../utils/aiResumeParser');
const { normalizeDocxText } = require('../utils/resumeParser');
const { getKeyPool } = require('../utils/xaiKeyPool');

const router = express.Router();
router.use(requireAuth);

// ─── AI key pool status (for diagnosing quota issues) ─────────────────────────
router.get('/ai-status', (req, res) => {
  const pool = getKeyPool();
  res.json({
    configuredKeys: pool.count(),
    keys: pool.status()
  });
});

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
 * Clean up raw PDF-extracted text before parsing:
 * - Remove page-number artifacts
 * - Remove repeated headers/footers (lines that appear 2+ times verbatim)
 * - Normalise bullet characters
 * - Collapse excessive blank lines
 */
function cleanPdfText(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');

  // Count line frequencies — lines that appear 3+ times are likely headers/footers
  const freq = {};
  for (const l of lines) {
    const t = l.trim();
    if (t) freq[t] = (freq[t] || 0) + 1;
  }

  const cleaned = lines
    .map(l => {
      const t = l.trim();
      // Remove page-number lines
      if (/^--\s*\d+\s*(of\s+\d+)?\s*--$/i.test(t)) return '';
      if (/^Page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return '';
      // Remove repeated header/footer lines
      if (freq[t] >= 3) return '';
      // Normalise bullets
      return l.replace(/^[\s]*[\u2022\u25AA\u25CF\u2713\u2714\u25BA\u27A2\u27B3*▪▸]\s*/m, '- ');
    });

  return cleaned.join('\n')
    .replace(/\n{4,}/g, '\n\n')   // collapse 4+ blank lines to 2
    .trim();
}

// ─── Parse uploaded resume ────────────────────────────────────────────────────

router.post('/parse', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not read that file' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a PDF or DOCX file' });

    try {
      let text = '';

      if (req.file.mimetype === 'application/pdf') {
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(req.file.buffer, {
          // Use raw text extraction without normalization — we clean it ourselves
          normalizeWhitespace: false
        });
        text = cleanPdfText(result.text);
      } else {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = normalizeDocxText(value);
      }

      if (!text || !text.trim()) {
        return res.status(422).json({
          error: "We couldn't read any text from that file. Try Build from Scratch instead."
        });
      }

      const parsed = await parseResumeWithAI(text);
      res.json({ parsed });
    } catch (err2) {
      console.error('[/parse]', err2);
      res.status(500).json({ error: 'Could not process that file. Try Build from Scratch instead.' });
    }
  });
});

// ─── Parse pasted resume text (web portal "Parse resume" tab) ────────────────
// Uses the server's own XAI_API_KEY — the person never supplies one.

router.post('/parse-text', async (req, res) => {
  try {
    const { text = '' } = req.body;
    if (!text.trim()) return res.status(400).json({ error: 'Paste a resume first' });

    const parsed = await parseRawResumeTextWithAI(text);
    res.json({ parsed });
  } catch (err) {
    console.error('[/parse-text]', err.message);
    if (err.message.includes('XAI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (XAI_API_KEY is not configured).' });
    }
    res.status(502).json({ error: `Resume parsing failed: ${err.message}` });
  }
});

// ─── Tailor pasted resume text against a pasted job description ──────────────
// (web portal "Tailor resume" tab — no saved resume required)

router.post('/tailor-text', async (req, res) => {
  try {
    const { resumeText = '', jobDescription = '' } = req.body;
    if (!resumeText.trim() || !jobDescription.trim()) {
      return res.status(400).json({ error: 'Add both a resume and a job description' });
    }

    const tailored = await tailorRawTextWithAI(resumeText, jobDescription);
    res.json({ tailored });
  } catch (err) {
    console.error('[/tailor-text]', err.message);
    if (err.message.includes('XAI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (XAI_API_KEY is not configured).' });
    }
    res.status(502).json({ error: `AI tailoring failed: ${err.message}` });
  }
});

// ─── Tailor an existing resume ────────────────────────────────────────────────

router.post('/:id/tailor', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const { jobTitle = '', jobDescription = '', emphasizeSkills = [], tailoringLevel = 'high' } = req.body;
    if (!jobDescription.trim()) return res.status(400).json({ error: 'Job description is required' });

    const tailored = await tailorResumeWithAI(resume, jobTitle, jobDescription, emphasizeSkills, tailoringLevel);
    res.json({ tailored });
  } catch (err) {
    console.error('[/tailor]', err.message);
    if (err.message.includes('XAI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (XAI_API_KEY is not configured).' });
    }
    // Surface the real reason (xAI status code / message) instead of a
    // generic "please try again" — a masked error is impossible to
    // self-diagnose from the client side.
    res.status(502).json({ error: `AI tailoring failed: ${err.message}` });
  }
});

// ─── Generate a cover letter for a job ────────────────────────────────────────

router.post('/:id/cover-letter', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });

    const { jobTitle = '', company = '', jobDescription = '' } = req.body;
    if (!jobDescription.trim()) return res.status(400).json({ error: 'Job description is required' });

    const coverLetter = await generateCoverLetterWithAI(resume, jobTitle, company, jobDescription);
    res.json({ coverLetter });
  } catch (err) {
    console.error('[/cover-letter]', err.message);
    if (err.message.includes('XAI_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (XAI_API_KEY is not configured).' });
    }
    res.status(502).json({ error: `Cover letter generation failed: ${err.message}` });
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
    listFields.forEach(key => {
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
    allowed.forEach(key => {
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
