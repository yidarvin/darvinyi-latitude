import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import { prisma } from './db.js';
import { closeAllActiveRuns } from './agent/loop.js';
import healthRouter from './routes/health.js';
import authRouter  from './routes/auth.js';
import walksRouter from './routes/walks.js';
import folioRouter from './routes/folio.js';
import agentRunsRouter from './routes/agentRuns.js';
import utilRouter from './routes/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Last-resort backstop: an async handler that forgot a try/catch would
// otherwise crash the whole process (and every open SSE connection with it)
// on the next unhandled rejection. Route handlers should still catch their
// own errors — this just prevents a missed one from taking the server down.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const app = express();

if (config.isProd) {
  // Trust Railway's edge proxy so req.protocol, req.ip, and secure cookies behave correctly.
  app.set('trust proxy', 1);
}

// Mounted first, before anything else touches the response. helmet sets
// X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, and
// disables X-Powered-By by default; the CSP below is scoped to this app's
// actual origins (Google Fonts, CartoDB map tiles) rather than the
// permissive default.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      // React/Leaflet set inline style attributes at runtime; the Google
      // Fonts stylesheet itself is loaded externally, not inlined.
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https://*.basemaps.cartocdn.com'],
      connectSrc:  ["'self'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use(cors({
  origin: config.clientOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[req] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms${req.user?.id ? ` user:${req.user.id}` : ''}`);
  });
  next();
});

// API routes
app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', walksRouter);
app.use('/api', folioRouter);
app.use('/api', agentRunsRouter);
app.use('/api', utilRouter);

// Serve client in production
if (config.nodeEnv === 'production') {
  const clientDist = path.join(__dirname, '..', 'public');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler — keep last
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.expose ? err.message : 'Internal server error',
  });
});

const server = app.listen(config.port, () => {
  console.log(`[latitude] server listening on :${config.port}`);
});

// On a Railway redeploy (or any SIGTERM), stop taking new work, let
// in-progress agent runs disconnect cleanly (resumable, not silently
// dropped), then disconnect Prisma before exiting — rather than the
// previous behavior of disconnecting Prisma immediately while requests
// (including live SSE streams) were still in flight against it.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[latitude] ${signal} received — shutting down`);

  server.close();
  closeAllActiveRuns();

  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('[latitude] error disconnecting Prisma during shutdown', err);
  }

  process.exit(0);
}

// Backstop in case something above hangs — Railway escalates to SIGKILL
// after its own grace period, but exit proactively rather than relying on it.
function forceExitSoon() {
  setTimeout(() => process.exit(1), 10_000).unref();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    forceExitSoon();
    shutdown(signal).catch((err) => {
      console.error('[latitude] error during shutdown', err);
      process.exit(1);
    });
  });
}
