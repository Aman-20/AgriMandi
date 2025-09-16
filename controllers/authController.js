// controllers/authController.js (only register part shown - replace existing register)
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const JWT_EXPIRES = '7d';
const SALT_ROUNDS = 10;

function createToken(user) {
  const payload = { id: user._id ? String(user._id) : String(user.id), email: user.email, role: user.role || 'buyer' };
  return jwt.sign(payload, process.env.JWT_SECRET || 'change_me', { expiresIn: JWT_EXPIRES });
}

async function register(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');

    const { name, email, password, role = 'buyer', adminCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Normalize role: only allow 'buyer' or 'farmer' from public register
    let finalRole = role;
    if (finalRole !== 'buyer' && finalRole !== 'farmer' && finalRole !== 'admin') finalRole = 'buyer';

    // If trying to create admin via public register, require server admin code
    if (finalRole === 'admin') {
      const required = process.env.ADMIN_REG_CODE;
      if (!required) {
        return res.status(403).json({ error: 'Admin registration is disabled on this server' });
      }
      if (!adminCode || adminCode !== required) {
        return res.status(403).json({ error: 'Invalid admin registration code' });
      }
    }

    const exists = await users.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const inserted = await users.insertOne({ name, email: email.toLowerCase(), password: hash, role: finalRole, createdAt: new Date() });
    const user = { _id: inserted.insertedId, name, email: email.toLowerCase(), role: finalRole };
    const token = createToken(user);
    return res.json({ token, user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('register err', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function login(req, res) {
  // keep your previous login code (unchanged)
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = createToken(user);
    return res.json({ token, user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('login err', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function me(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');
    const id = req.user && req.user.id;
    if (!id) return res.status(401).json({ error: 'No user' });
    const user = await users.findOne({ _id: new ObjectId(id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (err) {
    console.error('me err', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { register, login, me };
