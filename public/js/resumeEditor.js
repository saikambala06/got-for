// ResumeEditor — shared tabbed "Edit & Tailor Resume with AI" UI.
// Renders an editable structured resume form into a container element.
//
// Usage:
//   ResumeEditor.mount(containerEl, resumeData, {
//     title: 'Edit & Tailor Resume with AI',
//     subtitle: 'Review the details we found, fix anything that's off, then continue.',
//     cancelLabel: 'Cancel',
//     saveLabel: 'Save changes',
//     onCancel: () => {},
//     onSave: (updatedResumeData) => {}
//   });
//
// `resumeData` shape (all fields optional / defaulted):
// { personal:{name,email,phone,location,linkedin,portfolio}, summary, skills:[],
//   experience:[{company,role,location,startDate,endDate,current,description}],
//   education:[{school,degree,field,location,startDate,endDate,current,description}],
//   projects:[{name,description}] }

(function () {
  const TABS = [
    { id: 'personal', label: 'Personal Info', icon: '👤' },
    { id: 'summary', label: 'Summary', icon: '📝' },
    { id: 'skills', label: 'Skills', icon: '🏷️' },
    { id: 'experience', label: 'Experience', icon: '💼' },
    { id: 'education', label: 'Education', icon: '🎓' },
    { id: 'projects', label: 'Projects', icon: '📁' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uid() { return 'e' + Math.random().toString(36).slice(2, 10); }

  function normalize(data) {
    const d = data || {};
    return {
      personal: {
        name: d.personal?.name || '',
        email: d.personal?.email || '',
        phone: d.personal?.phone || '',
        location: d.personal?.location || '',
        linkedin: d.personal?.linkedin || '',
        portfolio: d.personal?.portfolio || ''
      },
      summary: d.summary || '',
      skills: Array.isArray(d.skills) ? [...d.skills] : [],
      experience: (d.experience || []).map(e => ({
        _id: e._id || uid(), company: e.company || '', role: e.role || '', location: e.location || '',
        startDate: e.startDate || '', endDate: e.endDate || '', current: !!e.current, description: e.description || ''
      })),
      education: (d.education || []).map(ed => ({
        _id: ed._id || uid(), school: ed.school || '', degree: ed.degree || '', field: ed.field || '', location: ed.location || '',
        startDate: ed.startDate || '', endDate: ed.endDate || '', current: !!ed.current, description: ed.description || ''
      })),
      projects: (d.projects || []).map(p => (typeof p === 'string' ? { _id: uid(), name: p, description: '' } : { _id: p._id || uid(), name: p.name || '', description: p.description || '' })),
      certifications: Array.isArray(d.certifications) ? [...d.certifications] : [],
      achievements: Array.isArray(d.achievements) ? [...d.achievements] : [],
      languages: Array.isArray(d.languages) ? [...d.languages] : [],
      publications: Array.isArray(d.publications) ? [...d.publications] : []
    };
  }

  function injectStyles() {
    if (document.getElementById('resume-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'resume-editor-styles';
    style.textContent = `
      .re-wrap{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
      .re-head{ padding:22px 26px 0; }
      .re-head h2{ font-size:19px; display:flex; align-items:center; gap:8px; }
      .re-head h2 .re-ai{ font-size:11px; font-weight:700; color:var(--accent-2); background:var(--accent-soft);
        padding:3px 9px; border-radius:100px; }
      .re-head p{ color:var(--text-dim); font-size:13px; margin-top:6px; }
      .re-tabs{ display:flex; flex-wrap:wrap; gap:6px; margin:18px 26px 0; border-bottom:1px solid var(--border); padding-bottom:0; }
      .re-tab{ display:flex; align-items:center; gap:6px; padding:10px 15px; font-size:13px; font-weight:600;
        color:var(--text-faint); background:none; border:none; cursor:pointer; border-bottom:2px solid transparent; position:relative; top:1px; }
      .re-tab.active{ color:var(--accent-2); border-bottom-color:var(--accent); }
      .re-tab:hover{ color:var(--text); }
      .re-body{ padding:24px 26px; min-height:220px; }
      .re-panel{ display:none; }
      .re-panel.active{ display:block; animation:re-fade .15s ease; }
      @keyframes re-fade{ from{opacity:0; transform:translateY(3px);} to{opacity:1; transform:none;} }

      .re-summary-row{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .re-ai-btn{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--accent-2);
        background:var(--accent-soft); border:1px solid rgba(255,154,77,0.3); border-radius:100px; padding:6px 12px; cursor:pointer; }
      .re-ai-btn:hover{ filter:brightness(1.08); }
      .re-ai-btn:disabled{ opacity:.5; cursor:default; }

      .re-skills-chips{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
      .re-skill-chip{ display:flex; align-items:center; gap:7px; background:var(--surface-2); border:1px solid var(--border);
        border-radius:100px; padding:6px 8px 6px 13px; font-size:13px; }
      .re-skill-chip button{ background:none; border:none; color:var(--text-faint); cursor:pointer; font-size:14px; line-height:1;
        width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
      .re-skill-chip button:hover{ background:rgba(255,107,129,0.15); color:var(--red); }
      .re-skill-add{ display:flex; gap:8px; }
      .re-skill-add input{ flex:1; }

      .re-entry{ background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-sm);
        padding:16px 18px; margin-bottom:14px; position:relative; }
      .re-entry-top{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .re-entry-title{ font-size:12px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:.04em; }
      .re-entry-remove{ background:none; border:none; color:var(--text-faint); cursor:pointer; font-size:13px; }
      .re-entry-remove:hover{ color:var(--red); }
      .re-check-row{ display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-dim); margin-top:2px; }
      .re-add-btn{ width:100%; border:1.5px dashed var(--border); background:transparent; color:var(--text-dim);
        border-radius:var(--radius-sm); padding:12px; font-size:13px; font-weight:600; cursor:pointer; }
      .re-add-btn:hover{ border-color:var(--accent); color:var(--accent-2); }

      .re-foot{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:18px 26px;
        border-top:1px solid var(--border); background:var(--bg-soft); }
      .re-foot-hint{ font-size:12px; color:var(--text-faint); }
    `;
    document.head.appendChild(style);
  }

  function field(label, inputHtml) {
    return `<div class="field"><label>${esc(label)}</label>${inputHtml}</div>`;
  }

  function render(container, state) {
    const p = state.data.personal;
    let panelsHtml = '';

    // Personal
    panelsHtml += `<div class="re-panel ${state.tab === 'personal' ? 'active' : ''}" data-panel="personal">
      <div class="form-grid">
        ${field('Full Name', `<input data-f="personal.name" value="${esc(p.name)}" placeholder="Jane Doe" />`)}
        ${field('Email', `<input data-f="personal.email" value="${esc(p.email)}" placeholder="jane@email.com" />`)}
        ${field('Phone', `<input data-f="personal.phone" value="${esc(p.phone)}" placeholder="+1 555 123 4567" />`)}
        ${field('Location', `<input data-f="personal.location" value="${esc(p.location)}" placeholder="San Francisco, CA" />`)}
        ${field('LinkedIn', `<input data-f="personal.linkedin" value="${esc(p.linkedin)}" placeholder="linkedin.com/in/janedoe" />`)}
        ${field('Portfolio Website', `<input data-f="personal.portfolio" value="${esc(p.portfolio)}" placeholder="janedoe.dev" />`)}
      </div>
    </div>`;

    // Summary
    panelsHtml += `<div class="re-panel ${state.tab === 'summary' ? 'active' : ''}" data-panel="summary">
      <div class="re-summary-row">
        <label style="font-size:12px;color:var(--text-dim);font-weight:600;">Professional Summary</label>
        <button class="re-ai-btn" data-ai="summary" ${state.aiBusy ? 'disabled' : ''}>✨ ${state.aiBusy === 'summary' ? 'Enhancing…' : 'Enhance with AI'}</button>
      </div>
      <textarea data-f="summary" rows="6" placeholder="A short paragraph highlighting your experience and strengths…">${esc(state.data.summary)}</textarea>
    </div>`;

    // Skills
    panelsHtml += `<div class="re-panel ${state.tab === 'skills' ? 'active' : ''}" data-panel="skills">
      <div class="re-skills-chips">
        ${state.data.skills.map((s, i) => `<span class="re-skill-chip">${esc(s)}<button data-skill-remove="${i}" type="button">✕</button></span>`).join('') || '<span style="color:var(--text-faint);font-size:13px;">No skills yet — add some below.</span>'}
      </div>
      <div class="re-skill-add">
        <input id="re-skill-input" placeholder="Add a skill and press Enter…" />
        <button class="btn" id="re-skill-add-btn" type="button">Add</button>
      </div>
    </div>`;

    // Experience
    panelsHtml += `<div class="re-panel ${state.tab === 'experience' ? 'active' : ''}" data-panel="experience">
      ${state.data.experience.map((e, i) => `
        <div class="re-entry" data-entry="experience:${i}">
          <div class="re-entry-top">
            <span class="re-entry-title">Experience ${i + 1}</span>
            <button class="re-entry-remove" data-remove="experience:${i}" type="button">Remove</button>
          </div>
          <div class="form-grid">
            ${field('Role / Title', `<input data-f="experience.${i}.role" value="${esc(e.role)}" placeholder="Software Engineer" />`)}
            ${field('Company', `<input data-f="experience.${i}.company" value="${esc(e.company)}" placeholder="Acme Corp" />`)}
            ${field('Location', `<input data-f="experience.${i}.location" value="${esc(e.location)}" placeholder="Remote" />`)}
            <div></div>
            ${field('Start Date', `<input data-f="experience.${i}.startDate" value="${esc(e.startDate)}" placeholder="Jan 2022" />`)}
            ${field('End Date', `<input data-f="experience.${i}.endDate" value="${esc(e.endDate)}" placeholder="Present" ${e.current ? 'disabled' : ''} />`)}
          </div>
          <label class="re-check-row"><input type="checkbox" data-f="experience.${i}.current" ${e.current ? 'checked' : ''} /> I currently work here</label>
          <div style="margin-top:12px;">
            <div class="re-summary-row">
              <label style="font-size:12px;color:var(--text-dim);font-weight:600;">Description (one bullet per line)</label>
              <button class="re-ai-btn" data-ai="experience:${i}" ${state.aiBusy ? 'disabled' : ''}>✨ ${state.aiBusy === 'experience:' + i ? 'Improving…' : 'Improve with AI'}</button>
            </div>
            <textarea data-f="experience.${i}.description" rows="4" placeholder="• Led a team of 4 engineers…">${esc(e.description)}</textarea>
          </div>
        </div>`).join('')}
      <button class="re-add-btn" id="re-add-experience" type="button">+ Add Experience</button>
    </div>`;

    // Education
    panelsHtml += `<div class="re-panel ${state.tab === 'education' ? 'active' : ''}" data-panel="education">
      ${state.data.education.map((ed, i) => `
        <div class="re-entry" data-entry="education:${i}">
          <div class="re-entry-top">
            <span class="re-entry-title">Education ${i + 1}</span>
            <button class="re-entry-remove" data-remove="education:${i}" type="button">Remove</button>
          </div>
          <div class="form-grid">
            ${field('School', `<input data-f="education.${i}.school" value="${esc(ed.school)}" placeholder="State University" />`)}
            ${field('Degree', `<input data-f="education.${i}.degree" value="${esc(ed.degree)}" placeholder="B.S." />`)}
            ${field('Field of Study', `<input data-f="education.${i}.field" value="${esc(ed.field)}" placeholder="Computer Science" />`)}
            ${field('Location', `<input data-f="education.${i}.location" value="${esc(ed.location)}" placeholder="Boston, MA" />`)}
            ${field('Start Date', `<input data-f="education.${i}.startDate" value="${esc(ed.startDate)}" placeholder="2018" />`)}
            ${field('End Date', `<input data-f="education.${i}.endDate" value="${esc(ed.endDate)}" placeholder="2022" ${ed.current ? 'disabled' : ''} />`)}
          </div>
          <label class="re-check-row"><input type="checkbox" data-f="education.${i}.current" ${ed.current ? 'checked' : ''} /> Currently studying here</label>
        </div>`).join('')}
      <button class="re-add-btn" id="re-add-education" type="button">+ Add Education</button>
    </div>`;

    // Projects
    panelsHtml += `<div class="re-panel ${state.tab === 'projects' ? 'active' : ''}" data-panel="projects">
      ${state.data.projects.map((pr, i) => `
        <div class="re-entry" data-entry="projects:${i}">
          <div class="re-entry-top">
            <span class="re-entry-title">Project ${i + 1}</span>
            <button class="re-entry-remove" data-remove="projects:${i}" type="button">Remove</button>
          </div>
          ${field('Name', `<input data-f="projects.${i}.name" value="${esc(pr.name)}" placeholder="Project name" />`)}
          ${field('Description', `<textarea data-f="projects.${i}.description" rows="3" placeholder="What it does, tech used…">${esc(pr.description)}</textarea>`)}
        </div>`).join('')}
      <button class="re-add-btn" id="re-add-projects" type="button">+ Add Project</button>
    </div>`;

    container.innerHTML = `
      <div class="re-wrap">
        <div class="re-head">
          <h2>${esc(state.opts.title || 'Edit & Tailor Resume with AI')} <span class="re-ai">✨ AI-assisted</span></h2>
          <p>${esc(state.opts.subtitle || "Review the details we found, fix anything that's off, then continue.")}</p>
        </div>
        <div class="re-tabs">
          ${TABS.map(t => `<button class="re-tab ${state.tab === t.id ? 'active' : ''}" data-retab="${t.id}">${t.icon} ${t.label}</button>`).join('')}
        </div>
        <div class="re-body">${panelsHtml}</div>
        <div class="re-foot">
          <span class="re-foot-hint">Changes are kept only on this device until you save.</span>
          <div style="display:flex;gap:10px;">
            <button class="btn" id="re-cancel-btn" type="button">${esc(state.opts.cancelLabel || 'Cancel')}</button>
            <button class="btn btn-primary" id="re-save-btn" type="button">${esc(state.opts.saveLabel || 'Save changes')}</button>
          </div>
        </div>
      </div>`;

    wire(container, state);
  }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  function wire(container, state) {
    container.querySelectorAll('[data-retab]').forEach(btn => {
      btn.addEventListener('click', () => { state.tab = btn.dataset.retab; render(container, state); });
    });

    container.querySelectorAll('[data-f]').forEach(el => {
      const path = el.dataset.f;
      const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const val = el.type === 'checkbox' ? el.checked : el.value;
        setPath(state.data, path, val);
        if (el.type === 'checkbox' && path.endsWith('.current')) render(container, state);
      });
    });

    // skills
    const addSkill = () => {
      const input = container.querySelector('#re-skill-input');
      const v = (input.value || '').trim();
      if (!v) return;
      if (!state.data.skills.some(s => s.toLowerCase() === v.toLowerCase())) state.data.skills.push(v);
      input.value = '';
      render(container, state);
      container.querySelector('#re-skill-input')?.focus();
    };
    container.querySelector('#re-skill-add-btn')?.addEventListener('click', addSkill);
    container.querySelector('#re-skill-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
    });
    container.querySelectorAll('[data-skill-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.data.skills.splice(Number(btn.dataset.skillRemove), 1);
        render(container, state);
      });
    });

    // add/remove entries
    container.querySelector('#re-add-experience')?.addEventListener('click', () => {
      state.data.experience.push({ _id: uid(), company: '', role: '', location: '', startDate: '', endDate: '', current: false, description: '' });
      render(container, state);
    });
    container.querySelector('#re-add-education')?.addEventListener('click', () => {
      state.data.education.push({ _id: uid(), school: '', degree: '', field: '', location: '', startDate: '', endDate: '', current: false, description: '' });
      render(container, state);
    });
    container.querySelector('#re-add-projects')?.addEventListener('click', () => {
      state.data.projects.push({ _id: uid(), name: '', description: '' });
      render(container, state);
    });
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [key, idx] = btn.dataset.remove.split(':');
        state.data[key].splice(Number(idx), 1);
        render(container, state);
      });
    });

    // AI enhance buttons
    container.querySelectorAll('[data-ai]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (typeof state.opts.onAiEnhance !== 'function') {
          showToastSafe('AI enhance is not available here yet', 'error');
          return;
        }
        const key = btn.dataset.ai; // 'summary' or 'experience:2'
        state.aiBusy = key;
        render(container, state);
        try {
          if (key === 'summary') {
            const next = await state.opts.onAiEnhance('summary', state.data.summary, state.data);
            if (typeof next === 'string') state.data.summary = next;
          } else {
            const [, idxStr] = key.split(':');
            const idx = Number(idxStr);
            const entry = state.data.experience[idx];
            const next = await state.opts.onAiEnhance('experience', entry.description, state.data, entry);
            if (typeof next === 'string') entry.description = next;
          }
        } catch (e) {
          showToastSafe(e.message || 'AI enhance failed', 'error');
        }
        state.aiBusy = null;
        render(container, state);
      });
    });

    container.querySelector('#re-cancel-btn')?.addEventListener('click', () => {
      if (typeof state.opts.onCancel === 'function') state.opts.onCancel();
    });
    container.querySelector('#re-save-btn')?.addEventListener('click', () => {
      if (typeof state.opts.onSave === 'function') state.opts.onSave(cleanForSave(state.data));
    });
  }

  function cleanForSave(data) {
    const strip = arr => arr.map(({ _id, ...rest }) => rest);
    return {
      personal: { ...data.personal },
      summary: data.summary,
      skills: [...data.skills],
      experience: strip(data.experience),
      education: strip(data.education),
      projects: strip(data.projects),
      certifications: data.certifications,
      achievements: data.achievements,
      languages: data.languages,
      publications: data.publications
    };
  }

  function showToastSafe(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }

  function mount(container, resumeData, opts) {
    injectStyles();
    const state = { data: normalize(resumeData), tab: 'personal', opts: opts || {}, aiBusy: null };
    render(container, state);
    return {
      getData: () => cleanForSave(state.data),
      setData: (d) => { state.data = normalize(d); render(container, state); }
    };
  }

  window.ResumeEditor = { mount };
})();
