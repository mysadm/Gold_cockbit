import { useEffect, useState } from 'preact/hooks';
import {
  approveUser, disableUser, enableUser, listUsers, resetPassword, setDailyLimit, type AdminUser,
} from '../api/adminUsers';
import { Card, SectionLabel } from './primitives';

const TEXT = {
  en: {
    title: 'Users', pending: 'pending', active: 'Active', disabled: 'Disabled', pendingS: 'Pending',
    approve: 'Approve', disable: 'Disable', enable: 'Enable', save: 'Save', limit: 'Daily analyses',
    used: 'used today', reset: 'Reset password', newPassword: 'New password for', minPw: 'At least 8 characters.',
    admin: 'Admin', none: 'No users yet.', you: 'you', loading: 'Loading…', done: 'Password changed.',
  },
  ar: {
    title: 'المستخدمون', pending: 'بانتظار الموافقة', active: 'نشط', disabled: 'معطّل', pendingS: 'بانتظار الموافقة',
    approve: 'موافقة', disable: 'تعطيل', enable: 'تفعيل', save: 'حفظ', limit: 'التحليلات اليومية',
    used: 'استُخدم اليوم', reset: 'إعادة تعيين كلمة المرور', newPassword: 'كلمة مرور جديدة لـ', minPw: '٨ أحرف على الأقل.',
    admin: 'مدير', none: 'لا يوجد مستخدمون بعد.', you: 'أنت', loading: 'جارٍ التحميل…', done: 'تم تغيير كلمة المرور.',
  },
} as const;

export function UsersPanel({ ar, currentUserId, onPendingCount }: { ar: boolean; currentUserId: string; onPendingCount: (n: number) => void }) {
  const t = TEXT[ar ? 'ar' : 'en'];
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listUsers();
      setUsers(list);
      setLimits(Object.fromEntries(list.map((u) => [u.id, String(u.daily_ai_limit)])));
      onPendingCount(list.filter((u) => u.status === 'pending').length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function act(action: () => Promise<unknown>, message?: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (message) setNotice(message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusLabel = (u: AdminUser) => (u.status === 'pending' ? t.pendingS : u.status === 'active' ? t.active : t.disabled);

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel text={t.title.toUpperCase()} />
      {error && <div role="alert" style={{ color: 'var(--down)', marginBottom: 8, fontSize: 14 }}>{error}</div>}
      {notice && <div role="status" style={{ color: 'var(--up)', marginBottom: 8, fontSize: 14 }}>{notice}</div>}
      {users === null ? (
        <div className="soft-text">{t.loading}</div>
      ) : users.length === 0 ? (
        <div className="soft-text">{t.none}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((u) => {
            const self = u.id === currentUserId;
            const limitText = limits[u.id] ?? '';
            // Blank/negative would coerce to 0 or be rejected server-side; don't offer Save for them.
            const limitValid = /^\d+$/.test(limitText) && Number(limitText) <= 1000;
            const limitChanged = limitText !== String(u.daily_ai_limit);
            return (
              <Card key={u.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                      {u.display_name || u.email} {self && <span className="muted-text" style={{ fontWeight: 400 }}>({t.you})</span>}
                      {u.role === 'admin' && <span className="muted-text" style={{ fontWeight: 400 }}> · {t.admin}</span>}
                    </div>
                    <div className="muted-text" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{u.email}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      color: u.status === 'active' ? 'var(--up)' : u.status === 'pending' ? 'var(--caution)' : 'var(--down)',
                      border: '1px solid currentColor',
                    }}
                  >
                    {statusLabel(u)}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  {u.role !== 'admin' && (
                    <>
                      <label className="muted-text" style={{ fontSize: 13 }} htmlFor={`limit-${u.id}`}>{t.limit}</label>
                      <input
                        id={`limit-${u.id}`}
                        type="number" min={0} max={1000} style={{ width: 80 }}
                        value={limitText}
                        onInput={(e) => setLimits({ ...limits, [u.id]: (e.target as HTMLInputElement).value })}
                      />
                      <button type="button" className="btn-outline" style={{ padding: '6px 10px' }} disabled={!limitChanged || !limitValid}
                        onClick={() => act(() => setDailyLimit(u.id, Number(limitText)))}>
                        {t.save}
                      </button>
                      <span className="muted-text" style={{ fontSize: 13 }}>{u.ai_used_today} {t.used}</span>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {u.status === 'pending' && (
                    <button type="button" className="btn-primary" style={{ padding: '8px 14px' }} onClick={() => act(() => approveUser(u.id))}>{t.approve}</button>
                  )}
                  {/* The server only allows disabling an active user (409 otherwise), and never oneself. */}
                  {u.status === 'active' && !self && (
                    <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} onClick={() => act(() => disableUser(u.id))}>{t.disable}</button>
                  )}
                  {u.status === 'disabled' && (
                    <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} onClick={() => act(() => enableUser(u.id))}>{t.enable}</button>
                  )}
                  <button
                    type="button" className="btn-outline" style={{ padding: '8px 14px' }}
                    onClick={() => {
                      const password = window.prompt(`${t.newPassword} ${u.email}\n${t.minPw}`);
                      if (password) void act(() => resetPassword(u.id, password), t.done);
                    }}
                  >
                    {t.reset}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
