const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'snapbridge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    public_key TEXT NOT NULL,
    friend_key TEXT UNIQUE NOT NULL,
    is_online INTEGER DEFAULT 0,
    last_seen INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS friends (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT DEFAULT 'accepted',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, friend_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    encrypted_image TEXT NOT NULL,
    encrypted_aes_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    msg_type TEXT NOT NULL DEFAULT 'image',
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    snap_timer INTEGER DEFAULT 0,
    delivered_at INTEGER,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, status);
  CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_friend_key ON users(friend_key);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// Add msg_type column migration for existing DBs
try { db.prepare("ALTER TABLE messages ADD COLUMN msg_type TEXT NOT NULL DEFAULT 'image'").run(); }
catch { /* already exists */ }

// Add snap_timer column migration
try { db.prepare("ALTER TABLE messages ADD COLUMN snap_timer INTEGER DEFAULT 0").run(); }
catch { /* already exists */ }

// Add updatePublicKey if missing
try { db.prepare("ALTER TABLE users ADD COLUMN public_key_updated_at INTEGER DEFAULT 0").run(); }
catch { /* already exists */ }

const stmts = {
  createUser:         db.prepare('INSERT INTO users (id,username,password_hash,public_key,friend_key) VALUES (@id,@username,@password_hash,@public_key,@friend_key)'),
  getUserById:        db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByUsername:  db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  getUserByFriendKey: db.prepare('SELECT * FROM users WHERE friend_key = ?'),
  updatePublicKey:    db.prepare('UPDATE users SET public_key = ? WHERE id = ?'),
  setOnline:          db.prepare('UPDATE users SET is_online = ?, last_seen = ? WHERE id = ?'),
  areFriends:         db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"),
  addFriend:          db.prepare("INSERT OR IGNORE INTO friends (id,user_id,friend_id,status) VALUES (?,?,?,'accepted')"),
  getFriends:         db.prepare("SELECT u.id,u.username,u.friend_key,u.public_key,u.is_online FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='accepted'"),
  removeFriend:       db.prepare('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)'),
  insertMessage:      db.prepare("INSERT INTO messages (id,sender_id,recipient_id,encrypted_image,encrypted_aes_key,iv,msg_type,snap_timer,status) VALUES (@id,@sender_id,@recipient_id,@encrypted_image,@encrypted_aes_key,@iv,@msg_type,@snap_timer,'stored')"),
  getPendingMessages: db.prepare("SELECT * FROM messages WHERE recipient_id=? AND status!='delivered' ORDER BY created_at ASC"),
  markDelivered:      db.prepare("UPDATE messages SET status='delivered',delivered_at=? WHERE id=?"),
  deleteMessage:      db.prepare('DELETE FROM messages WHERE id=?'),
  // Admin
  getUserCount:       db.prepare('SELECT COUNT(*) as count FROM users'),
  deleteUser:         db.prepare('DELETE FROM users WHERE id = ?'),
  getAllUsers:        db.prepare('SELECT id,username,friend_key,is_online,created_at FROM users ORDER BY created_at DESC'),
};

module.exports = { db, stmts };
