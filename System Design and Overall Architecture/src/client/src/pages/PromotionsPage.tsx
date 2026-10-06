/**
 * UC-M11 Manage Promotion Codes — with «include» UC-M19 View Promotion Usage,
 * «extend» UC-M20 Create, UC-M21 Edit and UC-M22 Activate / Deactivate.
 *
 * Codes are shown as the stub a guest would type; everything else is a plain
 * table. The rules (bounds, locked terms, limits) are the server's — this page
 * only explains them before the Manager hits one.
 */
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { promotionApi } from '../api/endpoints';
import { Dialog, Drawer, Empty, ErrorNotice, Loading, Notice, PageHead, Stat, Status } from '../components/ui';
import { calendarDate, discountLabel, hotelTodayISO, money } from '../lib/format';
import type { Promotion, PromotionForm, PromotionStatus } from '../types';

type Filter = 'ALL' | 'ACTIVE' | 'SCHEDULED' | 'ENDED' | 'INACTIVE';

const FILTERS: { key: Filter; label: string; match: (s: PromotionStatus) => boolean }[] = [
  { key: 'ALL', label: 'All', match: () => true },
  { key: 'ACTIVE', label: 'Active', match: (s) => s === 'ACTIVE' },
  { key: 'SCHEDULED', label: 'Starts later', match: (s) => s === 'SCHEDULED' },
  { key: 'ENDED', label: 'Ended or used up', match: (s) => s === 'EXPIRED' || s === 'USED_UP' },
  { key: 'INACTIVE', label: 'Switched off', match: (s) => s === 'INACTIVE' },
];

