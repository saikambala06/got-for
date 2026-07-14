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

  const LOCATION_SELECTORS = [
    '[data-testid="inlineHeader-companyLocation"]',    // Indeed
    '.jobsearch-JobInfoHeader-subtitle > div',           // Indeed (alt)
    '.jobs-unified-top-card__bullet',                    // LinkedIn
    '.job-details-jobs-unified-top-card__bullet',        // LinkedIn (alt layout)
    '[data-automation-id="locations"]',                  // Workday
    '.job-location', '.job__location',                   // Greenhouse / SmartRecruiters
    '.location',                                          // Greenhouse / Lever
    '.posting-categories .location',                     // Lever (alt)
    '.iCIMS_JobHeaderLocationText',                       // iCIMS
    '[class*="jobLocation" i]', '[class*="job-location" i]'
  ];

  // Country names commonly seen after a city/region in "City, Country"
  // formatted locations. Used only as a fallback location regex — kept to
  // an explicit list (rather than any capitalized word after a comma) so it
  // doesn't false-positive on things like "Python, Java" in a skills list.
  const COUNTRY_NAMES = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'India', 'Germany', 'France',
    'Ireland', 'Singapore', 'Netherlands', 'Spain', 'Italy', 'Japan', 'China', 'Brazil',
    'Mexico', 'Poland', 'Sweden', 'Switzerland', 'Israel', 'UAE', 'New Zealand', 'Philippines'
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
      .filter((b) => b.len > 80 && b.density < 0.35);

    // Drop "pass-through" wrapper blocks — a block whose text is almost
    // entirely just one of its own descendant candidate blocks (>=85% of
    // its length). Without this, a plain largest-text-wins sort always
    // converges on the outermost app wrapper (e.g. <div id="root">), since
    // an ancestor trivially contains everything its descendants do PLUS
    // nav/footer/sidebar text, so it's always at least as long as the real
    // description block and usually wins outright. Keeping only the most
    // specific (deepest) block that still clears the length/density bar
    // means we actually land on the description container itself.
    const specific = blocks.filter((b) => {
      const containsBiggerChild = blocks.some((o) => o.el !== b.el && b.el.contains(o.el) && o.len >= b.len * 0.85);
      return !containsBiggerChild;
    });

    const candidates = (specific.length ? specific : blocks).sort((a, b) => b.len - a.len);
    const text = candidates.length ? candidates[0].el.innerText.trim() : (document.body.innerText || '').trim();
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
            // Prefer locality+region ("Austin, TX"); if region is missing
            // (common outside the US) fall back to locality+country instead
            // of silently dropping the country entirely.
            location = addr.addressRegion
              ? [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ')
              : [addr.addressLocality, addr.addressCountry].filter(Boolean).join(', ');
          }
        }
        // Remote postings often carry jobLocationType: "TELECOMMUTE" with no
        // street address at all — that's a real, explicit signal, not a
        // parse failure, so surface it instead of leaving location blank.
        if (!location && /telecommute/i.test(job.jobLocationType || '')) {
          location = 'Remote';
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

    // "Full-time" with a hyphen was the only spelling recognized before —
    // "Full time" / "Part time" (no hyphen, very common) silently matched
    // nothing, leaving the employment-type pill blank on plenty of real
    // postings even though the page states it plainly.
    const employmentType = (bodyText.match(/\b(Full[- ]?time|Part[- ]?time|Contract|Internship|Temporary|Freelance)\b/i) || [])[1] || '';

    const salaryMatch = bodyText.match(/\$\s?\d{1,3}(?:[,\d]{0,10})?(?:K|k)?\s?(?:\/(?:yr|hr|year|hour))?\s?-\s?\$\s?\d{1,3}(?:[,\d]{0,10})?(?:K|k)?\s?(?:\/(?:yr|hr|year|hour))?/);
    const salary = salaryMatch ? salaryMatch[0].replace(/\s+/g, '') : '';

    // Location: known-site selectors first (reliable, structured — mirrors
    // the company lookup above). Only falls back to scanning body text when
    // no known board matched, and even then prefers an explicit country
    // name over the old US-only "City, ST" pattern so international and
    // remote postings aren't left blank.
    let location = firstMatchText(LOCATION_SELECTORS);
    if (!location) {
      const countryPattern = new RegExp(`\\b([A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+)?,\\s?(?:${COUNTRY_NAMES.join('|')}))\\b`);
      const countryMatch = bodyText.match(countryPattern);
      if (countryMatch) location = countryMatch[1];
    }
    if (!location) {
      const locationMatch = bodyText.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?,\s?[A-Z]{2})\b/);
      location = locationMatch ? locationMatch[1] : '';
    }

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

  // Broader set of phrasings real postings use for the requirements section
  // — the old version needed an EXACT full-line match against a short list
  // (e.g. "Requirements" alone), so anything phrased as "What we're looking
  // for", "Ideal Candidate", "Minimum Qualifications", or with an emoji/extra
  // words tacked on ("🎯 Requirements") silently matched nothing and the
  // whole qualifications section came back empty.
  // Phrases that are essentially always used as a standalone section
  // heading in practice — safe to match anywhere at the start of a short
  // line, even with a few trailing words ("Requirements for this role").
  const HEADING_START_RE =
    /^(requirements?|qualifications?|minimum qualifications|basic qualifications|preferred qualifications|what (?:you.?ll|you will) need|what (?:you.?ll|you will) bring|what we.?re looking for|ideal candidate|who you are|about you|your profile|required skills|skills required|bonus points)\b/i;

  // Phrases that are ALSO a common way to open a single requirement bullet
  // ("Must have 3+ years of X experience", "Nice to have: Docker") — only
  // treat these as a heading when the line is essentially just the phrase
  // itself, not a full sentence built around it, so real bullets don't get
  // mistaken for the section boundary and silently dropped.
  const HEADING_EXACT_RE = /^(skills?|must[- ]?haves?|nice to have)\s*:?\s*$/i;

  function isQualificationHeadingLine(line) {
    const stripped = line.replace(/^[-•▪*\u2022\u25CF\u25AA]\s*/, '').trim();
    if (!stripped || stripped.length > 60) return false;
    return HEADING_START_RE.test(stripped) || HEADING_EXACT_RE.test(stripped);
  }

  function detectQualificationPhrases(description) {
    const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
    const headingIdx = lines.findIndex(isQualificationHeadingLine);

    if (headingIdx === -1) {
      // No recognizable heading anywhere — fall back to pulling any
      // bullet-style lines or explicit "N+ years" lines from the whole
      // description, rather than giving up and showing nothing.
      return lines
        .filter((l) => /^[-•▪*\u2022\u25CF\u25AA]\s*/.test(l) || /^\d+\+?\s*years?\b/i.test(l))
        .map((l) => l.replace(/^[-•▪*\u2022\u25CF\u25AA]\s*/, '').trim())
        .filter((l) => l.length >= 4 && l.length <= 90)
        .slice(0, 8);
    }

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
    const years = description.match(/\b(\d{1,2})\+?\s*(?:(?:to|-|–|—)\s*\d{1,2}\s*)?years?\b/i);
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
