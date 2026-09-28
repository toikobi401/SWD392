/**
 * Administration: UC-A01 Manage Accounts, UC-A02 Create Employee Account,
 * UC-A04 Lock / Deactivate, UC-A06 Assign Role, UC-A08 Revoke Role,
 * UC-A05/A07 Roles & Permissions, UC-A13/A14/A15 Audit Log,
 * UC-A12 Configure Payment Gateway.
 */
import { FormEvent, Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, paymentApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Dialog, Drawer, Empty, ErrorNotice, Loading, Notice, PageHead, Status } from '../components/ui';
import { hotelTodayISO, humanize, PERMISSION, PERMISSION_GROUPS, ROLE_NAME, when } from '../lib/format';
import type { Account, AccountStatus, RoleDoc } from '../types';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function AccountsPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ['accounts', search, status, page],
    queryFn: () => adminApi.accounts({ q: search || undefined, status: status || undefined, page, pageSize: 25 }),
  });
  const pages = accounts.data ? Math.max(1, Math.ceil(accounts.data.total / accounts.data.pageSize)) : 1;
  const account = accounts.data?.users.find((u) => u._id === selected) ?? null;

  return (
    <div className="stack">
      <PageHead title="Accounts" sub="Staff and customer accounts. Access comes from roles, never from the account itself.">
        <button className="btn" onClick={() => setCreating(true)}>Add staff member</button>
      </PageHead>

      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(q); setPage(1); }}>
        <input className="input grow" style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" aria-label="Search accounts" />
        <select className="input" style={{ width: 200 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="LOCKED">Locked</option>
          <option value="DEACTIVATED">Deactivated</option>
          <option value="PENDING_VERIFICATION">Email not verified</option>
        </select>
        <button className="btn secondary">Search</button>
      </form>

      {accounts.isLoading && <Loading />}
      <ErrorNotice error={accounts.error} />
      {accounts.data && accounts.data.users.length === 0 && <Empty title="No accounts match" />}
      {accounts.data && accounts.data.users.length > 0 && (
        <div className="panel flush table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Department</th><th>Status</th></tr></thead>
            <tbody>
              {accounts.data.users.map((u) => (
                <tr key={u._id} className="clickable" onClick={() => setSelected(u._id)}>
                  <td><button className="btn ghost small" style={{ padding: 0 }}>{u.fullName}</button></td>
                  <td className="muted">{u.email}</td>
                  <td>{u.roles.filter((r) => r.name !== 'EMPLOYEE').map((r) => ROLE_NAME[r.name] ?? r.name).join(', ') || (u.roles.length ? 'Employee' : '—')}</td>
                  <td>{u.department ?? '—'}</td>
                  <td><Status kind="account" value={u.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="row">
          <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="small muted">Page {page} of {pages}</span>
          <button className="btn secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {creating && <CreateEmployee onClose={() => setCreating(false)} />}
      {account && <AccountDrawer account={account} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CreateEmployee({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: adminApi.roles });
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', employeeCode: '', department: 'Front Office', position: '',
    hireDate: hotelTodayISO(0), baseSalary: 8_500_000, roleId: '',
  });
  const create = useMutation({
    mutationFn: () => adminApi.createEmployee({ ...form, roleId: form.roleId || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: k === 'baseSalary' ? Number(e.target.value) : e.target.value });

  if (create.data) {
    return (
      <Dialog title="Account created" onClose={onClose}>
        <p>Give {form.fullName} this temporary password. It is shown only once.</p>
        <p style={{ font: '700 22px/1.3 var(--font-display)', letterSpacing: '0.04em' }}>{create.data.temporaryPassword}</p>
        <p className="small muted">They sign in with {create.data.email} and should change it under Account.</p>
        <div className="actions end"><button className="btn" onClick={onClose}>Done</button></div>
      </Dialog>
    );
  }

  const assignable = roles.data?.filter((r) => !['CUSTOMER', 'GUEST', 'SUPER_ADMIN'].includes(r.name)) ?? [];

  return (
    <Dialog title="Add staff member" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <label className="field">Full name<input value={form.fullName} onChange={set('fullName')} required /></label>
        <div className="form-row">
          <label className="field">Email<input type="email" value={form.email} onChange={set('email')} required /></label>
          <label className="field">Phone<input value={form.phone} onChange={set('phone')} /></label>
        </div>
        <div className="form-row">
          <label className="field">Employee code<input value={form.employeeCode} onChange={set('employeeCode')} required placeholder="E0101" /></label>
          <label className="field">
            Department
            <select value={form.department} onChange={set('department')}>
              {['Front Office', 'Housekeeping', 'F&B', 'Maintenance', 'IT'].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="field">Position<input value={form.position} onChange={set('position')} required /></label>
          <label className="field">Start date<input type="date" value={form.hireDate} onChange={set('hireDate')} required /></label>
        </div>
        <div className="form-row">
          <label className="field">Base salary (VND)<input type="number" min={0} step={100000} value={form.baseSalary} onChange={set('baseSalary')} required /></label>
          <label className="field">
            Role
            <select value={form.roleId} onChange={set('roleId')}>
              <option value="">Employee only</option>
              {assignable.map((r) => <option key={r._id} value={r._id}>{ROLE_NAME[r.name] ?? r.name}</option>)}
            </select>
          </label>
        </div>
        <ErrorNotice error={create.error} />
        <div className="actions end">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create account'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function AccountDrawer({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: adminApi.roles });
  const history = useQuery({ queryKey: ['login-history', account._id], queryFn: () => adminApi.loginHistory(account._id) });
  const [roleToAdd, setRoleToAdd] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const setStatus = useMutation({ mutationFn: (s: AccountStatus) => adminApi.setStatus(account._id, s), onSuccess: invalidate });
  const assign = useMutation({ mutationFn: () => adminApi.assignRole(account._id, roleToAdd), onSuccess: () => { setRoleToAdd(''); invalidate(); } });
  const revoke = useMutation({ mutationFn: (roleId: string) => adminApi.revokeRole(account._id, roleId), onSuccess: invalidate });

  const held = new Set(account.roles.map((r) => r._id));
  const isSelf = profile?.id === account._id;

  return (
    <Drawer title={account.fullName} onClose={onClose}>
      <div className="row between">
        <span className="muted small">{account.email}</span>
        <Status kind="account" value={account.status} />
      </div>
      <dl className="facts">
        {account.position && (<><dt>Position</dt><dd>{account.position}, {account.department}</dd></>)}
        {account.employeeCode && (<><dt>Code</dt><dd>{account.employeeCode}</dd></>)}
        <dt>Created</dt><dd>{when(account.createdAt)}</dd>
        <dt>Last sign-in</dt><dd>{when(account.lastLoginAt)}</dd>
      </dl>

      <section className="stack tight">
        <h3>Roles</h3>
        {account.roles.length === 0 && <p className="small muted">No roles — this account can do nothing yet.</p>}
        {account.roles.map((r) => (
          <div className="row between" key={r._id}>
            <span>{ROLE_NAME[r.name] ?? r.name}</span>
            <button className="btn ghost small" disabled={revoke.isPending} onClick={() => revoke.mutate(r._id)}>Remove</button>
          </div>
        ))}
        <div className="row">
          <select className="input grow" value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value)} aria-label="Role to add">
            <option value="">Add a role…</option>
            {roles.data?.filter((r) => !held.has(r._id) && r.name !== 'GUEST').map((r) => (
              <option key={r._id} value={r._id}>{ROLE_NAME[r.name] ?? r.name}</option>
            ))}
          </select>
          <button className="btn secondary" disabled={!roleToAdd || assign.isPending} onClick={() => assign.mutate()}>Add</button>
        </div>
        <ErrorNotice error={assign.error ?? revoke.error} />
        <p className="xs muted">Takes effect at the person’s next sign-in, or within 15 minutes.</p>
      </section>

      <section className="stack tight">
        <h3>Access</h3>
        {isSelf ? (
          <p className="small muted">You cannot lock or deactivate your own account.</p>
        ) : (
          <div className="actions">
            {account.status !== 'ACTIVE' && <button className="btn" onClick={() => setStatus.mutate('ACTIVE')}>Reactivate</button>}
            {account.status === 'ACTIVE' && <button className="btn secondary" onClick={() => setStatus.mutate('LOCKED')}>Lock</button>}
            {account.status !== 'DEACTIVATED' && <button className="btn danger" onClick={() => setStatus.mutate('DEACTIVATED')}>Deactivate</button>}
          </div>
        )}
        <ErrorNotice error={setStatus.error} />
      </section>

      <section className="stack tight">
        <h3>Recent sign-ins</h3>
        {history.data?.length === 0 && <p className="small muted">None recorded.</p>}
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {history.data?.slice(0, 8).map((h) => (
            <li key={h._id}>{humanize(h.action)}, {when(h.timestamp)}{h.ipAddress ? ` from ${h.ipAddress}` : ''}</li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: adminApi.roles });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});

  const save = useMutation({
    mutationFn: (role: RoleDoc) => adminApi.setPermissions(role._id, [...draft[role._id]]),
    onSuccess: (_, role) => {
      setDraft((d) => { const n = { ...d }; delete n[role._id]; return n; });
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  const shown = roles.data?.filter((r) => r.name !== 'GUEST') ?? [];
  const current = (r: RoleDoc) => draft[r._id] ?? new Set(r.permissions);
  const toggle = (r: RoleDoc, p: string) => {
    const next = new Set(current(r));
    next.has(p) ? next.delete(p) : next.add(p);
    setDraft({ ...draft, [r._id]: next });
  };

  return (
    <div className="stack">
      <PageHead title="Roles & permissions" sub="What each role may do. A change reaches each person when they next sign in, or within 15 minutes when their access token renews." />
      {roles.isLoading && <Loading />}
      <ErrorNotice error={roles.error ?? save.error} />
      {roles.data && (
        <div className="panel flush table-wrap">
          <table className="data perm-matrix">
            <thead>
              <tr>
                <th>Permission</th>
                {shown.map((r) => <th key={r._id}>{ROLE_NAME[r.name] ?? r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.title}>
                  <tr><td colSpan={shown.length + 1} className="muted small" style={{ background: '#fafbfc', fontWeight: 600 }}>{g.title}</td></tr>
                  {g.items.map((p) => (
                    <tr key={p}>
                      <td>{PERMISSION[p] ?? p}</td>
                      {shown.map((r) => (
                        <td key={r._id}>
                          <input
                            type="checkbox"
                            aria-label={`${ROLE_NAME[r.name] ?? r.name}: ${PERMISSION[p] ?? p}`}
                            checked={current(r).has(p)}
                            disabled={r.name === 'SUPER_ADMIN'}
                            onChange={() => toggle(r, p)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="muted xs">Super admin always holds everything.</td>
                {shown.map((r) => (
                  <td key={r._id}>
                    {draft[r._id] && (
                      <button className="btn small" disabled={save.isPending} onClick={() => save.mutate(r)}>Save</button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function AuditLogPage() {
  const [filters, setFilters] = useState({ action: '', entityType: '', from: hotelTodayISO(-7), to: hotelTodayISO(0) });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  const log = useQuery({
    queryKey: ['audit', applied, page],
    queryFn: () => adminApi.audit({
      action: applied.action || undefined,
      entityType: applied.entityType || undefined,
      from: applied.from || undefined,
      // `to` is a date; include the whole day.
      to: applied.to ? `${applied.to}T23:59:59Z` : undefined,
      page,
      pageSize: 50,
    }),
  });

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await adminApi.exportAudit({ from: applied.from || undefined, to: applied.to ? `${applied.to}T23:59:59Z` : undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${applied.from}-to-${applied.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err);
    } finally {
      setExporting(false);
    }
  }

  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / 50)) : 1;

  return (
    <div className="stack">
      <PageHead title="Audit log" sub="Every sign-in, booking, payment, check-in and role change. Entries cannot be edited or deleted.">
        <button className="btn secondary" disabled={exporting} onClick={exportCsv}>{exporting ? 'Preparing…' : 'Export CSV'}</button>
      </PageHead>
      <ErrorNotice error={exportError} />

      <form className="panel form-row" onSubmit={(e: FormEvent) => { e.preventDefault(); setApplied(filters); setPage(1); }}>
        <label className="field">
          Event
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">All events</option>
            {['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'BOOKING_CREATED', 'BOOKING_CANCELLED', 'PAYMENT_CAPTURED', 'PAYMENT_AMOUNT_MISMATCH',
              'GUEST_CHECKED_IN', 'GUEST_CHECKED_OUT', 'REFUND_MANUAL_TRANSFER_REQUIRED', 'REFUND_APPROVED', 'LEAVE_APPROVED', 'LEAVE_REJECTED',
              'ROLE_ASSIGNED', 'ROLE_REVOKED', 'ROLE_PERMISSIONS_CHANGED', 'ACCOUNT_STATUS_CHANGED', 'EMPLOYEE_ACCOUNT_CREATED'].map((a) => (
              <option key={a} value={a}>{humanize(a)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          About
          <select value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
            <option value="">Anything</option>
            {['Booking', 'Payment', 'User', 'Role', 'LeaveRequest', 'RefundRequest', 'Settings'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">From<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="field">To<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn">Apply</button></div>
      </form>

      {log.isLoading && <Loading />}
      <ErrorNotice error={log.error} />
      {log.data && (
        <>
          <p className="small muted">{log.data.total.toLocaleString('en')} entries</p>
          {log.data.rows.length === 0 ? <Empty title="Nothing recorded for these filters" /> : (
            <div className="panel flush table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th>Event</th><th>About</th><th>Details</th></tr></thead>
                <tbody>
                  {log.data.rows.map((r) => (
                    <tr key={r._id}>
                      <td className="nowrap muted">{when(r.timestamp)}</td>
                      <td className="nowrap">{humanize(r.action)}</td>
                      <td className="nowrap">{r.entityType}</td>
                      <td className="xs muted" style={{ maxWidth: 420 }}>
                        {r.after ? Object.entries(r.after).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="row">
              <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
              <span className="small muted">Page {page} of {pages}</span>
              <button className="btn secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment gateway
// ---------------------------------------------------------------------------

export function PaymentSettingsPage() {
  const [url, setUrl] = useState('');
  const register = useMutation({ mutationFn: () => paymentApi.registerWebhook(url) });

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHead title="Payment gateway" sub="Guests pay through payOS by VietQR bank transfer." />

      <div className="panel stack tight">
        <h3>How payments are confirmed</h3>
        <p className="small">
          payOS tells the hotel about each transfer by calling a webhook. When a guest returns from the payOS page, the
          hotel also asks payOS directly — so bookings confirm even before the webhook is set up, or on a development
          machine payOS cannot reach.
        </p>
        <p className="small muted">payOS has no refund API: approved refunds are transferred back by hand from the hotel’s bank account.</p>
      </div>

      <form className="panel form" onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
        <h3>Register the webhook</h3>
        <label className="field">
          Public webhook URL <span className="hint">Must be HTTPS and reachable from the internet. During development, expose port 3000 with a tunnel such as ngrok.</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-domain/api/payments/payos/webhook" required />
        </label>
        <ErrorNotice error={register.error} />
        {register.isSuccess && <Notice tone="ok">payOS accepted the webhook and sent it a test call.</Notice>}
        <div className="actions"><button className="btn" disabled={register.isPending}>{register.isPending ? 'Registering…' : 'Register with payOS'}</button></div>
      </form>

      <div className="panel stack tight">
        <h3>Credentials</h3>
        <p className="small">
          The client ID, API key and checksum key are read from the server’s <code>.env</code> (<code>PAYOS_CLIENT_ID</code>,{' '}
          <code>PAYOS_API_KEY</code>, <code>PAYOS_CHECKSUM_KEY</code>). They are never stored in the database or sent to the browser.
        </p>
      </div>
    </div>
  );
}
