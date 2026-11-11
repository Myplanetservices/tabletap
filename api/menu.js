import { connectToDatabase } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { db, error } = await connectToDatabase();
  if (error || !db) {
    return res.status(503).json({ error: error || 'MongoDB not configured' });
  }

  const itemsCol = db.collection('items');
  const catsCol = db.collection('categories');

  try {
    if (req.method === 'GET') {
      const { clientId } = req.query || {};
      const filter = clientId ? { clientId } : {};

      const items = await itemsCol.find(filter).toArray();
      const categories = await catsCol.find(filter).sort({ order: 1 }).toArray();

      return res.status(200).json({ categories, items });
    }

    if (req.method === 'POST') {
      const { type, data } = req.body || {};
      if (!data || !data.id) {
        return res.status(400).json({ error: 'data with id is required' });
      }

      const targetCol = type === 'category' ? catsCol : itemsCol;
      await targetCol.updateOne(
        { id: data.id },
        { $set: { ...data, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );

      return res.status(200).json({ success: true, data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
