const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/images/send  — REST fallback when WS not available
router.post('/send', (req, res) => {
  try {
    const { recipientId, encryptedImage, encryptedAesKey, iv, messageId } = req.body;
    if (!recipientId || !encryptedImage || !encryptedAesKey || !iv) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    // Check friendship
    const ok = stmts.areFriends.get(req.user.id, recipientId);
    if (!ok) return res.status(403).json({ success: false, error: 'Not friends' });

    // Validate image size (max 5MB base64)
    if (encryptedImage.length > 7_000_000) {
      return res.status(413).json({ success: false, error: 'Image too large (max 5MB)' });
    }

    const id = messageId || uuidv4();
    stmts.insertMessage.run({
      id, sender_id: req.user.id, recipient_id: recipientId,
      encrypted_image: encryptedImage, encrypted_aes_key: encryptedAesKey, iv
    });

    const msg = {
      id, senderId: req.user.id, recipientId,
      encryptedImage, encryptedAesKey, iv,
      timestamp: Date.now(), status: 'stored'
    };

    // Try to push via WebSocket if recipient is connected
    const wsClients = req.app.get('wsClients');
    const recipientWs = wsClients?.get(recipientId);
    if (recipientWs && recipientWs.readyState === 1) {
      recipientWs.send(JSON.stringify({ type: 'incoming_image', data: msg }));
      stmts.markDelivered.run(Date.now(), id);
      msg.status = 'delivered';
    }

    res.json({ success: true, data: msg });
  } catch (e) {
    console.error('send image error:', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/images/pending — pull pending images (offline recovery)
router.get('/pending', (req, res) => {
  try {
    const msgs = stmts.getPendingMessages.all(req.user.id);
    res.json({ success: true, data: msgs.map(m => ({
      id: m.id,
      senderId: m.sender_id,
      recipientId: m.recipient_id,
      encryptedImage: m.encrypted_image,
      encryptedAesKey: m.encrypted_aes_key,
      iv: m.iv,
      timestamp: m.created_at * 1000,
      status: m.status
    }))});
  } catch (e) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/images/:messageId/ack — acknowledge delivery, delete from server
router.post('/:messageId/ack', (req, res) => {
  stmts.markDelivered.run(Date.now(), req.params.messageId);
  // Delete after 24h (handled by cleanup job) — or immediately on ack
  stmts.deleteMessage.run(req.params.messageId);
  res.json({ success: true, data: null });
});

module.exports = router;
