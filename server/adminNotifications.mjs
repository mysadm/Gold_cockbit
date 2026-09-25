// In-app admin notifications: at most one OPEN row per kind (partial unique index).

const PUBLIC = 'id, kind, message, created_at, updated_at';

function present(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    message: row.message,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function raiseNotification(db, { kind, message, detail = null }) {
  if (['1', 'true'].includes(process.env.DISABLE_NOTIFICATIONS)) return;
  await db.query(
    `INSERT INTO admin_notifications (kind, message, detail)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (kind) WHERE resolved_at IS NULL
     DO UPDATE SET message = EXCLUDED.message, detail = EXCLUDED.detail, updated_at = now()`,
    [kind, message, detail === null ? null : JSON.stringify(detail)]
  );
}

export async function resolveNotifications(db, kind) {
  await db.query('UPDATE admin_notifications SET resolved_at = now() WHERE kind = $1 AND resolved_at IS NULL', [kind]);
}

export async function listOpen(db) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC} FROM admin_notifications WHERE resolved_at IS NULL ORDER BY created_at DESC, id DESC`
  );
  return rows.map(present);
}

// True when an open notification was closed; false for an unknown or already closed id.
export async function dismiss(db, id) {
  const { rowCount } = await db.query(
    'UPDATE admin_notifications SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL',
    [id]
  );
  return rowCount > 0;
}
