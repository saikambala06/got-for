const puppeteer = require('puppeteer');

/**
 * Generates an optimized, clean single or multi-page A4 PDF from customized HTML content.
 */
async function generateResumePDF(htmlContent) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport to standard desktop resolution for sizing accuracy
    await page.setViewport({ width: 1200, height: 800 });
    
    // Inject custom print-specific styles to ensure strict A4 layouts and eliminate margins
    const printableHtml = `
      <html>
        <head>
          <style>
            @page {
              size: A4;
              margin: 15mm 15mm 15mm 15mm;
            }
            body {
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
              color: #333333;
              line-height: 1.5;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .strike-through { text-decoration: line-through; color: #a0a0a0; }
            .highlight-addition { background-color: #e6f4ea; color: #137333; padding: 2px 4px; border-radius: 4px; }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    await page.setContent(printableHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    });

    await browser.close();
    return pdfBuffer;
  } catch (error) {
    if (browser) await browser.close();
    console.error("Puppeteer PDF Compilation Error:", error);
    throw error;
  }
}

module.exports = { generateResumePDF };
