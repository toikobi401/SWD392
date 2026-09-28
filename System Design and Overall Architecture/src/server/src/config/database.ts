/**
 * Database connection.
 *
 * Production and any configured environment use MONGODB_URI. In development,
 * when MONGODB_URI is left unset, an embedded MongoDB is started instead so the
 * project runs with nothing installed — its data is written to `.data/mongo`
 * and survives restarts. Set MONGODB_URI (local mongod, Docker or Atlas) to
 * use a real server.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import mongoose from 'mongoose';

/** Stops the embedded server, if one was started. */
let stopEmbedded: (() => Promise<void>) | null = null;

export async function connectDatabase(): Promise<void> {
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is not configured');
    }
    uri = await startEmbeddedMongo();
  }

  await mongoose.connect(uri);
  console.log(`[db] connected — ${redact(uri)}`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (stopEmbedded) {
    await stopEmbedded();
    stopEmbedded = null;
  }
}

async function startEmbeddedMongo(): Promise<string> {
  const port = Number(process.env.EMBEDDED_MONGO_PORT ?? 27027);

  // Already running — typically the dev server owns it and this is a second
  // process such as `npm run seed:demo`. Share it: a second mongod cannot
  // open the same data directory (DBPathInUse).
  if (await isListening(port)) {
    const uri = `mongodb://127.0.0.1:${port}/hms`;
    console.log(`[db] using the embedded MongoDB already running on :${port}`);
    return uri;
  }

  // Loaded lazily: it is a devDependency, so a production install (which
  // omits dev dependencies) must never require it.
  const { MongoMemoryServer } = await import('mongodb-memory-server');

  const dbPath = path.resolve(__dirname, '../../.data/mongo');
  fs.mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    // wiredTiger (not the default in-memory engine) is what makes the data
    // persist on disk between runs.
    instance: { dbPath, storageEngine: 'wiredTiger', port },
  });

  // doCleanup:false — keep the data directory; that is the whole point.
  stopEmbedded = async () => {
    await server.stop({ doCleanup: false });
  };

  const uri = server.getUri('hms');
  console.log(`[db] embedded MongoDB started (development) — data in ${dbPath}`);
  console.log(`[db] connect with MongoDB Compass: ${uri}`);
  return uri;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Never print a password that may be embedded in a connection string. */
function redact(uri: string): string {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:****@');
}
