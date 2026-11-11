import { connectToDatabase } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { db, error } = await connectToDatabase();

  if (error || !db) {
    return res.status(200).json({
      status: 'standby',
      mongodb: {
        connected: false,
        message: error || 'MONGODB_URI is not set. Running in local/offline database mode.'
      },
      timestamp: new Date().toISOString()
    });
  }

  try {
    const collections = await db.listCollections().toArray();
    const stats = await db.command({ ping: 1 });

    return res.status(200).json({
      status: 'ok',
      mongodb: {
        connected: true,
        database: db.databaseName,
        ping: stats.ok === 1,
        collections: collections.map((c) => c.name)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      mongodb: {
        connected: false,
        message: err.message
      },
      timestamp: new Date().toISOString()
    });
  }
}
