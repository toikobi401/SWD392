/**
 * UC-M06 Approve / Reject Leave, UC-M14 Approve Refund (the manager's queue),
 * and UC-E15/E16/E17 an employee's own leave.
 */
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi, refundApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNotice, Loading, Notice, PageHead, Stat, Status } from '../components/ui';
import { hotelTodayISO, LEAVE_TYPE, money, REFUND_STATUS, stayDate, stayDateShort, when } from '../lib/format';
import type { LeaveRequest, LeaveType, PersonRef, RefundRequest } from '../types';

const person = (p: PersonRef | string | undefined) => (p && typeof p !== 'string' ? p : undefined);

export function ApprovalsPage() {
  const { can, profile } = useAuth();
  const [tab, setTab] = useState<'leave' | 'refunds'>(can('APPROVE_LEAVE') ? 'leave' : 'refunds');
  const department = profile?.employee?.department ?? 'Front Office';

  const leave = useQuery({ queryKey: ['approvals', 'leave', department], queryFn: () => leaveApi.pending(department), enabled: can('APPROVE_LEAVE') });
  const refunds = useQuery({ queryKey: ['approvals', 'refunds'], queryFn: refundApi.pending, enabled: can('APPROVE_REFUND') });

  return (
    <div className="stack">
      <PageHead title="Approvals" sub={`Leave requests from ${department}, and refunds that need a manager.`} />
      <div className="tabs" role="tablist">
        {can('APPROVE_LEAVE') && (
          <button role="tab" aria-selected={tab === 'leave'} onClick={() => setTab('leave')}>
            Leave<span className="count">{leave.data?.length ?? ''}</span>
          </button>
        )}
        {can('APPROVE_REFUND') && (
          <button role="tab" aria-selected={tab === 'refunds'} onClick={() => setTab('refunds')}>
            Refunds<span className="count">{refunds.data?.length ?? ''}</span>
          </button>
        )}
      </div>

      {tab === 'leave' && (
        <>
          {leave.isLoading && <Loading />}
          <ErrorNotice error={leave.error} />
          {leave.data?.length === 0 && <Empty title="No leave waiting for you">New requests from your department appear here.</Empty>}
          <div className="stack">{leave.data?.map((r) => <LeaveDecision key={r._id} request={r} />)}</div>
        </>
      )}
      {tab === 'refunds' && (
        <>
          {refunds.isLoading && <Loading />}
          <ErrorNotice error={refunds.error} />
          {refunds.data?.length === 0 && <Empty title="No refunds waiting">Refunds above the automatic limit appear here.</Empty>}
          <div className="stack">{refunds.data?.map((r) => <RefundDecision key={r._id} request={r} />)}</div>
        </>
      )}
    </div>
  );
}

function LeaveDecision({ request }: { request: LeaveRequest }) {
  const qc = useQueryClient();
  const who = person(request.employeeId);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [coverageWarning, setCoverageWarning] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      leaveApi.decide(request._id, approve, { note: note || undefined, coverageOverrideJustification: override || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', 'leave'] }),
    onError: (err) => {
      // UC-M06 1.0.E2 — approving would leave the department short-staffed.
      if (err instanceof ApiError && err.code === 'COVERAGE_OVERRIDE_REQUIRED') setCoverageWarning(err.message);
    },
  });

  const balance = request.type === 'SICK' ? who?.leaveBalance?.sick : request.type === 'ANNUAL' ? who?.leaveBalance?.annual : undefined;

  return (
    <article className="panel stack tight">
      <div className="row between">
        <div>
          <h3>{who?.fullName ?? 'Employee'}</h3>
          <p className="small muted">{who?.position}</p>
        </div>
        <Status kind="leave" value={request.status} />
      </div>
      <dl className="facts">
        <dt>{LEAVE_TYPE[request.type]}</dt>
        <dd>{stayDateShort(request.fromDate)} – {stayDate(request.toDate)}, {request.days} day{request.days === 1 ? '' : 's'}</dd>
        {balance !== undefined && (<><dt>Days left</dt><dd>{balance}{balance < request.days ? ' — not enough, approve as unpaid or partly' : ''}</dd></>)}
        {request.reason && (<><dt>Reason</dt><dd>{request.reason}</dd></>)}
        <dt>Asked</dt><dd>{when(request.createdAt)}</dd>
      </dl>
      <label className="field">
        Note to the employee <span className="hint">Required when rejecting.</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {coverageWarning && (
        <div className="stack tight">
          <Notice tone="warn">{coverageWarning}</Notice>
          <label className="field">
            Why is it safe to approve anyway? <span className="hint">Kept in the audit log.</span>
            <input value={override} onChange={(e) => setOverride(e.target.value)} />
          </label>
        </div>
      )}
      {!(decide.error instanceof ApiError && decide.error.code === 'COVERAGE_OVERRIDE_REQUIRED') && <ErrorNotice error={decide.error} />}
      <div className="actions">
        <button className="btn" disabled={decide.isPending || (Boolean(coverageWarning) && !override.trim())} onClick={() => decide.mutate(true)}>Approve</button>
        <button className="btn secondary" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate(false)}>Reject</button>
      </div>
    </article>
  );
}

