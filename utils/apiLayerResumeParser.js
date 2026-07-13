/**
 * APILayer Resume Parser integration.
 *
 * IMPORTANT: the APILayer key must live only in the server environment
 * (APILAYER_API_KEY). It is never sent to the browser — the client only
 * ever talks to our own /api/resumes/parse-apilayer endpoint, which then
 * makes this server-to-server call.
 */

const APILAYER_ENDPOINT = 'https://api.apilayer.com/resume_parser/upload';

async function callApiLayer(fileBuffer) {
  const apiKey = process.env.APILAYER_API_KEY;
  if (!apiKey) {
    throw new Error('APILAYER_API_KEY is not configured on the server.');
  }

  const response = await fetch(APILAYER_ENDPOINT, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/octet-stream'
    },
    body: fileBuffer
  });

  const apiResult = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(apiResult.message || `APILayer request failed (${response.status})`);
  }
  return apiResult;
}

// Same weighting the client-side parser used, so the confidence ring and
// "not detected" list behave identically regardless of which parser ran.
function scoreConfidence(d) {
  const contactChecks = [d.email, d.phone, d.location, d.linkedin];
  const sectionChecks = [
    !!d.summary,
    (d.skills.categorized.length > 0 || d.skills.flat.length > 0),
    d.experience.length > 0,
    d.education.length > 0,
    d.certifications.length > 0
  ];
  const contactScore = contactChecks.filter(Boolean).length / contactChecks.length;
  const sectionScore = sectionChecks.filter(Boolean).length / sectionChecks.length;
  const total = Math.round((contactScore * 0.35 + sectionScore * 0.65) * 100);

  const missing = [];
  if (!d.email) missing.push('Email');
  if (!d.phone) missing.push('Phone');
  if (!d.location) missing.push('Location');
  if (!d.linkedin) missing.push('LinkedIn');
  if (!sectionChecks[0]) missing.push('Summary');
  if (!sectionChecks[1]) missing.push('Skills');
  if (!sectionChecks[2]) missing.push('Experience');
  if (!sectionChecks[3]) missing.push('Education');
  if (!sectionChecks[4]) missing.push('Certifications');

  return { score: total, missing };
}

function mapApiLayerData(apiData) {
  const links = Array.isArray(apiData.links) ? apiData.links : [];
  const github = apiData.github || links.find(l => /github\.com/i.test(l)) || '';
  const website = apiData.portfolio || links.find(l => l !== github) || '';

  const resume = {
    name: apiData.name || 'Name not detected',
    title: apiData.designation || '',
    email: apiData.email || '',
    phone: apiData.phone || '',
    location: apiData.location || apiData.address || '',
    linkedin: apiData.linkedin || '',
    github,
    website,

    summary: apiData.summary || apiData.objective || '',

    skills: {
      categorized: [],
      flat: Array.isArray(apiData.skills) ? apiData.skills : []
    },

    experience: (apiData.experience || []).map(exp => ({
      title: exp.title || exp.designation || 'Role',
      company: exp.company || exp.organization || '',
      date: exp.dates || exp.duration || '',
      location: exp.location || '',
      bullets: exp.description ? [exp.description] : [],
      raw: exp.description || ''
    })),

    education: (apiData.education || []).map(edu => ({
      degree: edu.degree || edu.course || 'Program',
      institution: edu.institution || edu.university || '',
      date: edu.dates || edu.year || '',
      location: edu.location || '',
      gpa: edu.gpa || edu.score || '',
      bullets: [],
      raw: ''
    })),

    certifications: (apiData.certification || apiData.certifications || []).map(cert => ({
      name: typeof cert === 'string' ? cert : (cert.name || 'Certification'),
      issuer: (cert && cert.issuer) || '',
      date: (cert && (cert.date || cert.year)) || '',
      raw: typeof cert === 'string' ? cert : JSON.stringify(cert)
    })),

    rawText: ''
  };

  // Real confidence score computed from what actually came back — not a
  // hardcoded number — so the UI stays trustworthy when APILayer only
  // partially parses a document.
  const conf = scoreConfidence(resume);
  resume.confidence = conf.score;
  resume.missing = conf.missing;

  return resume;
}

async function parseResumeWithApiLayer(fileBuffer) {
  const apiResult = await callApiLayer(fileBuffer);
  return mapApiLayerData(apiResult);
}

module.exports = { parseResumeWithApiLayer };
