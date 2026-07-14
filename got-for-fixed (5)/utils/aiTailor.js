const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Tailors base resume content to a specific job description.
 * Returns a strict structured diff map for the UI.
 */
async function tailorResume(baseResume, jobDescription, tailoringLevel = 'Medium') {
  const prompt = `
    You are an elite technical recruiter and resume optimization engine. 
    Your task is to tailor the provided resume data to perfectly align with the target job description.
    
    Tailoring Level Intensity: ${tailoringLevel}
    - Low: Adjust keywords and core skill terms only.
    - Medium: Rewrite bullet points for maximum impact and re-order skills based on job priorities.
    - High: Perform deep contextual updates across the summary, rewrite bullet points with clear metric placeholders if missing, and aggressively align terminology.

    You must output ONLY a valid JSON object matching the following structural schema exactly. Do not include markdown formatting or wrapper blocks around the JSON object.

    Schema:
    {
      "summary": {
        "original": "The original summary string",
        "suggested": "The optimized summary string aligned to the job description"
      },
      "skills": {
        "added": ["Skill Name 1", "Skill Name 2"],
        "removed": ["Irrelevant Skill 1"]
      },
      "experience": [
        {
          "company": "Company Name",
          "role": "Role Title",
          "bullets": [
            {
              "original": "Original bullet point string",
              "suggested": "Optimized bullet point string incorporating metrics and keywords",
              "status": "changed" 
            }
          ]
        }
      ],
      "estimatedMatchScore": 95
    }

    Base Resume Data:
    ${JSON.stringify(baseResume, null, 2)}

    Target Job Description:
    ${jobDescription}
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are a professional resume optimization assistant that outputs strictly valid JSON matching requested schemas.' 
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("AI Tailoring Engine Failure:", error);
    throw new Error("Failed to parse and tailor resume using AI context.");
  }
}

module.exports = { tailorResume };
