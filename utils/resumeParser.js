const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extracts raw text from a PDF or DOCX file buffer.
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - File mime type
 * @returns {Promise<string>} Extracted text
 */
async function parseResumeToText(buffer, mimeType) {
    try {
        if (mimeType === 'application/pdf') {
            const data = await pdfParse(buffer);
            return data.text;
        } else if (
            mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
            mimeType === 'application/msword'
        ) {
            const data = await mammoth.extractRawText({ buffer: buffer });
            return data.value;
        } else {
            throw new Error('Unsupported file format. Please upload a PDF or DOCX file.');
        }
    } catch (error) {
        console.error('Error in parseResumeToText:', error);
        throw error;
    }
}

module.exports = { parseResumeToText };
