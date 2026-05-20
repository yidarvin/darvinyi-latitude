import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  API_KEY_ENCRYPTION_KEY: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional(),
});

const env = schema.parse(process.env);

export const config = {
  databaseUrl:           env.DATABASE_URL,
  jwtSecret:             env.JWT_SECRET,
  apiKeyEncryptionKey:   env.API_KEY_ENCRYPTION_KEY,
  nodeEnv:               env.NODE_ENV,
  port:                  env.PORT,
  clientOrigin:          env.CLIENT_ORIGIN,
  cookieDomain:          env.COOKIE_DOMAIN,
  isProd:                env.NODE_ENV === 'production',
};
