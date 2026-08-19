/**
 * Compatibility wrapper for legacy callers.
 * All AI work in this project is routed through the single Groq implementation.
 */
const { tailorResumeWithAI } = require('./aiResumeParser');

async function tailorResume(baseResume, jobDescription, tailoringLevel = 'medium') {
  return tailorResumeWithAI(baseResume, '', jobDescription, [], String(tailoringLevel).toLowerCase());
}

module.exports = { tailorResume };
