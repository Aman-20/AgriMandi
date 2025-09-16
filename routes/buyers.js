// routes/buyers.js
const express = require('express');
const router = express.Router();
const buyerCtrl = require('../controllers/buyerController');
const { verifyToken, requireRole, requireAnyRole } = require('../middleware/auth');

// admin can list all buyers
router.get('/', verifyToken, requireRole('admin'), buyerCtrl.listBuyers);

// buyer creates a connect request to a farmer/market
router.post('/connect', verifyToken, requireRole('buyer'), buyerCtrl.createConnectionRequest);

// buyer fetches their own requests
router.get('/my-requests', verifyToken, requireRole('buyer'), buyerCtrl.myRequests);

// farmer/admin: list all pending requests (or filter)
router.get('/requests', verifyToken, requireAnyRole(['farmer','admin']), buyerCtrl.listAllRequests);

// farmer/admin: update request state (accept / complete / cancel)
router.patch('/requests/:id', verifyToken, requireAnyRole(['farmer','admin']), buyerCtrl.updateRequest);

// buyer: cancel their own pending request
router.patch('/my-requests/:id', verifyToken, requireRole('buyer'), buyerCtrl.buyerCancelRequest);

module.exports = router;
