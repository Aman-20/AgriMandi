// controllers/mandiController.js
async function listPrices(req, res) {
    try {
      const db = req.app.locals.db;
      const coll = db.collection('mandi_prices');
      const { state } = req.query;
      const filter = state ? { state } : {};
      const rows = await coll.find(filter).toArray();
      return res.json({ prices: rows });
    } catch (err) {
      console.error('mandi listPrices', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
  
  async function listByState(req, res) {
    try {
      const db = req.app.locals.db;
      const coll = db.collection('mandi_prices');
      const state = req.params.state;
      const rows = await coll.find({ state }).toArray();
      return res.json({ prices: rows });
    } catch (err) {
      console.error('mandi listByState', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
  
  module.exports = { listPrices, listByState };
  