// got-for-main/routes/resumes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { extractTextFromFile } = require('../utils/resumeParser');
const { parseResumeWithAI } = require('../utils/aiResumeParser');
const Resume = require('../models/Resume'); 
const auth = require('../middleware/auth'); 

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.post('/upload', auth, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded. Please select a resume.' });
    }

    // Pass the buffer, mimetype, AND the original filename for extension checking
    const rawText = await extractTextFromFile(
      req.file.buffer, 
      req.file.mimetype, 
      req.file.originalname
    );

    // Pass the extracted text to the strict AI parser
    const structuredResumeData = await parseResumeWithAI(rawText);

    res.json({
      success: true,
      data: structuredResumeData
    });

  } catch (err) {
    console.error("Resume Upload Route Error:", err.message);
    // Send the specific error message generated in the parser back to the frontend
    res.status(400).json({ msg: err.message || 'Server Error during resume parsing' });
  }
});

module.exports = router;
