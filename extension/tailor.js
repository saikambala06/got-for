// Heuristic "AI-style" resume tailoring engine. No external API calls or
// keys required — runs entirely in the browser using keyword-gap analysis,
// action-verb mirroring, and ATS best practices, so it works the moment the
// extension is installed.

const ACTION_VERBS = [
  'led', 'built', 'designed', 'launched', 'automated', 'optimized', 'reduced', 'increased',
  'implemented', 'migrated', 'managed', 'developed', 'architected', 'streamlined', 'delivered',
  'improved', 'scaled', 'deployed', 'maintained', 'collaborated', 'mentored', 'owned'
];

const STOPWORDS = new Set(('a an the and or for with to of in on at from by is are was were be been '
  + 'this that you your we our they their it as well etc will must should can may including '
  + 'experience years year plus strong ability work working').split(' '));

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.]{1,}/g) || [])
    .filter((w) => !STOPWORDS.has(w) && w.length > 2);
}

// Pull the highest-signal phrases out of a job description: known skills,
// plus any capitalized multi-word terms (tools/products), plus the most
// frequent meaningful single words.
function extractJobKeywords(job) {
  const text = `${job.title || ''} ${job.descriptionText || ''}`;
  const known = new Set((job.skills || []).map((s) => s.toLowerCase()));

  const capPhrase = text.match(/\b([A-Z][a-zA-Z0-9+.#]*(?:\s[A-Z][a-zA-Z0-9+.#]*){0,2})\b/g) || [];
  capPhrase.forEach((p) => {
    const clean = p.trim();
    if (clean.length > 2 && clean.length < 30 && !/^(I|The|A|An|We|You|Our)$/.test(clean)) {
      known.add(clean.toLowerCase());
    }
  });

  const freq = {};
  tokenize(text).forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([w]) => known.add(w));

  return Array.from(known).filter(Boolean).slice(0, 25);
}

function extractLeadVerbs(job) {
  const bullets = job.qualifications || [];
  const verbs = new Set();
  bullets.forEach((b) => {
    const first = (b.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (ACTION_VERBS.includes(first)) verbs.add(first);
  });
  return Array.from(verbs);
}

function generateTailorSuggestions(job, resumeText) {
  const jobKeywords = extractJobKeywords(job);
  const resumeLower = (resumeText || '').toLowerCase();

  const present = [];
  const missing = [];
  jobKeywords.forEach((kw) => {
    const hit = resumeLower.includes(kw.toLowerCase());
    (hit ? present : missing).push(kw);
  });

  const matchScore = jobKeywords.length
    ? Math.round((present.length / jobKeywords.length) * 100)
    : 0;

  const verbsToMirror = extractLeadVerbs(job).filter((v) => !resumeLower.includes(v));

  const titleWords = (job.title || 'this role').trim();
  const topMissing = missing.slice(0, 5);
  const suggestedSummary = topMissing.length
    ? `Results-driven professional with hands-on experience in ${topMissing.slice(0, 3).join(', ')}, `
      + `seeking to bring proven ${titleWords} skills to ${job.company || 'your team'}. `
      + `Skilled in ${topMissing.slice(3, 5).join(' and ') || topMissing[0]}, with a track record of `
      + `delivering measurable results.`
    : `Results-driven ${titleWords} professional with a strong track record of delivering measurable `
      + `impact, ready to bring that experience to ${job.company || 'your team'}.`;

  const bulletTips = [];
  if (missing.length) {
    bulletTips.push(`Work "${missing.slice(0, 3).join('", "')}" into your bullets where genuinely true — these appear in the posting but not in your resume text.`);
  }
  if (verbsToMirror.length) {
    bulletTips.push(`The posting favors action verbs like "${verbsToMirror.slice(0, 4).join('", "')}." Lead bullets with these instead of generic phrasing like "responsible for."`);
  }
  bulletTips.push('Quantify at least 2-3 bullets with a number (%, $, time saved, team size) — ATS and recruiters both weight measurable impact higher.');
  if (job.jobType || job.workMode) {
    bulletTips.push(`This role is listed as ${[job.jobType, job.workMode].filter(Boolean).join(', ')} — make sure your resume's location/availability won't filter you out.`);
  }

  const atsChecklist = [
    'Use the exact job title somewhere in your resume (recruiters and ATS both search for it).',
    'Mirror the posting\'s spelling/casing for tools (e.g. "Node.js" not "NodeJS") to maximize keyword matches.',
    'Keep formatting simple — avoid tables/columns that some ATS parsers mangle.',
    'Put your strongest, most relevant bullet first in each role, not chronologically buried.'
  ];

  return {
    matchScore,
    jobKeywords,
    present,
    missing,
    suggestedSummary,
    bulletTips,
    atsChecklist
  };
}

// Exposed for sidepanel.js (classic script, no modules, so attach to window).
window.SKVKTailor = { generateTailorSuggestions, extractJobKeywords };
