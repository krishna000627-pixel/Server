const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db/database');
const { signToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateFriendKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, publicKey, password } = req.body;
    if (!username || !publicKey) return res.status(400).json({ success: false, error: 'username and publicKey required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: 'Username must be 3-20 chars' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: 'Username: letters, numbers, underscore only' });
    if (!password || password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    // FIX: username uniqueness enforced case-insensitively
    const existing = stmts.getUserByUsername.get(username);
    if (existing) return res.status(409).json({ success: false, error: `Username "${username}" is already taken` });

    const userId = uuidv4();
    let friendKey = generateFriendKey();
    while (stmts.getUserByFriendKey.get(friendKey)) friendKey = generateFriendKey();

    const passwordHash = await bcrypt.hash(password, 10);
    stmts.createUser.run({ id: userId, username, password_hash: passwordHash, public_key: publicKey, friend_key: friendKey });

    res.json({ success: true, data: { userId, friendKey, token: signToken(userId) } });
  } catch (e) {
    console.error('register:', e.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'username and password required' });
    const user = stmts.getUserByUsername.get(username);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid username or password' });
    res.json({ success: true, data: { userId: user.id, token: signToken(user.id), friendKey: user.friend_key, publicKey: user.public_key } });
  } catch (e) {
    console.error('login:', e.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({ success: true, data: { userId: u.id, username: u.username, friendKey: u.friend_key, publicKey: u.public_key, isOnline: !!u.is_online } });
});

// GET /api/auth/me/public-key — client checks server key vs device key
router.get('/me/public-key', authMiddleware, (req, res) => {
  res.json({ success: true, data: { publicKey: req.user.public_key } });
});

// PUT /api/auth/public-key — client pushes updated key after reinstall/new device
router.put('/public-key', authMiddleware, (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 100) {
      return res.status(400).json({ success: false, error: 'Invalid publicKey' });
    }
    stmts.updatePublicKey.run(publicKey, req.user.id);
    console.log(`[Auth] Key updated for ${req.user.username}`);
    res.json({ success: true, data: null });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
