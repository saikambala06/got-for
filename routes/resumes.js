// got-for-main/routes/resumes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { extractTextFromFile } = require('../utils/resumeParser');
const { parseResumeWithAI } = require('../utils/aiResumeParser');
const Resume = require('../models/Resume');[cite: 1]
const auth = require('../middleware/auth');[cite: 1]

// In-memory binary buffer handler configuration with explicitly constrained validation boundaries
const multerInboundHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 7 * 1024 * 1024 } // 7 Megabyte strict threshold ceiling
}).single('resume');

/**
 * @route   POST api/resumes/upload
 * @desc    Intercept multi-part data streams, strip out text strings, parse structures through AI, and emit data.
 * @access  Private
 */
router.post('/upload', auth, (req, res) => {[cite: 1]
  // Execution scope explicitly handles internal multi-part pipeline interrupts to prevent route-killing authorization drop-offs
  multerInboundHandler(req, res, async (multerProcessingError) => {
    if (multerProcessingError instanceof multer.MulterError) {
      return res.status(400).json({ 
        success: false, 
        msg: `Multi-part file transmission boundary error: ${multerProcessingError.message}` 
      });
    } else if (multerProcessingError) {
      return res.status(500).json({ 
        success: false, 
        msg: "An unexpected layout stream error caused the parsing pipeline to fail internally." 
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          msg: "No raw multipart stream detected. Ensure that the source key explicitly matches 'resume'." 
        });
      }

      // Step 1: Perform complete text structure isolation
      const sanitizedDocumentString = await extractTextFromFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );

      // Step 2: Push string vectors into the AI mapping machine
      const accurateFormFieldsJson = await parseResumeWithAI(sanitizedDocumentString);

      // Step 3: Serve the precise fields structure to hydrate frontend state arrays instantly
      return res.status(200).json({
        success: true,
        data: accurateFormFieldsJson
      });

    } catch (pipelineException) {
      console.error("Execution failure logged within document routing loop:", pipelineException.message);
      return res.status(422).json({ 
        success: false, 
        msg: pipelineException.message || "The document data could not be parsed securely." 
      });
    }
  });
});

module.exports = router;
