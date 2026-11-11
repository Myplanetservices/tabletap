import { connectToDatabase } from './db.js';

const COLLECTIONS = [
  'clients',
  'owners',
  'staff',
  'tables',
  'categories',
  'items',
  'orders',
  'waiterCalls',
  'sessions',
  'invites',
  'activity',
  'settings'
];

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { db, error } = await connectToDatabase();
  if (error || !db) {
    return res.status(503).json({ error: error || 'MongoDB not configured' });
  }

  try {
    // GET: pull complete database from MongoDB cluster
    if (req.method === 'GET') {
      const fullData = {};
      for (const colName of COLLECTIONS) {
        fullData[colName] = await db.collection(colName).find({}).toArray();
      }
      return res.status(200).json({ success: true, db: fullData });
    }

    // POST: push complete database into MongoDB cluster
    if (req.method === 'POST') {
      const payload = req.body || {};
      const sourceDb = payload.db || payload;
      const stats = {};

      for (const colName of COLLECTIONS) {
        const records = Array.isArray(sourceDb[colName]) ? sourceDb[colName] : [];
        if (records.length > 0) {
          const col = db.collection(colName);
          const ops = records.map((doc) => {
            const docId = doc.id || doc._id || String(doc.number || Math.random());
            const cleanDoc = { ...doc };
            delete cleanDoc._id; // avoid immutable _id conflict
            return {
              updateOne: {
                filter: { id: docId },
                update: { $set: cleanDoc },
                upsert: true
              }
            };
          });
          const result = await col.bulkWrite(ops);
          stats[colName] = { upserted: result.upsertedCount, modified: result.modifiedCount };
        }
      }

      return res.status(200).json({ success: true, message: 'Synchronized with MongoDB cluster', stats });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
