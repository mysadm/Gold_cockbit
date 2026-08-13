import { Router } from 'express';
import pg from 'pg';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const { Pool } = pg;

const HOLDINGS_COLUMNS = 'user_id, oz, g24, g21, g18, pounds, locked, created_at, updated_at';
const HOLDINGS_FIELDS = ['oz', 'g24', 'g21', 'g18', 'pounds'];
const SNAPSHOT_COLUMNS = 'id, user_id, intl_value_egp, egypt_value_egp, usd_egp_rate, recorded_at';
const TRANSACTION_COLUMNS = 'id, user_id, unit, side, amount, price_egp, recorded_at';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function holdingValidationError(field, value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return `${field} must be a non-negative number`;
  }
  if (field === 'oz' && !Number.isInteger(value)) {
    return 'oz must be a whole number';
  }
  return null;
}

function transactionDateError(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
    return 'recorded_at must be a valid YYYY-MM-DD date';
  }
  return null;
}

function toUtcMidnight(dateStr) {
  return dateStr ? `${dateStr}T00:00:00Z` : null;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function withTransactionClient(db, fn) {
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

export function createWalletRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(`SELECT ${HOLDINGS_COLUMNS} FROM wallet_holdings WHERE user_id = $1`, [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Wallet holdings not found' });
    res.json(rows[0]);
  });

  router.put('/', async (req, res) => {
    const updates = HOLDINGS_FIELDS.filter((field) => field in req.body);
    const lockProvided = 'locked' in req.body;

    if (updates.length === 0 && !lockProvided) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    for (const field of updates) {
      const error = holdingValidationError(field, req.body[field]);
      if (error) return res.status(400).json({ error });
    }
    if (lockProvided && typeof req.body.locked !== 'boolean') {
      return res.status(400).json({ error: 'locked must be a boolean' });
    }

    const setFields = [...updates];
    const values = updates.map((field) => req.body[field]);
    if (lockProvided) {
      setFields.push('locked');
      values.push(req.body.locked);
    }
    const setClause = setFields.map((field, index) => `${field} = $${index + 1}`).join(', ');

    const { rows } = await db.query(
      `UPDATE wallet_holdings SET ${setClause} WHERE user_id = $${setFields.length + 1} RETURNING ${HOLDINGS_COLUMNS}`,
      [...values, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Wallet holdings not found' });
    res.json(rows[0]);
  });

  router.get('/cost-basis', async (req, res) => {
    const { rows } = await db.query(
      `SELECT unit, side, amount, price_egp FROM wallet_transactions WHERE user_id = $1 ORDER BY recorded_at ASC, id ASC`,
      [userId]
    );

    const state = Object.fromEntries(HOLDINGS_FIELDS.map((unit) => [unit, { qty: 0, costTotal: 0, realizedEgp: 0 }]));

    for (const row of rows) {
      const unit = state[row.unit];
      const amount = Number(row.amount);
      const price = Number(row.price_egp);
      if (row.side === 'buy') {
        unit.qty += amount;
        unit.costTotal += amount * price;
      } else {
        const avgCost = unit.qty > 0 ? unit.costTotal / unit.qty : 0;
        unit.realizedEgp += (price - avgCost) * amount;
        unit.qty -= amount;
        unit.costTotal -= avgCost * amount;
      }
    }

    const result = HOLDINGS_FIELDS.map((unit) => ({
      unit,
      avgCostEgp: state[unit].qty > 0 ? state[unit].costTotal / state[unit].qty : 0,
      openQty: state[unit].qty,
      realizedEgp: state[unit].realizedEgp,
    }));
    res.json(result);
  });

  router.get('/snapshots', async (req, res) => {
    const { since } = req.query;
    if (since) {
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) return res.status(400).json({ error: 'since must be a valid date' });
      const { rows } = await db.query(
        `SELECT ${SNAPSHOT_COLUMNS} FROM wallet_snapshots WHERE user_id = $1 AND recorded_at >= $2 ORDER BY recorded_at`,
        [userId, sinceDate.toISOString()]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM wallet_snapshots WHERE user_id = $1 ORDER BY recorded_at`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/snapshots', async (req, res) => {
    const { intl_value_egp, egypt_value_egp, usd_egp_rate } = req.body;
    if (typeof intl_value_egp !== 'number' || Number.isNaN(intl_value_egp)) {
      return res.status(400).json({ error: 'intl_value_egp is required and must be a number' });
    }
    if (egypt_value_egp !== undefined && egypt_value_egp !== null && (typeof egypt_value_egp !== 'number' || Number.isNaN(egypt_value_egp))) {
      return res.status(400).json({ error: 'egypt_value_egp must be a number when provided' });
    }
    if (usd_egp_rate !== undefined && usd_egp_rate !== null && (typeof usd_egp_rate !== 'number' || Number.isNaN(usd_egp_rate))) {
      return res.status(400).json({ error: 'usd_egp_rate must be a number when provided' });
    }

    const { rows } = await db.query(
      `INSERT INTO wallet_snapshots (user_id, intl_value_egp, egypt_value_egp, usd_egp_rate, recorded_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, ((recorded_at AT TIME ZONE 'UTC')::date))
       DO UPDATE SET intl_value_egp = EXCLUDED.intl_value_egp, egypt_value_egp = EXCLUDED.egypt_value_egp, usd_egp_rate = EXCLUDED.usd_egp_rate, recorded_at = now()
       RETURNING ${SNAPSHOT_COLUMNS}`,
      [userId, intl_value_egp, egypt_value_egp ?? null, usd_egp_rate ?? null]
    );
    res.status(201).json(rows[0]);
  });

  router.get('/transactions', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC`,
      [userId]
    );
    res.json(rows);
  });

  router.get('/transactions/export.csv', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC`,
      [userId]
    );
    const header = 'id,unit,side,amount,price_egp,recorded_at';
    const lines = rows.map((row) =>
      [row.id, row.unit, row.side, Number(row.amount), Number(row.price_egp), new Date(row.recorded_at).toISOString()].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wallet-transactions.csv"');
    res.send([header, ...lines].join('\n') + '\n');
  });

  router.post('/transactions', async (req, res) => {
    const { unit, side, amount, price_egp, recorded_at } = req.body;

    if (!HOLDINGS_FIELDS.includes(unit)) {
      return res.status(400).json({ error: 'unit must be one of oz, g24, g21, g18, pounds' });
    }
    if (side !== 'buy' && side !== 'sell') {
      return res.status(400).json({ error: 'side must be buy or sell' });
    }
    if (typeof amount !== 'number' || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (unit === 'oz' && !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'oz amount must be a whole number' });
    }
    if (typeof price_egp !== 'number' || Number.isNaN(price_egp) || price_egp < 0) {
      return res.status(400).json({ error: 'price_egp must be a non-negative number' });
    }
    if (recorded_at !== undefined) {
      const error = transactionDateError(recorded_at);
      if (error) return res.status(400).json({ error });
    }

    try {
      const result = await withTransactionClient(db, async (client) => {
        const { rows: holdingsRows } = await client.query(
          `SELECT ${unit} AS current FROM wallet_holdings WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
        if (holdingsRows.length === 0) throw new HttpError(404, 'Wallet holdings not found');

        const current = Number(holdingsRows[0].current);
        const next = side === 'buy' ? current + amount : current - amount;
        if (next < 0) throw new HttpError(400, 'Not enough holdings to sell that amount');

        const { rows: txRows } = await client.query(
          `INSERT INTO wallet_transactions (user_id, unit, side, amount, price_egp, recorded_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now())) RETURNING ${TRANSACTION_COLUMNS}`,
          [userId, unit, side, amount, price_egp, toUtcMidnight(recorded_at)]
        );

        const { rows: updatedHoldings } = await client.query(
          `UPDATE wallet_holdings SET ${unit} = $1 WHERE user_id = $2 RETURNING ${HOLDINGS_COLUMNS}`,
          [next, userId]
        );

        return { transaction: txRows[0], holdings: updatedHoldings[0] };
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  router.patch('/transactions/:id', async (req, res) => {
    const body = req.body;

    if ('unit' in body && !HOLDINGS_FIELDS.includes(body.unit)) {
      return res.status(400).json({ error: 'unit must be one of oz, g24, g21, g18, pounds' });
    }
    if ('side' in body && body.side !== 'buy' && body.side !== 'sell') {
      return res.status(400).json({ error: 'side must be buy or sell' });
    }
    if ('amount' in body && (typeof body.amount !== 'number' || Number.isNaN(body.amount) || body.amount <= 0)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if ('price_egp' in body && (typeof body.price_egp !== 'number' || Number.isNaN(body.price_egp) || body.price_egp < 0)) {
      return res.status(400).json({ error: 'price_egp must be a non-negative number' });
    }
    if ('recorded_at' in body) {
      const error = transactionDateError(body.recorded_at);
      if (error) return res.status(400).json({ error });
    }

    try {
      const result = await withTransactionClient(db, async (client) => {
        const { rows: existingRows } = await client.query(
          `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [req.params.id, userId]
        );
        if (existingRows.length === 0) throw new HttpError(404, 'Transaction not found');
        const existing = existingRows[0];

        const newUnit = 'unit' in body ? body.unit : existing.unit;
        const newSide = 'side' in body ? body.side : existing.side;
        const newAmount = 'amount' in body ? body.amount : Number(existing.amount);
        const newPrice = 'price_egp' in body ? body.price_egp : Number(existing.price_egp);
        const newRecordedAt = 'recorded_at' in body ? toUtcMidnight(body.recorded_at) : null;

        if (newUnit === 'oz' && !Number.isInteger(newAmount)) {
          throw new HttpError(400, 'oz amount must be a whole number');
        }

        const { rows: holdingsRows } = await client.query(
          `SELECT oz, g24, g21, g18, pounds FROM wallet_holdings WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
        if (holdingsRows.length === 0) throw new HttpError(404, 'Wallet holdings not found');
        const holdings = holdingsRows[0];

        const oldUnit = existing.unit;
        const oldAmount = Number(existing.amount);
        const oldSide = existing.side;

        const working = {};
        for (const field of HOLDINGS_FIELDS) working[field] = Number(holdings[field]);

        working[oldUnit] = oldSide === 'buy' ? working[oldUnit] - oldAmount : working[oldUnit] + oldAmount;
        if (working[oldUnit] < 0) throw new HttpError(400, 'Editing this transaction would make holdings negative');

        working[newUnit] = newSide === 'buy' ? working[newUnit] + newAmount : working[newUnit] - newAmount;
        if (working[newUnit] < 0) throw new HttpError(400, 'Editing this transaction would make holdings negative');

        const affectedUnits = oldUnit === newUnit ? [oldUnit] : [oldUnit, newUnit];
        const setClause = affectedUnits.map((unit, index) => `${unit} = $${index + 1}`).join(', ');
        const values = affectedUnits.map((unit) => working[unit]);
        await client.query(
          `UPDATE wallet_holdings SET ${setClause} WHERE user_id = $${affectedUnits.length + 1}`,
          [...values, userId]
        );

        const { rows: updatedTxRows } = await client.query(
          `UPDATE wallet_transactions
           SET unit = $1, side = $2, amount = $3, price_egp = $4, recorded_at = COALESCE($5::timestamptz, recorded_at)
           WHERE id = $6 AND user_id = $7 RETURNING ${TRANSACTION_COLUMNS}`,
          [newUnit, newSide, newAmount, newPrice, newRecordedAt, req.params.id, userId]
        );

        const { rows: finalHoldingsRows } = await client.query(
          `SELECT ${HOLDINGS_COLUMNS} FROM wallet_holdings WHERE user_id = $1`,
          [userId]
        );

        return { transaction: updatedTxRows[0], holdings: finalHoldingsRows[0] };
      });
      res.json(result);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  router.delete('/transactions/:id', async (req, res) => {
    try {
      const result = await withTransactionClient(db, async (client) => {
        const { rows: existingRows } = await client.query(
          `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [req.params.id, userId]
        );
        if (existingRows.length === 0) throw new HttpError(404, 'Transaction not found');
        const existing = existingRows[0];

        const { rows: holdingsRows } = await client.query(
          `SELECT ${existing.unit} AS current FROM wallet_holdings WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
        if (holdingsRows.length === 0) throw new HttpError(404, 'Wallet holdings not found');

        const current = Number(holdingsRows[0].current);
        const reversed = existing.side === 'buy' ? current - Number(existing.amount) : current + Number(existing.amount);
        if (reversed < 0) throw new HttpError(400, 'Deleting this transaction would make holdings negative');

        await client.query(`UPDATE wallet_holdings SET ${existing.unit} = $1 WHERE user_id = $2`, [reversed, userId]);
        await client.query('DELETE FROM wallet_transactions WHERE id = $1 AND user_id = $2', [req.params.id, userId]);

        const { rows: finalHoldingsRows } = await client.query(
          `SELECT ${HOLDINGS_COLUMNS} FROM wallet_holdings WHERE user_id = $1`,
          [userId]
        );
        return finalHoldingsRows[0];
      });
      res.json({ holdings: result });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
