#!/usr/bin/env node

/**
 * Generate PDF documentation from Markdown files
 * Creates downloadable PDF versions of README.md and STATION_SETUP.md
 */

const { mdToPdf } = require('md-to-pdf');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'docs');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const documents = [
  {
    input: path.join(outputDir, 'Stratus-User-Guide.md'),
    output: path.join(outputDir, 'Stratus-Complete-User-Guide.pdf'),
    title: 'Stratus Weather Server - Complete User Guide'
  }
];

const pdfOptions = {
  stylesheet: [],
  css: `
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
      max-width: 100%;
    }
    h1 {
      color: #2563eb;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 10px;
      margin-top: 30px;
    }
    h2 {
      color: #1d4ed8;
      border-bottom: 1px solid #ddd;
      padding-bottom: 5px;
      margin-top: 25px;
    }
    h3 {
      color: #1e40af;
      margin-top: 20px;
    }
    code {
      background-color: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 10pt;
    }
    pre {
      background-color: #1f2937;
      color: #e5e7eb;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 9pt;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      color: inherit;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 15px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
    }
    th {
      background-color: #2563eb;
      color: white;
    }
    tr:nth-child(even) {
      background-color: #f9fafb;
    }
    blockquote {
      border-left: 4px solid #2563eb;
      margin: 15px 0;
      padding: 10px 20px;
      background-color: #eff6ff;
      color: #1e40af;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    ul, ol {
      margin: 10px 0;
      padding-left: 25px;
    }
    li {
      margin: 5px 0;
    }
    hr {
      border: none;
      border-top: 2px solid #e5e7eb;
      margin: 30px 0;
    }
    img {
      max-width: 100%;
      height: auto;
    }
  `,
  pdf_options: {
    format: 'A4',
    margin: {
      top: '25mm',
      bottom: '25mm',
      left: '20mm',
      right: '20mm'
    },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-size: 9px; color: #666; width: 100%; text-align: center; padding: 5px 20px;">
        <span style="font-weight: bold;">Stratus Weather Server Documentation</span>
      </div>
    `,
    footerTemplate: `
      <div style="font-size: 9px; color: #666; width: 100%; display: flex; justify-content: space-between; padding: 5px 20px;">
        <span>Generated: ${new Date().toLocaleDateString()}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `
  },
  launch_options: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};

async function generatePDFs() {
  console.log('🚀 Generating PDF documentation...\n');

  for (const doc of documents) {
    try {
      console.log(`📄 Converting: ${path.basename(doc.input)}`);
      
      if (!fs.existsSync(doc.input)) {
        console.error(`   ❌ File not found: ${doc.input}`);
        continue;
      }

      const pdf = await mdToPdf(
        { path: doc.input },
        {
          ...pdfOptions,
          dest: doc.output
        }
      );

      if (pdf) {
        console.log(`   ✅ Created: ${path.basename(doc.output)}`);
        
        // Get file size
        const stats = fs.statSync(doc.output);
        const fileSizeKB = (stats.size / 1024).toFixed(1);
        console.log(`   📦 Size: ${fileSizeKB} KB\n`);
      }
    } catch (error) {
      console.error(`   ❌ Error converting ${doc.input}:`, error.message);
    }
  }

  console.log('✨ PDF generation complete!');
  console.log(`📁 Output directory: ${outputDir}`);
}

generatePDFs().catch(console.error);
