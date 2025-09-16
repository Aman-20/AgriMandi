// routes/index.js
const express = require('express');
const router = express.Router();
const authRoutes = require('./auth');
const buyerRoutes = require('./buyers');
const commodityRoutes = require('./commodities');
const mandiRoutes = require('./mandi');

router.use('/auth', authRoutes);
router.use('/buyers', buyerRoutes);
router.use('/commodities', commodityRoutes);
router.use('/mandi', mandiRoutes);

/**
 * Server-side proxy for OpenWeather API:
 * Client calls: GET /api/external-weather?lat=...&lon=...
 * This keeps the API key secret on server (.env -> WEATHER_API_KEY)
 */
router.get('/external-weather', async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const key = process.env.WEATHER_API_KEY;
    if (!key) return res.status(500).json({ error: 'WEATHER_API_KEY not configured on server' });

    // Use global fetch if available (Node 18+), otherwise try node-fetch
    let fetchFn = global.fetch;
    if (!fetchFn) {
      try {
        // node-fetch v2/v3 compat
        fetchFn = require('node-fetch');
      } catch (e) {
        return res.status(500).json({ error: 'fetch not available; install node-fetch on server' });
      }
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&appid=${encodeURIComponent(key)}`;
    const r = await fetchFn(url);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: 'OpenWeather fetch failed', details: txt });
    }
    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error('external-weather error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
