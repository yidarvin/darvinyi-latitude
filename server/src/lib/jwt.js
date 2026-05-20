import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ISSUER = 'latitude';
const EXPIRES_IN = '7d';

export function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    issuer: ISSUER,
    expiresIn: EXPIRES_IN,
  });
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER });
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export const COOKIE_NAME = 'lat_session';

export function cookieOptions() {
  return {
    httpOnly: true,
    secure:   config.isProd,
    sameSite: 'lax',
    domain:   config.isProd ? config.cookieDomain : undefined,
    path:     '/',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  };
}
