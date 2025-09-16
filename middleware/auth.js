// middleware/auth.js
const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  try {
    const auth = req.headers['authorization'] || '';
    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }
    const token = parts[1];
    const secret = process.env.JWT_SECRET || 'change_me';
    jwt.verify(token, secret, (err, decoded) => {
      if (err) return res.status(401).json({ error: 'Invalid token' });
      req.user = decoded;
      next();
    });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden - role required: ' + role });
    next();
  };
}

// NEW: require any of roles array, e.g. requireAnyRole(['farmer','admin'])
function requireAnyRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!Array.isArray(roles) || roles.length === 0) return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden - one of roles required: ' + roles.join(',') });
    next();
  };
}

module.exports = { verifyToken, requireRole, requireAnyRole };
