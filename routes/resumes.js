const express = require('express');
const Resume  = require('../models/Resume');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');
const { tailorResumeWithAI, tailorRawTextWithAI, generateCoverLetterWithAI } = require('../utils/aiResumeParser');
const { getKeyPool } = require('../utils/groqKeyPool');
const { generatePdfBuffer } = require('../utils/simplePdf');
const Job = require('../models/Job');

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
    if (err.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (GROQ_API_KEY is not configured).' });
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
    if (err.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (GROQ_API_KEY is not configured).' });
    }
    // Surface the real reason (Groq status code / message) instead of a
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
    if (err.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI features are not enabled on this server (GROQ_API_KEY is not configured).' });
    }
    res.status(502).json({ error: `Cover letter generation failed: ${err.message}` });
  }
});

// ─── Tailor workspace compatibility route ───────────────────────────────────
router.post('/tailor', async (req, res) => {
  try {
    const { resumeId, jobId, jobTitle = '', jobDescription = '', emphasizeSkills = [], tailoringLevel = 'medium' } = req.body || {};
    if (!resumeId) return res.status(400).json({ error: 'resumeId is required' });
    const resume = await Resume.findOne({ _id: resumeId, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    let title = jobTitle;
    let description = jobDescription;
    if (jobId) {
      const job = await Job.findOne({ _id: jobId, user: req.userId });
      if (!job) return res.status(404).json({ error: 'Job not found' });
      title = title || job.title;
      description = description || job.notes || '';
      if (!description.trim() && Array.isArray(job.skills) && job.skills.length) description = `Required skills: ${job.skills.join(', ')}`;
    }
    if (!description.trim()) return res.status(400).json({ error: 'A job description is required' });
    const tailored = await tailorResumeWithAI(resume, title, description, emphasizeSkills, String(tailoringLevel).toLowerCase());
    const diff = {
      ...tailored,
      summary: {
        original: tailored.summary?.old || '',
        suggested: tailored.summary?.new || '',
        old: tailored.summary?.old || '',
        new: tailored.summary?.new || ''
      },
      skills: {
        original: resume.skills || [],
        added: (tailored.skills || []).filter(s => !(resume.skills || []).some(x => String(x).toLowerCase() === String(s).toLowerCase())),
        removed: (resume.skills || []).filter(s => !(tailored.skills || []).some(x => String(x).toLowerCase() === String(s).toLowerCase()))
      },
      experience: (tailored.experience || []).map(exp => ({
        ...exp,
        bullets: (exp.bullets || []).map(b => ({
          original: b.old || '',
          suggested: b.new || b.old || '',
          old: b.old || '',
          new: b.new || b.old || '',
          action: b.action || 'keep'
        }))
      }))
    };
    res.json({ success: true, diff, tailored });
  } catch (err) {
    console.error('[/resumes/tailor]', err);
    if (err.message.includes('GROQ_API_KEY')) return res.status(503).json({ error: 'Groq AI is not configured (GROQ_API_KEY is required).' });
    res.status(502).json({ error: `AI tailoring failed: ${err.message}` });
  }
});

// ─── PDF export compatibility route ─────────────────────────────────────────
router.post('/download-pdf', async (req, res) => {
  try {
    const { resumeData = {}, customOptions = {} } = req.body || {};
    if (!resumeData || typeof resumeData !== 'object') return res.status(400).json({ error: 'resumeData is required' });
    const pdf = generatePdfBuffer(resumeData, customOptions);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="SKVK_Tailored_Resume_${Date.now()}.pdf"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store'
    });
    res.end(pdf);
  } catch (err) {
    console.error('[/resumes/download-pdf]', err);
    res.status(500).json({ error: 'Could not generate the resume PDF' });
  }
});

// Generate a PDF directly from a saved resume. This route is used by the
// extension so it never has to rasterize the resume with html2canvas.
router.get('/:id/download-pdf', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const pdf = generatePdfBuffer(resume.toObject(), {});
    if (!Buffer.isBuffer(pdf) || !pdf.subarray(0, 5).toString().startsWith('%PDF-')) {
      throw new Error('Generated PDF buffer is invalid');
    }
    res.status(200).set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=\"SKVK_Resume_${Date.now()}.pdf\"`,
      'Content-Length': String(pdf.length),
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(pdf);
  } catch (err) {
    console.error('[/resumes/:id/download-pdf]', err);
    res.status(500).json({ error: 'Could not generate the resume PDF' });
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
