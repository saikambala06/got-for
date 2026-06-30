// Best-effort job-posting scraper. Works generically across job boards by
// looking for common patterns (headings, badges, salary text, bullet lists)
// rather than depending on one site's exact markup.

const JOB_TYPE_PATTERNS = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Seasonal'];
const WORK_MODE_PATTERNS = ['Hybrid work', 'Hybrid', 'Remote', 'On-site', 'In-person'];

function textOf(el) {
  return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
}

function findSalary(bodyText) {
  const m = bodyText.match(/\$[\d,]+(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?[\d,]+(?:\.\d+)?\s*(?:a year|\/year|per year|an hour|\/hr|per hour|a month|\/month)/i)
    || bodyText.match(/\$[\d,]+(?:\.\d+)?\s*(?:a year|\/year|per year|an hour|\/hr|per hour)/i);
  return m ? m[0].trim() : '';
}

function findFirst(patterns, bodyText) {
  for (const p of patterns) {
    const re = new RegExp('\\b' + p.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + '\\b', 'i');
    if (re.test(bodyText)) return p;
  }
  return '';
}

function findLocation(bodyText) {
  const m = bodyText.match(/\b[A-Z][a-zA-Z.'\s]{1,25},\s?[A-Z]{2}\b/);
  return m ? m[0].trim() : '';
}

function findTitle() {
  const h1 = document.querySelector('h1');
  if (h1) {
    const t = textOf(h1);
    if (t && t.length < 140) return t;
  }
  return document.title.split(/[-|]/)[0].trim();
}

function findCompany(bodyText) {
  const h1 = document.querySelector('h1');
  let node = (h1 && h1.nextElementSibling) || (h1 && h1.parentElement);
  for (let i = 0; node && i < 6; i++, node = node.nextElementSibling) {
    const links = node.querySelectorAll ? node.querySelectorAll('a') : [];
    for (const a of links) {
      const t = textOf(a);
      if (t && t.length < 60 && !/apply|save|share|sign in/i.test(t)) return t;
    }
  }
  const meta = document.querySelector('meta[property="og:site_name"]');
  return (meta && meta.content && meta.content.trim()) || '';
}

function sectionBullets(headingPattern) {
  const headings = Array.from(document.querySelectorAll('h2, h3, h4, strong, b'));
  const heading = headings.find((h) => headingPattern.test(textOf(h)));
  if (!heading) return [];
  let scanned = 0;
  const bullets = [];
  let cursor = heading;
  while (cursor && scanned < 12) {
    cursor = cursor.nextElementSibling;
    scanned++;
    if (!cursor) break;
    if (/^H[1-4]$/.test(cursor.tagName) || /^(STRONG|B)$/.test(cursor.tagName)) break;
    const lis = cursor.querySelectorAll ? cursor.querySelectorAll('li') : [];
    lis.forEach((li) => {
      const t = textOf(li);
      if (t) bullets.push(t);
    });
    if (cursor.tagName === 'LI') {
      const t = textOf(cursor);
      if (t) bullets.push(t);
    }
  }
  return bullets.slice(0, 10);
}

const SKILL_DICTIONARY = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
  'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'Spring', '.NET',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'CI/CD',
  'Linux', 'Bash', 'SQL', 'NoSQL', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis',
  'Automation', 'DevOps', 'Agile', 'Scrum', 'Git', 'REST', 'GraphQL', 'Microservices',
  'Machine Learning', 'Data Analysis', 'Excel', 'Salesforce', 'SAP', 'Tableau', 'Power BI',
  'Communication', 'Leadership', 'Project Management', 'Customer Service'
];

function detectedSkills(bodyText) {
  return SKILL_DICTIONARY.filter((skill) => {
    const re = new RegExp('\\b' + skill.replace(/[.+]/g, '\\$&') + '\\b', 'i');
    return re.test(bodyText);
  }).slice(0, 12);
}

const BENEFIT_KEYWORDS = [
  ['401(k)', /401\s*\(?k\)?/i],
  ['Health insurance', /health insurance/i],
  ['Dental insurance', /dental/i],
  ['Vision insurance', /vision insurance/i],
  ['Paid time off', /paid time off|\bpto\b/i],
  ['Hybrid work', /hybrid/i],
  ['Remote work', /\bremote\b/i],
  ['Equity / stock options', /equity|stock options/i],
  ['Parental leave', /parental leave/i],
  ['Tuition reimbursement', /tuition reimbursement/i]
];

function detectedHighlights(bodyText) {
  return BENEFIT_KEYWORDS.filter((pair) => pair[1].test(bodyText)).map((pair) => pair[0]);
}

function scrapeJobPosting() {
  const bodyText = textOf(document.body);
  const title = findTitle();
  return {
    url: location.href,
    title,
    company: findCompany(bodyText),
    location: findLocation(bodyText),
    salary: findSalary(bodyText),
    jobType: findFirst(JOB_TYPE_PATTERNS, bodyText),
    workMode: findFirst(WORK_MODE_PATTERNS, bodyText),
    skills: detectedSkills(bodyText),
    highlights: detectedHighlights(bodyText),
    qualifications: sectionBullets(/qualifications|requirements|what you.?ll (need|bring)|minimum qualifications/i),
    descriptionText: bodyText.slice(0, 20000),
    scrapedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'SCRAPE_JOB') {
    try {
      sendResponse({ ok: true, job: scrapeJobPosting() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }
  return true;
});
