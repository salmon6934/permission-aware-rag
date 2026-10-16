export interface ChunkOptions {
  /** Target maximum character length per chunk (default: 1800 chars ~ 450-500 tokens) */
  chunkSize?: number;
  /** Overlap character length between consecutive chunks (default: 180 chars ~ 45-50 tokens) */
  overlap?: number;
}

export interface TextChunk {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
}

const DEFAULT_CHUNK_SIZE = 1800; // ~450-500 tokens
const DEFAULT_OVERLAP = 180;     // ~45-50 tokens

/**
 * Splits text into overlapping semantic chunks preserving paragraph and sentence boundaries.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(chunkSize / 2));

  if (trimmed.length <= chunkSize) {
    return [
      {
        index: 0,
        text: trimmed,
        charStart: 0,
        charEnd: trimmed.length,
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let currentStart = 0;

  while (currentStart < trimmed.length) {
    const targetEnd = currentStart + chunkSize;

    if (targetEnd >= trimmed.length) {
      // Reached the end of the text
      const chunkContent = trimmed.slice(currentStart).trim();
      if (chunkContent.length > 0) {
        chunks.push({
          index: chunks.length,
          text: chunkContent,
          charStart: currentStart,
          charEnd: trimmed.length,
        });
      }
      break;
    }

    // Try to find a natural break near targetEnd
    // 1. Look for paragraph break (\n\n) within [targetEnd - 30%, targetEnd]
    const searchWindowStart = Math.max(currentStart + overlap, targetEnd - Math.floor(chunkSize * 0.3));
    const searchSlice = trimmed.slice(searchWindowStart, targetEnd + 100);

    let breakOffset = -1;

    // Search for paragraph break (\n\n)
    const paraIdx = searchSlice.lastIndexOf('\n\n');
    if (paraIdx !== -1) {
      breakOffset = searchWindowStart + paraIdx + 2;
    } else {
      // Search for sentence break (. , ? , ! , \n)
      const sentenceRegex = /([.?!]\s+|\n)/g;
      let match: RegExpExecArray | null;
      let lastMatchIdx = -1;
      let lastMatchLen = 0;

      while ((match = sentenceRegex.exec(searchSlice)) !== null) {
        if (searchWindowStart + match.index <= targetEnd + 50) {
          lastMatchIdx = match.index;
          lastMatchLen = match[0].length;
        }
      }

      if (lastMatchIdx !== -1) {
        breakOffset = searchWindowStart + lastMatchIdx + lastMatchLen;
      } else {
        // Fallback to space
        const spaceIdx = searchSlice.lastIndexOf(' ');
        if (spaceIdx !== -1) {
          breakOffset = searchWindowStart + spaceIdx + 1;
        }
      }
    }

    // If no boundary found, hard break at targetEnd
    const finalEnd = breakOffset > currentStart ? Math.min(breakOffset, trimmed.length) : targetEnd;
    const chunkContent = trimmed.slice(currentStart, finalEnd).trim();

    if (chunkContent.length > 0) {
      chunks.push({
        index: chunks.length,
        text: chunkContent,
        charStart: currentStart,
        charEnd: finalEnd,
      });
    }

    // Advance start position with overlap
    currentStart = Math.max(currentStart + 1, finalEnd - overlap);
  }

  return chunks;
}
