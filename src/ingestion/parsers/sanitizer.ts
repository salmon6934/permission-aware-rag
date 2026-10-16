/**
 * Normalizes extracted text:
 * 1. Strips null bytes (\u0000).
 * 2. Normalizes CRLF / CR line endings to LF (\n).
 * 3. Collapses horizontal whitespace (spaces/tabs).
 * 4. Limits excessive vertical whitespace to maximum 2 consecutive newlines.
 * 5. Trims leading and trailing whitespace.
 */
export function sanitizeText(rawText: string): string {
  if (!rawText) return '';

  let text = rawText.replace(/\0/g, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
