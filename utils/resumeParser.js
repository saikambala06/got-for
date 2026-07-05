// got-for-main/utils/resumeParser.js
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

const extractTextFromFile = async (fileBuffer, mimetype, originalname) => {
  try {
    let extractedText = "";
    // Get the file extension as a fallback in case the mimetype is generic
    const ext = path.extname(originalname).toLowerCase();

    if (mimetype === 'application/pdf' || ext === '.pdf') {
      const pdfData = await pdfParse(fileBuffer);
      extractedText = pdfData.text;
    } 
    else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
      ext === '.docx'
    ) {
      const docData = await mammoth.extractRawText({ buffer: fileBuffer });
      extractedText = docData.value;
    } 
    else if (mimetype === 'application/msword' || ext === '.doc') {
      throw new Error("Older .doc formats are not supported. Please save your resume as a .docx or .pdf and try again.");
    } 
    else {
      throw new Error(`Unsupported file type (${ext}). Please upload a .pdf or .docx file.`);
    }

    // Check if the parser ran, but found no text (e.g., a scanned image PDF)
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("No readable text found. If this is a scanned PDF, please upload a text-based document.");
    }

    // Clean up excessive whitespace
    return extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
    
  } catch (error) {
    console.error("Text Extraction Error:", error.message);
    throw error; // Pass the exact error message up to the route
  }
};

module.exports = { extractTextFromFile };
