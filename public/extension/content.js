// content.js — extracts job details from the current job page

(function () {
  'use strict';

  function text(selector, root) {
    const el = (root || document).querySelector(selector);
    return el ? el.innerText.trim() : '';
  }
  function texts(selector, root) {
    return [...(root || document).querySelectorAll(selector)].map((e) => e.innerText.trim()).filter(Boolean);
  }

  // ── LinkedIn ─────────────────────────────────────────────────────────────
  function extractLinkedIn() {
    const title =
      text('.job-details-jobs-unified-top-card__job-title h1') ||
      text('.job-details-jobs-unified-top-card__job-title') ||
      text('h1.t-24') || text('h1');
    const company =
      text('.job-details-jobs-unified-top-card__company-name a') ||
      text('.job-details-jobs-unified-top-card__company-name') ||
      text('.topcard__org-name-link');
    const location =
      text('.job-details-jobs-unified-top-card__primary-description-container .tvm__text') ||
      text('.job-details-jobs-unified-top-card__bullet') ||
      text('.topcard__flavor--bullet');
    const descEl =
      document.querySelector('.jobs-description__content .jobs-box__html-content') ||
      document.querySelector('.jobs-description__content') ||
      document.querySelector('#job-details');
    const description = descEl ? descEl.innerText.trim() : '';
    const jobType =
      text('.job-details-jobs-unified-top-card__job-insight span') ||
      text('.job-details-preferences-and-skills__pill span');
    return { title, company, location, description, jobType, source: 'LinkedIn' };
  }

  // ── Indeed ───────────────────────────────────────────────────────────────
  function extractIndeed() {
    const title = text('[data-testid="jobsearch-JobInfoHeader-title"] h1') || text('h1.jobsearch-JobInfoHeader-title') || text('h1');
    const company = text('[data-testid="inlineHeader-companyName"] a') || text('.icl-u-lg-mr--sm');
    const location = text('[data-testid="job-location"]') || text('.icl-u-xs-mt--xs');
    const description = text('#jobDescriptionText') || text('.jobsearch-jobDescriptionText');
    return { title, company, location, description, jobType: '', source: 'Indeed' };
  }

  // ── Greenhouse ───────────────────────────────────────────────────────────
  function extractGreenhouse() {
    const title = text('#header h1') || text('.app-title') || text('h1');
    const company = text('#header .company-name') || document.title.split(' at ')[1] || '';
    const location = text('#header .location') || text('.location');
    const description = text('#content') || text('.job__description');
    return { title, company, location, description, jobType: '', source: 'Greenhouse' };
  }

  // ── Lever ────────────────────────────────────────────────────────────────
  function extractLever() {
    const title = text('.posting-headline h2') || text('h2') || text('h1');
    const company = document.title.split(' - ')[1] || '';
    const location = text('.posting-headline .sort-by-time') || text('.location');
    const description = text('.posting-description') || text('.content');
    return { title, company, location, description, jobType: '', source: 'Lever' };
  }

  // ── Workday ──────────────────────────────────────────────────────────────
  function extractWorkday() {
    const title = text('[data-automation-id="jobPostingHeader"]') || text('h1');
    const company = text('[data-automation-id="company"]') || '';
    const location = text('[data-automation-id="locations"]') || '';
    const description = text('[data-automation-id="jobPostingDescription"]') || text('.job-description');
    return { title, company, location, description, jobType: '', source: 'Workday' };
  }

  // ── Generic fallback ─────────────────────────────────────────────────────
  function extractGeneric() {
    const title = text('h1') || text('h2') || document.title;
    const description =
      text('[class*="description"]') ||
      text('[id*="description"]') ||
      text('[class*="job-detail"]') ||
      text('article') ||
      text('main') || '';
    // Try to extract company from page title or meta
    const metaCompany = (document.querySelector('meta[property="og:site_name"]') || {}).content || '';
    const company = metaCompany || document.title.split(' - ')[1] || document.title.split(' | ')[1] || '';
    const location = text('[class*="location"]') || text('[id*="location"]') || '';
    return { title, company, location, description, jobType: '', source: 'Job Page' };
  }

  // ── Skill extractor ──────────────────────────────────────────────────────
  function extractSkills(description) {
    if (!description) return [];
    const SKILL_PATTERNS = [
      'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'K8s',
      'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
      'Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'Rust', 'C\\+\\+', 'C#',
      'Node\\.js', 'React', 'Angular', 'Vue', 'Next\\.js',
      'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
      'Linux', 'Unix', 'Bash', 'PowerShell', 'Shell',
      'REST', 'GraphQL', 'gRPC', 'API',
      'Git', 'Agile', 'Scrum', 'DevOps', 'DevSecOps', 'SRE',
      'Helm', 'ArgoCD', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
      'Microservices', 'Serverless', 'Lambda', 'ECS', 'EKS', 'AKS',
      'Kafka', 'RabbitMQ', 'Celery',
      'Machine Learning', 'ML', 'AI', 'TensorFlow', 'PyTorch',
      'SQL', 'NoSQL', 'ETL', 'Spark', 'Hadoop',
      'JIRA', 'Confluence', 'Slack',
      'RBAC', 'IAM', 'OAuth', 'JWT', 'SSL/TLS', 'Security',
    ];
    const found = new Set();
    for (const skill of SKILL_PATTERNS) {
      const re = new RegExp(`\\b${skill}\\b`, 'i');
      if (re.test(description)) {
        found.add(SKILL_PATTERNS.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(skill) ? s === skill : false) || skill.replace('\\+\\+', '++').replace('\\.', '.'));
      }
    }
    return [...found];
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  function run() {
    const url = window.location.href;
    let raw;
    if (url.includes('linkedin.com')) raw = extractLinkedIn();
    else if (url.includes('indeed.com')) raw = extractIndeed();
    else if (url.includes('greenhouse.io')) raw = extractGreenhouse();
    else if (url.includes('lever.co')) raw = extractLever();
    else if (url.includes('workday.com') || url.includes('myworkdayjobs.com')) raw = extractWorkday();
    else raw = extractGeneric();

    raw.skills = extractSkills(raw.description);
    raw.url = url;
    raw.pageTitle = document.title;

    chrome.runtime.sendMessage({ type: 'JOB_DATA', data: raw });
  }

  // Run once on load, then re-run on URL changes (SPAs like LinkedIn)
  run();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(run, 1500); // Wait for SPA content to render
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
