import { z } from 'zod';

export const ClearanceLevelSchema = z.number().int().min(0).max(3);
export type ClearanceLevel = z.infer<typeof ClearanceLevelSchema>;

export const PrincipalSchema = z.object({
  tenant_id: z.string().uuid({ message: 'tenant_id must be a valid UUID' }),
  user_id: z.string().min(1, { message: 'user_id cannot be empty' }),
  roles: z.array(z.string().min(1)).min(1, { message: 'roles must contain at least one role' }),
  clearance: ClearanceLevelSchema,
});

export type Principal = z.infer<typeof PrincipalSchema>;
