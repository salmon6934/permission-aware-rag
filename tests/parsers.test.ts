import { describe, it, expect } from 'vitest';
import { sanitizeText } from '../src/ingestion/parsers/sanitizer.js';
import { parsePlainText } from '../src/ingestion/parsers/textParser.js';
import { parseDocument } from '../src/ingestion/parsers/index.js';

describe('Day 3: Format Parsers & Sanitization Unit Tests', () => {
  describe('sanitizeText', () => {
    it('strips null bytes', () => {
      const input = 'Hello\u0000World\u0000!';
      expect(sanitizeText(input)).toBe('HelloWorld!');
    });

    it('normalizes CRLF to LF and trims excess newlines', () => {
      const input = 'Line 1\r\n\r\n\r\n\r\nLine 2\r\n';
      expect(sanitizeText(input)).toBe('Line 1\n\nLine 2');
    });

    it('collapses multiple horizontal spaces and tabs', () => {
      const input = 'This   has \t multiple   spaces.';
      expect(sanitizeText(input)).toBe('This has multiple spaces.');
    });

    it('handles empty or blank strings', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText('   \n\r\n  ')).toBe('');
    });
  });

  describe('parsePlainText', () => {
    it('parses valid UTF-8 plain text', async () => {
      const buf = Buffer.from('Antigravity Multi-Tenant RAG system architecture.\nParagraph two.');
      const res = await parsePlainText(buf);
      expect(res).toBe('Antigravity Multi-Tenant RAG system architecture.\nParagraph two.');
    });

    it('parses markdown retaining headings and structure', async () => {
      const buf = Buffer.from('# Strategic Roadmap\n\n- Task 1\n- Task 2');
      const res = await parsePlainText(buf);
      expect(res).toBe('# Strategic Roadmap\n\n- Task 1\n- Task 2');
    });

    it('fails closed when plain text is empty or only whitespace', async () => {
      const emptyBuf = Buffer.from('   \n\n  \t  ');
      await expect(parsePlainText(emptyBuf)).rejects.toThrow('Document is empty or contains no extractable text');
    });
  });

  describe('parseDocument dispatcher', () => {
    it('routes text/plain and text/markdown correctly', async () => {
      const buf = Buffer.from('Document content');
      const res = await parseDocument(buf, 'text/plain');
      expect(res).toBe('Document content');

      const mdRes = await parseDocument(buf, 'text/markdown', 'readme.md');
      expect(mdRes).toBe('Document content');
    });

    it('rejects unsupported MIME types with descriptive error', async () => {
      const buf = Buffer.from('image bytes');
      await expect(parseDocument(buf, 'image/png', 'photo.png')).rejects.toThrow('Unsupported file type');
    });
  });
});
