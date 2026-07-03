const TECH_KEYWORDS = [
  'JavaScript','TypeScript','Python','Java','C++','C#','Ruby','Go','Rust','Swift','Kotlin','Scala','PHP','Perl','R','MATLAB',
  'React','Vue','Angular','Node.js','Express','Django','Flask','Spring','Next.js','Nuxt.js','Svelte','Ember','Backbone',
  'HTML','CSS','Sass','SCSS','Tailwind','Bootstrap','Material UI','Styled Components','Webpack','Vite','Babel',
  'SQL','MongoDB','PostgreSQL','MySQL','Redis','Firebase','DynamoDB','Elasticsearch','Cassandra','Oracle','SQLite','CouchDB',
  'AWS','Azure','GCP','Docker','Kubernetes','Jenkins','CI/CD','Terraform','Ansible','CloudFormation','Serverless','Lambda',
  'Git','GitHub','GitLab','Bitbucket','SVN','Mercurial',
  'Machine Learning','Deep Learning','NLP','Computer Vision','Data Science','AI','LLM','GenAI','TensorFlow','PyTorch',
  'Keras','Scikit-learn','Pandas','NumPy','Matplotlib','Seaborn','Jupyter','Spark','Hadoop','Kafka','Airflow','dbt',
  'Tableau','Power BI','Looker','Excel','SPSS','SAS','Google Analytics','Mixpanel','Amplitude',
  'REST','GraphQL','gRPC','WebSockets','API','Microservices','SOA','Event-Driven',
  'Linux','Unix','Bash','PowerShell','Shell Scripting','Cron',
  'Agile','Scrum','Kanban','Jira','Confluence','Trello','Asana','Monday',
  'Project Management','Leadership','Communication','Collaboration','Problem Solving',
  'Critical Thinking','Time Management','Adaptability','Creativity','Teamwork','Mentoring',
  'Statistical Analysis','Data Analysis','Data Visualization','A/B Testing','Regression','Forecasting',
  'SEO','SEM','Digital Marketing','Content Marketing','Social Media','Email Marketing',
  'Photoshop','Illustrator','Figma','Sketch','Adobe XD','InDesign','After Effects',
  'Salesforce','HubSpot','Marketo','Mailchimp','Zendesk','Slack',
  'Customer Service','Customer Success','Account Management','CRM',
  'Financial Analysis','Accounting','QuickBooks','SAP','Financial Modeling',
  'Supply Chain','Logistics','Inventory Management','Procurement',
  'Healthcare','Medical','Nursing','HIPAA','EMR','EHR',
  'Legal','Compliance','Regulatory','GDPR','SOX','ISO',
  'Research','Writing','Editing','Journalism','Copywriting','Technical Writing',
  'Product Management','Product Strategy','Roadmap','User Research','UX','UI',
  'DevOps','SRE','Monitoring','Logging','Prometheus','Grafana','ELK Stack',
  'Blockchain','Smart Contracts','Solidity','Web3','Ethereum',
  'Mobile Development','iOS','Android','React Native','Flutter','Xamarin',
  'Testing','JUnit','Selenium','Cypress','Jest','Mocha','PHPUnit','PyTest'
];

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would','should','could','may','might',
  'must','can','shall','this','that','these','those','i','you','he','she','it','we','they','what','which',
  'who','when','where','why','how','all','each','every','some','any','few','more','most','other','such',
  'no','not','only','own','same','so','than','too','very','just','also','as','if','into','about','through',
  'during','before','after','above','below','up','down','out','off','over','under','again','further','then',
  'once','here','there','your','our','their','its','them','us','me','him','her','my','his','hers','ours',
  'theirs','myself','yourself','himself','herself','itself','ourselves','yourselves','themselves','who',
  'whom','whose','which','that','what','whatever','whoever','whomever','whichever','job','role','position',
  'work','working','ability','experience','experienced','strong','excellent','good','great','must','preferred',
  'required','plus','equal','opportunity','employer','offer','competitive','benefits','salary','compensation',
  'team','teams','company','candidate','candidates','ideal','looking','seeking','join','help','build','create',
  'develop','ensure','including','etc','may','within','across','well','years','year','degree','field','related'
]);

