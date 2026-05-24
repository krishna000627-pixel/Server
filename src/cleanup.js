/**
 * Standalone cleanup script — run via cron or Railway cron job
 * Deletes delivered messages older than 48h, offline users older than 30d
 * node src/cleanup.js
 */
const { db } = require('./db/database');

function cleanup() {
  const now = Math.floor(Date.now() / 1000);
  const msgCutoff = now - 48 * 3600;      // 48 hours
  const userCutoff = now - 30 * 86400;    // 30 days

  const deletedMsgs = db.prepare(
    "DELETE FROM messages WHERE status = 'delivered' AND created_at < ?"
  ).run(msgCutoff);

  const resetOffline = db.prepare(
    "UPDATE users SET is_online = 0 WHERE is_online = 1 AND last_seen < ?"
  ).run(now - 120); // 2 min timeout

  console.log(`[Cleanup] Deleted ${deletedMsgs.changes} old messages`);
  console.log(`[Cleanup] Reset ${resetOffline.changes} stale online statuses`);
}

cleanup();
