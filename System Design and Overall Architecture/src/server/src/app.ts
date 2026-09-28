/**
 * Express application assembly.
 *
 * The middleware order is the layering of §7.2 made executable: security and
 * parsing, then routes, then the error translator last — an error thrown
 * anywhere above lands in errorHandler and becomes a well-formed response.
 */
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import routes from './routes';
import { errorHandler, notFound } from './middleware/error.middleware';

export function createApp(): Application {
  const app = express();

  // Security headers and CORS — TLS is terminated at the load balancer (§7.5).
  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:3001')
        .split(',')
        .map((o) => o.trim()),
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Liveness probe for the load balancer (§8.1 Availability).
  app.get('/health', (_req, res) =>
    res.json({
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      uptime: process.uptime(),
    }),
  );

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri);
  console.log('[db] connected');
}
