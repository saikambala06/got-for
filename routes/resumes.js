const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const Resume = require('../models/Resume');
const User = require('../models/User');
const { parsePDF, parseResumeText, tailorResume } = require('../utils/resumeParser');

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'));
    }
  }
});

// Get all resumes
router.get('/', auth, async (req, res) => {
  try {
    const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(resumes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single resume
router.get('/:id', auth, async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload and parse resume
router.post('/upload', auth, upload.single('resume'), async (req, res) => {
  try {
    const { resumeName } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check plan limits
    const user = await User.findById(req.userId);
    if (user.planLimits.jobExtractionsUsed >= user.planLimits.jobExtractions) {
      return res.status(403).json({ error: 'Job extraction limit reached. Please upgrade your plan.' });
    }

    let parsedData;
    const fileType = req.file.mimetype === 'application/pdf' ? 'pdf' : 'docx';

    if (fileType === 'pdf') {
      parsedData = await parsePDF(req.file.buffer);
    } else {
      // For DOCX, extract text using mammoth
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      parsedData = parseResumeText(result.value);
    }

    const resume = new Resume({
      userId: req.userId,
      name: resumeName || req.file.originalname,
      originalFileName: req.file.originalname,
      fileType,
      fileData: req.file.buffer.toString('base64'),
      parsedData,
      status: 'complete'
    });

    await resume.save();

    // Update usage
    await User.findByIdAndUpdate(req.userId, {
      $inc: { 'planLimits.jobExtractionsUsed': 1 }
    });

    res.status(201).json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create resume manually
router.post('/manual', auth, async (req, res) => {
  try {
    const { name, parsedData } = req.body;

    const resume = new Resume({
      userId: req.userId,
      name,
      fileType: 'manual',
      parsedData,
      status: 'complete'
    });

    await resume.save();
    res.status(201).json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update resume
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, parsedData, status } = req.body;
    const resume = await Resume.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { name, parsedData, status, updatedAt: Date.now() },
      { new: true }
    );

    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    res.json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tailor resume for a job
router.post('/:id/tailor', auth, async (req, res) => {
  try {
    const { jobTitle, jobDescription } = req.body;

    // Check plan limits
    const user = await User.findById(req.userId);
    if (user.planLimits.tailoredResumesUsed >= user.planLimits.tailoredResumes) {
      return res.status(403).json({ error: 'Tailored resume limit reached. Please upgrade your plan.' });
    }

    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    const tailoredContent = tailorResume(resume.parsedData, jobDescription);

    // Create a new tailored resume
    const tailoredResume = new Resume({
      userId: req.userId,
      name: `${resume.name} - Tailored for ${jobTitle}`,
      fileType: 'manual',
      parsedData: tailoredContent,
      isTailored: true,
      parentResumeId: resume._id,
      status: 'tailored'
    });

    await tailoredResume.save();

    // Update the original resume with tailored version reference
    resume.tailoredVersions.push({
      jobTitle,
      jobDescription,
      tailoredContent,
      createdAt: Date.now()
    });
    await resume.save();

    // Update usage
    await User.findByIdAndUpdate(req.userId, {
      $inc: { 'planLimits.tailoredResumesUsed': 1 }
    });

    res.status(201).json(tailoredResume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete resume
router.delete('/:id', auth, async (req, res) => {
  try {
    const resume = await Resume.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json({ message: 'Resume deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
