import { connectToDatabase } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { db, error } = await connectToDatabase();
  if (error || !db) {
    return res.status(503).json({ error: error || 'MongoDB not configured' });
  }

  const collection = db.collection('orders');

  try {
    if (req.method === 'GET') {
      const { clientId, status, limit = 100 } = req.query || {};
      const filter = {};
      if (clientId) filter.clientId = clientId;
      if (status) filter.status = status;

      const orders = await collection
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .toArray();

      return res.status(200).json({ orders });
    }

    if (req.method === 'POST') {
      const order = req.body;
      if (!order || !order.id) {
        return res.status(400).json({ error: 'Order object with id is required' });
      }

      if (order.tableId) {
        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
        const count = await collection.countDocuments({
          tableId: order.tableId,
          createdAt: { $gte: oneMinuteAgo },
        });
        if (count >= 5) {
          return res.status(429).json({ error: 'Too many orders at once - please wait a moment.' });
        }
      }

      await collection.updateOne(
        { id: order.id },
        { $set: { ...order, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );

      return res.status(201).json({ success: true, order });
    }

    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'Order id is required' });
      }

      const result = await collection.updateOne(
        { id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } }
      );

      return res.status(200).json({ success: true, modified: result.modifiedCount });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
