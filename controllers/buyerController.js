// controllers/buyerController.js
const { ObjectId } = require('mongodb');

function norm(doc) {
  if (!doc) return null;
  const c = { ...doc };
  if (c._id) c._id = String(c._id);
  if (c.buyerId) c.buyerId = String(c.buyerId);
  if (c.farmerId) c.farmerId = String(c.farmerId);
  if (c.buyer && c.buyer._id) c.buyer._id = String(c.buyer._id);
  if (c.farmer && c.farmer._id) c.farmer._id = String(c.farmer._id);
  return c;
}

async function listBuyers(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');
    const buyers = await users.find({ role: 'buyer' }, { projection: { password: 0 } }).toArray();
    return res.json({ buyers: buyers.map(u => ({ id: String(u._id), name: u.name, email: u.email })) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

async function createConnectionRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const buyerId = req.user.id;
    const { crop, quantity, contact } = req.body;
    if (!crop || !quantity) return res.status(400).json({ error: 'crop and quantity required' });

    const doc = {
      buyerId: new ObjectId(buyerId),
      farmerId: null,
      crop,
      quantity: Number(quantity),
      contact: contact || null,
      status: 'pending',
      createdAt: new Date()
    };
    const r = await requests.insertOne(doc);
    return res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// buyer's requests include farmer info when assigned
async function myRequests(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const pipeline = [
      { $match: { buyerId: new ObjectId(req.user.id) } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } }
    ];
    const docs = await requests.aggregate(pipeline).toArray();
    return res.json({ requests: docs.map(norm) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// farmer/admin: see all (includes buyer & farmer info)
async function listAllRequests(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const { status, crop } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (crop) filter.crop = crop;
    const pipeline = [
      { $match: filter },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } }
    ];
    const docs = await requests.aggregate(pipeline).toArray();
    return res.json({ requests: docs.map(norm) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

/**
 * Update request: actions for farmer/admin:
 * - accept: assigns farmerId, status -> accepted, acceptedAt
 * - complete: (farmer) sets status completed_pending_buyer_confirmation and completedAt
 * - cancel: farmer/admin cancels -> cancelled, cancelledAt, cancelledBy
 * - reassign: admin reassigns farmerId
 */
async function updateRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const users = db.collection('users');
    const id = req.params.id;
    const { action, farmerId } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });

    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const role = req.user.role;
    const userId = req.user.id;

    if (action === 'accept') {
      // farmer or admin accepts
      if (existing.status === 'accepted' && existing.farmerId && String(existing.farmerId) !== userId && role !== 'admin') {
        return res.status(403).json({ error: 'Already accepted by another farmer' });
      }
      await requests.updateOne({ _id: objId }, { $set: { status: 'accepted', farmerId: new ObjectId(userId), acceptedAt: new Date(), cancelledBy: null, cancelledAt: null } });
    } else if (action === 'complete') {
      // only assigned farmer or admin
      if (role === 'farmer') {
        if (!existing.farmerId || String(existing.farmerId) !== userId) return res.status(403).json({ error: 'You are not assigned' });
      }
      await requests.updateOne({ _id: objId }, { $set: { status: 'completed_pending_buyer_confirmation', completedAt: new Date() } });
      // optionally email buyer — not implemented here (could call send email)
    } else if (action === 'cancel') {
      // admin cancels any; farmer can cancel if assigned
      if (role === 'admin') {
        await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'admin' } });
      } else if (role === 'farmer') {
        if (!existing.farmerId || String(existing.farmerId) !== userId) return res.status(403).json({ error: 'Not assigned' });
        await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'farmer' } });
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (action === 'reassign') {
      // admin only
      if (role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      if (!farmerId) return res.status(400).json({ error: 'farmerId required' });
      await requests.updateOne({ _id: objId }, { $set: { farmerId: new ObjectId(farmerId), acceptedAt: new Date(), status: 'accepted' } });
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    // return updated doc with lookups
    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// buyer cancel their pending request
async function buyerCancelRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (String(existing.buyerId) !== req.user.id) return res.status(403).json({ error: 'Not your request' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Only pending can be cancelled by buyer' });

    await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'buyer' } });

    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// buyer confirm completion
async function buyerConfirmCompletion(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (String(existing.buyerId) !== req.user.id) return res.status(403).json({ error: 'Not your request' });

    if (existing.status !== 'completed_pending_buyer_confirmation' && existing.status !== 'disputed') {
      return res.status(400).json({ error: 'Not awaiting confirmation' });
    }

    await requests.updateOne({ _id: objId }, { $set: { status: 'completed', buyerConfirmedAt: new Date() } });

    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// buyer deny completion (dispute)
async function buyerDenyCompletion(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const { reason } = req.body;
    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (String(existing.buyerId) !== req.user.id) return res.status(403).json({ error: 'Not your request' });

    if (existing.status !== 'completed_pending_buyer_confirmation') return res.status(400).json({ error: 'Not awaiting confirmation' });
    await requests.updateOne({ _id: objId }, { $set: { status: 'disputed', disputedAt: new Date(), disputeReason: reason || null } });

    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// buyer reactivate after farmer cancelled
async function buyerReactivateRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (String(existing.buyerId) !== req.user.id) return res.status(403).json({ error: 'Not your request' });
    if (existing.status !== 'cancelled') return res.status(400).json({ error: 'Only cancelled requests can be reactivated' });

    // Reactivate: clear farmer assignment and set to pending
    await requests.updateOne({ _id: objId }, { $set: { status: 'pending', farmerId: null, acceptedAt: null, cancelledAt: null, cancelledBy: null } });

    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

// admin reassign farmer to a request
async function adminReassign(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const users = db.collection('users');
    const id = req.params.id;
    const { farmerId } = req.body;
    if (!farmerId) return res.status(400).json({ error: 'farmerId required' });
    // verify farmer exists and has role farmer
    const farmer = await users.findOne({ _id: new ObjectId(farmerId), role: 'farmer' });
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    await requests.updateOne({ _id: objId }, { $set: { farmerId: new ObjectId(farmerId), status: 'accepted', acceptedAt: new Date() } });

    const pipeline = [
      { $match: { _id: objId } },
      { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'farmerId', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: norm(updated) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Server error' }); }
}

module.exports = {
  listBuyers,
  createConnectionRequest,
  myRequests,
  listAllRequests,
  updateRequest,
  buyerCancelRequest,
  buyerConfirmCompletion,
  buyerDenyCompletion,
  buyerReactivateRequest,
  adminReassign
};
