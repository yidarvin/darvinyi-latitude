import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import authRouter  from './routes/auth.js';
import walksRouter from './routes/walks.js';
import folioRouter from './routes/folio.js';
import agentRunsRouter from './routes/agentRuns.js';
import utilRouter from './routes/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

if (config.isProd) {
  // Trust Railway's edge proxy so req.protocol, req.ip, and secure cookies behave correctly.
  app.set('trust proxy', 1);
}

app.use(cors({
  origin: config.clientOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.expose ? err.message : 'Internal server error',
  });
});

app.listen(config.port, () => {
  console.log(`[latitude] server listening on :${config.port}`);
});
