import 'dotenv/config';
import { z } from 'zod';

const isPlaceholder = (s) => s.toLowerCase().startsWith('replace-me');

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string()
    .min(32, 'JWT_SECRET must be at least 32 chars')
    .refine((s) => !isPlaceholder(s), 'JWT_SECRET is still the .env.example placeholder — generate a real secret (openssl rand -hex 32)'),
  // Must decode to exactly 32 bytes for AES-256-GCM (see lib/crypto.js). A
  // key that merely looks non-empty boots cleanly and only fails on the
  // first signup/decrypt — validate the real constraint here instead.
  API_KEY_ENCRYPTION_KEY: z.string()
    .min(1)
    .refine((s) => !isPlaceholder(s), 'API_KEY_ENCRYPTION_KEY is still the .env.example placeholder — generate a real key (openssl rand -base64 32)')
    .refine((s) => {
      try { return Buffer.from(s, 'base64').length === 32; } catch { return false; }
    }, 'API_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes of base64 (openssl rand -base64 32)'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional(),
  MAPBOX_TOKEN: z.string().min(20, 'MAPBOX_TOKEN is required'),
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
  mapboxToken:           env.MAPBOX_TOKEN,
  isProd:                env.NODE_ENV === 'production',
};
