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

  // Known ATS/job-board containers that hold the actual posting body. Tried
  // first because they're far more reliable than any generic heuristic —
  // Greenhouse, Lever, Workday, iCIMS, Taleo, SmartRecruiters, BambooHR,
  // LinkedIn, and Indeed all mark up the description this way.
  const DESCRIPTION_SELECTORS = [
    '[class*="job-description" i]', '[id*="job-description" i]',
    '[class*="jobdescription" i]', '[id*="jobdescription" i]',
    '[class*="job-details" i]', '[id*="job-details" i]',
    '[class*="jobDetails" i]',
    '[class*="posting-body" i]', '[class*="posting-description" i]',
    '[class*="job-post" i]', '[id*="job-post" i]',
    '[data-testid*="job-description" i]', '[data-testid*="jobDescription" i]',
    '[class*="vacancy-description" i]',
    '#jobDescriptionText', // Indeed
    '.jobs-description__content', '.jobs-box__html-content', // LinkedIn
    '[class*="description" i]'
  ];

  // Blocks matching these are almost never the actual posting body, even if
  // they happen to be large — related-job carousels, sidebars, cookie/consent
  // banners, and navigation are the usual sources of "wrong content" bugs.
  const CLUTTER_SELECTOR = [
    '[class*="related" i]', '[class*="similar" i]', '[class*="recommend" i]',
    '[class*="carousel" i]', '[class*="sidebar" i]', '[class*="cookie" i]',
    '[class*="consent" i]', '[class*="newsletter" i]', '[class*="breadcrumb" i]',
    '[class*="comment" i]', '[class*="footer" i]', '[class*="navbar" i]',
    '[class*="social-share" i]', '[class*="job-list" i]', '[class*="job-card" i]',
    '[class*="search-results" i]'
  ].join(', ');

  function isClutter(el) {
    return el.matches?.(CLUTTER_SELECTOR) || !!el.closest(CLUTTER_SELECTOR);
  }

  /** Text-per-child-element density — high for genuine prose blocks, low for
   *  wrapper divs that just aggregate many unrelated child sections. This is
   *  what keeps a page's <main> (which also contains the sidebar, related
   *  jobs, nav, etc.) from beating out the actual description div just
   *  because it has more raw characters. */
  function density(el, len) {
    const children = el.querySelectorAll('*').length;
    return len / (1 + children);
  }

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

    // Company: try common "at Company" phrasing near the title, else biggest
    // text node that looks like a proper-noun short line right after the H1.
    let company = '';
    const atMatch = (document.title + ' ' + bodyText.slice(0, 400)).match(/\bat\s+([A-Z][\w&.,'\- ]{1,40})\b/);
    if (atMatch) company = atMatch[1].trim();

    // Description, in priority order:
    //   1. A known ATS description container (most reliable).
    //   2. The highest text-density candidate block, excluding clutter.
    //   3. The whole page body as a last resort, so the AI backend always
    //      has *something* to read instead of an empty string that would
    //      otherwise skip AI analysis entirely.
    let description = '';
    let source = 'dom';

    for (const sel of DESCRIPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && !isClutter(el)) {
        const text = stripHtml(el.innerHTML);
        if (text.length > 200) {
          description = text;
          source = 'dom-selector';
          break;
        }
      }
    }

    if (!description) {
      const candidates = Array.from(document.querySelectorAll('article, main, section, div'))
        .filter((el) => !el.closest('nav, header, footer, aside') && !isClutter(el))
        .map((el) => {
          const text = el.innerText || '';
          return { el, len: text.length, score: density(el, text.length) };
        })
        .filter((c) => c.len > 200)
        .sort((a, b) => b.score - a.score);

      if (candidates.length) {
        description = stripHtml(candidates[0].el.innerHTML);
      }
    }

    if (!description) {
      // Nothing scored well — fall back to the full page text (still minus
      // nav/header/footer/aside) rather than leaving the panel with nothing
      // to analyze.
      description = bodyText.trim();
    }

    return { title, company, location, employmentType, salary, description, source };
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
    let base = fromJsonLd();
    // Some ATS embed only a short teaser (or nothing) in the JSON-LD
    // "description" field and render the real posting body in the DOM. If
    // the JSON-LD description looks too thin to analyze, enrich it with
    // whatever the DOM heuristic finds rather than trusting JSON-LD blindly.
    if (base && base.description.length < 200) {
      const domFallback = fromDom();
      if (domFallback.description.length > base.description.length) {
        base = { ...base, description: domFallback.description, source: `${base.source}+dom` };
      }
    }
    base = base || fromDom();
    if (!base.title) return null;

    const description = base.description || '';

    // A raw, unfiltered snapshot of the visible page text, capped to a
    // sane size. Used only as a last-resort input to the AI backend if the
    // chosen `description` above turns out to yield nothing (e.g. the wrong
    // block was picked on an unusual page layout) — see content.js retry.
    const rawPageText = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);

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
      experience,
      rawPageText
    };
  }

  global.SKVKParser = { parseJobFromPage };
})(typeof window !== 'undefined' ? window : globalThis);
