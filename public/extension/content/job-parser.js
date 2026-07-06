// JobTrail Assistant — job posting parser
// Extracts title / company / location / employment type / salary / description
// from the current page, then mines the description for skills, qualification
// bullets, and benefit/sponsorship highlights.

(function (global) {
  const { SKILLS_TAXONOMY, HIGHLIGHT_RULES } = global.JobTrailSkillsData;

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').replace(/\s+\n/g, '\n').trim();
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

    // Description: the largest text block on the page (article/main/section),
    // excluding nav/header/footer/aside.
    const blocks = Array.from(document.querySelectorAll('article, main, section, div'))
      .filter((el) => !el.closest('nav, header, footer, aside'))
      .map((el) => ({ el, len: (el.innerText || '').length }))
      .sort((a, b) => b.len - a.len);
    const description = blocks.length ? blocks[0].el.innerText.trim() : bodyText.trim();

    return { title, company, location, employmentType, salary, description, source: 'dom' };
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

  global.JobTrailParser = { parseJobFromPage };
})(typeof window !== 'undefined' ? window : globalThis);
