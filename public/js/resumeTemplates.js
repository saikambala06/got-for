// Shared resume template renderer.
// Used by both the "Quick Download" flow and the "Review & edit" flow so that
// whichever template a user picks looks IDENTICAL in the live preview and in
// the exported PDF/DOCX, no matter which of the two flows produced it.
//
// Exposes: window.ResumeTemplates.renderResumeHTML(resume, opts) -> full <html> doc string
//          window.ResumeTemplates.renderResumePreviewFragment(resume, opts) -> inner fragment for on-page preview

(function () {
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function bulletLines(desc) {
    return (desc || '').split('\n').filter(Boolean).map(l => l.replace(/^[-•*]\s*/, ''));
  }

  function contactParts(p) {
    return [p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(esc);
  }

  // Each template returns { css, body } where body is the inner HTML (no <html>/<body> wrapper).
  const TEMPLATES = {
    Classic(resume, opts) {
      const p = resume.personal || {};
      const accent = opts.accent, textColor = opts.textColor;
      const css = `
        .r-doc{ font-family:Georgia,'Times New Roman',serif; color:${textColor}; }
        .r-doc h1{ text-align:center; font-size:22px; margin:0 0 2px; }
        .r-doc .r-title{ text-align:center; font-size:12.5px; font-weight:700; letter-spacing:.04em; color:${accent}; margin-bottom:2px; }
        .r-doc .r-contact{ text-align:center; font-size:12px; color:#6b7280; margin-bottom:14px; }
        .r-doc hr{ border:none; border-top:2px solid ${accent}; margin:12px 0; }
        .r-doc h2{ font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:${accent}; margin:18px 0 8px; }
        .r-doc .r-role{ font-weight:700; font-size:13.5px; } 
        .r-doc .r-company{ font-style:italic; color:#4b5160; font-size:12.5px; margin-bottom:6px; display:flex; justify-content:space-between; }
        .r-doc ul{ margin:0 0 12px; padding-left:18px; } .r-doc li{ font-size:12.8px; line-height:1.55; margin-bottom:4px; }
      `;
      const expHtml = (resume.experience || []).map(e => `
        <div class="r-role">${esc(e.role || '')}</div>
        <div class="r-company"><span>${esc(e.company || '')}</span><span>${esc(e.dates || '')}</span></div>
        <ul>${bulletLines(e.description).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
      const eduHtml = (resume.education || []).map(ed => `<div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');
      const body = `
        <div class="r-doc">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="r-title">${esc(resume.title || '')}</div>
          <div class="r-contact">${contactParts(p).join(' &nbsp;|&nbsp; ')}</div>
          <hr/>
          <h2>Summary</h2><p style="font-size:12.8px;line-height:1.6;">${esc(resume.summary || '')}</p>
          <h2>Skills</h2><p style="font-size:12.8px;">${(resume.skills || []).map(esc).join(', ')}</p>
          <h2>Experience</h2>${expHtml}
          ${eduHtml ? `<h2>Education</h2>${eduHtml}` : ''}
        </div>`;
      return { css, body };
    },

    Harvard(resume, opts) {
      const p = resume.personal || {};
      const accent = opts.accent, textColor = opts.textColor;
      const css = `
        .r-doc{ font-family:'Times New Roman',Times,serif; color:${textColor}; }
        .r-doc h1{ text-align:center; font-size:20px; letter-spacing:.03em; text-transform:uppercase; margin:0 0 4px; }
        .r-doc .r-contact{ text-align:center; font-size:12px; color:#444; margin-bottom:10px; }
        .r-doc hr{ border:none; border-top:1px solid #333; margin:10px 0; }
        .r-doc h2{ font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; border-bottom:1px solid ${accent}; padding-bottom:3px; margin:16px 0 8px; color:${textColor}; }
        .r-doc .r-role-row{ display:flex; justify-content:space-between; font-weight:700; font-size:13px; }
        .r-doc .r-company{ font-style:italic; font-size:12.5px; margin-bottom:5px; color:#333; }
        .r-doc ul{ margin:0 0 12px; padding-left:16px; } .r-doc li{ font-size:12.5px; line-height:1.5; margin-bottom:3px; }
      `;
      const expHtml = (resume.experience || []).map(e => `
        <div class="r-role-row"><span>${esc(e.company || '')}</span><span>${esc(e.dates || '')}</span></div>
        <div class="r-company">${esc(e.role || '')}</div>
        <ul>${bulletLines(e.description).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
      const eduHtml = (resume.education || []).map(ed => `<div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');
      const body = `
        <div class="r-doc">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="r-contact">${contactParts(p).join(' &nbsp;•&nbsp; ')}</div>
          <hr/>
          <h2>Summary</h2><p style="font-size:12.5px;line-height:1.55;">${esc(resume.summary || '')}</p>
          <h2>Skills</h2><p style="font-size:12.5px;">${(resume.skills || []).map(esc).join(', ')}</p>
          <h2>Experience</h2>${expHtml}
          ${eduHtml ? `<h2>Education</h2>${eduHtml}` : ''}
        </div>`;
      return { css, body };
    },

    "Jake's": function (resume, opts) {
      const p = resume.personal || {};
      const accent = opts.accent, textColor = opts.textColor;
      const css = `
        .r-doc{ font-family:'Segoe UI',Helvetica,Arial,sans-serif; color:${textColor}; font-size:12.5px; }
        .r-doc h1{ text-align:center; font-size:20px; margin:0 0 4px; letter-spacing:.02em; }
        .r-doc .r-contact{ text-align:center; font-size:11.5px; color:#444; margin-bottom:10px; }
        .r-doc h2{ font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-bottom:1.5px solid ${textColor}; padding-bottom:2px; margin:14px 0 6px; color:${accent}; }
        .r-doc .r-role-row{ display:flex; justify-content:space-between; font-weight:700; font-size:12.8px; }
        .r-doc .r-company-row{ display:flex; justify-content:space-between; font-style:italic; font-size:12px; color:#333; margin-bottom:4px; }
        .r-doc ul{ margin:0 0 10px; padding-left:16px; } .r-doc li{ font-size:12px; line-height:1.45; margin-bottom:2px; }
      `;
      const expHtml = (resume.experience || []).map(e => `
        <div class="r-role-row"><span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span></div>
        <div class="r-company-row"><span>${esc(e.company || '')}</span></div>
        <ul>${bulletLines(e.description).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
      const eduHtml = (resume.education || []).map(ed => `<div style="margin-bottom:6px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');
      const body = `
        <div class="r-doc">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="r-contact">${contactParts(p).join(' &nbsp;|&nbsp; ')}</div>
          <h2>Summary</h2><p>${esc(resume.summary || '')}</p>
          <h2>Skills</h2><p>${(resume.skills || []).map(esc).join(' &middot; ')}</p>
          <h2>Experience</h2>${expHtml}
          ${eduHtml ? `<h2>Education</h2>${eduHtml}` : ''}
        </div>`;
      return { css, body };
    },

    Modern(resume, opts) {
      const p = resume.personal || {};
      const accent = opts.accent, textColor = opts.textColor;
      const css = `
        .r-doc{ font-family:'Inter',Helvetica,Arial,sans-serif; color:${textColor}; }
        .r-doc h1{ text-align:left; font-size:26px; font-weight:800; margin:0 0 2px; color:${accent}; }
        .r-doc .r-title{ font-size:13px; font-weight:600; color:${textColor}; margin-bottom:6px; }
        .r-doc .r-contact{ font-size:11.5px; color:#666; margin-bottom:14px; }
        .r-doc h2{ display:inline-block; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#fff; background:${accent}; padding:3px 10px; border-radius:999px; margin:16px 0 8px; }
        .r-doc .r-role-row{ display:flex; justify-content:space-between; font-weight:700; font-size:13px; }
        .r-doc .r-company{ font-size:12.5px; color:#555; margin-bottom:5px; }
        .r-doc ul{ margin:0 0 12px; padding-left:18px; } .r-doc li{ font-size:12.5px; line-height:1.5; margin-bottom:3px; }
      `;
      const expHtml = (resume.experience || []).map(e => `
        <div class="r-role-row"><span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span></div>
        <div class="r-company">${esc(e.company || '')}</div>
        <ul>${bulletLines(e.description).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
      const eduHtml = (resume.education || []).map(ed => `<div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');
      const body = `
        <div class="r-doc">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="r-title">${esc(resume.title || '')}</div>
          <div class="r-contact">${contactParts(p).join(' &nbsp;|&nbsp; ')}</div>
          <div><h2>Summary</h2></div><p style="font-size:12.5px;line-height:1.6;">${esc(resume.summary || '')}</p>
          <div><h2>Skills</h2></div><p style="font-size:12.5px;">${(resume.skills || []).map(esc).join(', ')}</p>
          <div><h2>Experience</h2></div>${expHtml}
          ${eduHtml ? `<div><h2>Education</h2></div>${eduHtml}` : ''}
        </div>`;
      return { css, body };
    },

    Minimal(resume, opts) {
      const p = resume.personal || {};
      const accent = opts.accent, textColor = opts.textColor;
      const css = `
        .r-doc{ font-family:'Inter',Helvetica,Arial,sans-serif; color:${textColor}; }
        .r-doc h1{ text-align:left; font-size:19px; font-weight:600; margin:0 0 2px; }
        .r-doc .r-contact{ font-size:11.5px; color:#888; margin-bottom:16px; }
        .r-doc hr{ border:none; border-top:1px solid #eee; margin:14px 0; }
        .r-doc h2{ font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:#999; margin:16px 0 8px; }
        .r-doc .r-role-row{ display:flex; justify-content:space-between; font-weight:600; font-size:12.8px; color:${textColor}; }
        .r-doc .r-company{ font-size:12px; color:#999; margin-bottom:6px; }
        .r-doc ul{ margin:0 0 12px; padding-left:16px; } .r-doc li{ font-size:12.3px; line-height:1.6; margin-bottom:3px; color:${textColor}; }
        .r-doc h2 + .r-role-row, .r-doc a{ color:${accent}; }
      `;
      const expHtml = (resume.experience || []).map(e => `
        <div class="r-role-row"><span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span></div>
        <div class="r-company">${esc(e.company || '')}</div>
        <ul>${bulletLines(e.description).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
      const eduHtml = (resume.education || []).map(ed => `<div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');
      const body = `
        <div class="r-doc">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="r-contact">${contactParts(p).join(' &nbsp;·&nbsp; ')}</div>
          <hr/>
          <h2>Summary</h2><p style="font-size:12.3px;line-height:1.6;">${esc(resume.summary || '')}</p>
          <h2>Skills</h2><p style="font-size:12.3px;">${(resume.skills || []).map(esc).join(', ')}</p>
          <h2>Experience</h2>${expHtml}
          ${eduHtml ? `<h2>Education</h2>${eduHtml}` : ''}
        </div>`;
      return { css, body };
    }
  };

  function normalizeTemplate(name) {
    return TEMPLATES[name] ? name : 'Classic';
  }

  function build(resume, opts) {
    const template = normalizeTemplate(opts.template);
    return TEMPLATES[template](resume, {
      accent: opts.accentColor || opts.accent || '#0ea5a4',
      textColor: opts.textColor || '#1a1d29'
    });
  }

  // Full standalone HTML document — used for PDF (print) and DOCX (Word-compatible HTML) exports.
  function renderResumeHTML(resume, opts) {
    const { css, body } = build(resume, opts);
    const p = (resume.personal || {});
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(p.name || 'Resume')}</title>
      <style>
        body{ padding:40px; max-width:760px; margin:0 auto; }
        ${css}
        @media print { body{ padding:0; } }
      </style></head><body>${body}</body></html>`;
  }

  // Inner fragment only — used for the on-page live preview mount, wrapped in a scoped <div>.
  function renderResumePreviewFragment(resume, opts) {
    const { css, body } = build(resume, opts);
    return `<style>${css}</style>${body}`;
  }

  window.ResumeTemplates = { renderResumeHTML, renderResumePreviewFragment, TEMPLATE_NAMES: Object.keys(TEMPLATES) };
})();
