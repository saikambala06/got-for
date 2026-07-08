const express = require('express');
const router = express.Router();
const Resume = require('../models/Resume');[cite: 1]
const Job = require('../models/Job');[cite: 1]
const auth = require('../middleware/auth');[cite: 1]
const { tailorResume } = require('../utils/aiTailor');
const { generateResumePDF } = require('../utils/pdfGenerator');

/**
 * @route   POST /api/resumes/tailor
 * @desc    Process a resume against a targeted job description to calculate variations
 */
router.post('/tailor', auth, async (req, res) => {
  try {
    const { resumeId, jobId, tailoringLevel } = req.body;

    if (!resumeId || !jobId) {
      return res.status(400).json({ error: "Missing required resumeId or jobId parameter." });
    }

    const baseResume = await Resume.findOne({ _id: resumeId, userId: req.user.id });[cite: 1]
    const targetJob = await Job.findById(jobId);[cite: 1]

    if (!baseResume) return res.status(404).json({ error: "Base resume could not be located." });
    if (!targetJob) return res.status(404).json({ error: "Target job context could not be located." });

    // Execute the AI tailoring processing model
    const diffMap = await tailorResume(baseResume, targetJob.description, tailoringLevel || 'Medium');

    return res.json({
      success: true,
      jobTitle: targetJob.title,
      company: targetJob.company,
      diff: diffMap
    });
  } catch (error) {
    console.error("Tailoring Route Failure:", error);
    return res.status(500).json({ error: "Internal processing error during AI tailoring generation." });
  }
});

/**
 * @route   POST /api/resumes/download-pdf
 * @desc    Compile finalized client data into a rendered styling template and stream the raw PDF
 */
router.post('/download-pdf', auth, async (req, res) => {
  try {
    const { resumeData, customOptions } = req.body;

    if (!resumeData) {
      return res.status(400).json({ error: "Missing compiled structural resume payload." });
    }

    const accentColor = customOptions?.accentColor || '#000000';
    const fontName = customOptions?.fontName || 'Arial';

    // Construct print layout based on chosen template parameters dynamically
    let htmlLayout = `
      <div style="font-family: '${fontName}', sans-serif;">
        <div style="text-align: center; border-bottom: 2px solid ${accentColor}; padding-bottom: 12px; margin-bottom: 20px;">
          <h1 style="margin: 0 0 5px 0; color: #111; font-size: 28px;">${resumeData.name || 'Applicant'}</h1>
          <p style="margin: 0; color: #555; font-size: 14px;">
            ${resumeData.email || ''} | ${resumeData.phone || ''} | ${resumeData.location || ''}
          </p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <h2 style="color: ${accentColor}; font-size: 16px; text-transform: uppercase; margin-bottom: 8px;">Professional Summary</h2>
          <p style="margin: 0; font-size: 13px; text-align: justify;">${resumeData.summary || ''}</p>
        </div>

        <div style="margin-bottom: 20px;">
          <h2 style="color: ${accentColor}; font-size: 16px; text-transform: uppercase; margin-bottom: 8px;">Core Competencies</h2>
          <p style="margin: 0; font-size: 13px;">${Array.isArray(resumeData.skills) ? resumeData.skills.join(' • ') : ''}</p>
        </div>

        <div>
          <h2 style="color: ${accentColor}; font-size: 16px; text-transform: uppercase; margin-bottom: 8px;">Professional Experience</h2>
    `;

    if (resumeData.experience && Array.isArray(resumeData.experience)) {
      resumeData.experience.forEach(exp => {
        htmlLayout += `
          <div style="margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px;">
              <span>${exp.role} — ${exp.company}</span>
              <span>${exp.duration || ''}</span>
            </div>
            <ul style="margin: 5px 0 0 0; padding-left: 20px; font-size: 13px;">
        `;
        if (exp.bullets && Array.isArray(exp.bullets)) {
          exp.bullets.forEach(bullet => {
            htmlLayout += `<li style="margin-bottom: 4px; text-align: justify;">${bullet}</li>`;
          });
        }
        htmlLayout += `</ul></div>`;
      });
    }

    htmlLayout += `</div></div>`;

    // Process structured document composition markup into buffer streams
    const pdfBuffer = await generateResumePDF(htmlLayout);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Tailored_Resume_${Date.now()}.pdf"`,
      'Content-Length': pdfBuffer.length
    });

    return res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF Compilation Endpoint Failure:", error);
    return res.status(500).json({ error: "Failed to output printable binary document asset streams." });
  }
});

module.exports = router;
