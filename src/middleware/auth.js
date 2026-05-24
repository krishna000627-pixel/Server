const jwt = require('jsonwebtoken');
const { stmts } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'snapbridge-dev-secret-change-in-prod';

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing token' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmts.getUserById.get(payload.userId);
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '90d' });
}

module.exports = { authMiddleware, signToken, JWT_SECRET };
