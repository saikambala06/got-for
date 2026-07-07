/**
 * Shared skills lexicon used server-side by the local (no-AI) resume tailoring
 * and cover-letter fallback. Mirrors the taxonomy used by the browser
 * extension (browser-extension/content/skills-data.js) but lives separately
 * since it runs in Node, not the page context.
 *
 * Ambiguous common-English-word skills (Go, R, Excel, Swift, Rust, Spark) are
 * marked with a `guard` — they only count as a real match when the guard
 * regex ALSO matches, or when the term shows up inside a delimited list next
 * to another unambiguous skill (see `isRealMatch` below). This is what keeps
 * "R&D" from registering the R language, "go the extra mile" from registering
 * Go, "excel in this role" from registering Excel, etc.
 */

const SKILLS = [
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
  'Ruby', 'PHP', 'Kotlin', 'MATLAB', 'Bash',

  // Frameworks / libraries
  'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy', 'PySpark',
  'Hadoop', 'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'FastAPI', '.NET',
  'Spring Boot', 'HTML', 'CSS', 'REST API', 'GraphQL', 'Microservices', 'Selenium',

  // Cloud / infra
  'AWS', 'Amazon Web Services', 'Azure', 'Google Cloud Platform', 'GCP', 'Databricks',
  'Snowflake', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Airflow', 'Kafka',
  'DevOps', 'Linux',

  // Databases
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Oracle', 'DynamoDB', 'Cassandra', 'BigQuery',
  'Redshift', 'NoSQL',

  // Tools
  'Tableau', 'Power BI', 'Looker', 'Jira', 'Git', 'GitHub', 'GitLab', 'Salesforce', 'SAP',
  'RStudio', 'SwiftUI', 'Xcode', 'Android development', 'iOS development',

  // Business / domain
  'Project management', 'Product management', 'Stakeholder management', 'Agile', 'Scrum',
  'Business intelligence', 'Risk management', 'Financial modeling',

  // Certifications / degrees
  'PMP', 'CFA', 'Six Sigma', "Master's degree", 'PhD', 'CPA',
  'AWS Certified Data Analytics', 'AWS Certified Solutions Architect'
];

// Ambiguous single/short tokens that collide with common English words.
// `guard`: if this matches anywhere in the text, the term counts immediately.
// Otherwise it only counts if it shows up in a short delimited list next to
// another confirmed, unambiguous skill (see isRealMatch).
const AMBIGUOUS = {
  'r': /\br\s*(?:programming|language)\b|\brstudio\b|\btidyverse\b|\bggplot2?\b|\bcran\b/i,
  'go': /\bgolang\b|\bgo\s+(?:programming|language)\b/i,
  'excel': /\bmicrosoft\s+excel\b|\bms\s+excel\b|\bexcel\s+(?:spreadsheets?|macros?|vba)\b|\bpivot\s+tables?\b|\bvlookup\b/i,
  'swift': /\bswiftui\b|\bios\s+(?:development|developer|app)\b|\bxcode\b/i,
  'rust': /\brust\s+(?:lang|programming)\b|\bactix\b|\bcargo\s+build\b/i,
  'spark': /\bapache\s+spark\b|\bpyspark\b|\bspark\s+(?:sql|streaming|cluster)\b/i
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundaryPattern(term) {
  return new RegExp(`(?:^|[^a-zA-Z0-9])${escapeRe(term)}(?:$|[^a-zA-Z0-9])`, 'i');
}

const COMPILED = SKILLS.map((name) => ({ name, pattern: boundaryPattern(name) }));

/**
 * Split the text around each match of an ambiguous term into small
 * delimiter-separated chunks (comma / slash / pipe / bullet / "and") and
 * check whether a neighbouring chunk is itself a known, unambiguous skill.
 * This is what lets "Languages: Python, Go, Java" correctly count "Go"
 * even without the word "golang" anywhere in the text.
 */
function hasListNeighbor(text, term) {
  const re = new RegExp(`([^\\n,.;/|•]{0,40})[,/|•]\\s*${escapeRe(term)}\\s*[,/|•]?([^\\n,.;/|•]{0,40})`, 'i');
  const m = text.match(re);
  if (!m) return false;
  const neighbors = `${m[1] || ''} ${m[2] || ''}`.toLowerCase();
  return COMPILED.some((s) => s.name.toLowerCase() !== term && neighbors.includes(s.name.toLowerCase()));
}

function extractSkillsFromText(text) {
  const found = [];
  const lower = text || '';

  for (const skill of COMPILED) {
    if (skill.pattern.test(lower)) found.push(skill.name);
  }

  for (const [term, guard] of Object.entries(AMBIGUOUS)) {
    const pattern = boundaryPattern(term);
    if (!pattern.test(lower)) continue;
    if (guard.test(lower) || hasListNeighbor(lower, term)) {
      const label = term === 'r' ? 'R' : term.charAt(0).toUpperCase() + term.slice(1);
      if (!found.includes(label)) found.push(label);
    }
  }

  return found;
}

module.exports = { SKILLS, extractSkillsFromText };
