/**
 * Process entry point.
 *
 * Stateless by design: sessions live in the token and (in production) Redis,
 * never in process memory, so instances scale horizontally behind the load
 * balancer — §8.1 Scalability, quality scenario QA-2.
 */
import 'dotenv/config';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { seedIfEmpty } from './config/seed';
import { migrate } from './config/migrate';

const PORT = Number(process.env.PORT ?? 3000);

/** Fails fast on configuration that cannot work, and warns on the rest. */
function checkConfig(): void {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured — copy .env.example to .env');
  }

  const payos = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'];
  const missing = payos.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `[config] payOS not configured (${missing.join(', ')}): the site runs, but ` +
        'booking payments will fail until these are set — see https://my.payos.vn',
    );
  }
}

async function start(): Promise<void> {
  checkConfig();
  await connectDatabase();
  await migrate();

  if (process.env.NODE_ENV !== 'production') {
    await seedIfEmpty();
  }

  const server = createApp().listen(PORT, () =>
    console.log(`[api] listening on http://localhost:${PORT}`),
  );

  // Drain in-flight requests, then close the database — including the
  // embedded dev MongoDB, which must release its data files before `tsx watch`
  // starts the next process, or that process cannot open them.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase().catch((err) => console.error('[db] close failed', err));
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(async (err) => {
  console.error('[api] failed to start:', err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
