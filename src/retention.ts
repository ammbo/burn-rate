export async function cleanup(db: D1Database, now = Date.now()): Promise<void> {
  const cutoff = new Date(now - 30 * 86400000).toISOString();
  const expired = `SELECT id FROM jobs WHERE created_at < ? AND (mode = 'house' OR status IN ('captured', 'failed', 'draft'))`;
  await db.batch([
    db.prepare("UPDATE jobs SET status = 'failed' WHERE status = 'casting' AND created_at < ?").bind(new Date(now - 600000).toISOString()),
    db.prepare(`DELETE FROM entries WHERE job_id IN (${expired})`).bind(cutoff),
    db.prepare(`DELETE FROM journal_versions WHERE job_id IN (${expired})`).bind(cutoff),
    db.prepare(`DELETE FROM jobs WHERE id IN (${expired})`).bind(cutoff),
    db.prepare("DELETE FROM access_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM access_attempts WHERE expires_at <= ?").bind(now),
    // Keep reservation rows for the lifetime cap, but discard old browser/IP hashes.
    db.prepare("UPDATE generation_requests SET session_id = '', ip_hash = '' WHERE created_at < ?").bind(now - 7 * 86400000),
  ]);
  console.log(JSON.stringify({ event: "retention_cleanup", cutoff }));
}
