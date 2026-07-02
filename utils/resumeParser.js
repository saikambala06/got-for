const pdfParse = require('pdf-parse');

const parseResumeText = (text) => {
  const parsed = {
    fullName: '',
    email: '',
    phone: '',
    location: '',
    summary: '',
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    links: []
  };
  
  // Extract email
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    parsed.email = emails[0];
  }

  // Extract phone
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    parsed.phone = phones[0].trim();
  }

  // Extract URLs
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex);
  if (urls) {
    urls.forEach(url => {
      if (url.includes('linkedin')) {
        parsed.links.push({ label: 'LinkedIn', url: url });
      } else if (url.includes('github')) {
        parsed.links.push({ label: 'GitHub', url: url });
      } else {
        parsed.links.push({ label: 'Website', url: url });
      }
    });
  }

  // Split text into lines
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Try to get name from first line
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    if (firstLine.length < 60 && !firstLine.includes('@') && !firstLine.match(/^\d/)) {
      parsed.fullName = firstLine;
    }
  }

  // Extract sections
  const sectionHeaders = {
    summary: /^(summary|objective|profile|about|professional\s*summary)/i,
    experience: /^(experience|work\s*experience|employment|work\s*history|professional\s*experience)/i,
    education: /^(education|academic|qualification)/i,
    skills: /^(skills|technical\s*skills|core\s*competencies|technologies|competencies)/i,
    certifications: /^(certifications?|certificates?|licenses?)/i,
    languages: /^(languages?)/i
  };

  let currentSection = '';
  let sectionContent = {};

  lines.forEach(line => {
    for (const [section, regex] of Object.entries(sectionHeaders)) {
      if (regex.test(line)) {
        currentSection = section;
        sectionContent[section] = [];
        return;
      }
    }
    if (currentSection && sectionContent[currentSection]) {
      sectionContent[currentSection].push(line);
    }
  });

  // Parse skills
  if (sectionContent.skills) {
    const skillsText = sectionContent.skills.join(' ');
    const skills = skillsText.split(/[,|•·;]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 50);
    parsed.skills = [...new Set(skills)];
  }

  // Parse summary
  if (sectionContent.summary) {
    parsed.summary = sectionContent.summary.join(' ').substring(0, 500);
  }

  // Parse experience
  if (sectionContent.experience) {
    let currentExp = null;
    sectionContent.experience.forEach(line => {
      const dateRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{0,4}\s*[-–to]*\s*(present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)?\s*\d{0,4}/i;
      
      if (line.length < 80 && !dateRegex.test(line) && currentExp === null) {
        currentExp = {
          title: line,
          company: '',
          location: '',
          startDate: '',
          endDate: '',
          description: '',
          current: false
        };
        parsed.experience.push(currentExp);
      } else if (currentExp) {
        if (dateRegex.test(line)) {
          const match = line.match(dateRegex);
          if (match) {
            currentExp.startDate = match[0];
          }
          if (line.toLowerCase().includes('present') || line.toLowerCase().includes('current')) {
            currentExp.current = true;
            currentExp.endDate = 'Present';
          }
        } else if (!currentExp.company) {
          currentExp.company = line;
        } else {
          currentExp.description += line + ' ';
        }
      }
    });
  }

  // Parse education
  if (sectionContent.education) {
    let currentEdu = null;
    sectionContent.education.forEach(line => {
      const degreeRegex = /\b(bachelor|master|phd|doctorate|associate|diploma|b\.?s\.?|m\.?s\.?|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|mba|bba|b\.?sc|m\.?sc|b\.?a\.?|m\.?a\.?)/i;
      
      if (degreeRegex.test(line)) {
        currentEdu = {
          degree: line,
          institution: '',
          location: '',
          startDate: '',
          endDate: '',
          gpa: ''
        };
        parsed.education.push(currentEdu);
      } else if (currentEdu) {
        if (!currentEdu.institution) {
          currentEdu.institution = line;
        }
        const gpaRegex = /\b(gpa|cgpa|grade)[\s:]*(\d+\.?\d*)/i;
        const gpaMatch = line.match(gpaRegex);
        if (gpaMatch) {
          currentEdu.gpa = gpaMatch[2];
        }
      }
    });
  }

  // Parse certifications
  if (sectionContent.certifications) {
    parsed.certifications = sectionContent.certifications.filter(l => l.length > 3);
  }

  // Parse languages
  if (sectionContent.languages) {
    const langText = sectionContent.languages.join(' ');
    parsed.languages = langText.split(/[,|•·;]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 30);
  }

  return parsed;
};

const parsePDF = async (buffer) => {
  try {
    const data = await pdfParse(buffer);
    return parseResumeText(data.text);
  } catch (error) {
    console.error('PDF Parse error:', error);
    throw new Error('Failed to parse PDF');
  }
};

const tailorResume = (parsedData, jobDescription) => {
  const tailored = JSON.parse(JSON.stringify(parsedData));
  
  // Extract keywords from job description
  const jdLower = jobDescription.toLowerCase();
  const commonKeywords = [
    'javascript', 'python', 'java', 'react', 'node', 'angular', 'vue',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'ci/cd', 'devops',
    'sql', 'nosql', 'mongodb', 'postgresql', 'mysql', 'redis',
    'html', 'css', 'typescript', 'graphql', 'rest', 'api',
    'agile', 'scrum', 'git', 'linux', 'cloud', 'microservices',
    'machine learning', 'data science', 'deep learning', 'ai',
    'project management', 'leadership', 'communication', 'teamwork',
    'problem solving', 'analytical', 'strategic', 'planning'
  ];

  const matchedKeywords = commonKeywords.filter(keyword => 
    jdLower.includes(keyword.toLowerCase())
  );

  // Add matched keywords to skills if not present
  matchedKeywords.forEach(keyword => {
    const skillLower = tailored.skills.map(s => s.toLowerCase());
    if (!skillLower.includes(keyword.toLowerCase())) {
      // Only add if it seems relevant
      if (jdLower.includes(keyword)) {
        tailored.skills.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
      }
    }
  });

  // Reorder skills to prioritize matched keywords
  tailored.skills.sort((a, b) => {
    const aMatch = matchedKeywords.some(k => a.toLowerCase().includes(k));
    const bMatch = matchedKeywords.some(k => b.toLowerCase().includes(k));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });

  // Tailor summary
  if (tailored.summary) {
    tailored.summary = `Highly motivated professional with expertise in ${matchedKeywords.slice(0, 5).join(', ')}. ${tailored.summary}`;
  }

  return tailored;
};

module.exports = { parseResumeText, parsePDF, tailorResume };
