/**
 * Parser persistence.
 *
 * Parsing itself lives in the Python pipeline (api/parser/*.py) — it is the
 * only part of this app that is not Node, because the document-extraction
 * libraries it depends on (pdfplumber, pdfminer.six, python-docx) have no
 * equivalent here.
 *
 * Saving stays in Node because this is where the Mongoose models and the
 * session middleware already live, and shipping a second database client into
 * the Python function to write one document would be the wrong trade.
 *
 *   POST /api/parser/save   parsed JSON -> a saved resume
 *
 * In production Vercel routes /api/parser/{health,upload,text} to Python
 * before this router ever sees them (see vercel.json). The stubs below only
 * matter when someone runs `npm start` without the Python service, and they
 * exist so that produces a clear explanation rather than a confusing 404.
 */

'use strict';

const express = require('express');

const Resume = require('../models/Resume');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const PYTHON_ONLY_HINT =
  'Parsing runs in the Python pipeline. Use `vercel dev` to serve it locally, ' +
  'or start it directly with `cd api && PARSER_ALLOW_ANONYMOUS=true python -m _resume_parser.server`.';

// These only respond when the Python function is not in front of them.
['/health', '/upload', '/text'].forEach((path) => {
  router.all(path, (req, res) => {
    res.status(503).json({
      ok: false,
      error: 'The resume parser service is not reachable.',
      hint: PYTHON_ONLY_HINT,
      code: 'parser_unavailable'
    });
  });
});

router.use(requireAuth);

const LIST_FIELDS = [
  'experience', 'education', 'skills', 'projects',
  'certifications', 'achievements', 'languages', 'publications'
];

/**
 * Accept either the pipeline's public schema (contact_information /
 * work_experience) or the portal's own resume shape, so a saved resume can
 * come from the parser or from the editor without the client translating.
 */
function toResumeDocument(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  // Already in the portal's shape.
  if (parsed.personal || parsed.experience) {
    return {
      personal: {
        name: String(parsed.personal?.name || ''),
        email: String(parsed.personal?.email || ''),
        phone: String(parsed.personal?.phone || ''),
        location: String(parsed.personal?.location || ''),
        linkedin: String(parsed.personal?.linkedin || ''),
        portfolio: String(parsed.personal?.portfolio || '')
      },
      summary: String(parsed.summary || ''),
      ...Object.fromEntries(
        LIST_FIELDS.filter((k) => Array.isArray(parsed[k])).map((k) => [k, parsed[k]])
      )
    };
  }

  const contact = parsed.contact_information || {};
  const place = contact.location || {};
  const locationText = [place.city, place.state, place.country].filter(Boolean).join(', ');
  const skills = parsed.skills || {};

  return {
    personal: {
      name: String(contact.name || ''),
      email: String(contact.email || ''),
      phone: String(contact.phone || ''),
      location: locationText,
      linkedin: String(contact.linkedin || ''),
      portfolio: String(contact.website || '')
    },
    summary: String(parsed.summary || ''),
    experience: (parsed.work_experience || []).map((e) => ({
      company: String(e.company || ''),
      role: String(e.position || ''),
      location: String(e.location || ''),
      startDate: String(e.start_date || ''),
      endDate: String(e.end_date || ''),
      current: Boolean(e.current),
      description: (e.responsibilities || []).join('\n')
    })),
    education: (parsed.education || []).map((e) => ({
      school: String(e.institution || ''),
      degree: String(e.degree || ''),
      field: String(e.major || ''),
      location: String(e.location || ''),
      startDate: String(e.start_date || ''),
      endDate: String(e.graduation_date || ''),
      current: false,
      description: (e.coursework || []).join(', ') || (e.gpa ? `GPA ${e.gpa}` : '')
    })),
    skills: [...(skills.technical || []), ...(skills.soft || [])],
    projects: (parsed.projects || []).map((p) => ({
      name: String(p.name || ''),
      link: String(p.link || ''),
      description: String(p.description || '')
    })),
    certifications: (parsed.certifications || []).map((c) => ({
      name: String(c.name || ''),
      issuer: String(c.issuer || ''),
      date: String(c.date || '')
    })),
    achievements: parsed.achievements || [],
    languages: parsed.languages || [],
    publications: (parsed.publications || []).map((p) => ({
      title: String(p.title || ''),
      link: String(p.link || ''),
      date: String(p.date || '')
    }))
  };
}

router.post('/save', async (req, res) => {
  try {
    const mapped = toResumeDocument(req.body?.parsed);
    if (!mapped) {
      return res.status(400).json({ ok: false, error: 'Nothing to save — parse a resume first.' });
    }

    const count = await Resume.countDocuments({ user: req.userId });
    const title =
      String(req.body?.title || '').trim() ||
      mapped.personal.name ||
      String(req.body?.filename || '').replace(/\.(pdf|docx)$/i, '').trim() ||
      'Imported resume';

    const isDefault = req.body?.isDefault === true || count === 0;
    if (isDefault) {
      await Resume.updateMany({ user: req.userId }, { $set: { isDefault: false } });
    }

    const resume = await Resume.create({ user: req.userId, title, isDefault, ...mapped });
    res.status(201).json({ ok: true, resume });
  } catch (err) {
    console.error('[parser/save]', err);
    res.status(500).json({ ok: false, error: 'That resume could not be saved.', hint: err?.message || '' });
  }
});

module.exports = router;
