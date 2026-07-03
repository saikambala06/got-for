const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const { connectDB } = require('../src/db');
const { User, Resume, Job } = require('../src/models');
const { parseResumeText, generateResumeHTML } = require('../src/resumeParser');
const { tailorResume, extractKeywords, categorizeKeywords } = require('../src/resumeTailor');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'sk-vk-dev-secret');
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
  try {
    await connectDB();
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      connectedAccounts: email.toLowerCase()
    });
    await user.save();
    
    // Seed demo data
    await seedDemoData(user._id);
    
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'sk-vk-dev-secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'sk-vk-dev-secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    await connectDB();
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.put('/api/auth/profile', auth, async (req, res) => {
  try {
    await connectDB();
    const { name, email } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (name) user.name = name;
    if (email) {
      user.email = email.toLowerCase();
      user.connectedAccounts = email.toLowerCase();
    }
    await user.save();
    
    res.json({ user: { id: user._id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.put('/api/auth/password', auth, async (req, res) => {
  try {
    await connectDB();
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Password update failed' });
  }
});

// ============ RESUME ROUTES ============
app.get('/api/resumes', auth, async (req, res) => {
  try {
    await connectDB();
    const resumes = await Resume.find({ userId: req.userId }).sort({ updatedAt: -1 });
    res.json({ resumes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

app.get('/api/resumes/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch resume' });
  }
});

app.post('/api/resumes/upload', auth, async (req, res) => {
  try {
    await connectDB();
    const { fileName, fileContent, fileType } = req.body;
    
    if (!fileContent) return res.status(400).json({ error: 'No file content provided' });
    
    let text = '';
    const buffer = Buffer.from(fileContent, 'base64');
    
    if (fileType === 'pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const data = await pdfParse(buffer);
        text = data.text;
      } catch (e) {
        return res.status(400).json({ error: 'Failed to parse PDF. Ensure it is a text-based PDF.' });
      }
    } else if (fileType === 'docx' || fileName.toLowerCase().endsWith('.docx')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
    } else if (fileType === 'txt' || fileName.toLowerCase().endsWith('.txt')) {
      text = buffer.toString('utf-8');
    } else {
      text = buffer.toString('utf-8');
    }
    
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: 'Could not extract sufficient text from the file' });
    }
    
    const parsedData = parseResumeText(text);
    
    const user = await User.findById(req.userId);
    
    const resume = new Resume({
      userId: req.userId,
      name: parsedData.name ? `${parsedData.name}'s Resume` : fileName.replace(/\.[^/.]+$/, ''),
      isDefault: false,
      parsedData
    });
    
    // If first resume, make it default
    const count = await Resume.countDocuments({ userId: req.userId });
    if (count === 0) resume.isDefault = true;
    
    await resume.save();
    
    // Increment usage
    if (user) {
      user.jobExtractionsUsed += 1;
      await user.save();
    }
    
    res.json({ resume, message: 'Resume parsed successfully' });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

app.post('/api/resumes', auth, async (req, res) => {
  try {
    await connectDB();
    const { name, parsedData } = req.body;
    
    const count = await Resume.countDocuments({ userId: req.userId });
    const resume = new Resume({
      userId: req.userId,
      name: name || 'Untitled Resume',
      isDefault: count === 0,
      parsedData: parsedData || {
        name: '', email: '', phone: '', location: '', summary: '',
        skills: [], experience: [], education: [], projects: [], certifications: []
      }
    });
    await resume.save();
    res.json({ resume, message: 'Resume created' });
  } catch (err) {
    res.status(500).json({ error: 'Create failed' });
  }
});

app.put('/api/resumes/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const { name, parsedData, isDefault } = req.body;
    
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    
    if (name !== undefined) resume.name = name;
    if (parsedData !== undefined) resume.parsedData = parsedData;
    if (isDefault !== undefined) {
      if (isDefault) {
        await Resume.updateMany({ userId: req.userId }, { isDefault: false });
      }
      resume.isDefault = isDefault;
    }
    resume.updatedAt = Date.now();
    await resume.save();
    
    res.json({ resume, message: 'Resume updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/resumes/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const result = await Resume.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Resume not found' });
    res.json({ message: 'Resume deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.get('/api/resumes/:id/download', auth, async (req, res) => {
  try {
    await connectDB();
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    
    const html = generateResumeHTML(resume.parsedData);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${resume.name}.html"`);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

// ============ TAILOR ROUTE ============
app.post('/api/resumes/tailor', auth, async (req, res) => {
  try {
    await connectDB();
    const { resumeId, jobDescription, jobTitle, company } = req.body;
    
    if (!jobDescription || jobDescription.trim().length < 20) {
      return res.status(400).json({ error: 'Please provide a more detailed job description' });
    }
    
    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    
    const result = tailorResume(resume.parsedData, jobDescription);
    
    // Save tailored resume as new version
    const tailoredResume = new Resume({
      userId: req.userId,
      name: `${resume.name} - Tailored${jobTitle ? ' for ' + jobTitle : ''}`,
      isDefault: false,
      parsedData: {
        ...resume.parsedData,
        summary: result.tailoredSummary,
        skills: result.tailoredSkills
      },
      tailoredFor: jobTitle || company || '',
      matchScore: result.matchScore
    });
    await tailoredResume.save();
    
    // Increment usage
    const user = await User.findById(req.userId);
    if (user) {
      user.tailoredResumesUsed += 1;
      await user.save();
    }
    
    res.json({ ...result, tailoredResumeId: tailoredResume._id, message: 'Resume tailored successfully' });
  } catch (err) {
    console.error('Tailor error:', err);
    res.status(500).json({ error: 'Tailoring failed: ' + err.message });
  }
});

// ============ JOB ROUTES ============
app.get('/api/jobs', auth, async (req, res) => {
  try {
    await connectDB();
    const { status } = req.query;
    const query = { userId: req.userId };
    if (status && status !== 'All') {
      query.status = status;
    }
    const jobs = await Job.find(query).sort({ appliedDate: -1 });
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/jobs/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const job = await Job.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

app.post('/api/jobs', auth, async (req, res) => {
  try {
    await connectDB();
    const { title, company, location, portal, status, jobDescription, jobUrl, salary, notes, skills, softSkills } = req.body;
    
    if (!title) return res.status(400).json({ error: 'Job title is required' });
    
    // Auto-extract skills from job description
    let extractedSkills = skills || [];
    let extractedSoftSkills = softSkills || [];
    
    if (jobDescription && (!extractedSkills.length || !extractedSoftSkills.length)) {
      const keywords = extractKeywords(jobDescription);
      const categorized = categorizeKeywords(keywords);
      if (!extractedSkills.length) extractedSkills = categorized.technical;
      if (!extractedSoftSkills.length) extractedSoftSkills = categorized.soft;
    }
    
    const job = new Job({
      userId: req.userId,
      title,
      company: company || '',
      location: location || '',
      portal: portal || 'Direct',
      status: status || 'Applied',
      jobDescription: jobDescription || '',
      jobUrl: jobUrl || '',
      salary: salary || '',
      notes: notes || '',
      skills: extractedSkills,
      softSkills: extractedSoftSkills
    });
    await job.save();
    
    // Increment usage
    const user = await User.findById(req.userId);
    if (user) {
      user.jobExtractionsUsed += 1;
      await user.save();
    }
    
    res.json({ job, message: 'Job added successfully' });
  } catch (err) {
    console.error('Job create error:', err);
    res.status(500).json({ error: 'Failed to add job' });
  }
});

app.put('/api/jobs/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const job = await Job.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== 'userId') {
        job[key] = req.body[key];
      }
    });
    await job.save();
    res.json({ job, message: 'Job updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/jobs/:id', auth, async (req, res) => {
  try {
    await connectDB();
    const result = await Job.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ============ DASHBOARD ROUTES ============
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    await connectDB();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const [allTime, monthly, weekly] = await Promise.all([
      Job.countDocuments({ userId: req.userId }),
      Job.countDocuments({ userId: req.userId, appliedDate: { $gte: thirtyDaysAgo } }),
      Job.countDocuments({ userId: req.userId, appliedDate: { $gte: sevenDaysAgo } })
    ]);
    
    // Status distribution
    const statusDist = await Job.aggregate([
      { $match: { userId: req.userId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const statusCounts = {
      Applied: 0, Interviewing: 0, Offers: 0, Rejected: 0, Archived: 0, Favorites: 0
    };
    statusDist.forEach(s => { statusCounts[s._id] = s.count; });
    
    // Portal distribution
    const portalDist = await Job.aggregate([
      { $match: { userId: req.userId } },
      { $group: { _id: '$portal', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Application trends (last 6 months)
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const trends = await Job.aggregate([
      { $match: { userId: req.userId, appliedDate: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$appliedDate' },
            month: { $month: '$appliedDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const found = trends.find(t => t._id.year === d.getFullYear() && t._id.month === d.getMonth() + 1);
      trendData.push({
        label: monthNames[d.getMonth()],
        count: found ? found.count : 0
      });
    }
    
    // Recent applications
    const recent = await Job.find({ userId: req.userId })
      .sort({ appliedDate: -1 })
      .limit(5);
    
    // User plan info
    const user = await User.findById(req.userId).select('-password');
    
    res.json({
      stats: { allTime, monthly, weekly },
      statusCounts,
      portalDistribution: portalDist,
      trends: trendData,
      recentApplications: recent,
      plan: {
        name: user.plan,
        jobExtractions: { used: user.jobExtractionsUsed, limit: user.jobExtractionsLimit },
        tailoredResumes: { used: user.tailoredResumesUsed, limit: user.tailoredResumesLimit }
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ============ DEMO DATA SEEDING ============
async function seedDemoData(userId) {
  try {
    // Create sample resume
    const resume = new Resume({
      userId,
      name: 'Software Engineer',
      isDefault: true,
      parsedData: {
        name: 'Demo User',
        email: 'demo@skvk.com',
        phone: '+1234567890',
        location: 'San Francisco, CA',
        summary: 'Experienced software engineer with 5+ years of expertise in full-stack development, specializing in React, Node.js, and cloud technologies. Proven track record of building scalable applications and leading cross-functional teams.',
        skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Express', 'Python', 'SQL', 'MongoDB', 'PostgreSQL', 'AWS', 'Docker', 'Git', 'REST API', 'GraphQL', 'Jest'],
        experience: [
          'Senior Software Engineer | TechCorp | 2022 - Present',
          'Led development of microservices architecture serving 1M+ users daily',
          'Full Stack Developer | StartupXYZ | 2020 - 2022',
          'Built React-based dashboard improving user engagement by 40%'
        ],
        education: [
          'B.S. Computer Science | University of Technology | 2016 - 2020'
        ],
        projects: [
          'E-commerce Platform - Full-stack MERN application with Stripe integration',
          'AI Chatbot - NLP-based customer service bot using Python and TensorFlow'
        ],
        certifications: ['AWS Certified Solutions Architect', 'MongoDB Certified Developer']
      }
    });
    await resume.save();
    
    // Create sample jobs
    const portals = ['LinkedIn', 'Indeed', 'Glassdoor', 'Company Website', 'AngelList'];
    const companies = ['Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Netflix', 'Stripe', 'Airbnb', 'Uber', 'Tesla', 'Kikoff', 'Datadog', 'Snowflake', 'Databricks'];
    const titles = [
      'Software Engineer', 'Senior Software Engineer', 'Full Stack Developer', 'Frontend Engineer',
      'Backend Engineer', 'Data Scientist', 'DevOps Engineer', 'Product Engineer', 'Enterprise Data Scientist'
    ];
    const locations = ['San Francisco, CA', 'New York, NY', 'Seattle, WA', 'Remote', 'Austin, TX', 'Boston, MA'];
    const statuses = ['Applied', 'Applied', 'Applied', 'Applied', 'Applied', 'Interviewing', 'Interviewing', 'Offers', 'Rejected', 'Archived'];
    
    const skillsPool = ['JavaScript', 'React', 'Node.js', 'Python', 'SQL', 'AWS', 'Docker', 'TypeScript', 'GraphQL', 'MongoDB', 'PostgreSQL', 'Kubernetes', 'CI/CD', 'Machine Learning', 'Statistical Analysis', 'Data Visualization'];
    const softSkillsPool = ['Collaboration', 'Communication', 'Problem Solving', 'Leadership', 'Adaptability', 'Critical Thinking', 'Time Management', 'Teamwork'];
    
    const numJobs = 15;
    for (let i = 0; i < numJobs; i++) {
      const daysAgo = Math.floor(Math.random() * 170) + 1;
      const appliedDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      
      const numSkills = Math.floor(Math.random() * 6) + 3;
      const jobSkills = [...skillsPool].sort(() => Math.random() - 0.5).slice(0, numSkills);
      const jobSoftSkills = [...softSkillsPool].sort(() => Math.random() - 0.5).slice(0, 3);
      
      const job = new Job({
        userId,
        title: titles[Math.floor(Math.random() * titles.length)],
        company: companies[Math.floor(Math.random() * companies.length)],
        location: locations[Math.floor(Math.random() * locations.length)],
        portal: portals[Math.floor(Math.random() * portals.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
        appliedDate,
        skills: jobSkills,
        softSkills: jobSoftSkills,
        jobDescription: `We are looking for a talented engineer to join our team. Required skills include ${jobSkills.join(', ')}. The ideal candidate should have strong ${jobSoftSkills.join(', ')} skills.`,
        salary: `$${Math.floor(Math.random() * 80 + 80)}k - $${Math.floor(Math.random() * 80 + 120)}k`,
        notes: ''
      });
      await job.save();
    }
  } catch (err) {
    console.error('Seed error:', err);
  }
}

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;