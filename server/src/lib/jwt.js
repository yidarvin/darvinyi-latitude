import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ISSUER = 'latitude';
const EXPIRES_IN = '7d';
const ALGORITHM = 'HS256';

export function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    issuer: ISSUER,
    expiresIn: EXPIRES_IN,
    algorithm: ALGORITHM,
  });
}

export function verifyToken(token) {
  try {
    // Pin the accepted algorithm explicitly — without this, jwt.verify()
    // accepts whatever alg the token header claims, which is the standard
    // algorithm-confusion footgun if the signing key or verify options ever
    // change to accept key objects (e.g. RS256 support) down the line.
    const payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, algorithms: [ALGORITHM] });
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
