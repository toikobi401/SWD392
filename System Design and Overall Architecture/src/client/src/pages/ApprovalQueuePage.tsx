/**
 * «boundary» / user interaction — ApprovalQueuePage
 *
 * Realizes: UC-M06 Approve / Reject Leave Request, UC-M14 Approve Refund Request.
 *
 * The coverage override of UC-M06 exception 1.0.E2 is modelled honestly: the
 * first approval attempt is refused with COVERAGE_OVERRIDE_REQUIRED, and the
 * manager must type a justification before the second attempt is accepted. The
 * justification is stored and audit-logged, not merely dismissed client-side.
 */
import { useState } from 'react';
import {
  useDecideLeave,
  useDecideRefund,
  usePendingLeave,
  usePendingRefunds,
  formatDate,
  formatMoney,
} from '../hooks';
import { ApiError } from '../api/client';

type Tab = 'LEAVE' | 'REFUND';

export default function ApprovalQueuePage() {
  const [tab, setTab] = useState<Tab>('LEAVE');
  const [department, setDepartment] = useState('Front Office');

  return (
    <div className="page">
      <h1>Pending approvals</h1>

      <nav className="tabs">
        <button className={tab === 'LEAVE' ? 'active' : ''} onClick={() => setTab('LEAVE')}>
          Leave requests
        </button>
        <button className={tab === 'REFUND' ? 'active' : ''} onClick={() => setTab('REFUND')}>
          Refund requests
        </button>
      </nav>

      {tab === 'LEAVE' ? (
        <LeaveQueue department={department} onDepartmentChange={setDepartment} />
      ) : (
        <RefundQueue />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LeaveQueue({
  department,
  onDepartmentChange,
}: {
  department: string;
  onDepartmentChange: (d: string) => void;
}) {
  const { data, isLoading } = usePendingLeave(department);
  const decide = useDecideLeave();

  const [note, setNote] = useState<Record<string, string>>({});
  const [override, setOverride] = useState<Record<string, string>>({});
  const [needsOverride, setNeedsOverride] = useState<Record<string, string>>({});

  async function act(id: string, approve: boolean) {
    try {
      await decide.mutateAsync({
        id,
        approve,
        note: note[id],
        coverageOverrideJustification: override[id],
      });
      setNeedsOverride((s) => ({ ...s, [id]: '' }));
    } catch (err) {
      const error = err as ApiError;
      // Exception 1.0.E2 — surface the warning and demand a justification.
      if (error.code === 'COVERAGE_OVERRIDE_REQUIRED') {
        setNeedsOverride((s) => ({ ...s, [id]: error.message }));
      }
    }
  }

  if (isLoading) return <p>Loading…</p>;

  return (
    <>
      <label className="filter">
        Department
        <select value={department} onChange={(e) => onDepartmentChange(e.target.value)}>
          <option>Front Office</option>
          <option>Housekeeping</option>
          <option>F&amp;B</option>
          <option>Maintenance</option>
        </select>
      </label>

      {data?.requests.length === 0 && <p className="empty">Nothing awaiting a decision.</p>}

      <ul className="queue">
        {data?.requests.map((r) => (
          <li key={r._id} className="queue-item">
            <div className="queue-head">
              <strong>{r.type}</strong>
              <span>
                {formatDate(r.fromDate)} → {formatDate(r.toDate)} ({r.days} day
                {r.days === 1 ? '' : 's'})
              </span>
            </div>

            <p className="reason">{r.reason}</p>

            {/* BR-42 — a rejection requires a reason, so the field is always shown. */}
            <label>
              Note
              <input
                value={note[r._id] ?? ''}
                onChange={(e) => setNote({ ...note, [r._id]: e.target.value })}
                placeholder="Required when rejecting"
              />
            </label>

            {needsOverride[r._id] && (
              <div className="warning">
                <p>{needsOverride[r._id]}</p>
                <label>
                  Override justification (BR-41)
                  <input
                    value={override[r._id] ?? ''}
                    onChange={(e) => setOverride({ ...override, [r._id]: e.target.value })}
                    placeholder="Why is it safe to approve despite low coverage?"
                  />
                </label>
              </div>
            )}

            <div className="actions">
              <button
                onClick={() => act(r._id, true)}
                disabled={
                  decide.isPending ||
                  (Boolean(needsOverride[r._id]) && !override[r._id]?.trim())
                }
              >
                Approve
              </button>
              <button
                className="danger"
                onClick={() => act(r._id, false)}
                disabled={decide.isPending || !note[r._id]?.trim()}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------

function RefundQueue() {
  const { data, isLoading } = usePendingRefunds();
  const decide = useDecideRefund();

  const [amount, setAmount] = useState<Record<string, number>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  if (isLoading) return <p>Loading…</p>;

  return (
    <>
      {data?.requests.length === 0 && <p className="empty">No refund requests pending.</p>}

      <ul className="queue">
        {data?.requests.map((r) => (
          <li key={r._id} className="queue-item">
            <div className="queue-head">
              <strong>{r.referenceNumber}</strong>
              <span>{formatMoney(r.requestedAmount)}</span>
            </div>

            <p className="reason">
              {r.reasonCategory} — {r.description}
            </p>

            {/* Alternative flow 1.2 — a partial approval, capped by the server. */}
            <label>
              Approve amount
              <input
                type="number"
                min={0}
                max={r.requestedAmount}
                value={amount[r._id] ?? r.requestedAmount}
                onChange={(e) => setAmount({ ...amount, [r._id]: Number(e.target.value) })}
              />
            </label>

            <label>
              Note
              <input
                value={note[r._id] ?? ''}
                onChange={(e) => setNote({ ...note, [r._id]: e.target.value })}
                placeholder="Required when rejecting"
              />
            </label>

            <div className="actions">
              <button
                onClick={() =>
                  decide.mutate({
                    id: r._id,
                    approve: true,
                    approvedAmount: amount[r._id] ?? r.requestedAmount,
                    note: note[r._id],
                  })
                }
                disabled={decide.isPending}
              >
                Approve
              </button>
              <button
                className="danger"
                onClick={() =>
                  decide.mutate({ id: r._id, approve: false, note: note[r._id] })
                }
                disabled={decide.isPending || !note[r._id]?.trim()}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
