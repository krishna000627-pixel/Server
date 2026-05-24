const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/friends/add  { friendKey }
router.post('/add', (req, res) => {
  try {
    const { friendKey } = req.body;
    if (!friendKey) return res.status(400).json({ success: false, error: 'friendKey required' });

    const target = stmts.getUserByFriendKey.get(friendKey.toUpperCase());
    if (!target) return res.status(404).json({ success: false, error: 'No user with that friend key' });
    if (target.id === req.user.id) return res.status(400).json({ success: false, error: "Can't add yourself" });

    const id1 = uuidv4(), id2 = uuidv4();
    stmts.addFriend.run(id1, req.user.id, target.id);
    stmts.addFriend.run(id2, target.id, req.user.id);

    res.json({ success: true, data: {
      userId: target.id,
      username: target.username,
      friendKey: target.friend_key,
      publicKey: target.public_key,
      isOnline: !!target.is_online,
      status: 'accepted'
    }});
  } catch (e) {
    console.error('add friend error:', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/friends
router.get('/', (req, res) => {
  const friends = stmts.getFriends.all(req.user.id);
  res.json({ success: true, data: friends.map(f => ({
    userId: f.id,
    username: f.username,
    friendKey: f.friend_key,
    publicKey: f.public_key,
    isOnline: !!f.is_online,
    status: 'accepted'
  }))});
});

// DELETE /api/friends/:userId
router.delete('/:userId', (req, res) => {
  stmts.removeFriend.run(req.user.id, req.params.userId, req.params.userId, req.user.id);
  res.json({ success: true, data: null });
});

// GET /api/users/:userId/public-key
router.get('/users/:userId/public-key', (req, res) => {
  const user = stmts.getUserById.get(req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  // Only return if they are friends
  const ok = stmts.areFriends.get(req.user.id, req.params.userId, req.params.userId, req.user.id);
  if (!ok) return res.status(403).json({ success: false, error: 'Not friends' });
  res.json({ success: true, data: { publicKey: user.public_key } });
});

// GET /api/users/:userId/online
router.get('/users/:userId/online', (req, res) => {
  const user = stmts.getUserById.get(req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: { isOnline: !!user.is_online } });
});

module.exports = router;
