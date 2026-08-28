import pg from 'pg';

const { Pool } = pg;

// Routes receive either a pg.Pool (production, server/index.mjs) or a single
// already-connected pg.Client (tests, see tests/helpers/test-db.mjs). A Pool
// needs a checked-out client so BEGIN/COMMIT/ROLLBACK all run on the same
// connection; a Client already is that single connection.
export async function withTransactionClient(db, fn) {
  const isPool = db instanceof Pool;
  const client = isPool ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isPool) client.release();
  }
}
