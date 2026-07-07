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
    'Data warehousing', 'Data governance', 'Big Data', 'Exploratory data analysis',

    // Languages
    'Python', 'SQL', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Scala',
    'Ruby', 'PHP', 'Kotlin', 'MATLAB', 'Bash', 'HTML', 'CSS',

    // Frameworks / libraries
    'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy', 'PySpark',
    'Hadoop', 'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'FastAPI', '.NET',
    'Spring Boot', 'REST API', 'GraphQL', 'Microservices', 'Selenium',

    // Cloud / infra
    'AWS', 'Amazon Web Services', 'Azure', 'Google Cloud Platform', 'GCP', 'Databricks',
    'Snowflake', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Airflow', 'Kafka',
    'AWS Certified Data Analytics', 'AWS Certified Solutions Architect', 'DevOps', 'Linux',

    // Databases
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Oracle', 'DynamoDB', 'Cassandra', 'BigQuery',
    'Redshift', 'NoSQL',

    // Tools
    'Tableau', 'Power BI', 'Looker', 'Jira', 'Git', 'GitHub', 'GitLab', 'Salesforce', 'SAP',
    'RStudio', 'SwiftUI', 'Xcode', 'Android development', 'iOS development',

    // Business / domain (kept to genuine, specifically-named skills —
    // generic buzzwords like "Leadership" or "Communication skills" are
    // intentionally excluded since they match almost every job posting and
    // add noise, not signal).
    'Project management', 'Product management', 'Stakeholder management', 'Agile', 'Scrum',
    'Business intelligence', 'Risk management', 'Financial modeling',

    // Certifications / degrees (used for highlight detection too)
    'PMP', 'CFA', 'Six Sigma', "Master's degree", 'PhD', 'CPA'
  ];

  // Short/common-English-word skills that need extra context before they
  // count — otherwise "R&D" registers the R language, "go the extra mile"
  // registers Go, "excel in this role" registers Excel, etc.
  // `guard`: if this matches anywhere in the description, count it outright.
  // Otherwise it only counts if it appears in a short delimited list right
  // next to another already-confirmed, unambiguous skill (e.g.
  // "Languages: Python, Go, Java" — see hasListNeighbor below).
  const AMBIGUOUS_SKILLS = [
    { name: 'R', guard: /\br\s*(?:programming|language)\b|\brstudio\b|\btidyverse\b|\bggplot2?\b|\bcran\b/i },
    { name: 'Go', guard: /\bgolang\b|\bgo\s+(?:programming|language)\b/i },
    { name: 'Excel', guard: /\bmicrosoft\s+excel\b|\bms\s+excel\b|\bexcel\s+(?:spreadsheets?|macros?|vba)\b|\bpivot\s+tables?\b|\bvlookup\b/i },
    { name: 'Swift', guard: /\bswiftui\b|\bios\s+(?:development|developer|app)\b|\bxcode\b/i },
    { name: 'Rust', guard: /\brust\s+(?:lang|programming)\b|\bactix\b|\bcargo\s+build\b/i },
    { name: 'Spark', guard: /\bapache\s+spark\b|\bpyspark\b|\bspark\s+(?:sql|streaming|cluster)\b/i }
  ];

  function escapeRe(term) {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toPattern(term) {
    // Loose word boundaries (non-alphanumeric or string edge on both sides)
    // so "ML Ops" / "AWS" / "C++" etc. still match against punctuation-heavy
    // job description text — a real `\b` fails on trailing symbols like "++".
    return new RegExp(`(?:^|[^a-zA-Z0-9])${escapeRe(term)}(?:$|[^a-zA-Z0-9])`, 'i');
  }

  const SKILLS_TAXONOMY = RAW_SKILLS.map((name) => ({ name, pattern: toPattern(name) }));

  const AMBIGUOUS_TAXONOMY = AMBIGUOUS_SKILLS.map((s) => ({
    name: s.name,
    pattern: toPattern(s.name),
    guard: s.guard
  }));

  /**
   * Checks whether `term` shows up inside a short comma/slash/bullet
   * separated list right next to a recognised, unambiguous skill —
   * e.g. "Languages: Python, Go, Java" legitimately counts "Go" even
   * though the word "golang" never appears anywhere in the text.
   */
  function hasListNeighbor(text, term) {
    const re = new RegExp(`([^\\n,.;/|•]{0,40})[,/|•]\\s*${escapeRe(term)}\\s*[,/|•]?([^\\n,.;/|•]{0,40})`, 'i');
    const m = text.match(re);
    if (!m) return false;
    const neighbors = `${m[1] || ''} ${m[2] || ''}`.toLowerCase();
    return SKILLS_TAXONOMY.some((s) => neighbors.includes(s.name.toLowerCase()));
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

  global.JobTrailSkillsData = { SKILLS_TAXONOMY, AMBIGUOUS_TAXONOMY, hasListNeighbor, HIGHLIGHT_RULES };
})(typeof window !== 'undefined' ? window : globalThis);
