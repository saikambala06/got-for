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
    const salary =
      text('.job-details-jobs-unified-top-card__salary-info') ||
      text('[class*="salary"]') || '';
    return { title, company, location, description, jobType, salary, source: 'LinkedIn' };
  }

  // ── Indeed ───────────────────────────────────────────────────────────────
  function extractIndeed() {
    const title = text('[data-testid="jobsearch-JobInfoHeader-title"] h1') || text('h1.jobsearch-JobInfoHeader-title') || text('h1');
    const company = text('[data-testid="inlineHeader-companyName"] a') || text('.icl-u-lg-mr--sm');
    const location = text('[data-testid="job-location"]') || text('.icl-u-xs-mt--xs');
    const description = text('#jobDescriptionText') || text('.jobsearch-jobDescriptionText');
    const salary = text('[data-testid="attribute_snippet_testid"]') || text('[class*="salary"]') || '';
    return { title, company, location, description, jobType: '', salary, source: 'Indeed' };
  }

  // ── Greenhouse ───────────────────────────────────────────────────────────
  function extractGreenhouse() {
    const title = text('#header h1') || text('.app-title') || text('h1');
    const company = text('#header .company-name') || document.title.split(' at ')[1] || '';
    const location = text('#header .location') || text('.location');
    const description = text('#content') || text('.job__description');
    return { title, company, location, description, jobType: '', salary: '', source: 'Greenhouse' };
  }

  // ── Lever ────────────────────────────────────────────────────────────────
  function extractLever() {
    const title = text('.posting-headline h2') || text('h2') || text('h1');
    const company = document.title.split(' - ')[1] || '';
    const location = text('.posting-headline .sort-by-time') || text('.location');
    const description = text('.posting-description') || text('.content');
    return { title, company, location, description, jobType: '', salary: '', source: 'Lever' };
  }

  // ── Workday ──────────────────────────────────────────────────────────────
  function extractWorkday() {
    const title = text('[data-automation-id="jobPostingHeader"]') || text('h1');
    const company = text('[data-automation-id="company"]') || '';
    const location = text('[data-automation-id="locations"]') || '';
    const description = text('[data-automation-id="jobPostingDescription"]') || text('.job-description');
    return { title, company, location, description, jobType: '', salary: '', source: 'Workday' };
  }

  // ── Jobright.ai ──────────────────────────────────────────────────────────
  function extractJobright() {
    const title =
      text('h1[class*="title"]') ||
      text('.job-title') ||
      text('[class*="jobTitle"]') ||
      text('h1');
    const company =
      text('[class*="companyName"]') ||
      text('[class*="company-name"]') ||
      text('.company') ||
      text('a[class*="company"]');
    const location =
      text('[class*="location"]') ||
      text('[class*="Location"]') ||
      text('.location');
    const jobType =
      text('[class*="jobType"]') ||
      text('[class*="employment-type"]') ||
      text('[class*="workType"]') ||
      '';
    const salary =
      text('[class*="salary"]') ||
      text('[class*="Salary"]') ||
      text('[class*="compensation"]') ||
      '';
    // Try to get description from common containers
    const descEl =
      document.querySelector('[class*="description"]') ||
      document.querySelector('[class*="jobDesc"]') ||
      document.querySelector('main') ||
      document.querySelector('article');
    const description = descEl ? descEl.innerText.trim() : text('body');
    return { title, company, location, description, jobType, salary, source: 'Jobright' };
  }

  // ── Jobright jobright.ai/jobs/info ───────────────────────────────────────
  function extractJobrightInfo() {
    // Jobright uses React, so we look for data in the DOM text
    const allText = document.body.innerText;
    const title =
      text('h1') ||
      text('[class*="title"]') ||
      (document.title.split('|')[0] || '').trim();
    const company =
      text('[class*="company"]') ||
      text('[class*="employer"]') ||
      (document.title.split('|')[1] || '').trim();
    const location = text('[class*="location"]') || '';
    const jobType  = text('[class*="type"]') || '';
    const salary   = text('[class*="salary"]') || text('[class*="pay"]') || '';
    const descEl   = document.querySelector('[class*="desc"]') ||
                     document.querySelector('[class*="content"]') ||
                     document.querySelector('main');
    const description = descEl ? descEl.innerText.trim() : allText.slice(0, 5000);
    return { title, company, location, description, jobType, salary, source: 'Jobright' };
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
    const metaCompany = (document.querySelector('meta[property="og:site_name"]') || {}).content || '';
    const company = metaCompany || document.title.split(' - ')[1] || document.title.split(' | ')[1] || '';
    const location = text('[class*="location"]') || text('[id*="location"]') || '';
    const salary   = text('[class*="salary"]') || text('[class*="compensation"]') || '';
    const jobType  = text('[class*="job-type"]') || text('[class*="employment"]') || '';
    return { title, company, location, description, jobType, salary, source: 'Job Page' };
  }

  // ── Skill extractor ──────────────────────────────────────────────────────
  function extractSkills(description) {
    if (!description) return [];
    const SKILL_PATTERNS = [
      'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'K8s',
      'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
      'Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'Rust', 'C\\+\\+', 'C#', 'R',
      'Node\\.js', 'React', 'Angular', 'Vue', 'Next\\.js', 'FastAPI', 'Django', 'Flask',
      'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB',
      'Linux', 'Unix', 'Bash', 'PowerShell', 'Shell',
      'REST', 'GraphQL', 'gRPC', 'API',
      'Git', 'Agile', 'Scrum', 'DevOps', 'DevSecOps', 'SRE',
      'Helm', 'ArgoCD', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
      'Microservices', 'Serverless', 'Lambda', 'ECS', 'EKS', 'AKS',
      'Kafka', 'RabbitMQ', 'Celery',
      'Machine Learning', 'ML', 'Deep Learning', 'NLP', 'LLM',
      'AI', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Pandas', 'NumPy',
      'SQL', 'NoSQL', 'ETL', 'Spark', 'Hadoop', 'Databricks', 'Snowflake',
      'JIRA', 'Confluence', 'Slack',
      'RBAC', 'IAM', 'OAuth', 'JWT', 'SSL/TLS', 'Security',
      'Data Science', 'Data Engineering', 'ML Ops', 'MLOps',
      'Statistical Analysis', 'A/B Testing', 'Tableau', 'Power BI',
      'Excel', 'Looker', 'dbt',
      'AWS Certified', 'GCP Certified', 'Azure Certified',
    ];
    const found = new Set();
    for (const skill of SKILL_PATTERNS) {
      const re = new RegExp(`\\b${skill}\\b`, 'i');
      if (re.test(description)) {
        found.add(skill.replace('\\+\\+', '++').replace('\\.', '.'));
      }
    }
    return [...found];
  }

  // ── Salary regex helper ──────────────────────────────────────────────────
  function extractSalaryFromText(text) {
    const m = text.match(/\$\s*[\d,]+[Kk]?\s*[-–]\s*\$?\s*[\d,]+[Kk]?(?:\s*\/\s*(?:yr|year|hour|hr|mo))?/);
    return m ? m[0].trim() : '';
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  function run() {
    const url = window.location.href;
    let raw;
    if (url.includes('linkedin.com'))            raw = extractLinkedIn();
    else if (url.includes('indeed.com'))         raw = extractIndeed();
    else if (url.includes('greenhouse.io'))      raw = extractGreenhouse();
    else if (url.includes('lever.co'))           raw = extractLever();
    else if (url.includes('workday.com') || url.includes('myworkdayjobs.com')) raw = extractWorkday();
    else if (url.includes('jobright.ai'))        raw = extractJobrightInfo();
    else                                          raw = extractGeneric();

    // Extract skills from description
    raw.skills = extractSkills(raw.description);

    // Enrich salary if not found by site-specific extractor
    if (!raw.salary && raw.description) {
      raw.salary = extractSalaryFromText(raw.description);
    }

    raw.url       = url;
    raw.pageTitle = document.title;

    chrome.runtime.sendMessage({ type: 'JOB_DATA', data: raw });
  }

  // Run once on load, then re-run on URL changes (SPAs like LinkedIn)
  run();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(run, 1500);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
