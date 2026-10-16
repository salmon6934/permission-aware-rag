import { sanitizeText } from './sanitizer.js';

export async function parsePlainText(buffer: Buffer): Promise<string> {
  const rawText = buffer.toString('utf-8');
  const sanitized = sanitizeText(rawText);

  if (!sanitized) {
    throw new Error('Document is empty or contains no extractable text');
  }

  return sanitized;
}
