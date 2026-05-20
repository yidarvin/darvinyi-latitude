import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signToken, COOKIE_NAME, cookieOptions } from '../lib/jwt.js';
import { encryptApiKey, decryptApiKey, maskApiKey } from '../lib/crypto.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// ───────────────────────────────────────── schemas
const signupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  anthropicApiKey: z.string()
    .min(20, 'API key looks too short')
    .regex(/^sk-ant-/, 'API key should start with sk-ant-'),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

const rotateSchema = z.object({
  anthropicApiKey: z.string().min(20).regex(/^sk-ant-/),
});

// ───────────────────────────────────────── POST /signup
router.post('/auth/signup', async (req, res, next) => {
  try {
    const { email, password, anthropicApiKey } = signupSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const enc = encryptApiKey(anthropicApiKey);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        apiKeyCipher:  enc.cipher,
        apiKeyNonce:   enc.nonce,
        apiKeyAuthTag: enc.authTag,
      },
      select: { id: true, email: true, createdAt: true },
    });

    const token = signToken(user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());

    res.status(201).json({ user });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
    }
    next(err);
  }
});

// ───────────────────────────────────────── POST /login
router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    });

    // Always do a bcrypt compare to avoid timing leak of email existence
    const dummyHash = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv.';
    const ok = await bcrypt.compare(password, user?.passwordHash || dummyHash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());

    res.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    next(err);
  }
});

// ───────────────────────────────────────── POST /logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

// ───────────────────────────────────────── GET /me
router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, createdAt: true,
                apiKeyCipher: true, apiKeyNonce: true, apiKeyAuthTag: true },
    });
    let apiKeyMasked = null;
    try {
      const plain = decryptApiKey({
        cipher: u.apiKeyCipher,
        nonce: u.apiKeyNonce,
        authTag: u.apiKeyAuthTag,
      });
      apiKeyMasked = maskApiKey(plain);
    } catch {
      apiKeyMasked = '⚠ failed to decrypt';
    }
    res.json({
      user: {
        id: u.id,
        email: u.email,
        createdAt: u.createdAt,
        apiKeyMasked,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────── PATCH /api-key
router.patch('/auth/api-key', requireAuth, async (req, res, next) => {
  try {
    const { anthropicApiKey } = rotateSchema.parse(req.body);
    const enc = encryptApiKey(anthropicApiKey);
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        apiKeyCipher:  enc.cipher,
        apiKeyNonce:   enc.nonce,
        apiKeyAuthTag: enc.authTag,
      },
    });
    res.json({ ok: true, apiKeyMasked: maskApiKey(anthropicApiKey) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    next(err);
  }
});

export default router;
