const express = require('express');
const multer = require('multer');
const Resume = require('../models/Resume');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { normalizeDocxText } = require('../utils/resumeParser');

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

// ─── AI-powered resume parser using Claude ────────────────────────────────────
async function parseWithClaude(rawText) {
  const https = require('https');

  const systemPrompt = `You are a precise resume parser. Extract structured data from the resume text provided and return ONLY valid JSON — no markdown fences, no explanation, just the raw JSON object.

The JSON must exactly match this schema:
{
  "personal": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string (City, State or City, Country)",
    "linkedin": "string (full URL or empty)",
    "portfolio": "string (full URL or empty, not linkedin)"
  },
  "summary": "string (professional summary/objective text, or empty)",
  "experience": [
    {
      "role": "string (job title)",
      "company": "string (company/employer name)",
      "location": "string (city/state where job was, or empty)",
      "startDate": "string (e.g. Jan 2020 or 2020, or empty)",
      "endDate": "string (e.g. Dec 2023 or Present, or empty)",
      "current": boolean,
      "description": "string (bullet points joined by newlines, or empty)"
    }
  ],
  "education": [
    {
      "school": "string (institution name)",
      "degree": "string (e.g. Bachelor of Science, MBA)",
      "field": "string (e.g. Computer Science, or empty)",
      "location": "string (city/state or empty)",
      "startDate": "string or empty",
      "endDate": "string or empty",
      "current": boolean,
      "description": "string or empty"
    }
  ],
  "skills": ["string", ...],
  "projects": [
    {
      "name": "string",
      "link": "string (URL or empty)",
      "description": "string"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string or empty",
      "date": "string or empty"
    }
  ],
  "achievements": ["string", ...],
  "languages": ["string", ...],
  "publications": [
    {
      "title": "string",
      "link": "string or empty",
      "date": "string or empty"
    }
  ]
}

Rules:
- Extract EVERY work experience entry, even internships and part-time roles
- For "current" field: set true if endDate is "Present" or "Current"
- Keep description bullets as newline-separated text
- Skills must be individual items (split comma-separated lists)
- If a field has no data, use empty string "" or empty array []
- Do not invent or infer data that isn't in the resume
- Return ONLY the JSON object, nothing else`;

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Parse this resume:\n\n${rawText.slice(0, 12000)}` }]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || 'Claude API error'));
          const text = (json.content || []).map(b => b.text || '').join('').trim();
          // Strip any accidental markdown fences
          const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(clean);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse AI response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Fallback: basic rule-based parser (used when ANTHROPIC_API_KEY is not set)
function parseWithRules(rawText) {
  const { parseResumeText } = require('../utils/resumeParser');
  return parseResumeText(rawText);
}

// ─── POST /api/resumes/parse ──────────────────────────────────────────────────
router.post('/parse', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not read that file' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose a PDF or DOCX file' });
    }
    try {
      let text = '';
      if (req.file.mimetype === 'application/pdf') {
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(req.file.buffer);
        text = (result.text || '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n');
      } else {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = normalizeDocxText(value);
      }

      if (!text || !text.trim()) {
        return res.status(422).json({ error: "We couldn't read any text from that file. Try Build from Scratch instead." });
      }

      let parsed;
      if (process.env.ANTHROPIC_API_KEY) {
        parsed = await parseWithClaude(text);
      } else {
        parsed = parseWithRules(text);
      }

      res.json({ parsed });
    } catch (err2) {
      console.error('Resume parse error:', err2);
      // Graceful fallback to rule-based parser on AI failure
      try {
        const rawText = err2._rawText;
        if (rawText) {
          const parsed = parseWithRules(rawText);
          return res.json({ parsed });
        }
      } catch (_) {}
      res.status(500).json({ error: 'Could not process that file. Try Build from Scratch instead.' });
    }
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
