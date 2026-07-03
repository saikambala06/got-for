function parseResumeText(text) {
  const parsed = {
    name: '',
    email: '',
    phone: '',
    location: '',
    summary: '',
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: []
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const fullText = text;

  // Extract email
  const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) parsed.email = emailMatch[0];

  // Extract phone
  const phoneMatch = fullText.match(/(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) parsed.phone = phoneMatch[0];

  // Extract name (first non-empty line that's not an email)
  for (const line of lines) {
    if (line.length > 1 && line.length < 60 && !line.includes('@') && !line.match(/^\d/)) {
      parsed.name = line;
      break;
    }
  }

  // Extract location
  const locMatch = fullText.match(/([A-Z][a-z]+,\s*[A-Z]{2})|([A-Z][a-z]+,\s*[A-Z][a-z]+)/);
  if (locMatch) parsed.location = locMatch[0];

  // Extract summary
  const summaryRegex = /(?:SUMMARY|PROFILE|OBJECTIVE|ABOUT ME|PROFESSIONAL SUMMARY)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:EXPERIENCE|WORK|EDUCATION|SKILLS|PROJECTS|CERTIFICATIONS)|$)/i;
  const summaryMatch = fullText.match(summaryRegex);
  if (summaryMatch) {
    parsed.summary = summaryMatch[1].trim().substring(0, 1000);
  }

  // Extract skills
  const skillsRegex = /(?:SKILLS|TECHNICAL SKILLS|CORE COMPETENCIES|TECHNOLOGIES|KEY SKILLS)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:EXPERIENCE|WORK|EDUCATION|PROJECTS|CERTIFICATIONS)|$)/i;
  const skillsMatch = fullText.match(skillsRegex);
  if (skillsMatch) {
    const skillsText = skillsMatch[1].trim();
    parsed.skills = skillsText
      .split(/[,•·|\n•]/)
      .map(s => s.trim().replace(/^[•\-\*]\s*/, ''))
      .filter(s => s.length > 1 && s.length < 60);
  }

  // Extract experience
  const expRegex = /(?:EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EMPLOYMENT HISTORY|WORK HISTORY)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:EDUCATION|SKILLS|PROJECTS|CERTIFICATIONS)|$)/i;
  const expMatch = fullText.match(expRegex);
  if (expMatch) {
    parsed.experience = expMatch[1]
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);
  }

  // Extract education
  const eduRegex = /(?:EDUCATION|ACADEMIC BACKGROUND|ACADEMICS)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:SKILLS|PROJECTS|CERTIFICATIONS|EXPERIENCE)|$)/i;
  const eduMatch = fullText.match(eduRegex);
  if (eduMatch) {
    parsed.education = eduMatch[1]
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);
  }

  // Extract projects
  const projRegex = /(?:PROJECTS|PERSONAL PROJECTS|KEY PROJECTS)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:EDUCATION|SKILLS|CERTIFICATIONS|EXPERIENCE)|$)/i;
  const projMatch = fullText.match(projRegex);
  if (projMatch) {
    parsed.projects = projMatch[1]
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);
  }

  // Extract certifications
  const certRegex = /(?:CERTIFICATIONS|CERTIFICATES|LICENSES)\s*[:\n]+([\s\S]*?)(?=\n\s*\n|\n(?:EDUCATION|SKILLS|EXPERIENCE)|$)/i;
  const certMatch = fullText.match(certRegex);
  if (certMatch) {
    parsed.certifications = certMatch[1]
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);
  }

  return parsed;
}

function generateResumeHTML(parsed) {
  let html = '';
  html += `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">`;
  html += `<h1 style="text-align: center; color: #2D3436; margin-bottom: 5px;">${parsed.name || 'Your Name'}</h1>`;
  html += `<p style="text-align: center; color: #636E72; margin-bottom: 20px;">${parsed.email || ''} ${parsed.phone ? '| ' + parsed.phone : ''} ${parsed.location ? '| ' + parsed.location : ''}</p>`;
  
  if (parsed.summary) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Summary</h2>`;
    html += `<p style="color: #2D3436; line-height: 1.6;">${parsed.summary}</p>`;
  }
  
  if (parsed.skills.length > 0) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Skills</h2>`;
    html += `<p style="color: #2D3436;">${parsed.skills.join(' • ')}</p>`;
  }
  
  if (parsed.experience.length > 0) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Experience</h2>`;
    parsed.experience.forEach(exp => {
      html += `<p style="color: #2D3436; line-height: 1.6;">${exp}</p>`;
    });
  }
  
  if (parsed.education.length > 0) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Education</h2>`;
    parsed.education.forEach(edu => {
      html += `<p style="color: #2D3436; line-height: 1.6;">${edu}</p>`;
    });
  }
  
  if (parsed.projects.length > 0) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Projects</h2>`;
    parsed.projects.forEach(proj => {
      html += `<p style="color: #2D3436; line-height: 1.6;">${proj}</p>`;
    });
  }
  
  if (parsed.certifications.length > 0) {
    html += `<h2 style="color: #6C5CE7; border-bottom: 2px solid #6C5CE7; padding-bottom: 5px;">Certifications</h2>`;
    parsed.certifications.forEach(cert => {
      html += `<p style="color: #2D3436; line-height: 1.6;">${cert}</p>`;
    });
  }
  
  html += `</div>`;
  return html;
}

module.exports = { parseResumeText, generateResumeHTML };