/**
 * `npm run seed:demo` — fills the database with a believable day at the hotel.
 * `npm run seed:demo -- --reset` replaces existing operational data first
 * (bookings, folios, payments, shifts, leave, tasks, audit); accounts, roles
 * and rooms are kept. Development only.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from './database';
import { seedDemoData } from './demo-data';

(async () => {
  const reset = process.argv.includes('--reset');
  const started = Date.now();
  await connectDatabase();
  await seedDemoData({ reset });
  console.log(`[demo] done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await disconnectDatabase();
})().catch(async (err) => {
  console.error('[demo] failed:', err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
