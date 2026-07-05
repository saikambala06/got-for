const { GoogleGenAI } = require('@google/genai'); // Or your chosen LLM SDK

// Initialize your AI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Parses raw resume text into the exact structured JSON schema required by the UI.
 * @param {string} resumeText - Extracted text from the document
 * @returns {Promise<object>} Structured resume object
 */
async function parseResumeWithAI(resumeText) {
    const prompt = `
    You are an expert resume parsing engine. Analyze the following raw resume text and extract the data into an accurate JSON object matching the schema rules below.
    
    STRICT SCHEMA RULES:
    1. Do not invent or hallucinate data. If a field is missing, leave it as an empty string "" or an empty array [].
    2. Ensure text structures match standard titles.
    3. Output MUST be valid raw JSON only. Do not wrap it in markdown code blocks like \`\`\`json.

    SCHEMA STRUCTURE:
    {
        "personalInfo": {
            "name": "Full Name",
            "email": "Email Address",
            "phone": "Phone Number",
            "location": "City, State or Location",
            "linkedInUrl": "LinkedIn profile link",
            "portfolioUrl": "Website or Portfolio link"
        },
        "summary": "Professional summary paragraph",
        "workExperience": [
            {
                "jobTitle": "Exact role title",
                "companyName": "Company name",
                "location": "Job location",
                "startDate": "Start Date (e.g., Dec 2019)",
                "endDate": "End Date or 'Present'",
                "current": true/false,
                "bulletPoints": ["Responsibility 1", "Responsibility 2"]
            }
        ],
        "education": [
            {
                "school": "School/University name",
                "degree": "Degree name",
                "fieldOfStudy": "Field of study",
                "location": "School location",
                "startDate": "Start Date",
                "endDate": "End Date",
                "current": true/false,
                "description": "Optional description text"
            }
        ],
        "skills": ["Skill 1", "Skill 2", "Skill 3"],
        "projects": [
            {
                "name": "Project Name",
                "description": "Project Description",
                "technologies": ["Tech 1"],
                "url": "Project Link"
            }
        ],
        "certifications": [
            {
                "name": "Certification Name",
                "issuer": "Issuing organization",
                "date": "Date issued"
            }
        ],
        "achievements": [],
        "languages": [],
        "publications": []
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Using a reliable parsing model
            contents: [
                { role: 'user', parts: [{ text: `${prompt}\n\nResume Text:\n${resumeText}` }] }
            ],
            config: {
                // Forces model to return strict valid JSON strings matching schema constraints
                responseMimeType: 'application/json' 
            }
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText);
    } catch (error) {
        console.error('Error in parseResumeWithAI:', error);
        throw new Error('Failed to parse resume structure accurately.');
    }
}

module.exports = { parseResumeWithAI };
