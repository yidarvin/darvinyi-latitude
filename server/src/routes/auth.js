import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signToken, COOKIE_NAME, cookieOptions } from '../lib/jwt.js';
import { encryptApiKey, decryptApiKey, maskApiKey } from '../lib/crypto.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// ───────────────────────────────────────── rate limiting
// Unauthenticated endpoints — no req.user to key on, so limit by IP.
// `trust proxy` is set in production (index.js), so req.ip reflects the
// real client behind Railway's edge proxy, not the proxy's own address.
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// Signup's live key check (below) turns a 401-vs-other-outcome distinction
// into a fast, free oracle for testing whether an arbitrary Anthropic key is
// still valid — a legitimate signup for one person is a rare event, so this
// budget is far tighter than login's retry-tolerant one, to raise the cost
// of using this endpoint to mass-probe harvested/leaked keys.
const signupIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts from this network. Try again later.' },
});

// Login additionally limits by the submitted email, so an attacker spread
// across many IPs still can't brute-force one specific account.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '') || req.ip,
  message: { error: 'Too many attempts for this account. Try again in a few minutes.' },
});

// Authenticated but still password-confirmed (account deletion) — key by
// user id so one account's attempts can't be drowned out by another's.
const deleteAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// ───────────────────────────────────────── schemas
const signupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  // bcrypt silently truncates at 72 bytes — anything past that is dead
  // weight, not extra security. Cap it so the constraint is honest.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters'),
  anthropicApiKey: z.string()
    .min(20, 'API key looks too short')
    .regex(/^sk-ant-/, 'API key should start with sk-ant-'),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(72),
});

const rotateSchema = z.object({
  anthropicApiKey: z.string().min(20).regex(/^sk-ant-/),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(72),
});

// A real, valid 60-char bcrypt hash — generated once at module load, never
// matched by any real password. Used so the "user not found" path performs
// the same cost-12 bcrypt work as the "user found" path (see /login below).
// The previous dummy string was 67 characters; bcryptjs's compare() returns
// false immediately for any hash whose length isn't exactly 60, skipping the
// key-derivation work entirely — which made the "always compare" comment a
// no-op and left email existence trivially detectable by response timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password-used-only-for-timing', 12);

// ───────────────────────────────────────── POST /signup
router.post('/auth/signup', signupIpLimiter, async (req, res, next) => {
  try {
    const { email, password, anthropicApiKey } = signupSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    // A cheap, non-generating call — catches a typo'd or revoked key before
    // the user fills out a whole brief only to have their first walk fail.
    try {
      await new Anthropic({ apiKey: anthropicApiKey }).models.list({ limit: 1 });
    } catch (err) {
      if (err?.status === 401) {
        return res.status(400).json({ error: 'That API key was rejected by Anthropic — check it and try again' });
      }
      // Any other failure (network blip, Anthropic outage) shouldn't block
      // signup on a check that isn't the source of truth — the key still
      // gets used for real on the first walk either way.
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
router.post('/auth/login', authIpLimiter, loginAccountLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    });

    // Always do a full-cost bcrypt compare, whether or not the account
    // exists, so response timing doesn't reveal which emails are registered.
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);

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
    if (u.apiKeyCipher) {
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
    }
    res.json({
      user: {
        id: u.id,
        email: u.email,
        createdAt: u.createdAt,
        apiKeyMasked,
        hasApiKey: !!u.apiKeyCipher,
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

// ───────────────────────────────────────── DELETE /api-key
// Removes the stored key without deleting the account. Any agent run
// started afterward fails gracefully in the loop ("add an API key in
// Account") rather than crashing on a null decrypt.
router.delete('/auth/api-key', requireAuth, async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { apiKeyCipher: null, apiKeyNonce: null, apiKeyAuthTag: null },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────── DELETE /account
// Password-confirmed. Cascades to the user's walks, stops, and agent runs
// via the schema's onDelete: Cascade — nothing is left behind.
router.delete('/auth/account', requireAuth, deleteAccountLimiter, async (req, res, next) => {
  try {
    const { password } = deleteAccountSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { passwordHash: true },
    });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });

    await prisma.user.delete({ where: { id: req.user.id } });

    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Password is required' });
    }
    next(err);
  }
});

export default router;
