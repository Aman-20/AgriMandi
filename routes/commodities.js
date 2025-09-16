// routes/commodities.js
const express = require('express');
const router = express.Router();
const commodityCtrl = require('../controllers/commodityController');
const { verifyToken, requireRole } = require('../middleware/auth');

// public list of commodities/prices
router.get('/', commodityCtrl.list);

// SSE stream for live commodity updates
router.get('/sse', commodityCtrl.sseStream);

// admin updates commodity price (will broadcast)
router.post('/update', verifyToken, requireRole('admin'), commodityCtrl.update);

module.exports = router;
