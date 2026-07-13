import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

export const prisma = new PrismaClient({
  log: config.isProd ? ['error'] : ['warn', 'error'],
});

// Graceful shutdown is coordinated centrally in index.js (HTTP server close
// + open SSE streams + this disconnect, in order) — a standalone handler
// here would race it with no way to sequence the two.
