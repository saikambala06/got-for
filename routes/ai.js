const express = require('express');
const router = express.Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

function buildPrompt(job, resumeText) {
  const desc = (job.descriptionText || '').slice(0, 8000);
  return `You are an AI job-matching assistant inside a browser extension. Analyze the job posting below and (if a resume is provided) score how well the resume matches it.

JOB TITLE: ${job.title || 'Unknown'}
COMPANY: ${job.company || 'Unknown'}
RAW PAGE TEXT (may include nav/menus, ignore irrelevant parts):
"""
${desc}
"""

RESUME TEXT (may be empty):
"""
${(resumeText || '').slice(0, 6000)}
"""

Return ONLY a single JSON object (no markdown fences, no preamble) with this exact shape:
{
  "skills": ["string", ...up to 14 concrete skills/tools/technologies mentioned in the job],
  "matchedSkills": ["string", ...subset of skills that the resume text genuinely demonstrates; empty array if no resume given],
  "highlights": ["string", ...up to 5 short key highlights/benefits like 'Hybrid working environment'],
  "qualifications": ["string", ...up to 8 concise qualification/requirement bullets],
  "matchScore": integer 0-100 (0 if no resume text was provided; otherwise an honest holistic estimate of fit, not just keyword overlap),
  "missingKeywords": ["string", ...up to 8 important skills/keywords from the job that are NOT evidenced in the resume; empty if no resume],
  "suggestedSummary": "a 2-3 sentence tailored resume summary written for THIS job (empty string if no resume given)",
  "bulletTips": ["string", ...2-4 specific, actionable tips for rewriting resume bullets for this job],
  "atsChecklist": ["string", ...3-5 short ATS optimization tips specific to this posting]
}

Be concise and concrete. Do not invent skills that aren't actually implied by the job text.`;
}

function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in AI response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

router.post('/analyze', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI analysis is not configured on the server (missing ANTHROPIC_API_KEY).' });
    }

    const { job, resumeText } = req.body || {};
    if (!job || (!job.descriptionText && !job.title)) {
      return res.status(400).json({ error: 'A job with title or descriptionText is required.' });
    }

    const prompt = buildPrompt(job, resumeText || '');

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'AI provider request failed. Please try again.' });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'AI response had no usable content.' });

    let parsed;
    try {
      parsed = extractJson(textBlock.text);
    } catch (e) {
      console.error('Failed to parse AI JSON:', e, textBlock.text);
      return res.status(502).json({ error: 'Could not parse AI response.' });
    }

    const clean = {
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 14).map(String) : [],
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills.map(String) : [],
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5).map(String) : [],
      qualifications: Array.isArray(parsed.qualifications) ? parsed.qualifications.slice(0, 8).map(String) : [],
      matchScore: Number.isFinite(parsed.matchScore) ? Math.max(0, Math.min(100, Math.round(parsed.matchScore))) : 0,
      missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords.slice(0, 8).map(String) : [],
      suggestedSummary: typeof parsed.suggestedSummary === 'string' ? parsed.suggestedSummary : '',
      bulletTips: Array.isArray(parsed.bulletTips) ? parsed.bulletTips.slice(0, 4).map(String) : [],
      atsChecklist: Array.isArray(parsed.atsChecklist) ? parsed.atsChecklist.slice(0, 5).map(String) : []
    };

    res.json({ ok: true, result: clean });
  } catch (err) {
    console.error('AI analyze error:', err);
    res.status(500).json({ error: 'AI analysis failed unexpectedly.' });
  }
});

module.exports = router;
