const express = require('express');
const router = express.Router();
const { tailorResumeWithXAI } = require('../utils/resumeParser');

// API POST Endpoint to process and fit resume text data
router.post('/tailor', async (req, res) => {
  try {
    const { resumeText, jobDescription } = req.body;

    if (!resumeText || !jobDescription) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing fields. Please provide both resumeText and jobDescription." 
      });
    }

    // Call the xAI optimization utility
    const tailoredProfile = await tailorResumeWithXAI(resumeText, jobDescription);

    return res.status(200).json({
      success: true,
      message: "Resume data successfully aligned with target job description.",
      data: tailoredProfile
    });

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
