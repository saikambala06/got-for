// Resume tailoring engine.
//
// If ANTHROPIC_API_KEY is configured, this calls Claude to produce genuinely
// tailored, context-aware suggestions (best quality). If no key is set, it
// falls back to a deterministic keyword-gap heuristic so the feature still
// works out of the box for free/local installs.

const MODEL = 'claude-sonnet-4-6';

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

function resumeToText(resume) {
  const parts = [
    resume.summary || '',
    (resume.skills || []).join(' '),
    ...(resume.experience || []).map((e) => `${e.role} ${e.company} ${e.description}`),
    ...(resume.projects || []).map((p) => `${p.name} ${p.description}`)
  ];
  return parts.join('\n');
}

function extractJobKeywords(jobTitle, jobDescription) {
  const text = `${jobTitle || ''} ${jobDescription || ''}`;
  const found = new Set();

  const capPhrase = text.match(/\b([A-Z][a-zA-Z0-9+.#]*(?:\s[A-Z][a-zA-Z0-9+.#]*){0,2})\b/g) || [];
  capPhrase.forEach((p) => {
    const clean = p.trim();
    if (clean.length > 2 && clean.length < 30 && !/^(I|The|A|An|We|You|Our)$/.test(clean)) {
      found.add(clean.toLowerCase());
    }
  });

  const freq = {};
  tokenize(text).forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .forEach(([w]) => found.add(w));

  return Array.from(found).filter(Boolean).slice(0, 30);
}

function extractLeadVerbs(jobDescription) {
  const lines = (jobDescription || '').split(/\n|•|\u2022/);
  const verbs = new Set();
  lines.forEach((l) => {
    const first = (l.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (ACTION_VERBS.includes(first)) verbs.add(first);
  });
  return Array.from(verbs);
}

function heuristicTailor({ resume, jobTitle, company, jobDescription }) {
  const jobKeywords = extractJobKeywords(jobTitle, jobDescription);
  const resumeLower = resumeToText(resume).toLowerCase();

  const present = [];
  const missing = [];
  jobKeywords.forEach((kw) => (resumeLower.includes(kw.toLowerCase()) ? present : missing).push(kw));

  const matchScore = jobKeywords.length ? Math.round((present.length / jobKeywords.length) * 100) : 0;
  const verbsToMirror = extractLeadVerbs(jobDescription).filter((v) => !resumeLower.includes(v));
  const topMissing = missing.slice(0, 5);

  const tailoredSummary = topMissing.length
    ? `Results-driven professional with hands-on experience in ${topMissing.slice(0, 3).join(', ')}, `
      + `seeking to bring proven ${jobTitle || 'role-relevant'} skills to ${company || 'your team'}. `
      + `Skilled in ${topMissing.slice(3, 5).join(' and ') || topMissing[0]}, with a track record of delivering measurable results.`
    : `Results-driven ${jobTitle || ''} professional with a strong track record of delivering measurable `
      + `impact, ready to bring that experience to ${company || 'your team'}.`;

  const bulletRewrites = (resume.experience || []).slice(0, 3).map((exp) => ({
    role: exp.role,
    company: exp.company,
    original: exp.description || '',
    suggestion: exp.description
      ? `${(verbsToMirror[0] || 'Led')[0].toUpperCase()}${(verbsToMirror[0] || 'Led').slice(1)} ${exp.description.replace(/^[A-Za-z]+\s/, '').slice(0, 160)}`
        + (topMissing[0] ? ` — incorporating ${topMissing[0]} where applicable.` : '')
      : `Add 1-2 bullets here highlighting ${topMissing.slice(0, 2).join(' and ') || 'relevant impact'} for this role.`
  }));

  const atsChecklist = [
    'Use the exact job title somewhere in your resume — recruiters and ATS both search for it.',
    'Mirror the posting\'s exact spelling/casing for tools (e.g. "Node.js" not "NodeJS") to maximize keyword matches.',
    'Keep formatting simple — avoid tables/columns some ATS parsers mangle.',
    'Put your strongest, most relevant bullet first in each role, not buried chronologically.'
  ];

  return {
    source: 'heuristic',
    matchScore,
    missingKeywords: missing,
    presentKeywords: present,
    tailoredSummary,
    bulletRewrites,
    atsChecklist
  };
}

async function aiTailor({ resume, jobTitle, company, jobDescription }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const resumeSnapshot = {
    summary: resume.summary || '',
    skills: resume.skills || [],
    experience: (resume.experience || []).map((e) => ({
      role: e.role, company: e.company, description: e.description
    })),
    projects: (resume.projects || []).map((p) => ({ name: p.name, description: p.description }))
  };

  const prompt = `You are an expert resume coach. Tailor the candidate's resume to the specific job below.
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "matchScore": <0-100 integer, how well the resume currently matches the job>,
  "missingKeywords": [<up to 8 important keywords/skills from the job description not clearly reflected in the resume>],
  "presentKeywords": [<up to 8 important keywords/skills from the job that ARE already reflected>],
  "tailoredSummary": "<a 2-3 sentence professional summary tailored specifically to this job, written in first person resume style, truthful to the candidate's actual background>",
  "bulletRewrites": [
    {"role": "<original role title>", "company": "<original company>", "original": "<original bullet/description>", "suggestion": "<rewritten version, stronger action verb, quantified where plausible, mirroring the job description's language, but never inventing facts not implied by the original>"}
  ],
  "atsChecklist": [<3-5 short, specific ATS/formatting tips relevant to this exact job and resume>]
}

JOB TITLE: ${jobTitle || '(not provided)'}
COMPANY: ${company || '(not provided)'}
JOB DESCRIPTION:
${(jobDescription || '').slice(0, 6000)}

CANDIDATE RESUME (JSON):
${JSON.stringify(resumeSnapshot).slice(0, 6000)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((c) => c.type === 'text');
  if (!textBlock) throw new Error('Anthropic API returned no text content');

  const cleaned = textBlock.text.trim().replace(/^```json\s*|```$/g, '');
  const parsed = JSON.parse(cleaned);
  return { source: 'ai', ...parsed };
}

async function tailorResume(params) {
  try {
    const aiResult = await aiTailor(params);
    if (aiResult) return aiResult;
  } catch (err) {
    console.error('AI tailor failed, falling back to heuristic:', err.message);
  }
  return heuristicTailor(params);
}

module.exports = { tailorResume, heuristicTailor };
