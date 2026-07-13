import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// config.js validates process.env once, at import time — to test rejection
// paths we have to reset the module registry and re-import fresh for each
// scenario, with process.env mutated first.
const ORIGINAL_ENV = { ...process.env };

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('boots successfully with valid env vars', async () => {
    const { config } = await import('./config.js');
    expect(config.jwtSecret).toBe(ORIGINAL_ENV.JWT_SECRET);
    expect(config.apiKeyEncryptionKey).toBe(ORIGINAL_ENV.API_KEY_ENCRYPTION_KEY);
  });

  it('rejects a JWT_SECRET left as the .env.example placeholder', async () => {
    process.env.JWT_SECRET = 'replace-me-with-long-random-string-min-32-chars';
    await expect(import('./config.js')).rejects.toThrow();
  });

  it('rejects an API_KEY_ENCRYPTION_KEY left as the .env.example placeholder', async () => {
    process.env.API_KEY_ENCRYPTION_KEY = 'replace-me-32-byte-base64-key';
    await expect(import('./config.js')).rejects.toThrow();
  });

  it('rejects an API_KEY_ENCRYPTION_KEY that does not decode to 32 bytes', async () => {
    process.env.API_KEY_ENCRYPTION_KEY = Buffer.from('too-short-for-aes-256').toString('base64');
    await expect(import('./config.js')).rejects.toThrow();
  });

  it('accepts a genuine 32-byte base64 API_KEY_ENCRYPTION_KEY', async () => {
    process.env.API_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { config } = await import('./config.js');
    expect(config.apiKeyEncryptionKey).toBeTruthy();
  });

  it('rejects a JWT_SECRET shorter than 32 characters', async () => {
    process.env.JWT_SECRET = 'too-short';
    await expect(import('./config.js')).rejects.toThrow();
  });
});
