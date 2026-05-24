require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('./db/database');
const { JWT_SECRET } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '12mb' })); // handles ~7MB encrypted images
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/images',  require('./routes/images'));
app.use('/api/users',   require('./routes/friends'));


// ── App Update Endpoint ───────────────────────────────────────────
// Persists in memory until server restart; safe for low-volume personal use.
// Push via: POST /api/update/push { adminSecret, version, apkUrl, releaseNotes }
let latestUpdate = { version: null, apkUrl: null, releaseNotes: null, pushedAt: null };

app.get('/api/update/latest', (req, res) => {
  res.json(latestUpdate);
});

app.post('/api/update/push', (req, res) => {
  const { adminSecret, version, apkUrl, releaseNotes } = req.body;
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!version) return res.status(400).json({ error: 'version required' });
  latestUpdate = { version, apkUrl: apkUrl || null, releaseNotes: releaseNotes || null, pushedAt: Date.now() };
  // Push live notification to all connected clients
  const msg = JSON.stringify({ type: 'update_available', data: latestUpdate });
  let pushed = 0;
  wsClients.forEach(ws => { if (ws.readyState === 1) { ws.send(msg); pushed++; } });
  console.log(`Update v${version} pushed to ${pushed} connected clients`);
  res.json({ ok: true, pushed });
});

app.get('/health', (_, res) => res.json({
  status: 'ok', ts: Date.now(),
  online: wsClients.size,
  users: stmts.getUserCount.get().count
}));

// ── WebSocket ─────────────────────────────────────────────────────
const wsClients = new Map();
app.set('wsClients', wsClients);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let userId = null;
  try {
    userId = jwt.verify(token, JWT_SECRET).userId;
    if (!stmts.getUserById.get(userId)) { ws.close(4001, 'User not found'); return; }
  } catch { ws.close(4001, 'Invalid token'); return; }

  wsClients.set(userId, ws);
  stmts.setOnline.run(1, Date.now(), userId);
  broadcastPresence(userId, true);
  deliverPending(userId, ws); // FIX: deliver ALL pending on connect

  ws.on('message', raw => {
    try { handleMessage(userId, ws, JSON.parse(raw.toString())); } catch {}
  });
  ws.on('close', () => {
    wsClients.delete(userId);
    stmts.setOnline.run(0, Date.now(), userId);
    broadcastPresence(userId, false);
  });
  ws.on('error', e => console.error(`WS ${userId}:`, e.message));
});

function handleMessage(senderId, senderWs, msg) {
  const { type, data } = msg;
  if (type === 'ping') { senderWs.send(JSON.stringify({ type: 'pong' })); return; }

  if (type === 'send_image' || type === 'send_text') {
    const isText = type === 'send_text';
    const { recipientId, messageId } = data;
    const encImg = isText ? data.encryptedText    : data.encryptedImage;
    const encKey = isText ? data.encryptedTextKey : data.encryptedAesKey;
    const iv     = isText ? data.textIv           : data.iv;

    if (!stmts.areFriends.get(senderId, recipientId)) {
      senderWs.send(JSON.stringify({ type: 'error', data: { msg: 'Not friends' } })); return;
    }
    // Storage guard — max 8MB per message
    if (!encImg || encImg.length > 8_000_000) {
      senderWs.send(JSON.stringify({ type: 'error', data: { msg: 'Content too large' } })); return;
    }

    const id = messageId || uuidv4();
    const ts = Date.now();
    stmts.insertMessage.run({
      id, sender_id: senderId, recipient_id: recipientId,
      encrypted_image: encImg, encrypted_aes_key: encKey, iv,
      msg_type: isText ? 'text' : 'image'
    });

    const outPayload = JSON.stringify({
      type: isText ? 'incoming_text' : 'incoming_image',
      data: isText
        ? { messageId: id, senderId, encryptedText: encImg, encryptedTextKey: encKey, textIv: iv, timestamp: ts }
        : { messageId: id, senderId, encryptedImage: encImg, encryptedAesKey: encKey, iv, timestamp: ts }
    });

    const recipWs = wsClients.get(recipientId);
    if (recipWs?.readyState === 1) {
      recipWs.send(outPayload);
      stmts.markDelivered.run(ts, id);
      senderWs.send(JSON.stringify({ type: 'delivered', data: { messageId: id } }));
    } else {
      senderWs.send(JSON.stringify({ type: 'queued', data: { messageId: id } }));
    }
  }

  if (type === 'seen') {
    const { messageId, senderId: origSender } = data;
    wsClients.get(origSender)?.send(JSON.stringify({ type: 'seen', data: { messageId } }));
  }
}

function broadcastPresence(userId, isOnline) {
  const payload = JSON.stringify({ type: 'friend_online', data: { userId, isOnline } });
  stmts.getFriends.all(userId).forEach(f => wsClients.get(f.id)?.send(payload));
}

// FIX: deliver all pending correctly typed on connect
function deliverPending(userId, ws) {
  for (const m of stmts.getPendingMessages.all(userId)) {
    if (ws.readyState !== 1) break;
    const isText = m.msg_type === 'text';
    ws.send(JSON.stringify({
      type: isText ? 'incoming_text' : 'incoming_image',
      data: isText
        ? { messageId: m.id, senderId: m.sender_id, encryptedText: m.encrypted_image, encryptedTextKey: m.encrypted_aes_key, textIv: m.iv, timestamp: m.created_at * 1000 }
        : { messageId: m.id, senderId: m.sender_id, encryptedImage: m.encrypted_image, encryptedAesKey: m.encrypted_aes_key, iv: m.iv, timestamp: m.created_at * 1000 }
    }));
    stmts.markDelivered.run(Date.now(), m.id);
  }
}

// ── Storage management — keeps DB lean for unlimited users on free tier ───────
const cleanupDelivered  = db.prepare("DELETE FROM messages WHERE status='delivered' AND created_at < ?");
const cleanupStale      = db.prepare("DELETE FROM messages WHERE status!='delivered' AND created_at < ?");
const resetStaleOnline  = db.prepare("UPDATE users SET is_online=0 WHERE is_online=1 AND last_seen < ?");
const vacuumDB          = db.prepare("VACUUM");

setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  const d = cleanupDelivered.run(now - 86400);        // delivered msgs: 24h TTL
  const s = cleanupStale.run(now - 7 * 86400);        // undelivered:    7d TTL
  const o = resetStaleOnline.run(Date.now() - 120_000);
  if (d.changes || s.changes || o.changes) {
    console.log(`[Cleanup] delivered=${d.changes} stale=${s.changes} onlineReset=${o.changes}`);
    // VACUUM after significant cleanup to reclaim disk space on free-tier SQLite
    if (d.changes + s.changes > 100) try { vacuumDB.run(); } catch {}
  }
}, 3_600_000); // every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SnapBridge :${PORT} | ${new Date().toISOString()}`));
