// controllers/buyerController.js
const { ObjectId } = require('mongodb');

/**
 * Helper: convert ObjectId fields to strings and simplify returned object shape
 */
function normalizeRequestDoc(doc) {
  if (!doc) return doc;
  const copy = { ...doc };
  if (copy._id) copy._id = String(copy._id);
  if (copy.buyer && copy.buyer._id) copy.buyer._id = String(copy.buyer._id);
  if (copy.farmer && copy.farmer._id) copy.farmer._id = String(copy.farmer._id);
  if (copy.farmerId) copy.farmerId = String(copy.farmerId);
  if (copy.buyerId) copy.buyerId = String(copy.buyerId);
  return copy;
}

async function listBuyers(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');
    const buyers = await users.find({ role: 'buyer' }, { projection: { password: 0 } }).toArray();
    return res.json({ buyers: buyers.map(u => ({ id: String(u._id), name: u.name, email: u.email })) });
  } catch (err) {
    console.error('listBuyers', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function createConnectionRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');

    const buyerId = req.user.id;
    const { farmerId = null, crop, quantity, price, contact } = req.body;
    if (!crop || !quantity) return res.status(400).json({ error: 'crop and quantity required' });

    const doc = {
      buyerId: new ObjectId(buyerId),
      farmerId: farmerId ? new ObjectId(farmerId) : null,
      crop,
      quantity,
      price: price ? Number(price) : null,
      contact: contact || null,
      status: 'pending',   // default initial status
      createdAt: new Date()
    };
    const r = await requests.insertOne(doc);
    return res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error('createConnectionRequest', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// Buyer sees their requests. Include assigned farmer info when present.
async function myRequests(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const buyerId = req.user.id;

    const pipeline = [
      { $match: { buyerId: new ObjectId(buyerId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } }
    ];
    const docs = await requests.aggregate(pipeline).toArray();
    return res.json({ requests: docs.map(normalizeRequestDoc) });
  } catch (err) {
    console.error('myRequests', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// farmer/admin: list requests with both buyer and farmer info
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
      {
        $lookup: {
          from: 'users',
          localField: 'buyerId',
          foreignField: '_id',
          as: 'buyer'
        }
      },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } }
    ];
    const docs = await requests.aggregate(pipeline).toArray();
    return res.json({ requests: docs.map(normalizeRequestDoc) });
  } catch (err) {
    console.error('listAllRequests', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Update request state (accept / complete / cancel) - for farmer/admin.
 * - accept: farmer/admin assigns farmerId and sets status 'accepted'
 * - complete: assigned farmer (or admin) marks completed
 * - cancel: admin or assigned farmer can cancel (we also allow buyer to cancel via buyerCancelRequest)
 */
async function updateRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const { action } = req.body;
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
      await requests.updateOne({ _id: objId }, { $set: { status: 'accepted', farmerId: new ObjectId(userId), acceptedAt: new Date() } });
    } else if (action === 'complete') {
      // only assigned farmer or admin can complete
      if (role === 'farmer') {
        if (!existing.farmerId || String(existing.farmerId) !== userId) {
          return res.status(403).json({ error: 'You are not the assigned farmer for this request' });
        }
      }
      await requests.updateOne({ _id: objId }, { $set: { status: 'completed', completedAt: new Date() } });
    } else if (action === 'cancel') {
      // admin can cancel any; farmer can cancel if assigned
      if (role === 'admin') {
        await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
      } else if (role === 'farmer') {
        if (!existing.farmerId || String(existing.farmerId) !== userId) {
          return res.status(403).json({ error: 'You are not the assigned farmer to cancel this request' });
        }
        await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
      } else {
        return res.status(403).json({ error: 'Only admin or assigned farmer can cancel here' });
      }
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    // return updated document including buyer and farmer info
    const pipeline = [
      { $match: { _id: objId } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyerId',
          foreignField: '_id',
          as: 'buyer'
        }
      },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: normalizeRequestDoc(updated) });
  } catch (err) {
    console.error('updateRequest', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * buyerCancelRequest:
 * - Buyer may cancel their own request only if status is 'pending'
 */
async function buyerCancelRequest(req, res) {
  try {
    const db = req.app.locals.db;
    const requests = db.collection('buyer_requests');
    const id = req.params.id;
    const buyerId = req.user.id;

    const objId = new ObjectId(id);
    const existing = await requests.findOne({ _id: objId });
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (String(existing.buyerId) !== buyerId) return res.status(403).json({ error: 'Not your request' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled by buyer' });

    await requests.updateOne({ _id: objId }, { $set: { status: 'cancelled', cancelledAt: new Date() } });

    // Return updated doc (buyer+farmer)
    const pipeline = [
      { $match: { _id: objId } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyerId',
          foreignField: '_id',
          as: 'buyer'
        }
      },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'farmerId',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ];
    const [updated] = await requests.aggregate(pipeline).toArray();
    return res.json({ ok: true, request: normalizeRequestDoc(updated) });
  } catch (err) {
    console.error('buyerCancelRequest', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  listBuyers,
  createConnectionRequest,
  myRequests,
  listAllRequests,
  updateRequest,
  buyerCancelRequest
};
