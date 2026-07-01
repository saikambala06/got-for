// utils/resumeParser.js (enhanced)
const { parseResumeText: ruleBasedParse, normalizeDocxText } = require('./resumeParserOld'); // keep old as base

async function parseResumeWithAI(text, fileType) {
  if (!process.env.XAI_API_KEY) return ruleBasedParse(text);

  try {
    // Grok for smarter extraction
    const prompt = `Extract structured resume data from this text. Return clean JSON with: personal, summary, experience (array), education, skills, etc.`;
    // ... Grok call ...
    const aiParsed = /* Grok result */;
    return { ...ruleBasedParse(text), ...aiParsed }; // merge
  } catch (e) {
    return ruleBasedParse(text);
  }
}

// Export enhanced version
module.exports = { parseResumeText: parseResumeWithAI, normalizeDocxText };
