import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey, maskApiKey } from './crypto.js';

describe('crypto', () => {
  it('round-trips a plaintext key through encrypt/decrypt', () => {
    const plaintext = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const enc = encryptApiKey(plaintext);
    expect(enc.cipher).toBeTypeOf('string');
    expect(enc.nonce).toBeTypeOf('string');
    expect(enc.authTag).toBeTypeOf('string');

    const decrypted = decryptApiKey(enc);
    expect(decrypted).toBe(plaintext);
  });

  it('produces a different ciphertext for the same plaintext each time (random nonce)', () => {
    const plaintext = 'sk-ant-api03-same-plaintext-twice';
    const a = encryptApiKey(plaintext);
    const b = encryptApiKey(plaintext);
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects a tampered auth tag', () => {
    const enc = encryptApiKey('sk-ant-api03-some-key');
    const tampered = { ...enc, authTag: Buffer.from('0'.repeat(24), 'hex').toString('base64') };
    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptApiKey('sk-ant-api03-some-key');
    const flipped = Buffer.from(enc.cipher, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptApiKey({ ...enc, cipher: flipped.toString('base64') })).toThrow();
  });

  it('masks a key, keeping only a short prefix and suffix', () => {
    const masked = maskApiKey('sk-ant-api03-abcdefghijklmnop1234');
    expect(masked).toBe('sk-ant-…1234');
    expect(masked).not.toContain('abcdefgh');
  });

  it('masks short/empty input with a fixed placeholder', () => {
    expect(maskApiKey('')).toBe('••••');
    expect(maskApiKey('short')).toBe('••••');
    expect(maskApiKey(null)).toBe('••••');
  });
});
