import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/ingestion/chunker.js';

describe('Day 3: Text Chunker Unit Tests', () => {
  it('returns an empty array for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\t  ')).toEqual([]);
  });

  it('returns a single chunk when text is shorter than chunkSize', () => {
    const text = 'Short document explaining multi-tenant isolation.';
    const chunks = chunkText(text, { chunkSize: 200, overlap: 20 });

    expect(chunks.length).toBe(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(text.length);
  });

  it('splits long text into multiple sequential chunks with overlap', () => {
    // Generate text of ~1000 characters
    const sentences = [
      'The permission-aware RAG system provides zero-leakage isolation between tenants.',
      'Every vector chunk is stamped with allowed roles and sensitivity clearance.',
      'PostgreSQL evaluates Row Level Security policies on every connection checkout.',
      'Transactions enforce transaction-local tenant context using set_config.',
      'In-process embeddings eliminate external vector database dependencies.',
      'The audit log calculates deterministic SHA-256 hash chains per tenant.',
      'Database triggers block any unauthorized modification or deletion of audit records.',
    ];
    const fullText = sentences.join(' ');

    const chunks = chunkText(fullText, { chunkSize: 250, overlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);

    // Verify ordering and continuity
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].text.length).toBeGreaterThan(0);
      expect(chunks[i].charEnd).toBeGreaterThan(chunks[i].charStart);
    }

    // Verify overlap between chunk 0 and chunk 1
    expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd);
  });

  it('prefers breaking at paragraph boundaries', () => {
    const p1 = 'First paragraph describing the system requirements and setup.';
    const p2 = 'Second paragraph detailing security policies and role enforcement.';
    const p3 = 'Third paragraph outlining audit log hash verification.';
    const fullText = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkText(fullText, { chunkSize: 120, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // At least one chunk should cleanly end with p1 or p2
    expect(chunks[0].text).toContain(p1);
  });

  it('handles very long uninterrupted strings without infinite loops', () => {
    const longToken = 'a'.repeat(800);
    const chunks = chunkText(longToken, { chunkSize: 200, overlap: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.length).toBeLessThanOrEqual(200);
  });
});
