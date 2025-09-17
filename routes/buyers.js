// routes/buyers.js
const express = require('express');
const router = express.Router();
const buyerCtrl = require('../controllers/buyerController');
const { verifyToken, requireRole, requireAnyRole } = require('../middleware/auth');

router.get('/', verifyToken, requireRole('admin'), buyerCtrl.listBuyers);
router.post('/connect', verifyToken, requireRole('buyer'), buyerCtrl.createConnectionRequest);
router.get('/my-requests', verifyToken, requireRole('buyer'), buyerCtrl.myRequests);

// farmer/admin
router.get('/requests', verifyToken, requireAnyRole(['farmer','admin']), buyerCtrl.listAllRequests);
router.patch('/requests/:id', verifyToken, requireAnyRole(['farmer','admin']), buyerCtrl.updateRequest);

// buyer cancel their own pending
router.patch('/my-requests/:id', verifyToken, requireRole('buyer'), buyerCtrl.buyerCancelRequest);

// buyer confirm or deny completion
router.post('/my-requests/:id/confirm', verifyToken, requireRole('buyer'), buyerCtrl.buyerConfirmCompletion);
router.post('/my-requests/:id/deny', verifyToken, requireRole('buyer'), buyerCtrl.buyerDenyCompletion);

// buyer reactivate after farmer cancelled
router.post('/my-requests/:id/reactivate', verifyToken, requireRole('buyer'), buyerCtrl.buyerReactivateRequest);

// admin reassign farmer (admin-only)
router.post('/requests/:id/reassign', verifyToken, requireRole('admin'), buyerCtrl.adminReassign);

module.exports = router;
