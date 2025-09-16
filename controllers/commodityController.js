// controllers/commodityController.js
const { ObjectId } = require('mongodb');

// In-memory SSE client registry
const sseClients = [];

function sendSseEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function list(req, res) {
  try {
    const db = req.app.locals.db;
    const coll = db.collection('commodities');
    const rows = await coll.find({}).toArray();
    return res.json({ commodities: rows });
  } catch (err) {
    console.error('commodity list', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function sseStream(req, res) {
  // Set headers for SSE
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // Send an initial comment so some browsers keep connection alive
  res.write(': connected\n\n');

  // push to clients list
  const client = { id: Date.now() + Math.random(), res };
  sseClients.push(client);

  // send initial snapshot
  try {
    const db = req.app.locals.db;
    const coll = db.collection('commodities');
    const rows = await coll.find({}).toArray();
    sendSseEvent(res, { type: 'initial', data: rows });
  } catch (err) {
    sendSseEvent(res, { type: 'error', error: 'failed to fetch initial data' });
  }

  // cleanup on close
  req.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === client.id);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
}

async function update(req, res) {
  try {
    const db = req.app.locals.db;
    const coll = db.collection('commodities');
    const { id, price } = req.body;
    if (!id || typeof price === 'undefined') return res.status(400).json({ error: 'id and price required' });

    const _id = id.length === 24 ? new ObjectId(id) : id;
    const existing = await coll.findOne({ _id: _id });
    if (!existing) return res.status(404).json({ error: 'Commodity not found' });

    const change = Number(price) - (existing.price || 0);
    await coll.updateOne({ _id: _id }, { $set: { price: Number(price), change, lastUpdated: new Date() } });

    const updated = await coll.findOne({ _id: _id });

    // broadcast to SSE clients
    const payload = { type: 'update', data: updated };
    sseClients.forEach(c => {
      try { c.res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) { /* ignore broken pipes */ }
    });

    return res.json({ ok: true, updated });
  } catch (err) {
    console.error('commodity update', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { list, sseStream, update };
