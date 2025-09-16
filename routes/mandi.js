// routes/mandi.js
const express = require('express');
const router = express.Router();
const mandiCtrl = require('../controllers/mandiController');

// list mandi prices (optionally add query params ?state=...)
router.get('/prices', mandiCtrl.listPrices);
router.get('/prices/:state', mandiCtrl.listByState);

module.exports = router;
