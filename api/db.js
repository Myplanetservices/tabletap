import dns from 'dns';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Ensure DNS SRV records resolve cleanly in all environments (including Windows local machines)
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (_) {}

let cachedClient = null;
let cachedDb = null;

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return {
      client: null,
      db: null,
      error: 'MONGODB_URI is not set. Add it in Vercel Environment Variables or your .env file.'
    };
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb, error: null };
  }

  try {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await client.connect();
    const dbName = process.env.MONGODB_DB || 'tabletap';
    const db = client.db(dbName);

    cachedClient = client;
    cachedDb = db;

    return { client, db, error: null };
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    return { client: null, db: null, error: err.message };
  }
}
