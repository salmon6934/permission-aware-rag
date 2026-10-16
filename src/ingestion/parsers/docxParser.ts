import mammoth from 'mammoth';
import { sanitizeText } from './sanitizer.js';

export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const sanitized = sanitizeText(result.value);

    if (!sanitized) {
      throw new Error('DOCX document is empty or contains no extractable text');
    }

    return sanitized;
  } catch (err) {
    if (err instanceof Error && err.message.includes('empty')) {
      throw err;
    }
    throw new Error(`Failed to parse DOCX file: ${err instanceof Error ? err.message : String(err)}`);
  }
}
