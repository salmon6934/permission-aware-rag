import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/authHook.js';
import { requireRole } from '../auth/guards.js';
import { ingestDocument, deleteDocument, updateDocumentAcl } from '../services/ingestionService.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '../ingestion/constants.js';

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // Ingest document (requires 'editor' or 'admin')
  app.post(
    '/documents',
    {
      preHandler: [authenticate, requireRole(['editor', 'admin'])],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // Check if multipart request
      if (!request.isMultipart()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Request must be multipart/form-data',
        });
      }

      let fileData;
      try {
        fileData = await request.file({
          limits: { fileSize: MAX_FILE_SIZE_BYTES },
        });
      } catch (err) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Failed to parse multipart upload',
        });
      }

      if (!fileData) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No file uploaded in multipart request',
        });
      }

      // Whitelist MIME type check
      if (!ALLOWED_MIME_TYPES.includes(fileData.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
        return reply.status(415).send({
          statusCode: 415,
          error: 'Unsupported Media Type',
          message: `MIME type '${fileData.mimetype}' is not supported. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        });
      }

      // Extract form fields safely supporting both single and repeated multipart fields
      const fields = fileData.fields as Record<string, { value?: unknown } | Array<{ value?: unknown }> | undefined>;

      // Parse allowed_roles
      let allowedRoles: string[] = [];
      const rolesField = fields.allowed_roles;

      if (Array.isArray(rolesField)) {
        // Handles repeated form keys: allowed_roles=role1 & allowed_roles=role2
        allowedRoles = rolesField
          .map((f) => (typeof f.value === 'string' ? f.value.trim() : ''))
          .filter(Boolean);
      } else if (rolesField && typeof rolesField.value === 'string') {
        const rolesRaw = rolesField.value.trim();
        try {
          const parsed = JSON.parse(rolesRaw);
          if (Array.isArray(parsed)) {
            allowedRoles = parsed.map(String).map((r) => r.trim()).filter(Boolean);
          } else {
            allowedRoles = rolesRaw.split(',').map((r) => r.trim()).filter(Boolean);
          }
        } catch {
          allowedRoles = rolesRaw.split(',').map((r) => r.trim()).filter(Boolean);
        }
      }

      if (allowedRoles.length === 0 || allowedRoles.some((r) => !r)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'allowed_roles must be provided as a non-empty array of strings',
        });
      }

      // Parse sensitivity
      const sensField = fields.sensitivity;
      const sensitivityRaw = Array.isArray(sensField) ? sensField[0]?.value : sensField?.value;
      const sensitivity = Number(sensitivityRaw);
      if (isNaN(sensitivity) || !Number.isInteger(sensitivity) || sensitivity < 0 || sensitivity > 3) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'sensitivity must be an integer between 0 and 3',
        });
      }

      // Read buffer
      const buffer = await fileData.toBuffer();
      if (fileData.file.truncated) {
        return reply.status(413).send({
          statusCode: 413,
          error: 'Payload Too Large',
          message: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        });
      }

      try {
        const result = await ingestDocument({
          tenantId: principal.tenant_id, // Derived strictly from verified token
          filename: fileData.filename,
          mimeType: fileData.mimetype,
          buffer,
          allowedRoles,
          sensitivity,
        });

        return reply.status(201).send(result);
      } catch (err) {
        request.log.error(err, 'Failed to ingest document');
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Failed to ingest document',
        });
      }
    }
  );

  // Delete document (requires 'admin')
  app.delete<{ Params: { id: string } }>(
    '/documents/:id',
    {
      preHandler: [authenticate, requireRole(['admin'])],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      const uuidCheck = z.string().uuid().safeParse(id);
      if (!uuidCheck.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid document ID format: must be a UUID',
        });
      }

      const result = await deleteDocument(principal.tenant_id, id);
      if (!result.deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Document not found or does not belong to tenant',
        });
      }

      return reply.status(200).send({
        id,
        deleted: true,
        message: 'Document and associated vector chunks deleted successfully',
      });
    }
  );

  // Update document ACL (requires 'admin')
  app.patch<{
    Params: { id: string };
    Body: { allowed_roles?: string[]; sensitivity?: number };
  }>(
    '/documents/:id/acl',
    {
      preHandler: [authenticate, requireRole(['admin'])],
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      const uuidCheck = z.string().uuid().safeParse(id);
      if (!uuidCheck.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid document ID format: must be a UUID',
        });
      }

      const body = request.body;
      if (!body || (body.allowed_roles === undefined && body.sensitivity === undefined)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'At least one of allowed_roles or sensitivity must be provided',
        });
      }

      try {
        const result = await updateDocumentAcl({
          tenantId: principal.tenant_id,
          documentId: id,
          allowedRoles: body.allowed_roles,
          sensitivity: body.sensitivity,
        });

        if (!result) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Document not found or does not belong to tenant',
          });
        }

        return reply.status(200).send({
          message: 'Document ACL updated successfully',
          document: result,
        });
      } catch (err) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Failed to update document ACL',
        });
      }
    }
  );
}