function extractKeywords(text) {
  const found = new Set();
  const lowerText = text.toLowerCase();

  // Check for known tech keywords
  TECH_KEYWORDS.forEach(kw => {
    if (lowerText.includes(kw.toLowerCase())) {
      found.add(kw);
    }
  });

  // Extract other significant words and phrases
  const words = text.split(/[\s,;:.!?()\[\]{}'"\/\\|<>\-]+/);
  const phrases = text.match(/(?:^|[\s])([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
  
  if (phrases) {
    phrases.forEach(p => {
      const cleaned = p.trim();
      if (cleaned.length > 3 && cleaned.length < 50) {
        found.add(cleaned);
      }
    });
  }

  const wordFreq = {};
  words.forEach(word => {
    word = word.trim();
    if (word.length > 2 && !STOP_WORDS.has(word.toLowerCase()) && !/^\d+$/.test(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });

  Object.entries(wordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .forEach(([word]) => {
      if (!found.has(word)) found.add(word);
    });

  return Array.from(found);
}

function categorizeKeywords(keywords) {
  const technical = [];
  const soft = [];
  
  const softSkills = ['Leadership','Communication','Collaboration','Problem Solving','Critical Thinking',
    'Time Management','Adaptability','Creativity','Teamwork','Mentoring','Project Management',
    'Analytical','Strategic','Organizational','Presentation','Negotiation','Decision Making',
    'Interpersonal','Conflict Resolution','Stakeholder Management','Agile','Scrum','Kanban'];

  keywords.forEach(kw => {
    const isSoft = softSkills.some(ss => 
      kw.toLowerCase().includes(ss.toLowerCase()) || ss.toLowerCase().includes(kw.toLowerCase())
    );
    if (isSoft) {
      soft.push(kw);
    } else {
      technical.push(kw);
    }
  });

  return { technical, soft };
}

function tailorResume(resumeData, jobDescription) {
  const jobKeywords = extractKeywords(jobDescription);
  const categorized = categorizeKeywords(jobKeywords);
  
  const resumeSkills = (resumeData.skills || []).map(s => s.toLowerCase());
  const resumeText = JSON.stringify(resumeData).toLowerCase();

  const matchingSkills = [];
  const missingSkills = [];

  jobKeywords.forEach(kw => {
    const kwLower = kw.toLowerCase();
    const inSkills = resumeSkills.some(s => s.includes(kwLower) || kwLower.includes(s));
    const inText = resumeText.includes(kwLower);
    
    if (inSkills || inText) {
      matchingSkills.push(kw);
    } else {
      missingSkills.push(kw);
    }
  });

  const matchScore = jobKeywords.length > 0 
    ? Math.round((matchingSkills.length / jobKeywords.length) * 100)
    : 0;

  // Generate tailored summary
  const topMatching = matchingSkills.slice(0, 5);
  const topMissing = missingSkills.slice(0, 3);
  
  let tailoredSummary = resumeData.summary || '';
  
  if (topMatching.length > 0) {
    const skillPhrase = topMatching.join(', ');
    if (tailoredSummary.toLowerCase().includes(skillPhrase.toLowerCase())) {
      // Already mentioned
    } else {
      tailoredSummary = tailoredSummary.trim();
      if (tailoredSummary) {
        tailoredSummary += ` Proficient in ${skillPhrase}.`;
      } else {
        tailoredSummary = `Experienced professional with expertise in ${skillPhrase}.`;
      }
    }
  }

  // Suggest improvements
  const suggestions = [];
  
  if (missingSkills.length > 0) {
    suggestions.push({
      type: 'missing_skills',
      title: 'Consider adding these skills',
      items: missingSkills.slice(0, 10)
    });
  }

  if (resumeData.summary && resumeData.summary.length < 100) {
    suggestions.push({
      type: 'summary',
      title: 'Expand your summary',
      message: 'Your professional summary is quite short. Consider adding more details about your experience and key achievements.'
    });
  }

  if (resumeData.skills.length < 5) {
    suggestions.push({
      type: 'skills',
      title: 'Add more skills',
      message: 'Your resume has fewer than 5 skills listed. Adding more relevant skills will improve your match rate.'
    });
  }

  if (resumeData.experience.length < 2) {
    suggestions.push({
      type: 'experience',
      title: 'Add more experience details',
      message: 'Consider adding more detail to your work experience section.'
    });
  }

  // Combine resume skills with relevant missing skills
  const tailoredSkills = [...(resumeData.skills || [])];
  missingSkills.slice(0, 5).forEach(skill => {
    if (!tailoredSkills.some(s => s.toLowerCase() === skill.toLowerCase())) {
      tailoredSkills.push(skill);
    }
  });

  return {
    matchScore,
    matchingSkills,
    missingSkills,
    jobKeywords,
    technicalSkills: categorized.technical,
    softSkills: categorized.soft,
    tailoredSummary,
    tailoredSkills,
    suggestions,
    originalResume: resumeData
  };
}

module.exports = { extractKeywords, categorizeKeywords, tailorResume };