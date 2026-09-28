/**
 * `npm run seed` — seeds (or tops up) the database configured in .env.
 * Idempotent: existing roles are updated, existing rooms and accounts are kept.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from './database';
import { seedAll } from './seed';

(async () => {
  await connectDatabase();
  await seedAll();
  console.log('[seed] done');
  await disconnectDatabase();
})().catch(async (err) => {
  console.error('[seed] failed', err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