export default function PromotionsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const promotions = useQuery({ queryKey: ['promotions'], queryFn: promotionApi.list });

  const all = promotions.data ?? [];
  const shown = all.filter((p) => FILTERS.find((f) => f.key === filter)!.match(p.status));
  const selected = all.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="stack">
      <PageHead
        title="Promotion codes"
        sub="Codes guests enter when they book. A code counts one use per reservation, when the payment arrives."
      >
        <button className="btn" onClick={() => setCreating(true)}>New code</button>
      </PageHead>

      <div className="tabs" role="tablist" aria-label="Filter codes">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className="count">{all.filter((p) => f.match(p.status)).length}</span>
          </button>
        ))}
      </div>

      {promotions.isLoading && <Loading />}
      <ErrorNotice error={promotions.error} />
      {promotions.data && all.length === 0 && (
        <Empty title="No promotion codes yet">
          <p>Create one to give guests a discount when they book.</p>
        </Empty>
      )}
      {promotions.data && all.length > 0 && shown.length === 0 && <Empty title="No codes in this group" />}

      {shown.length > 0 && (
        <div className="panel flush table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Valid</th>
                <th>Uses</th>
                <th className="num">Brought in</th>
                <th>Shown to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setSelectedId(p.id)}>
                  <td>
                    <button className="code-tag" aria-label={`Open ${p.code}`}>{p.code}</button>
                    <div className="xs muted clamp">{p.description}</div>
                  </td>
                  <td className="nowrap">
                    {discountLabel(p)}
                    {p.minimumSpend > 0 && <div className="xs muted">from {money(p.minimumSpend)}</div>}
                  </td>
                  <td className="nowrap small">{calendarDate(p.validFrom)} – {calendarDate(p.validTo)}</td>
                  <td><Uses p={p} /></td>
                  <td className="num">
                    <span className="money">{money(p.usage.revenue)}</span>
                    <div className="xs muted">{p.usage.reservations} reservation{p.usage.reservations === 1 ? '' : 's'}</div>
                  </td>
                  <td className="small">{p.isPublic ? 'Everyone' : 'Given out'}</td>
                  <td><Status kind="promotion" value={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <PromotionDialog onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); setSelectedId(p.id); }} />}
      {selected && <PromotionDrawer p={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

/** Uses so far, against the limit when there is one. */
function Uses({ p }: { p: Promotion }) {
  if (!p.usageLimit) return <span className="small">{p.usedCount} <span className="muted xs">no limit</span></span>;
  const pct = Math.min(100, Math.round((p.usedCount / p.usageLimit) * 100));
  return (
    <div className="uses">
      <span className="small">{p.usedCount} of {p.usageLimit}</span>
      <span className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail — UC-M19 usage, and the actions
// ---------------------------------------------------------------------------

function PromotionDrawer({ p, onClose }: { p: Promotion; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['promotions'] });

  const toggle = useMutation({ mutationFn: () => promotionApi.setActive(p.id, !p.isActive), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => promotionApi.remove(p.id),
    onSuccess: () => { refresh(); onClose(); },
  });

  return (
    <Drawer title={<span className="code-tag large">{p.code}</span>} onClose={onClose}>
      <div className="row">
        <Status kind="promotion" value={p.status} />
        <span className="small muted">{p.isPublic ? 'Listed on the website' : 'Not listed: only guests you give it to'}</span>
      </div>
      <p>{p.description}</p>

      <dl className="facts">
        <dt>Discount</dt>
        <dd>{discountLabel(p)}{p.minimumSpend > 0 ? `, on bookings of ${money(p.minimumSpend)} or more before tax` : ''}</dd>
        <dt>Valid</dt>
        <dd>{calendarDate(p.validFrom)} to {calendarDate(p.validTo)}, booking date</dd>
        <dt>Limit</dt>
        <dd>{p.usageLimit ? `${p.usageLimit} reservations` : 'No limit'}</dd>
      </dl>

      <div>
        <h3 style={{ marginBottom: 10 }}>What it has brought in</h3>
        <div className="stat-row">
          <Stat value={p.usedCount} label={p.usedCount === 1 ? 'use' : 'uses'} />
          <Stat value={p.usage.rooms} label={`room${p.usage.rooms === 1 ? '' : 's'} booked, still standing`} />
          <Stat value={<span className="money">{money(p.usage.discountGiven)}</span>} label="given in discounts" />
          <Stat value={<span className="money">{money(p.usage.revenue)}</span>} label="paid, after discount" />
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>
          Uses count every paid reservation, including ones later cancelled. Rooms and amounts count only reservations
          that are confirmed, in house or completed.
        </p>
      </div>

      {p.status === 'USED_UP' && <Notice tone="warn">Every allowed use is taken. Raise the limit to let more guests use it.</Notice>}
      {!p.isActive && <Notice tone="info">Switched off: guests cannot use it. Bookings already made keep their discount.</Notice>}

      <ErrorNotice error={toggle.error ?? remove.error} />
      <div className="actions">
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {p.isActive ? 'Switch off' : 'Switch on'}
        </button>
        {p.deletable ? (
          <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete</button>
        ) : (
          <span className="xs muted">Guests have booked with it, so it stays on record. Switch it off instead of deleting.</span>
        )}
      </div>

      {editing && <PromotionDialog existing={p} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {confirmDelete && (
        <Dialog title={`Delete ${p.code}?`} onClose={() => setConfirmDelete(false)}>
          <p>No guest has used this code, so it can be removed completely. This cannot be undone.</p>
          <div className="actions end">
            <button className="btn secondary" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete code</button>
          </div>
        </Dialog>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Create (UC-M20) and edit (UC-M21)
// ---------------------------------------------------------------------------

const EXAMPLE_SPEND = 2_000_000;

function PromotionDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing?: Promotion;
  onClose: () => void;
  onSaved: (p: Promotion) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PromotionForm>(
    existing
      ? {
          code: existing.code,
          description: existing.description,
          discountType: existing.discountType,
          discountValue: existing.discountValue,
          validFrom: existing.validFrom,
          validTo: existing.validTo,
          usageLimit: existing.usageLimit,
          minimumSpend: existing.minimumSpend,
          isPublic: existing.isPublic,
        }
      : {
          code: '',
          description: '',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          validFrom: hotelTodayISO(0),
          validTo: hotelTodayISO(30),
          usageLimit: 0,
          minimumSpend: 0,
          isPublic: false,
        },
  );
  const locked = new Set(existing?.lockedFields ?? []);
  const termsLocked = locked.has('discountValue');

  const save = useMutation({
    mutationFn: () => {
      if (!existing) return promotionApi.create(form);
      // Send only what may change: locked terms are left out entirely.
      const { code: _code, ...rest } = form;
      const changes: Partial<PromotionForm> = { ...rest };
      for (const f of locked) delete changes[f];
      return promotionApi.update(existing.id, changes);
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
      onSaved(p);
    },
  });

  const set = <K extends keyof PromotionForm>(k: K, v: PromotionForm[K]) => setForm({ ...form, [k]: v });
  const percent = form.discountType === 'PERCENTAGE';

  // A worked example, so a Manager sees at once what the numbers mean.
  const exampleSpend = Math.max(EXAMPLE_SPEND, form.minimumSpend);
  const exampleOff = Math.min(
    exampleSpend,
    percent ? Math.round((exampleSpend * (form.discountValue || 0)) / 100) : form.discountValue || 0,
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Dialog title={existing ? `Edit ${existing.code}` : 'New promotion code'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="field">
            Code
            <span className="hint">{existing ? 'A code never changes once created.' : '4 to 20 letters or digits. Guests type it in.'}</span>
            <input
              value={form.code}
              disabled={Boolean(existing)}
              required
              minLength={4}
              maxLength={20}
              pattern="[A-Za-z0-9]{4,20}"
              autoCapitalize="characters"
              spellCheck={false}
              className="code-input"
              onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder="SUMMER15"
            />
          </label>
          <label className="field">
            Description
            <span className="hint">What guests see next to the code.</span>
            <input value={form.description} required maxLength={120} onChange={(e) => set('description', e.target.value)} placeholder="15 % off summer stays" />
          </label>
        </div>

        <fieldset className="field plain" disabled={termsLocked}>
          <legend>Discount</legend>
          {termsLocked && <span className="hint">Fixed: guests have booked with this code. Create a new code for different terms.</span>}
          <div className="row">
            <label className="check">
              <input type="radio" name="discountType" checked={percent} onChange={() => set('discountType', 'PERCENTAGE')} />
              Percentage
            </label>
            <label className="check">
              <input type="radio" name="discountType" checked={!percent} onChange={() => set('discountType', 'FIXED_AMOUNT')} />
              Fixed amount
            </label>
            <span className="with-unit">
              <input
                type="number"
                className="input"
                aria-label={percent ? 'Percent off' : 'Amount off, in đồng'}
                min={1}
                max={percent ? 100 : undefined}
                step={percent ? 1 : 1000}
                required
                value={form.discountValue || ''}
                onChange={(e) => set('discountValue', Number(e.target.value))}
              />
              <span className="unit">{percent ? '%' : '₫'}</span>
            </span>
          </div>
        </fieldset>

        <div className="form-row">
          <label className="field">
            First day
            <input type="date" value={form.validFrom} required onChange={(e) => set('validFrom', e.target.value)} />
          </label>
          <label className="field">
            Last day
            <span className="hint">Guests may book until midnight, hotel time.</span>
            <input type="date" value={form.validTo} min={form.validFrom} required onChange={(e) => set('validTo', e.target.value)} />
          </label>
        </div>

        <div className="form-row">
          <label className="field">
            Uses allowed
            <span className="hint">One use per reservation. 0 for no limit.{existing?.usedCount ? ` Used ${existing.usedCount} times so far.` : ''}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={form.usageLimit}
              onChange={(e) => set('usageLimit', Number(e.target.value))}
            />
          </label>
          <label className="field">
            Minimum spend, ₫
            <span className="hint">The whole reservation, before tax. 0 for none.</span>
            <input type="number" min={0} step={10000} value={form.minimumSpend} onChange={(e) => set('minimumSpend', Number(e.target.value))} />
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set('isPublic', e.target.checked)} />
          List it on the website, so any guest can find it
        </label>

        {form.discountValue > 0 && (
          <p className="small muted">
            Example: a reservation of {money(exampleSpend)} before tax gets {money(exampleOff)} off.
          </p>
        )}

        <ErrorNotice error={save.error} />
        <div className="actions end">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={save.isPending}>{existing ? 'Save changes' : 'Create code'}</button>
        </div>
      </form>
    </Dialog>
  );
}
