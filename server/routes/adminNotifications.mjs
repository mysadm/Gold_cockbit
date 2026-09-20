import { Router } from 'express';
import { listOpen, dismiss } from '../adminNotifications.mjs';

// BIGSERIAL ids: digits only, and short enough to be an exact JS integer.
const ID_RE = /^\d{1,15}$/;

// Mounted under /api/admin behind requireAdmin (next to the admin users router).
export function createAdminNotificationsRouter(db) {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    res.json(await listOpen(db));
  });

  router.post('/notifications/:id/dismiss', async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Notification not found' });
    if (!(await dismiss(db, Number(req.params.id)))) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  });

  return router;
}
