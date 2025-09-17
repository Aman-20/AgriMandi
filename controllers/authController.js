// controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const JWT_EXPIRES = '7d';
const SALT_ROUNDS = 10;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours tokens for verify/reset

function createToken(user) {
  const payload = { id: user._id ? String(user._id) : String(user.id), email: user.email, role: user.role || 'buyer' };
  return jwt.sign(payload, process.env.JWT_SECRET || 'change_me', { expiresIn: JWT_EXPIRES });
}

async function getTransporter() {
  // nodemailer transport from env
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE === 'true') || false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// helper to send email (returns true if attempted)
async function sendEmail({ to, subject, text, html }) {
  const transporter = await getTransporter();
  if (!transporter) {
    console.warn('SMTP not configured, skip sending email to', to);
    return false;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text, html
  });
  return true;
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function register(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');
    const tokens = db.collection('tokens');

    const { name, email, password, role = 'buyer', contact, adminCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // sanitize role input
    let finalRole = role;
    if (finalRole !== 'buyer' && finalRole !== 'farmer' && finalRole !== 'admin') finalRole = 'buyer';

    // protect admin creation by env code
    if (finalRole === 'admin') {
      const required = process.env.ADMIN_REG_CODE;
      if (!required) return res.status(403).json({ error: 'Admin registration disabled' });
      if (!adminCode || adminCode !== required) return res.status(403).json({ error: 'Invalid admin code' });
    }

    const exists = await users.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const insertRes = await users.insertOne({
      name,
      email: email.toLowerCase(),
      password: hash,
      role: finalRole,
      contact: contact || null,
      isVerified: false,
      createdAt: new Date()
    });

    const userId = insertRes.insertedId;

    // generate verification token
    const token = randomToken();
    await tokens.insertOne({
      token,
      userId,
      type: 'verify_email',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
    });

    // send verification email
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;
    const html = `<p>Hi ${name || ''},</p>
      <p>Click to verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`;
    await sendEmail({ to: email, subject: 'Verify your AgriMandi account', html });

    return res.json({ ok: true, message: 'Registered. Please check your email to verify your account.' });
  } catch (err) {
    console.error('register err', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function verifyEmail(req, res) {
  try {
    const db = req.app.locals.db;
    const tokens = db.collection('tokens');
    const users = db.collection('users');
    const token = req.query.token;
    if (!token) return res.status(400).send('token required');

    const rec = await tokens.findOne({ token, type: 'verify_email' });
    if (!rec) return res.status(400).send('Invalid or expired token');

    if (rec.expiresAt && rec.expiresAt < new Date()) {
      return res.status(400).send('Token expired');
    }

    await users.updateOne({ _id: rec.userId }, { $set: { isVerified: true } });
    await tokens.deleteOne({ _id: rec._id });
    // You can redirect user to front-end UI
    const front = process.env.APP_URL || 'http://localhost:3000';
    return res.redirect(`${front}/?verified=1`);
  } catch (err) {
    console.error('verifyEmail', err);
    return res.status(500).send('Server error');
  }
}

async function login(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.isVerified) return res.status(403).json({ error: 'Email not verified. Check your inbox.' });

    const token = createToken(user);
    return res.json({ token, user: { id: String(user._id), name: user.name, email: user.email, role: user.role, contact: user.contact } });
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
    return res.json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role, contact: user.contact, isVerified: user.isVerified } });
  } catch (err) {
    console.error('me err', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// forgot password
async function forgotPassword(req, res) {
  try {
    const db = req.app.locals.db;
    const users = db.collection('users');
    const tokens = db.collection('tokens');
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(200).json({ ok: true }); // do not expose existence

    const token = randomToken();
    await tokens.insertOne({
      token,
      userId: user._id,
      type: 'reset_password',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
    });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset-password.html?token=${token}`; // client page (you may create static page)
    const html = `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`;
    await sendEmail({ to: email, subject: 'Reset your AgriMandi password', html });

    return res.json({ ok: true });
  } catch (err) {
    console.error('forgotPassword', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// reset (expects { token, password })
async function resetPassword(req, res) {
  try {
    const db = req.app.locals.db;
    const tokens = db.collection('tokens');
    const users = db.collection('users');
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });

    const rec = await tokens.findOne({ token, type: 'reset_password' });
    if (!rec) return res.status(400).json({ error: 'Invalid or expired token' });
    if (rec.expiresAt && rec.expiresAt < new Date()) return res.status(400).json({ error: 'Token expired' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await users.updateOne({ _id: rec.userId }, { $set: { password: hash } });
    await tokens.deleteOne({ _id: rec._id });

    return res.json({ ok: true, message: 'Password updated' });
  } catch (err) {
    console.error('resetPassword', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { register, login, me, verifyEmail, forgotPassword, resetPassword };
