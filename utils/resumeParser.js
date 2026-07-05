// got-for-main/utils/aiResumeParser.js

// Ensure you have your AI provider's SDK installed (e.g., OpenAI, Gemini, etc.)
// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const parseResumeWithAI = async (resumeText) => {
  const systemPrompt = `You are a strict, highly accurate resume data extraction API. Your ONLY job is to extract information from the provided resume text and map it perfectly to the JSON schema below.

  CRITICAL INSTRUCTIONS FOR ACCURACY:
  1. Output ONLY valid JSON. No markdown formatting, no conversational text.
  2. WORK EXPERIENCE BULLETS: This is critical. You MUST break down the job description/responsibilities into an array of individual strings inside the "bullets" array. Do NOT output a single massive paragraph.
  3. DATES: Format all dates exactly as "MMM YYYY" (e.g., "Dec 2019", "Feb 2018"). 
  4. CURRENT JOBS: If a job indicates "Present", "Current", or has no end date but implies current employment, set "endDate": "Present" and "isCurrent": true.
  5. SKILLS: Extract technical and soft skills into an array of individual strings (e.g., ["Azure DevOps", "Terraform", "Docker"]).
  6. MISSING DATA: If the resume does not contain information for a specific field, return an empty string "" for text fields, or an empty array [] for lists. Do not invent data.

  EXPECTED JSON SCHEMA:
  {
    "personalInformation": {
      "name": "",
      "email": "",
      "phone": "",
      "location": "",
      "linkedinUrl": "",
      "portfolioUrl": ""
    },
    "summary": "",
    "workExperience": [
      {
        "jobTitle": "",
        "companyName": "",
        "location": "",
        "startDate": "",
        "endDate": "",
        "isCurrent": false,
        "bullets": [
          "string (extracted bullet point 1)",
          "string (extracted bullet point 2)"
        ]
      }
    ],
    "education": [
      {
        "school": "",
        "degree": "",
        "fieldOfStudy": "",
        "location": "",
        "startDate": "",
        "endDate": "",
        "isCurrent": false,
        "description": ""
      }
    ],
    "skills": ["string", "string"],
    "projects": [
       {
         "name": "",
         "description": ""
       }
    ],
    "additionalInformation": {
      "certifications": [
        {
          "name": "",
          "issuer": "",
          "date": ""
        }
      ],
      "achievements": [],
      "languages": [],
      "publications": []
    }
  }`;

  try {
    // Example using OpenAI API format. Adjust accordingly if using Gemini or another provider.
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo", // Highly recommended for accurate JSON structuring
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract the data from the following resume text:\n\n${resumeText}` }
      ],
      temperature: 0.0, // Set to 0 for maximum factual accuracy and consistency
    });

    const parsedContent = response.choices[0].message.content;
    const parsedData = JSON.parse(parsedContent);
    
    return parsedData;
  } catch (error) {
    console.error("AI Parsing Error:", error);
    throw new Error("Failed to parse resume data accurately. Please check the API configuration.");
  }
};

module.exports = { parseResumeWithAI };
