import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgresql://migrator:migrator_secret@localhost:5432/rag_db'),
  DATABASE_APP_URL: z.string().default('postgresql://app_user:app_secret@localhost:5432/rag_db'),
  JWT_SECRET: z.string().min(32).default('super-secret-dev-jwt-key-must-be-at-least-32-chars-long'),
  LLM_PROVIDER: z.string().default('gemini'),
  LLM_API_KEY: z.string().optional().default(''),
  EMBEDDING_MODEL: z.string().default('all-MiniLM-L6-v2'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
