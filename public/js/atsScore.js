/**
 * Deterministic ATS (Applicant Tracking System) match scorer.
 *
 * Runs entirely in the browser against the resume JSON + job description
 * text already on the page — no AI call involved, so it works even when
 * Gemini is rate-limited or misbehaving, and gives a stable "real" score
 * (same inputs -> same output) rather than an AI-guessed number that can
 * jump around between calls.
 *
 * Score = weighted blend of:
 *   - keyword coverage between the JD and the resume        (55%)
 *   - how many of the top JD keywords are in the skills list (20%)
 *   - resume section completeness                            (15%)
 *   - bullet points that carry a quantified metric            (10%)
 */
(function (global) {
  const STOPWORDS = new Set([
    'the','a','an','and','or','but','if','then','for','of','to','in','on','with','at','by',
    'from','as','is','are','was','were','be','been','being','this','that','these','those',
    'you','your','we','our','they','their','it','its','will','can','may','must','should',
    'have','has','had','do','does','did','not','no','yes','who','what','which','when','where',
    'how','why','into','about','than','also','etc','including','other','such','all','any',
    'per','via','using','use','used','across','within','including','role','job','work',
    'years','year','experience','experienced','team','teams','ability','strong','excellent',
    'company','looking','preferred','required','requirements','responsibilities','including',
    'candidate','candidates','plus','including','including','well','including'
  ]);

  function tokenize(str) {
    return String(str || '').toLowerCase().match(/[a-z0-9][a-z0-9+.#/-]{1,}/g) || [];
  }

  function extractKeywords(jobDescription, max) {
    const freq = {};
    tokenize(jobDescription).forEach((w) => {
      if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) return;
      freq[w] = (freq[w] || 0) + 1;
    });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max || 40)
      .map((e) => e[0]);
  }

  function resumeBlob(resume) {
    const exp = (resume.experience || [])
      .map((e) => `${e.role || ''} ${e.company || ''} ${e.description || ''}`)
      .join(' ');
    const edu = (resume.education || [])
      .map((e) => `${e.degree || ''} ${e.field || ''} ${e.school || ''}`)
      .join(' ');
    const proj = (resume.projects || [])
      .map((p) => `${p.name || ''} ${p.description || ''}`)
      .join(' ');
    return [
      resume.summary || '',
      (resume.skills || []).join(' '),
      exp, edu, proj,
      (resume.certifications || []).join(' '),
      (resume.achievements || []).join(' ')
    ].join(' ').toLowerCase();
  }

  function levelFor(score) {
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  function computeATSScore(resume, jobDescription) {
    resume = resume || {};
    if (!jobDescription || !jobDescription.trim()) {
      return { score: 0, level: 'low', matched: [], missing: [], breakdown: { coverage: 0, skills: 0, completeness: 0, metrics: 0 } };
    }

    const keywords = extractKeywords(jobDescription, 40);
    const blob = resumeBlob(resume);
    const skillSet = new Set((resume.skills || []).map((s) => String(s).toLowerCase()));

    const matched = [];
    const missing = [];
    keywords.forEach((k) => {
      if (blob.indexOf(k) !== -1) matched.push(k); else missing.push(k);
    });
    const coverage = keywords.length ? matched.length / keywords.length : 0;

    const topSkillKeywords = keywords.slice(0, 20);
    const skillsOverlap = topSkillKeywords.length
      ? topSkillKeywords.filter((k) => skillSet.has(k) || blob.includes(k)).length / topSkillKeywords.length
      : 0;

    const p = resume.personal || {};
    let completeness = 0;
    if (resume.summary && resume.summary.trim().length > 30) completeness += 0.25;
    if ((resume.skills || []).length >= 5) completeness += 0.25;
    if ((resume.experience || []).length >= 1) completeness += 0.25;
    if (p.email && p.phone) completeness += 0.25;

    const bullets = (resume.experience || [])
      .flatMap((e) => String(e.description || '').split('\n'))
      .map((l) => l.trim())
      .filter(Boolean);
    const withMetrics = bullets.filter((b) => /\d/.test(b)).length;
    const metricRatio = bullets.length ? withMetrics / bullets.length : 0;

    const raw = coverage * 0.55 + Math.min(1, skillsOverlap) * 0.20 + completeness * 0.15 + metricRatio * 0.10;
    const score = Math.round(Math.max(0, Math.min(100, raw * 100)));

    return {
      score,
      level: levelFor(score),
      matched,
      missing,
      breakdown: {
        coverage: Math.round(coverage * 100),
        skills: Math.round(Math.min(1, skillsOverlap) * 100),
        completeness: Math.round(completeness * 100),
        metrics: Math.round(metricRatio * 100)
      }
    };
  }

  global.computeATSScore = computeATSScore;
})(window);
