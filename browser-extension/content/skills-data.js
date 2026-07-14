// SKVK Assistant — skills taxonomy
// A curated dictionary of skills/tools/certs we scan job descriptions for.
// Kept as a flat list of { name, pattern } so content.js can regex-match
// case-insensitively on word boundaries without pulling in a dependency.

(function (global) {
  const RAW_SKILLS = [
    // Data / ML / AI
    'Machine learning', 'Deep learning', 'Data science', 'Data analysis', 'Data engineering',
    'Natural language processing', 'Computer vision', 'MLOps', 'ML Ops', 'Generative AI',
    'LLM', 'Large language models', 'AI/ML application development', 'Statistical modeling',
    'Statistical segmentation methodologies', 'A/B testing', 'Predictive modeling',
    'Feature engineering', 'Reinforcement learning', 'Neural networks', 'Recommendation systems',
    'Time series analysis', 'Forecasting', 'Data visualization', 'ETL', 'Data pipelines',
    'Data warehousing', 'Data governance', 'Big Data',

    // Languages
    'Python', 'R', 'SQL', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Go', 'Scala',
    'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'MATLAB', 'Bash', 'Programming languages',

    // Frameworks / libraries
    'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy', 'Spark', 'PySpark',
    'Hadoop', 'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'FastAPI', '.NET',
    'Spring Boot',

    // Cloud / infra
    'AWS', 'Amazon Web Services', 'Azure', 'Google Cloud Platform', 'GCP', 'Databricks',
    'Snowflake', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Airflow', 'Kafka',
    'AWS Certified Data Analytics', 'AWS Certified Solutions Architect',

    // Databases
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Oracle', 'DynamoDB', 'Cassandra', 'BigQuery',
    'Redshift', 'NoSQL',

    // Tools
    'Tableau', 'Power BI', 'Looker', 'Excel', 'Jira', 'Git', 'GitHub', 'GitLab',

    // Business / soft
    'Project management', 'Product management', 'Stakeholder management', 'Agile', 'Scrum',
    'Cross-functional collaboration', 'Communication skills', 'Leadership', 'Consulting',
    'Enterprise software', 'Business intelligence', 'Risk management', 'Financial modeling',

    // Certifications / degrees (used for highlight detection too)
    'PMP', 'CFA', 'Six Sigma', "Master's degree", 'PhD', 'CPA'
  ];

  function toPattern(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Loose word boundaries so "ML Ops" / "AWS" etc. still match against
    // punctuation-heavy job description text.
    return new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
  }

  // A handful of skill names are also ordinary English words/fragments, so a
  // plain word-boundary match produces confident-looking false positives:
  //   "Go"  matches "...go the extra mile", "...go above and beyond"
  //   "R"   matches "...R&D team", "Sr. Engineer" (word-boundary-only checks
  //         would treat the punctuation next to "R&D" as a boundary too)
  // For these, require the token to be bounded by the punctuation an actual
  // skills list would use (comma, semicolon, colon, slash, pipe, brackets,
  // line breaks) instead of by ordinary prose. This trades a little recall
  // (a bare prose mention like "5 years of experience with Go" won't match)
  // for a lot fewer wrong-looking matches, which is the better trade-off
  // here since most job posts list stack/tools as a punctuated list anyway.
  // Add more names to STRICT_TOKENS if they turn out to be similarly ambiguous.
  const STRICT_TOKENS = new Set(['Go', 'R']);

  function strictTokenPattern(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundary = '[\\n,;:/|()]';
    return new RegExp(`(?:^|${boundary})\\s*${escaped}\\s*(?=${boundary}|$)`, 'im');
  }

  // "Go" gets one extra allowance: an immediately-following "(Golang)" is
  // unambiguous no matter what precedes it (nobody writes "let's go (Golang)
  // grab lunch"), so that specific phrasing is recognized even in prose,
  // where the general list-style boundary rule above wouldn't otherwise match.
  const CUSTOM_PATTERNS = {
    Go: new RegExp(`${strictTokenPattern('Go').source}|\\bGo(?=\\s*\\(\\s*golang\\s*\\))`, 'im')
  };

  const SKILLS_TAXONOMY = RAW_SKILLS.map((name) => ({
    name,
    pattern: CUSTOM_PATTERNS[name] || (STRICT_TOKENS.has(name) ? strictTokenPattern(name) : toPattern(name))
  }));

  // ── Skill name cleanup & matching ──────────────────────────────────────
  //
  // Resumes sometimes store skills with a leftover category label, e.g.
  // "Languages: Python" instead of "Python" (an artifact of how a resume's
  // "Skills" section gets split during parsing). cleanSkill() strips that
  // so both display and matching see the real skill name — this mirrors
  // utils/skillUtils.js on the server side.
  function cleanSkill(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    const withoutLabel = s.replace(/^[A-Za-z][A-Za-z&/+ ]{1,28}:\s*(?=\S)/, '').trim();
    if (withoutLabel) s = withoutLabel;
    s = s.replace(/^[-*•\u2022\u25AA\u25CF\u25BA\u27A2\u27B3▪▸]\s*/, '').trim();
    return s;
  }

  // A curated alias map so common abbreviations/spelling variants still
  // count as the same skill WITHOUT falling back to loose substring
  // matching — substring matching incorrectly treats "Java" as matching
  // "JavaScript" (JavaScript contains "Java"), or "Go" as matching "Django"
  // (Django ends in "go"), which is precisely the kind of "matched skill"
  // mismatch that looks obviously wrong to a candidate reviewing the panel.
  const SKILL_ALIASES = {
    'js': 'javascript', 'javascript': 'javascript',
    'ts': 'typescript', 'typescript': 'typescript',
    'k8s': 'kubernetes', 'kubernetes': 'kubernetes',
    'gcp': 'google cloud platform', 'google cloud platform': 'google cloud platform', 'google cloud': 'google cloud platform',
    'aws': 'amazon web services', 'amazon web services': 'amazon web services',
    'ml': 'machine learning', 'machine learning': 'machine learning',
    'nlp': 'natural language processing', 'natural language processing': 'natural language processing',
    'postgres': 'postgresql', 'postgresql': 'postgresql',
    'mongo': 'mongodb', 'mongodb': 'mongodb',
    'node': 'node.js', 'nodejs': 'node.js', 'node.js': 'node.js',
    'golang': 'go', 'go': 'go',
    'dotnet': '.net', '.net': '.net',
    'ci/cd': 'ci/cd', 'cicd': 'ci/cd', 'ci cd': 'ci/cd'
  };

  function canonicalSkill(raw) {
    const norm = cleanSkill(raw).toLowerCase();
    return SKILL_ALIASES[norm] || norm;
  }

  // Exact (post-canonicalisation) match — replaces the old bidirectional
  // .includes() check, which matched any skill that merely contained (or
  // was contained by) another as a substring.
  function skillsMatch(a, b) {
    const ca = canonicalSkill(a);
    const cb = canonicalSkill(b);
    return !!ca && ca === cb;
  }

  // Signals used to build the "Key Highlights" chips (benefits, sponsorship, work model).
  const HIGHLIGHT_RULES = [
    { label: 'H1B Sponsor Likely', test: /\bh-?1b\b.{0,40}\b(sponsor|sponsorship)\b|\bsponsor(ship)?\b.{0,40}\bh-?1b\b|visa sponsorship available/i },
    { label: 'Medical coverage', test: /\bmedical\s+(insurance|coverage|benefits)?\b/i },
    { label: 'Dental', test: /\bdental\b/i },
    { label: 'Vision', test: /\bvision\b/i },
    { label: '401(k)', test: /\b401\s?\(?k\)?\b/i },
    { label: 'Remote friendly', test: /\bremote[- ]friendly\b|\bwork from home\b|\bfully remote\b/i },
    { label: 'Hybrid', test: /\bhybrid\b/i },
    { label: 'Equity / stock options', test: /\bequity\b|\bstock options\b|\bRSU\b/i },
    { label: 'Unlimited PTO', test: /\bunlimited\s+(pto|vacation)\b/i },
    { label: 'Relocation assistance', test: /\brelocation\s+(assistance|package|support)\b/i },
    { label: 'Security clearance required', test: /\bsecurity clearance\b/i },
    { label: 'Bonus eligible', test: /\bannual bonus\b|\bbonus eligible\b|\bperformance bonus\b/i }
  ];

  global.SKVKSkillsData = { SKILLS_TAXONOMY, HIGHLIGHT_RULES, cleanSkill, canonicalSkill, skillsMatch };
})(typeof window !== 'undefined' ? window : globalThis);
