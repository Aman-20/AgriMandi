// app.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const API_ROUTES = require('./routes'); // will provide next
const app = express();
const port = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());
// Serve frontend static from /public
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Mount API routes (they will expect req.app.locals.db to be set)
app.use('/api', API_ROUTES);

// Fallback: serve index.html for SPA routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// App state
let client = null;
async function startServer() {
  const MONGO_URI = process.env.MONGO_URI;
  const DB_NAME = process.env.DB_NAME || 'agrimandi';

  if (!MONGO_URI) {
    console.error('MONGO_URI not set. Copy .env.example -> .env and fill MONGO_URI.');
    process.exit(1);
  }

  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    app.locals.db = db; // controllers/routes will use this
    console.log('✅ Connected to MongoDB:', DB_NAME);

    // Basic seeding if empty (safe, idempotent)
    await seedIfNeeded(db);

    // Start HTTP server
    app.listen(port, () => {
      console.log(`🚀 Server listening on http://localhost:${port}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('SIGINT received — shutting down');
      try { await client.close(); } catch (e) { /* ignore */ }
      process.exit(0);
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

async function seedIfNeeded(db) {
  try {
    const mandiColl = db.collection('mandi_prices');
    const c = await mandiColl.countDocuments();
    if (c === 0) {
      await mandiColl.insertMany([
        { state: "Maharashtra", district: "Pune", crop: "Wheat", todayPrice: 2150, yesterdayPrice: 2120 },
        { state: "Maharashtra", district: "Pune", crop: "Rice", todayPrice: 1800, yesterdayPrice: 1820 },
        { state: "Maharashtra", district: "Nashik", crop: "Onion", todayPrice: 1500, yesterdayPrice: 1480 },
        { state: "Karnataka", district: "Bengaluru", crop: "Potato", todayPrice: 2500, yesterdayPrice: 2550 }
      ]);
      console.log('Seeded mandi_prices.');
    }

    const commColl = db.collection('commodities');
    const c2 = await commColl.countDocuments();
    if (c2 === 0) {
      await commColl.insertMany([
        { commodity: "Wheat", price: 2150, change: 0, lastUpdated: new Date() },
        { commodity: "Rice", price: 1800, change: 0, lastUpdated: new Date() },
        { commodity: "Onion", price: 1500, change: 0, lastUpdated: new Date() },
        { commodity: "Potato", price: 2500, change: 0, lastUpdated: new Date() }
      ]);
      console.log('Seeded commodities.');
    }
  } catch (e) {
    console.warn('Seeding error (non-fatal):', e);
  }
}

startServer();