function RefundDecision({ request }: { request: RefundRequest }) {
  const qc = useQueryClient();
  const booking = typeof request.bookingId === 'string' ? undefined : request.bookingId;
  const who = person(request.requestedBy);
  const [amount, setAmount] = useState(request.requestedAmount);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (approve: boolean) => refundApi.decide(request._id, approve, { approvedAmount: approve ? amount : undefined, note: note || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', 'refunds'] }),
  });

  if (decide.data) {
    return <Notice tone="ok">{request.referenceNumber}: {REFUND_STATUS[decide.data.status] ?? decide.data.status}.{decide.data.status === 'REFUND_FAILED' ? ' payOS cannot refund automatically — accounts will transfer the money by hand.' : ''}</Notice>;
  }

  return (
    <article className="panel stack tight">
      <div className="row between">
        <div>
          <h3>{request.referenceNumber}</h3>
          <p className="small muted">{who?.fullName ?? booking?.guest.fullName}{booking ? `, booking ${booking.bookingCode}` : ''}</p>
        </div>
        <strong className="money">{money(request.requestedAmount)}</strong>
      </div>
      <dl className="facts">
        {booking && (<><dt>Stay</dt><dd>{stayDateShort(booking.checkInDate)} – {stayDate(booking.checkOutDate)}</dd></>)}
        <dt>Reason</dt><dd>{request.description || request.reasonCategory}</dd>
        <dt>Asked</dt><dd>{when(request.createdAt)}</dd>
      </dl>
      <div className="form-row">
        <label className="field">
          Refund amount <span className="hint">Less than asked is a partial approval.</span>
          <input type="number" min={0} max={request.requestedAmount} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <label className="field">
          Note <span className="hint">Required when declining.</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={decide.error} />
      <div className="actions">
        <button className="btn" disabled={decide.isPending || amount <= 0} onClick={() => decide.mutate(true)}>Approve {money(amount)}</button>
        <button className="btn secondary" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate(false)}>Decline</button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

export function MyLeavePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['my-leave'], queryFn: leaveApi.mine });
  const [form, setForm] = useState<{ type: LeaveType; fromDate: string; toDate: string; reason: string }>({
    type: 'ANNUAL', fromDate: hotelTodayISO(7), toDate: hotelTodayISO(7), reason: '',
  });

  const submit = useMutation({
    mutationFn: () => leaveApi.submit(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-leave'] }); setForm({ ...form, reason: '' }); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => leaveApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leave'] }),
  });

  return (
    <div className="stack">
      <PageHead title="My leave" />
      {isLoading && <Loading />}
      <ErrorNotice error={error} />

      {data?.balance && (
        <div className="stat-row" style={{ maxWidth: 420 }}>
          <Stat value={data.balance.annual} label="Annual days left" />
          <Stat value={data.balance.sick} label="Sick days left" />
        </div>
      )}

      <div className="split">
        <section className="stack">
          <h2>Requests</h2>
          {data?.requests.length === 0 && <Empty title="No requests yet" />}
          {data && data.requests.length > 0 && (
            <div className="panel flush table-wrap">
              <table className="data">
                <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r._id}>
                      <td>{LEAVE_TYPE[r.type]}</td>
                      <td className="nowrap">{stayDateShort(r.fromDate)} – {stayDate(r.toDate)}</td>
                      <td>{r.days}</td>
                      <td>
                        <Status kind="leave" value={r.status} />
                        {r.decisionNote && <div className="xs muted" style={{ marginTop: 4 }}>{r.decisionNote}</div>}
                      </td>
                      <td className="num">
                        {r.status === 'PENDING' && (
                          <button className="btn ghost small" disabled={cancel.isPending} onClick={() => cancel.mutate(r._id)}>Withdraw</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ErrorNotice error={cancel.error} />
        </section>

        <form className="panel form" onSubmit={(e: FormEvent) => { e.preventDefault(); submit.mutate(); }}>
          <h3>Ask for leave</h3>
          <label className="field">
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}>
              {Object.entries(LEAVE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="form-row">
            <label className="field">From<input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })} required /></label>
            <label className="field">To<input type="date" value={form.toDate} min={form.fromDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} required /></label>
          </div>
          <label className="field">Reason<textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <ErrorNotice error={submit.error} />
          {submit.isSuccess && <Notice tone="ok">Sent to your manager.</Notice>}
          <div className="actions"><button className="btn" disabled={submit.isPending}>Send request</button></div>
        </form>
      </div>
    </div>
  );
}
