/**
 * Process entry point.
 *
 * Stateless by design: sessions live in the token and (in production) Redis,
 * never in process memory, so instances scale horizontally behind the load
 * balancer — §8.1 Scalability, quality scenario QA-2.
 */
import 'dotenv/config';
import { createApp, connectDatabase } from './app';

const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  await connectDatabase();

  const server = createApp().listen(PORT, () =>
    console.log(`[api] listening on :${PORT}`),
  );

  // Drain in-flight requests before exiting so a deploy never cuts a booking
  // mid-transaction.
  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
