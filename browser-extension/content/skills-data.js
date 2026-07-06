// JobTrail Assistant — skills taxonomy
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

  // These terms double as ordinary English words/verbs ("excel in your role",
  // "go-getter", "R&D") so case-insensitive matching produces false positives.
  // They're normally written capitalized when meant as the actual skill, so
  // matching case-sensitively (still with word boundaries) fixes this without
  // dropping legitimate mentions.
  const CASE_SENSITIVE_TERMS = new Set(['R', 'Go', 'Excel', 'Rust', 'Swift', 'Bash']);

  function toPattern(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Loose word boundaries so "ML Ops" / "AWS" etc. still match against
    // punctuation-heavy job description text.
    const flags = CASE_SENSITIVE_TERMS.has(term) ? '' : 'i';
    // "R&D" is an extremely common phrase in job postings and is not a
    // reference to the R programming language — exclude it explicitly.
    if (term === 'R') {
      return new RegExp(`(?:^|[^a-zA-Z0-9])R(?!\\s*&\\s*D)(?:$|[^a-zA-Z0-9])`, flags);
    }
    return new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, flags);
  }

  const SKILLS_TAXONOMY = RAW_SKILLS.map((name) => ({ name, pattern: toPattern(name) }));

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

  global.JobTrailSkillsData = { SKILLS_TAXONOMY, HIGHLIGHT_RULES };
})(typeof window !== 'undefined' ? window : globalThis);
