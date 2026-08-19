/**
 * Parser page controller.
 *
 * Shared by the web dashboard (/parse-resume.html) and the browser extension
 * (browser-extension/parse.html). The only difference between the two hosts is
 * how requests are made, which is injected as `window.PARSER_TRANSPORT` — the
 * extension supplies an absolute base URL plus a bearer token, the dashboard
 * uses same-origin cookies. Everything else, including all animation, is
 * identical so the two surfaces behave the same.
 */

(function () {
  'use strict';

  const M = window.motion;

  // ── Transport ──────────────────────────────────────────────────────────

  const transport = window.PARSER_TRANSPORT || {
    base: '',
    // Dashboard: same-origin with the httpOnly session cookie.
    request: (url, options) => fetch(url, { ...options, credentials: 'include' })
  };

  const api = (path) => `${transport.base || ''}${path}`;

  async function send(path, options) {
    const res = await transport.request(api(path), options || {});
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.hint = data.hint || '';
      throw err;
    }
    return data;
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const fileCardSlot = $('fileCardSlot');
  const alertBox = $('alertBox');
  const pipelineEl = $('pipeline');
  const aiNoteEl = $('aiNote');
  const resultsEl = $('results');
  const modeTabs = $('modeTabs');
  const fileMode = $('fileMode');
  const textMode = $('textMode');
  const pasteBox = $('pasteBox');
  const pasteCount = $('pasteCount');
  const parseTextBtn = $('parseTextBtn');

  let lastResult = null;
  let busy = false;

  // ── Utilities ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  function bytes(n) {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function linkify(value) {
    const v = String(value || '');
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>`;
    if (/^[\w.+'-]+@[\w-]+\.[\w.-]+$/.test(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    return esc(v);
  }

  function showAlert(message, hint, kind) {
    if (!alertBox) return;
    alertBox.className = `alert${kind === 'warn' ? ' warn' : ''}`;
    alertBox.innerHTML = `<b>${esc(message)}</b>${hint ? `<span class="alert-hint">${esc(hint)}</span>` : ''}`;
    alertBox.hidden = false;
  }
  function clearAlert() { if (alertBox) alertBox.hidden = true; }

  // ── Pipeline ───────────────────────────────────────────────────────────

  // These mirror the server pipeline's real stages, so the progress the user
  // watches is the work that is actually happening.
  const STAGES = [
    { key: 'validate', label: 'Validate the file', note: 'Format, size and integrity' },
    { key: 'extract',  label: 'Extract the text',  note: 'Layout, columns, fonts and bullets' },
    { key: 'clean',    label: 'Clean the text',    note: 'Repair wrapping, hyphens and page furniture' },
    { key: 'segment',  label: 'Segment sections',  note: 'Headings and entry hierarchy' },
    { key: 'recognise',label: 'Recognise entities',note: 'Names, employers, dates, skills' },
    { key: 'format',   label: 'Build the result',  note: 'Structured JSON and confidence' }
  ];

  function renderPipeline() {
    if (!pipelineEl) return;
    pipelineEl.innerHTML = STAGES.map((s, i) => `
      <div class="pipe-step" data-step="${s.key}">
        <div class="pipe-dot">
          <span class="pipe-num">${i + 1}</span>
          <svg class="pipe-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"
               stroke-linecap="round" stroke-linejoin="round" style="display:none;width:13px;height:13px">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <div class="pipe-label">${esc(s.label)}</div>
          <div class="pipe-note">${esc(s.note)}</div>
        </div>
      </div>`).join('');
  }

  function setStage(key, state, note) {
    if (!pipelineEl) return;
    const index = STAGES.findIndex((s) => s.key === key);
    pipelineEl.querySelectorAll('.pipe-step').forEach((el, i) => {
      el.classList.remove('is-active', 'is-done', 'is-error');
      const tick = el.querySelector('.pipe-tick');
      const num = el.querySelector('.pipe-num');

      if (state === 'error' && i === index) {
        el.classList.add('is-error');
      } else if (i < index || (state === 'done' && i <= index)) {
        el.classList.add('is-done');
      } else if (i === index) {
        el.classList.add('is-active');
      }

      const done = el.classList.contains('is-done');
      if (tick && num) {
        tick.style.display = done ? 'block' : 'none';
        num.style.display = done ? 'none' : 'block';
      }
    });
    if (note && index >= 0) {
      const el = pipelineEl.querySelectorAll('.pipe-step')[index];
      const noteEl = el && el.querySelector('.pipe-note');
      if (noteEl) noteEl.textContent = note;
    }
  }

  function resetPipeline() {
    renderPipeline();
    if (aiNoteEl) aiNoteEl.hidden = true;
  }

  // ── File card ──────────────────────────────────────────────────────────

  function showFileCard(file) {
    if (!fileCardSlot) return;
    const ext = /\.docx$/i.test(file.name) ? 'docx' : 'pdf';
    fileCardSlot.innerHTML = `
      <div class="filecard">
        <div class="filecard-icon ${ext}">${ext.toUpperCase()}</div>
        <div class="filecard-meta">
          <div class="filecard-name">${esc(file.name)}</div>
          <div class="filecard-sub" id="fileCardSub">${bytes(file.size)} · reading…</div>
        </div>
        <button class="filecard-clear" type="button" id="fileClear" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>`;
    const clear = $('fileClear');
    if (clear) clear.addEventListener('click', resetAll);
  }

  function setFileCardStatus(text) {
    const el = $('fileCardSub');
    if (el) el.textContent = text;
  }

  // ── Parse flows ────────────────────────────────────────────────────────

  const VALID = /\.(pdf|docx)$/i;

  async function parseFile(file) {
    if (busy) return;
    if (!file) return;

    if (!VALID.test(file.name)) {
      dropzone.classList.add('is-invalid');
      setTimeout(() => dropzone.classList.remove('is-invalid'), 600);
      showAlert('That file type is not supported.', 'Upload a PDF (.pdf) or Word (.docx) resume.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showAlert('That file is larger than 15 MB.', 'Export a lighter PDF, or upload the DOCX version.');
      return;
    }

    busy = true;
    clearAlert();
    if (resultsEl) resultsEl.hidden = true;
    resetPipeline();
    showFileCard(file);
    dropzone.classList.add('is-busy');

    setStage('validate', 'active');
    const form = new FormData();
    form.append('file', file, file.name);

    // The stages advance on a timer so the user sees the work progress; the
    // request itself is a single round trip.
    const timers = [
      setTimeout(() => setStage('extract', 'active'), 260),
      setTimeout(() => setStage('clean', 'active'), 900),
      setTimeout(() => setStage('segment', 'active'), 1250),
      setTimeout(() => setStage('recognise', 'active'), 1550)
    ];

    try {
      const data = await send('/api/parser/upload', { method: 'POST', body: form });
      timers.forEach(clearTimeout);
      setStage('format', 'active');
      const ocrNote = data.metadata?.ocr_used ? ' · OCR' : '';
      setFileCardStatus(`${bytes(file.size)} · ${data.stats?.words || 0} words · ${data.stats?.pages || 1} page${(data.stats?.pages || 1) > 1 ? 's' : ''}${ocrNote}`);
      await new Promise((r) => setTimeout(r, 200));
      setStage('format', 'done');
      renderResult(data, file.name);
    } catch (err) {
      timers.forEach(clearTimeout);
      setStage('extract', 'error');
      setFileCardStatus('could not be parsed');
      showAlert(err.message || 'That file could not be parsed.', err.hint);
      if (M) M.toast(err.message || 'Parsing failed', 'error');
    } finally {
      busy = false;
      dropzone.classList.remove('is-busy');
    }
  }

  async function parseText() {
    if (busy) return;
    const text = (pasteBox && pasteBox.value) || '';
    if (!text.trim()) return;

    busy = true;
    clearAlert();
    if (resultsEl) resultsEl.hidden = true;
    resetPipeline();
    setStage('validate', 'done');
    setStage('extract', 'active', 'Reading line structure');
    if (parseTextBtn) { parseTextBtn.disabled = true; parseTextBtn.textContent = 'Parsing…'; }

    const timer = setTimeout(() => setStage('segment', 'active'), 400);

    try {
      const data = await send('/api/parser/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      clearTimeout(timer);
      setStage('format', 'done');
      renderResult(data, '');
    } catch (err) {
      clearTimeout(timer);
      setStage('segment', 'error');
      showAlert(err.message || 'That text could not be parsed.', err.hint);
      if (M) M.toast(err.message || 'Parsing failed', 'error');
    } finally {
      busy = false;
      if (parseTextBtn) { parseTextBtn.disabled = false; parseTextBtn.textContent = 'Parse this text'; }
    }
  }

  // ── Result rendering ───────────────────────────────────────────────────

  const ICONS = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM2.4 9h5.2v12H2.4zM9.6 9h5v1.6h.1a5.5 5.5 0 0 1 4.9-2.7c5.2 0 6.2 3.4 6.2 7.9V21h-5.2v-4.6c0-1.1 0-2.5-1.6-2.5s-1.8 1.2-1.8 2.4V21H9.6z"/></svg>'
  };

  function contactChip(icon, value, href) {
    if (!value) return '';
    const inner = `${ICONS[icon] || ''}<span>${esc(value)}</span>`;
    return href
      ? `<a class="chip chip-in" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<span class="chip chip-in">${inner}</span>`;
  }

  /**
   * Normalise the API response into one shape the render code can rely on.
   *
   * The parser speaks the public schema (contact_information, work_experience,
   * skills.technical). Keeping the translation here means the rendering code
   * has a single vocabulary and the API can evolve without touching it.
   */
  function adapt(data) {
    const contact = data.contact_information || {};
    const place = contact.location || {};
    const skills = data.skills || {};
    return {
      person: {
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        location: [place.city, place.state, place.country].filter(Boolean).join(', '),
        linkedin: contact.linkedin || '',
        github: contact.github || '',
        website: contact.website || ''
      },
      headline: contact.headline || '',
      summary: data.summary || '',
      experience: data.work_experience || [],
      education: data.education || [],
      skills: [...(skills.technical || []), ...(skills.soft || [])],
      skillsTechnical: skills.technical || [],
      skillsSoft: skills.soft || [],
      skillCategories: skills.categories || {},
      projects: data.projects || [],
      certifications: data.certifications || [],
      achievements: data.achievements || [],
      languages: data.languages || [],
      publications: data.publications || []
    };
  }

  function renderResult(data, filename) {
    lastResult = data;
    const p = adapt(data);
    const person = p.person;
    const conf = data.confidence || { overall: 0, fields: {} };

    // Identity
    $('outName').textContent = person.name || 'Name not detected';
    $('outInitials').textContent = initialsOf(person.name);
    const headline = $('outHeadline');
    headline.textContent = p.headline || (p.experience[0] ? p.experience[0].position : '') || '';

    $('outChips').innerHTML = [
      contactChip('mail', person.email, person.email ? `mailto:${person.email}` : ''),
      contactChip('phone', person.phone, person.phone ? `tel:${person.phone.replace(/\s/g, '')}` : ''),
      contactChip('pin', person.location, ''),
      contactChip('linkedin', person.linkedin ? person.linkedin.replace(/^https?:\/\/(www\.)?/, '') : '', person.linkedin),
      contactChip('link', person.website ? person.website.replace(/^https?:\/\/(www\.)?/, '') : '', person.website)
    ].filter(Boolean).join('') || '<span class="hint">No contact details were found in this document.</span>';

    Array.from($('outChips').children).forEach((el, i) => el.style.setProperty('--i', String(i)));

    // Title suggestion
    const titleInput = $('titleInput');
    titleInput.value = person.name || String(filename || '').replace(/\.(pdf|docx)$/i, '') || 'Imported resume';

    // Score
    if (M) {
      M.setRing($('ringFill'), conf.overall);
      M.countUp($('ringNum'), conf.overall, { duration: 1000 });
    } else {
      $('ringNum').textContent = String(conf.overall);
    }

    const meterOrder = ['name', 'email', 'phone', 'location', 'summary', 'work_experience', 'education', 'skills'];
    $('scoreMeters').innerHTML = meterOrder.map((key, i) => {
      const v = Math.round(conf.fields?.[key] ?? 0);
      return `<div class="meter-row" style="--i:${i}">
        <span class="meter-name">${esc(key.replace(/_/g, ' '))}</span>
        <span class="meter-track"><span class="meter-fill" data-value="${v}"></span></span>
        <span class="meter-val">${v}%</span>
      </div>`;
    }).join('');
    if (M) M.fillMeters($('scoreMeters'));

    // Stats
    const s = data.stats || {};
    const tiles = [
      ['Fields found', countFilled(p)],
      ['Roles', (p.experience || []).length],
      ['Degrees', (p.education || []).length],
      ['Skills', (p.skills || []).length],
      ['Words read', s.words || 0],
      ['Parsed in', `${Math.round(data.metadata?.duration_ms || 0)}ms`]
    ];
    $('statStrip').innerHTML = tiles.map(([label, value]) => `
      <div class="stat-tile" data-reveal="pop">
        <b data-count="${typeof value === 'number' ? value : ''}">${typeof value === 'number' ? '0' : esc(value)}</b>
        <span>${esc(label)}</span>
      </div>`).join('');

    // Tabs
    const tabs = buildTabs(p, data);
    const tabsEl = $('resultTabs');
    tabsEl.innerHTML = '<span class="tab-pill"></span>' + tabs.map((t, i) => `
      <button class="tab ${i === 0 ? 'active' : ''}" data-tab="${t.key}" role="tab">
        ${esc(t.label)}${t.count != null ? `<span class="tab-count">${t.count}</span>` : ''}
      </button>`).join('');
    $('tabPanels').innerHTML = tabs.map((t, i) => `
      <div class="tabpanel ${i === 0 ? 'active' : ''}" data-panel="${t.key}">${t.html}</div>`).join('');

    tabsEl.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        $('tabPanels').querySelectorAll('.tabpanel').forEach((pane) => {
          pane.classList.toggle('active', pane.dataset.panel === btn.dataset.tab);
        });
        if (M) M.moveTabPill(tabsEl);
      });
    });

    // AI note
    if (aiNoteEl) {
      const meta = data.metadata || {};
      const stages = meta.stages_ms || {};
      const timing = Object.entries(stages).map(([k, v]) => `${esc(k)} ${v}ms`).join(' · ');
      const engine = meta.ocr_used
        ? `<b>Read with OCR.</b> This document had no text layer, so it was rasterised and recognised. Check the fields carefully.`
        : `<b>Extracted with ${esc(meta.extraction_method || 'the document parser')}.</b>`;
      aiNoteEl.innerHTML = `${engine}${timing ? `<br><span style="opacity:.75">${timing}</span>` : ''}`;
      aiNoteEl.hidden = false;
    }

    if ((data.warnings || []).length) {
      showAlert('Parsed with notes.', data.warnings.join(' '), 'warn');
    }

    // Reveal
    resultsEl.hidden = false;
    if (M) {
      M.revealNow(resultsEl);
      M.wireRipples(resultsEl);
      requestAnimationFrame(() => M.moveTabPill(tabsEl));
      $('statStrip').querySelectorAll('b[data-count]').forEach((el) => {
        if (el.dataset.count !== '') M.countUp(el, Number(el.dataset.count), { duration: 850 });
      });
      M.toast(`Parsed ${conf.overall}% of the expected fields`, 'success');
    }
    resultsEl.scrollIntoView({ behavior: M && M.reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  function countFilled(p) {
    let n = Object.values(p.person).filter(Boolean).length;
    if (p.summary) n++;
    if (p.headline) n++;
    ['experience', 'education', 'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications']
      .forEach((k) => { n += (p[k] || []).length; });
    return n;
  }

  // ── Tab content ────────────────────────────────────────────────────────

  function fieldRow(key, value) {
    const filled = value != null && String(value).trim() !== '';
    return `<div class="frow">
      <div class="fkey">${esc(key)}</div>
      <div class="fval${filled ? '' : ' empty'}">${filled ? linkify(value) : 'not found'}</div>
    </div>`;
  }

  function emptyNote(text) { return `<div class="empty-note">${esc(text)}</div>`; }

  function buildTabs(p, data) {
    // adapt() emits `person`; reading `personal` here made every field in
    // this panel render as "not found" even when the header above showed them.
    const person = p.person || {};
    const tabs = [];

    tabs.push({
      key: 'overview', label: 'Overview',
      html: `
        <div class="panel-grid">
          <div>
            ${fieldRow('Full name', person.name)}
            ${fieldRow('Email', person.email)}
            ${fieldRow('Phone', person.phone)}
            ${fieldRow('Location', person.location)}
          </div>
          <div>
            ${fieldRow('LinkedIn', person.linkedin)}
            ${fieldRow('Website', person.website)}
            ${fieldRow('GitHub', person.github)}
            ${fieldRow('Headline', p.headline)}
            ${fieldRow('Sections detected', ((data.metadata || {}).sections_detected || []).join(', '))}
          </div>
        </div>
        <div style="margin-top:18px">
          <div class="fkey" style="margin-bottom:7px">Summary</div>
          <div class="fval${p.summary ? '' : ' empty'}">${p.summary ? esc(p.summary) : 'not found'}</div>
        </div>`
    });

    tabs.push({
      key: 'experience', label: 'Experience', count: (p.experience || []).length,
      html: (p.experience || []).length
        ? p.experience.map((e) => `
            <div class="entry">
              <div class="entry-head">
                <div>
                  <div class="entry-title">${esc(e.position || 'Role not detected')}</div>
                  <div class="entry-sub">${[e.company, e.location].filter(Boolean).map(esc).join(' · ') || '—'}</div>
                </div>
                ${(e.start_date || e.end_date) ? `<span class="entry-dates">${esc([e.start_date, e.end_date].filter(Boolean).join(' — '))}</span>` : ''}
              </div>
              ${(e.responsibilities || []).length ? `<ul class="entry-bullets">${e.responsibilities.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
              ${e.environment ? `<div class="entry-sub" style="margin-top:9px"><b>Environment:</b> ${esc(e.environment)}</div>` : ''}
            </div>`).join('')
        : emptyNote('No work experience section was found in this document.')
    });

    tabs.push({
      key: 'education', label: 'Education', count: (p.education || []).length,
      html: (p.education || []).length
        ? p.education.map((e) => `
            <div class="entry">
              <div class="entry-head">
                <div>
                  <div class="entry-title">${esc([e.degree, e.major].filter(Boolean).join(', ') || e.institution || 'Degree not detected')}</div>
                  <div class="entry-sub">${[e.institution, e.location].filter(Boolean).map(esc).join(' · ') || '—'}</div>
                </div>
                ${(e.start_date || e.graduation_date) ? `<span class="entry-dates">${esc([e.start_date, e.graduation_date].filter(Boolean).join(' — '))}</span>` : ''}
              </div>
              ${e.gpa ? `<div class="entry-sub" style="margin-top:7px">GPA ${esc(e.gpa)}</div>` : ''}
              ${(e.coursework || []).length ? `<div class="entry-sub" style="margin-top:8px"><b>Coursework:</b> ${esc(e.coursework.join(', '))}</div>` : ''}
            </div>`).join('')
        : emptyNote('No education section was found in this document.')
    });

    const categoryNames = Object.keys(p.skillCategories || {});
    tabs.push({
      key: 'skills', label: 'Skills', count: p.skills.length,
      html: p.skills.length
        ? [
            categoryNames.length
              ? categoryNames.map((name) => `
                  <h4 class="fkey" style="margin:0 0 8px">${esc(name)}</h4>
                  <div class="chip-cloud" style="margin-bottom:16px">${p.skillCategories[name]
                    .map((s, i) => `<span class="chip chip-in" style="--i:${i}">${esc(s)}</span>`).join('')}</div>`).join('')
              : `<div class="chip-cloud">${p.skillsTechnical.map((s, i) => `<span class="chip chip-in" style="--i:${i}">${esc(s)}</span>`).join('')}</div>`,
            p.skillsSoft.length
              ? `<h4 class="fkey" style="margin:16px 0 8px">Soft skills</h4>
                 <div class="chip-cloud">${p.skillsSoft.map((s, i) => `<span class="chip chip-plain chip-in" style="--i:${i}">${esc(s)}</span>`).join('')}</div>`
              : ''
          ].filter(Boolean).join('')
        : emptyNote('No skills section was found in this document.')
    });

    const extras = (p.projects || []).length + (p.certifications || []).length +
                   (p.achievements || []).length + (p.languages || []).length + (p.publications || []).length;

    tabs.push({
      key: 'more', label: 'More', count: extras,
      html: extras ? [
        (p.projects || []).length ? `
          <h4 class="fkey" style="margin:0 0 10px">Projects</h4>
          ${p.projects.map((pr) => `
            <div class="entry">
              <div class="entry-title">${esc(pr.name)}</div>
              ${pr.description ? `<div class="entry-sub" style="margin-top:4px">${esc(pr.description)}</div>` : ''}
              ${pr.link ? `<div style="margin-top:7px">${linkify(pr.link)}</div>` : ''}
            </div>`).join('')}` : '',
        (p.certifications || []).length ? `
          <h4 class="fkey" style="margin:20px 0 10px">Certifications</h4>
          <div class="cert-grid">${p.certifications.map((c) => `
            <div class="cert-card">
              <div class="cert-name">${esc(c.name)}</div>
              <div class="cert-meta">${esc([c.issuer, c.date].filter(Boolean).join(' · ') || '—')}</div>
            </div>`).join('')}</div>` : '',
        (p.achievements || []).length ? `
          <h4 class="fkey" style="margin:20px 0 10px">Achievements</h4>
          <ul class="list-lines">${p.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '',
        (p.languages || []).length ? `
          <h4 class="fkey" style="margin:20px 0 10px">Languages</h4>
          <div class="chip-cloud">${p.languages.map((l, i) => `<span class="chip chip-plain chip-in" style="--i:${i}">${esc(l)}</span>`).join('')}</div>` : '',
        (p.publications || []).length ? `
          <h4 class="fkey" style="margin:20px 0 10px">Publications</h4>
          <ul class="list-lines">${p.publications.map((x) => `<li>${esc(x.title)}${x.date ? ` <span class="hint">(${esc(x.date)})</span>` : ''}${x.link ? `<br>${linkify(x.link)}` : ''}</li>`).join('')}</ul>` : ''
      ].filter(Boolean).join('') : emptyNote('No projects, certifications, achievements, languages or publications were found.')
    });

    tabs.push({
      key: 'raw', label: 'Extracted text',
      html: `
        <div class="raw-head">
          <span class="hint">This is exactly what was read out of the document — every field above comes from this text.</span>
          <button class="btn btn-ghost btn-sm" id="copyRawBtn" type="button">Copy text</button>
        </div>
        <div class="rawpane">${esc(data.raw_text || '')}</div>`
    });

    return tabs;
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async function saveResume() {
    if (!lastResult) return;
    const btn = $('saveBtn');
    const title = ($('titleInput').value || '').trim();
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      await send('/api/parser/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed: lastResult, title, filename: lastResult.filename })
      });
      btn.textContent = 'Saved ✓';
      if (M) M.toast('Saved to My Resumes', 'success');
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
    } catch (err) {
      btn.textContent = original;
      btn.disabled = false;
      if (M) M.toast(err.message || 'Could not save', 'error');
    }
  }

  function downloadJson() {
    if (!lastResult) return;
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(lastResult.contact_information?.name || 'resume').replace(/\s+/g, '-').toLowerCase()}-parsed.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (M) M.toast('JSON downloaded', 'success');
  }

  function resetAll() {
    lastResult = null;
    if (fileInput) fileInput.value = '';
    if (fileCardSlot) fileCardSlot.innerHTML = '';
    if (resultsEl) resultsEl.hidden = true;
    clearAlert();
    resetPipeline();
    if (pasteBox) { pasteBox.value = ''; updatePasteCount(); }
    window.scrollTo({ top: 0, behavior: M && M.reduced() ? 'auto' : 'smooth' });
  }

  function updatePasteCount() {
    if (!pasteBox || !pasteCount) return;
    const n = pasteBox.value.length;
    pasteCount.textContent = `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
    if (parseTextBtn) parseTextBtn.disabled = n < 40;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────

  function wireDropzone() {
    if (!dropzone) return;

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) parseFile(file);
    });

    ['dragenter', 'dragover'].forEach((type) =>
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) dropzone.classList.add('is-dragging');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        // dragleave fires when moving over child elements too; only clear the
        // state when the pointer has actually left the dropzone's box.
        if (type === 'dragleave' && dropzone.contains(e.relatedTarget)) return;
        dropzone.classList.remove('is-dragging');
      })
    );
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) parseFile(file);
    });

    // Whole-window drag highlight so the target is obvious from anywhere.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  function wireModes() {
    if (!modeTabs) return;
    modeTabs.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        modeTabs.querySelectorAll('.tab').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const isFile = btn.dataset.mode === 'file';
        fileMode.hidden = !isFile;
        textMode.hidden = isFile;
        (isFile ? fileMode : textMode).classList.remove('sk-anim-up');
        void (isFile ? fileMode : textMode).offsetWidth;
        (isFile ? fileMode : textMode).classList.add('sk-anim-up');
        if (M) M.moveTabPill(modeTabs);
      });
    });
    if (M) requestAnimationFrame(() => M.moveTabPill(modeTabs));
  }

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'copyRawBtn' && lastResult) {
      navigator.clipboard.writeText(lastResult.rawText || '')
        .then(() => M && M.toast('Extracted text copied', 'success'))
        .catch(() => M && M.toast('Could not copy', 'error'));
    }
  });

  async function loadHealth() {
    const el = $('heroEngine');
    if (!el) return;
    try {
      const h = await send('/api/parser/health');
      el.textContent = h.ocr?.available ? 'OCR' : 'Text';
      const libs = Object.entries(h.libraries || {})
        .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
      el.title = [
        `${h.engine || 'parser'} ${h.parser_version || ''}`.trim(),
        h.ocr?.available ? `OCR via ${h.ocr.backend}` : 'OCR unavailable — text PDFs and DOCX only',
        libs
      ].filter(Boolean).join(' — ');
    } catch {
      el.textContent = 'Text';
    }
  }

  function boot() {
    renderPipeline();
    wireDropzone();
    wireModes();
    if (pasteBox) { pasteBox.addEventListener('input', updatePasteCount); updatePasteCount(); }
    if (parseTextBtn) parseTextBtn.addEventListener('click', parseText);
    if ($('saveBtn')) $('saveBtn').addEventListener('click', saveResume);
    if ($('jsonBtn')) $('jsonBtn').addEventListener('click', downloadJson);
    if ($('resetBtn')) $('resetBtn').addEventListener('click', resetAll);
    loadHealth();
    if (typeof requireSession === 'function') requireSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
