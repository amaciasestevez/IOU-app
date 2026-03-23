import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import { setupExpressErrorHandler } from '@sentry/node';

import authRouter from './routes/auth';
import contactsRouter from './routes/contacts';
import transactionsRouter from './routes/transactions';
import groupsRouter from './routes/groups';

// --- Startup guards ---
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET must be set in environment and be at least 16 characters');
}

const PORT = parseInt(process.env.PORT || '3000');
const isProd = process.env.NODE_ENV === 'production';

// --- Structured logger ---
const logger = pino({
  level: isProd ? 'info' : 'debug',
  ...(isProd ? {} : { transport: { target: 'pino-pretty' } }),
});

// --- Sentry (only initialises when DSN is provided) ---
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
  logger.info('Sentry initialised');
}

const app = express();


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",            // required for inline <script> in vanilla HTML pages
        "https://cdn.tailwindcss.com",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
      fontSrc:  ["'self'", "https:", "data:", "https://fonts.gstatic.com"],
      imgSrc:   ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// pino-http: logs method, path, status, responseTime, and userId if available
app.use(pinoHttp({
  logger,
  customProps: (req: Request) => ({
    userId: (req as any).user?.id ?? null,
  }),
  // Don't log health checks — they're too noisy
  autoLogging: {
    ignore: (req) => req.url === '/api/v1/health',
  },
}));

app.use(express.json());
app.use(express.static('public'));

// --- Rate limiters ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Too many accounts created from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// --- Routes ---
app.use('/api/v1', authRouter);

// Apply per-route rate limiters on auth paths
app.use('/api/v1/login', loginLimiter);
app.use('/api/v1/register', registerLimiter);

app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/groups', groupsRouter);

// Health check
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// --- Sentry error handler (must be before other error handlers) ---
if (process.env.SENTRY_DSN) {
  setupExpressErrorHandler(app);
}

// --- 404 handler ---
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

// --- Centralized error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err, 'Unhandled error');
  res.status(500).json({
    message: 'Internal server error',
    ...(!isProd && { error: err.message }),
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'Server started');
});
