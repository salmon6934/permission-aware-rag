import { parsePdf } from './pdfParser.js';
import { parseDocx } from './docxParser.js';
import { parsePlainText } from './textParser.js';
import { sanitizeText } from './sanitizer.js';

export { parsePdf, parseDocx, parsePlainText, sanitizeText };

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename?: string
): Promise<string> {
  const normalizedMime = mimeType.toLowerCase();
  const lowerFilename = (filename || '').toLowerCase();

  if (normalizedMime === 'application/pdf' || lowerFilename.endsWith('.pdf')) {
    return parsePdf(buffer);
  }

  if (
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerFilename.endsWith('.docx')
  ) {
    return parseDocx(buffer);
  }

  if (
    normalizedMime === 'text/markdown' ||
    normalizedMime === 'text/plain' ||
    lowerFilename.endsWith('.md') ||
    lowerFilename.endsWith('.txt')
  ) {
    return parsePlainText(buffer);
  }

  throw new Error(`Unsupported file type: MIME '${mimeType}', filename '${filename || 'unknown'}'`);
}
