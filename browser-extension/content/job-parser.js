// SKVK Assistant — job posting parser
// Extracts title / company / location / employment type / salary / description
// from the current page, then mines the description for skills, qualification
// bullets, and benefit/sponsorship highlights.

(function (global) {
  const { SKILLS_TAXONOMY, HIGHLIGHT_RULES } = global.SKVKSkillsData;

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;

    // .textContent concatenates all text nodes with NO separator at element
    // boundaries — e.g. "<li>Python</li><li>JavaScript</li>" becomes
    // "PythonJavaScript" with nothing between them. That silently breaks two
    // things downstream: (1) skill detection, since the word-boundary regex
    // then sees "PythonJavaScript" as one unrecognizable token instead of
    // two known skills, and (2) qualification-line splitting, which relies
    // on each bullet/paragraph landing on its own line. Force a line break
    // at every block-level boundary before reading textContent so structure
    // survives the conversion to plain text.
    div.querySelectorAll('script, style').forEach((el) => el.remove());
    div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    div.querySelectorAll('li, p, div, tr, h1, h2, h3, h4, h5, h6').forEach((el) => {
      el.insertAdjacentText('afterend', '\n');
    });

    return (div.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // ── Known ATS / job-board container selectors ───────────────────────────
  // Ordered lists of selectors that point directly at the real description
  // or company name on the most common job boards / applicant-tracking
  // systems. Tried before any generic heuristic — a direct hit here means
  // we never risk grabbing a "Similar jobs" rail, nav menu, or footer
  // instead of the actual posting. Harmless on sites that don't match any
  // of them (querySelector just returns null and we fall through).
  const DESCRIPTION_SELECTORS = [
    '[data-automation-id="jobPostingDescription"]', // Workday
    '#jobDescriptionText',                            // Indeed
    '.jobs-description__content',                     // LinkedIn
    '.jobs-box__html-content',                         // LinkedIn (alt layout)
    '#job-details',                                    // LinkedIn (alt layout)
    '.job__description',                               // Greenhouse
    '#job-post-description',                           // Greenhouse (alt)
    '.posting-requirements',                           // Lever
    '[data-qa="job-description"]',                     // Lever (alt)
    '.job_description',                                // ZipRecruiter
    '#job-description',                                // generic / ZipRecruiter (alt)
    '.job-sections',                                    // SmartRecruiters
    '#st-jobDescription',                               // SmartRecruiters (alt)
    '#iCIMS_JobContent',                                // iCIMS
    '.iCIMS_JobContent',
    '.jobdescription',                                  // Taleo
    '[class*="jobDescription" i]',
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    '[class*="posting-description" i]'
  ];

  const COMPANY_SELECTORS = [
    '[itemprop="hiringOrganization"]',
    '.jobs-unified-top-card__company-name',           // LinkedIn
    '.job-details-jobs-unified-top-card__company-name', // LinkedIn (alt layout)
    '[data-testid="inlineHeader-companyName"]',        // Indeed
    '.jobsearch-InlineCompanyRating div a',             // Indeed (alt)
    '.company-name',                                    // Greenhouse et al.
    '[class*="companyName" i]',
    '[class*="company-name" i]',
    '[data-testid*="company" i]'
  ];

  // Common words that end up right after "at" in job-page prose without
  // being a company name at all — "experience at least 3 years", "work at
  // any of our offices", "starts at present". Without this list the old
  // loose "at\s+([A-Z]...)" scan over page body text produced confident-
  // looking but wrong company names constantly.
  const COMPANY_STOPWORDS = new Set([
    'least', 'any', 'all', 'this', 'that', 'our', 'the', 'once', 'first',
    'no', 'present', 'a', 'scale', 'an', 'time', 'work', 'least once'
  ]);

  function firstMatchText(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const text = textOf(el);
        if (text && text.length >= 2 && text.length <= 200) return text;
      } catch (_) { /* selector unsupported in this doc, keep scanning */ }
    }
    return '';
  }

  // Fraction of an element's visible text that lives inside <a> tags. Nav
  // menus and "Similar jobs" / "Related listings" rails are almost all
  // links, while an actual job description is almost all prose — this lets
  // the generic fallback below tell the two apart instead of just picking
  // whichever block happens to have the most characters.
  function linkDensity(el) {
    const totalLen = (el.innerText || '').length;
    if (!totalLen) return 1;
    const linkLen = Array.from(el.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.innerText || '').length, 0);
    return linkLen / totalLen;
  }

  // Finds the actual job description text. Tries known ATS/job-board
  // selectors first (most reliable); falls back to the largest prose block
  // on the page — excluding nav/header/footer/aside and anything that's
  // mostly links — only when nothing recognizable matched.
  function bestDescriptionBlock() {
    for (const sel of DESCRIPTION_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const text = (el && el.innerText || '').trim();
        if (text.length > 80) return { text, matchedKnownSelector: true };
      } catch (_) { /* selector unsupported in this doc, keep scanning */ }
    }
    const blocks = Array.from(document.querySelectorAll('article, main, section, div'))
      .filter((el) => !el.closest('nav, header, footer, aside'))
      .map((el) => ({ el, len: (el.innerText || '').length, density: linkDensity(el) }))
      .filter((b) => b.len > 80 && b.density < 0.35)
      .sort((a, b) => b.len - a.len);
    const text = blocks.length ? blocks[0].el.innerText.trim() : (document.body.innerText || '').trim();
    return { text, matchedKnownSelector: false };
  }

  // ── 1. schema.org JobPosting JSON-LD (LinkedIn, Indeed, Greenhouse, many ATS) ──
  function fromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const candidates = Array.isArray(data) ? data : [data, ...(data['@graph'] || [])];
        const job = candidates.find((c) => c && /jobposting/i.test(c['@type'] || ''));
        if (!job) continue;

        let location = '';
        const loc = job.jobLocation;
        if (loc) {
          const addr = Array.isArray(loc) ? loc[0]?.address : loc.address;
          if (addr) {
            location = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
          }
        }

        let salary = '';
        const sal = job.baseSalary?.value;
        if (sal) {
          const unit = (sal.unitText || '').toLowerCase();
          if (sal.minValue && sal.maxValue) {
            salary = `$${Number(sal.minValue).toLocaleString()} - $${Number(sal.maxValue).toLocaleString()}${unit ? '/' + unit : ''}`;
          } else if (sal.value) {
            salary = `$${Number(sal.value).toLocaleString()}${unit ? '/' + unit : ''}`;
          }
        }

        return {
          title: job.title || '',
          company: job.hiringOrganization?.name || '',
          location,
          employmentType: Array.isArray(job.employmentType) ? job.employmentType[0] : (job.employmentType || ''),
          salary,
          description: stripHtml(job.description || ''),
          source: 'json-ld'
        };
      } catch (_) { /* not valid JSON-LD, keep scanning */ }
    }
    return null;
  }

  // ── 2. Generic DOM heuristics (fallback for sites without JSON-LD) ──
  function fromDom() {
    const title =
      textOf(document.querySelector('h1')) ||
      document.title.split(/[-|]/)[0].trim();

    const bodyText = document.body.innerText || '';

    const employmentType = (bodyText.match(/\b(Full-time|Part-time|Contract|Internship|Temporary|Freelance)\b/i) || [])[1] || '';

    const salaryMatch = bodyText.match(/\$\s?\d{1,3}(?:[,\d]{0,10})?(?:K|k)?\s?(?:\/(?:yr|hr|year|hour))?\s?-\s?\$\s?\d{1,3}(?:[,\d]{0,10})?(?:K|k)?\s?(?:\/(?:yr|hr|year|hour))?/);
    const salary = salaryMatch ? salaryMatch[0].replace(/\s+/g, '') : '';

    const locationMatch = bodyText.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?,\s?[A-Z]{2})\b/);
    const location = locationMatch ? locationMatch[1] : '';

    // Company: known-site selectors first (reliable, structured). Falls
    // back to reading the <title> tag — job pages commonly format it as
    // "Job Title at Company | Site" or "Job Title - Company - Site" — which
    // is far less noisy than the old approach of regex-scanning the whole
    // visible page body for the word "at" (that matched phrases like
    // "experience at least 3 years" just as happily as a real company).
    let company = firstMatchText(COMPANY_SELECTORS);
    if (!company) {
      const atMatch = document.title.match(/\bat\s+([A-Z][\w&.,'\- ]{1,40})\b/);
      const candidate = atMatch ? atMatch[1].trim() : '';
      if (candidate && !COMPANY_STOPWORDS.has(candidate.toLowerCase())) company = candidate;
    }
    if (!company) {
      const dashParts = document.title.split(/\s[-|–]\s/).map((s) => s.trim()).filter(Boolean);
      // "Job Title - Company - Site Name" style titles: the middle segment
      // is usually the company when there are 3+ segments.
      if (dashParts.length >= 3) company = dashParts[1];
    }

    // Description: known ATS/job-board container first; only falls back to
    // the "largest prose block, filtered by link density" heuristic when
    // nothing recognizable is on the page.
    const { text: description, matchedKnownSelector } = bestDescriptionBlock();

    return { title, company, location, employmentType, salary, description, source: matchedKnownSelector ? 'dom-known' : 'dom-generic' };
  }

  // ── 3. Skill + qualification mining from the description text ──
  function detectSkills(description) {
    const found = [];
    for (const skill of SKILLS_TAXONOMY) {
      if (skill.pattern.test(description)) found.push(skill.name);
    }
    return found;
  }

  function detectQualificationPhrases(description) {
    const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
    const headingIdx = lines.findIndex((l) =>
      /^(requirements?|qualifications?|what you.?ll need|who you are|skills( required)?|must have|preferred qualifications)\b[:\-]?$/i.test(l)
    );
    if (headingIdx === -1) return [];

    const phrases = [];
    for (let i = headingIdx + 1; i < Math.min(lines.length, headingIdx + 25); i++) {
      const line = lines[i].replace(/^[-•▪*\u2022\u25CF\u25AA]\s*/, '').trim();
      if (!line) continue;
      // Stop once we clearly hit the next section heading.
      if (/^(benefits|perks|about (us|the company)|responsibilities|what you.?ll do)\b/i.test(line)) break;
      if (line.length >= 4 && line.length <= 90) phrases.push(line);
    }
    return phrases.slice(0, 8);
  }

  function detectHighlights(description) {
    return HIGHLIGHT_RULES.filter((rule) => rule.test.test(description)).map((rule) => rule.label);
  }

  function detectExperienceLevel(description) {
    const years = description.match(/\b(\d{1,2})\+?\s*(?:to\s*\d{1,2}\s*)?years?\b/i);
    const seniority = (description.match(/\b(Senior|Junior|Mid[- ]?level|Entry[- ]?level|Lead|Principal|Staff)\b/i) || [])[1];
    return {
      years: years ? years[0] : '',
      seniority: seniority || ''
    };
  }

  function parseJobFromPage() {
    const base = fromJsonLd() || fromDom();
    if (!base.title) return null;

    const description = base.description || '';
    const skillsFound = detectSkills(description);
    const qualificationPhrases = detectQualificationPhrases(description);
    const highlights = detectHighlights(description);
    const experience = detectExperienceLevel(description);

    return {
      ...base,
      url: location.href,
      skillsFound,
      qualificationPhrases,
      highlights,
      experience
    };
  }

  // ── 4. "Is this actually a job posting?" confidence check ───────────────
  // Runs AFTER parsing (unlike the old pre-parse URL allowlist, which
  // blocked the panel from even trying to read pages whose URL didn't
  // happen to contain "job"/"career"/etc — missing large boards like
  // Indeed, ZipRecruiter, Glassdoor, Ashby, SmartRecruiters, Dice, iCIMS...
  // whenever their URL path didn't literally spell it out). Combines
  // several independent signals so a single false one doesn't flip the
  // verdict either way — a strong signal (JSON-LD, a known ATS selector)
  // is enough on its own; weaker signals need to agree with each other.
  const JOB_URL_HINT = /\b(job|jobs|career|careers|greenhouse|lever\.co|workday|myworkdayjobs|jobright|ashbyhq|smartrecruiters|icims|taleo|dice|monster|ziprecruiter|breezy\.hr|recruitee|workable|bamboohr|successfactors|wellfound|glassdoor)\b/i;

  function isLikelyJobPosting(parsed) {
    if (!parsed || !parsed.title) return false;
    let score = 0;
    if (parsed.source === 'json-ld') score += 3;
    if (parsed.source === 'dom-known') score += 3;
    if (JOB_URL_HINT.test(location.href)) score += 1;
    if (parsed.employmentType) score += 1;
    if (parsed.qualificationPhrases?.length) score += 1;
    if ((parsed.skillsFound?.length || 0) >= 3) score += 1;
    if (/\b(responsibilities|qualifications|requirements|who you are|what you.?ll do|what you.?ll need)\b/i.test(parsed.description || '')) score += 1;
    if ((parsed.description || '').length > 500) score += 1;
    return score >= 3;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Some SPA job boards (Workday, LinkedIn, custom React career sites)
  // haven't finished hydrating the description into the DOM at the exact
  // moment the toolbar icon is clicked. Rather than judge the page on a
  // single, possibly-too-early read, re-parse a few times over ~2.5s and
  // keep the first attempt that looks confidently like a real posting.
  async function parseJobFromPageWithRetry(maxWaitMs = 2500, stepMs = 350) {
    let parsed = parseJobFromPage();
    const start = Date.now();
    while (!isLikelyJobPosting(parsed) && Date.now() - start < maxWaitMs) {
      await sleep(stepMs);
      const retry = parseJobFromPage();
      if (retry) parsed = retry;
    }
    return parsed;
  }

  global.SKVKParser = { parseJobFromPage, parseJobFromPageWithRetry, isLikelyJobPosting };
})(typeof window !== 'undefined' ? window : globalThis);
