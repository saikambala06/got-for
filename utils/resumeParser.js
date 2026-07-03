const { OpenAI } = require('openai');

// Initialize OpenAI SDK tailored to use xAI's endpoint
const xaiClient = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.xai.ai/v1", 
});

/**
 * Optimizes and fits resume data to accurately match a target job description.
 * @param {string} originalResumeText - Raw extracted resume text
 * @param {string} jobDescription - Target job requirements
 * @returns {Promise<object>} - Tailored resume structure in JSON
 */
async function tailorResumeWithXAI(originalResumeText, jobDescription) {
  try {
    const response = await xaiClient.chat.completions.create({
      model: "grok-beta", 
      messages: [
        {
          role: "system",
          content: `You are an elite, precision-oriented resume parser and ATS optimization engine. 
          Your explicit goal is to adjust, align, and organize the user's raw resume data to fit perfectly into the provided target job description. 
          Highlight relevant skills, reword experience highlights using high-impact metrics and action verbs that map to the target role, and extract structured profile information.
          Return ONLY a valid JSON object matching the requested schema. Do not include markdown code block syntax (\`\`\`json) or conversational explanations.`
        },
        {
          role: "user",
          content: `
            TARGET JOB DESCRIPTION:
            ${jobDescription}

            ORIGINAL RESUME TEXT:
            ${originalResumeText}

            Please output a perfectly formatted JSON database object matching this schema:
            {
              "fullName": "Extracted Name",
              "professionalSummary": "A highly tailored, compelling 3-4 sentence summary aligning experience to the job description.",
              "matchedSkills": ["Skill 1", "Skill 2", "Skill 3"],
              "tailoredExperience": [
                {
                  "role": "Job Title",
                  "company": "Company Name",
                  "duration": "Dates",
                  "optimizedAccomplishments": [
                    "Tailored metric-driven achievement aligning with the target job requirements",
                    "Another relevant capability proof point"
                  ]
                }
              ]
            }
          `
        }
      ],
      temperature: 0.2, // Kept low to enforce data accuracy and prevent AI hallucination
    });

    const cleanContent = response.choices[0].message.content.trim();
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error("xAI Integration Error:", error);
    throw new Error("Failed to map resume data using xAI Grok Engine.");
  }
}

module.exports = { tailorResumeWithXAI };
