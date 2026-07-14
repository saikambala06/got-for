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
    'Kanban', 'Cross-functional collaboration', 'Communication skills', 'Leadership', 'Consulting',
    'Enterprise software', 'Business intelligence', 'Risk management', 'Financial modeling',
    'Vendor management', 'Change management', 'Strategic planning', 'Operations management',
    'Supply chain management', 'Process improvement', 'Budgeting',

    // Office / productivity / collaboration tools
    'Microsoft Office', 'Microsoft Word', 'PowerPoint', 'Google Workspace', 'Google Sheets',
    'Slack', 'Asana', 'Trello', 'Notion', 'Confluence', 'Monday.com', 'Airtable', 'Zoom',
    'SharePoint', 'Outlook',

    // Sales / CRM / marketing
    'Salesforce', 'HubSpot', 'CRM', 'Lead generation', 'Cold calling', 'Account management',
    'Business development', 'Negotiation', 'Sales forecasting', 'Pipeline management',
    'Customer relationship management', 'SEO', 'SEM', 'Google Analytics', 'Google Ads',
    'Facebook Ads', 'Content marketing', 'Email marketing', 'Social media marketing',
    'Copywriting', 'Marketing automation', 'Marketo', 'Mailchimp', 'Brand management',
    'Market research', 'Growth marketing', 'Public relations',

    // Design / creative
    'UX design', 'UI design', 'UX/UI design', 'Figma', 'Sketch', 'Adobe XD', 'InVision',
    'Wireframing', 'Prototyping', 'User research', 'Usability testing', 'Adobe Creative Suite',
    'Photoshop', 'Illustrator', 'InDesign', 'After Effects', 'Premiere Pro', 'Canva',
    'Graphic design', 'Video editing', 'Typography',

    // Customer support / service
    'Customer service', 'Customer support', 'Technical support', 'Zendesk', 'Intercom',
    'Help desk', 'Ticketing systems', 'Live chat support',

    // HR / recruiting
    'Recruiting', 'Talent acquisition', 'Onboarding', 'HRIS', 'Workday', 'Payroll',
    'Employee relations', 'Performance management', 'Compensation and benefits',
    'Applicant tracking systems', 'DEI',

    // Finance / accounting
    'QuickBooks', 'SAP', 'GAAP', 'Bookkeeping', 'Accounts payable', 'Accounts receivable',
    'Financial analysis', 'Financial reporting', 'Forecasting', 'Auditing', 'Tax preparation',
    'Bloomberg Terminal', 'Underwriting',

    // Healthcare
    'EHR', 'EMR', 'HIPAA', 'Patient care', 'Clinical research', 'ICD-10', 'CPT coding',
    'Medical terminology', 'Nursing', 'Phlebotomy', 'BLS', 'CPR certification',

    // Legal
    'Contract review', 'Legal research', 'Litigation', 'Compliance', 'Regulatory compliance',
    'Paralegal',

    // Manufacturing / operations / logistics
    'Lean manufacturing', 'Quality assurance', 'Quality control', 'Inventory management',
    'Warehouse management', 'Forklift operation', 'OSHA', 'Logistics',

    // Engineering (non-software)
    'AutoCAD', 'SolidWorks', 'Mechanical engineering', 'Electrical engineering',
    'Civil engineering',

    // Education
    'Curriculum development', 'Classroom management', 'Lesson planning', 'Tutoring',

    // Additional common tech tools not already covered above
    'HTML', 'CSS', 'REST API', 'GraphQL', 'Microservices', 'Linux', 'Selenium', 'Jenkins',
    'Ansible', 'Elasticsearch', 'Firebase', 'Webpack', 'Unit testing',

    // Certifications / degrees (used for highlight detection too)
    'PMP', 'CFA', 'Six Sigma', "Bachelor's degree", "Master's degree", 'MBA', 'PhD', 'CPA',
    'SHRM'
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
    'ci/cd': 'ci/cd', 'cicd': 'ci/cd', 'ci cd': 'ci/cd',
    'ms office': 'microsoft office', 'microsoft office': 'microsoft office',
    'gsuite': 'google workspace', 'google suite': 'google workspace', 'google workspace': 'google workspace',
    'crm software': 'crm', 'crm': 'crm',
    'ppt': 'powerpoint', 'powerpoint': 'powerpoint', 'microsoft powerpoint': 'powerpoint',
    'ux': 'ux design', 'ux design': 'ux design', 'user experience design': 'ux design',
    'ui': 'ui design', 'ui design': 'ui design', 'user interface design': 'ui design'
  };

  function canonicalSkill(raw) {
    const norm = cleanSkill(raw).toLowerCase();
    return SKILL_ALIASES[norm] || norm;
  }

  // ── Whole-word fallback matching ───────────────────────────────────────
  //
  // Exact canonical match (below) only catches a skill that's spelled
  // identically (or is in the small hand-curated SKILL_ALIASES map) on
  // both sides. In practice the job's skills come from one AI extraction
  // pass and the resume's skills come from a separate one, so the same
  // real-world skill often comes back phrased slightly differently on
  // each side — "Azure" vs "Microsoft Azure", "API" vs "REST APIs",
  // "CI/CD" vs "CI/CD pipelines". An exact-only check silently drops all
  // of these as "not matched" even though they plainly are, which is why
  // the panel could show 0 matches out of a dozen-plus detected skills.
  //
  // The fallback below matches when one skill's words appear as a
  // contiguous, whole-word run inside the other's words — never a raw
  // substring. That distinction is what keeps the earlier bug fixed:
  // "Java" is one whole word and "JavaScript" is a different single word,
  // so they still never match; "Azure" is a whole word inside the two
  // words "Microsoft Azure", so that now correctly matches.
  function singularizeToken(t) {
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 4 && /(?:sh|ch|x|s|z)es$/.test(t)) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  }

  function tokenize(s) {
    return s
      .split(/[^a-z0-9+#.]+/i)
      .filter(Boolean)
      .map((t) => singularizeToken(t.toLowerCase()));
  }

  // Single tokens short/common enough that a bare whole-word "contains"
  // match is more likely a coincidence than a real skill match (e.g. the
  // token "go" turning up inside an unrelated multi-word phrase). Exact
  // and alias matches above are unaffected by this list — it only guards
  // the fuzzy contains-fallback below.
  const AMBIGUOUS_SOLO_TOKENS = new Set(['go', 'r', 'c', 'j', 'ai', 'ml', 'bi', 'io', 'os', 'ui', 'ux', 'qa', 'ir']);

  function containsWholeWordRun(shortToks, longToks) {
    if (!shortToks.length || shortToks.length > longToks.length) return false;
    if (shortToks.length === 1 && AMBIGUOUS_SOLO_TOKENS.has(shortToks[0])) return false;
    for (let i = 0; i <= longToks.length - shortToks.length; i++) {
      if (shortToks.every((t, j) => longToks[i + j] === t)) return true;
    }
    return false;
  }

  function skillsMatch(a, b) {
    const ca = canonicalSkill(a);
    const cb = canonicalSkill(b);
    if (!ca || !cb) return false;
    if (ca === cb) return true;

    const tokensA = tokenize(ca);
    const tokensB = tokenize(cb);
    if (!tokensA.length || !tokensB.length) return false;

    return tokensA.length <= tokensB.length
      ? containsWholeWordRun(tokensA, tokensB)
      : containsWholeWordRun(tokensB, tokensA);
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
