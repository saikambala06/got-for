const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 46;
const RIGHT = 46;
const TOP = 52;
const BOTTOM = 50;

function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function wrap(text, maxChars) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function normalizeResume(input = {}) {
  return {
    personal: input.personal || {},
    summary: input.summary || '',
    experience: Array.isArray(input.experience) ? input.experience : [],
    education: Array.isArray(input.education) ? input.education : [],
    skills: Array.isArray(input.skills) ? input.skills : [],
    projects: Array.isArray(input.projects) ? input.projects : [],
    certifications: Array.isArray(input.certifications) ? input.certifications : [],
    achievements: Array.isArray(input.achievements) ? input.achievements : [],
    languages: Array.isArray(input.languages) ? input.languages : [],
    publications: Array.isArray(input.publications) ? input.publications : []
  };
}

function linesForResume(data, accentColor = '#6557f5') {
  const rows = [];
  const add = (text, size = 9.4, bold = false, indent = 0, gapAfter = 3) => {
    for (const line of wrap(text, Math.max(42, 98 - Math.floor(indent / 4)))) rows.push({ text: line, size, bold, indent, gapAfter });
  };
  const section = (name) => { rows.push({ text: name.toUpperCase(), size: 10.2, bold: true, section: true, accentColor }); };
  const p = data.personal;
  if (p.name) rows.push({ text: p.name, size: 22, bold: true, name: true });
  const contact = [p.email, p.phone, p.location, p.linkedin, p.portfolio].filter(Boolean).join('  •  ');
  if (contact) rows.push({ text: contact, size: 8.6, contact: true, gapAfter: 10 });
  if (data.summary) { section('Professional Summary'); add(data.summary, 9.5, false, 0, 7); }
  if (data.experience.length) {
    section('Experience');
    for (const e of data.experience) {
      const meta = [e.startDate, e.endDate || (e.current ? 'Present' : '')].filter(Boolean).join(' – ');
      add(`${e.role || 'Role'}${e.company ? ` | ${e.company}` : ''}${e.location ? ` | ${e.location}` : ''}`, 10.2, true, 0, 1);
      if (meta) add(meta, 8.5, false, 0, 2);
      const sourceBullets = Array.isArray(e.bullets) ? e.bullets.map(b => typeof b === 'string' ? b : (b?.new || b?.suggested || b?.old || b?.original || '')) : [];
      const bullets = (sourceBullets.length ? sourceBullets : String(e.description || '').split(/\n|•|\u2022/)).map(v => String(v).replace(/^[-*]\s*/, '').trim()).filter(Boolean);
      for (const b of bullets) add(`- ${b}`, 9.1, false, 8, 1);
      rows.push({ text: '', size: 3 });
    }
  }
  if (data.skills.length) { section('Skills'); add(data.skills.join('  •  '), 9.2, false, 0, 7); }
  if (data.projects.length) {
    section('Projects');
    for (const pr of data.projects) { add(`${pr.name || 'Project'}${pr.link ? ` | ${pr.link}` : ''}`, 10, true, 0, 1); add(pr.description || '', 9, false, 0, 5); }
  }
  if (data.education.length) {
    section('Education');
    for (const e of data.education) {
      add(`${e.degree || 'Degree'}${e.field ? ` in ${e.field}` : ''} | ${e.school || ''}`, 10, true, 0, 1);
      const meta = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      if (meta || e.location) add([meta, e.location].filter(Boolean).join(' | '), 8.6, false, 0, 2);
      if (e.description) add(e.description, 9, false, 0, 5);
    }
  }
  if (data.certifications.length) { section('Certifications'); data.certifications.forEach(c => add(`${c.name || ''}${c.issuer ? ` — ${c.issuer}` : ''}${c.date ? ` (${c.date})` : ''}`, 9.1, false, 0, 2)); }
  if (data.achievements.length) { section('Achievements'); data.achievements.forEach(x => add(`- ${x}`, 9.1, false, 8, 1)); }
  if (data.languages.length) { section('Languages'); add(data.languages.join('  •  '), 9.1, false, 0, 6); }
  if (data.publications.length) { section('Publications'); data.publications.forEach(x => add(`${x.title || ''}${x.date ? ` — ${x.date}` : ''}${x.link ? ` | ${x.link}` : ''}`, 9.1, false, 0, 2)); }
  return rows;
}

function hexRgb(hex) {
  const m = String(hex || '#6557f5').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0.396, 0.341, 0.961];
  return [0, 1, 2].map(i => parseInt(m[1].slice(i * 2, i * 2 + 2), 16) / 255);
}

function contentStream(pageRows, accentColor) {
  const ops = [];
  const [r, g, b] = hexRgb(accentColor);
  let y = PAGE_HEIGHT - TOP;
  for (const row of pageRows) {
    if (row.section) {
      y -= 8;
      ops.push('q');
      ops.push(`${r} ${g} ${b} RG`);
      ops.push(`${LEFT} ${y - 3} m ${PAGE_WIDTH - RIGHT} ${y - 3} l 1.3 w S`);
      ops.push('Q');
      ops.push('BT /F2 10 Tf');
      ops.push(`${LEFT} ${y - 16} Td (${esc(row.text)}) Tj ET`);
      y -= 30;
      continue;
    }
    const font = row.bold ? '/F2' : '/F1';
    const size = row.size || 9.4;
    y -= size + 2;
    if (y < BOTTOM) break;
    ops.push(`BT ${font} ${size} Tf ${LEFT + (row.indent || 0)} ${y} Td (${esc(row.text)}) Tj ET`);
    y -= row.gapAfter ?? 2;
  }
  return ops.join('\n');
}

function generatePdfBuffer(resumeData, options = {}) {
  const data = normalizeResume(resumeData);
  const rows = linesForResume(data, options.accentColor);
  const pages = [];
  let current = [];
  let estimated = TOP;
  const limits = PAGE_HEIGHT - BOTTOM - TOP;
  for (const row of rows) {
    const cost = row.section ? 34 : (row.size || 9.4) + (row.gapAfter ?? 2) + 3;
    if (estimated + cost > limits && current.length) { pages.push(current); current = []; estimated = 0; }
    current.push(row); estimated += cost;
  }
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([{ text: 'Resume', size: 18, bold: true }]);

  const objects = [];
  const addObj = body => { objects.push(body); return objects.length; };
  const catalog = addObj('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesObject = 2;
  addObj(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`);
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  for (let i = 0; i < pages.length; i++) {
    const stream = contentStream(pages[i], options.accentColor || '#6557f5');
    const pageIndex = 5 + i * 2;
    const streamIndex = pageIndex + 1;
    objects.push(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamIndex} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  }
  const chunks = [Buffer.from('%PDF-1.4\n%SKVK\n')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((obj, idx) => {
    const id = idx + 1;
    const chunk = Buffer.from(`${id} 0 obj\n${obj}\nendobj\n`, 'utf8');
    offsets[id] = offset;
    chunks.push(chunk); offset += chunk.length;
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'utf8'));
  return Buffer.concat(chunks);
}

module.exports = { generatePdfBuffer };
