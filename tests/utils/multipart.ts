/**
 * Helper to build multipart/form-data payload and headers for Fastify injection.
 */
export function buildMultipartPayload(
  fields: Record<string, string>,
  file?: {
    fieldName: string;
    filename: string;
    content: Buffer | string;
    contentType: string;
  }
): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
  const chunks: Buffer[] = [];

  // Append fields
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    );
  }

  // Append file
  if (file) {
    const fileBuffer = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf-8');

    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }

  // Closing boundary
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': body.length.toString(),
    },
  };
}
