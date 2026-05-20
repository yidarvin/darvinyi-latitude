import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

export const prisma = new PrismaClient({
  log: config.isProd ? ['error'] : ['warn', 'error'],
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
});
