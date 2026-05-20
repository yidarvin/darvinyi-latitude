import crypto from 'crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(config.apiKeyEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('API_KEY_ENCRYPTION_KEY must be 32 bytes (base64)');
  }
  return key;
}

export function encryptApiKey(plaintext) {
  const key = getKey();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cipher: ct.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptApiKey({ cipher, nonce, authTag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(cipher, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

// Lightly mask a key for display: "sk-ant-api03-xxxx-prototype" → "sk-ant-…type"
export function maskApiKey(plaintext) {
  if (!plaintext || plaintext.length < 12) return '••••';
  return `${plaintext.slice(0, 7)}…${plaintext.slice(-4)}`;
}
