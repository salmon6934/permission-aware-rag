import { PDFParse } from 'pdf-parse';
import { sanitizeText } from './sanitizer.js';

export async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const sanitized = sanitizeText(result.text);

    if (!sanitized) {
      throw new Error('PDF document is empty or contains no extractable text');
    }

    return sanitized;
  } catch (err) {
    if (err instanceof Error && err.message.includes('empty')) {
      throw err;
    }
    throw new Error(`Failed to parse PDF file: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      await parser.destroy();
    } catch {
      // Ignore parser destroy cleanup errors
    }
  }
}
