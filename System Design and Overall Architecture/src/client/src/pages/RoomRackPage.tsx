/**
 * UC-R12 View Room Availability / UC-R13 Update Room Status — the room rack.
 *
 * Drawn after the key board behind a hotel front desk: one fob per room, one
 * row per floor, top floor on top like the building itself. The fob colour is
 * the housekeeping state and always carries a word as well.
 *
 * The actions offered for a room are exactly the transitions §6.5 allows from
 * its current state; ASSIGN and CHECK_OUT belong to check-in/out and are never
 * offered here (the server refuses them too).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deskApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Drawer, ErrorNotice, Loading, Notice, PageHead, Status } from '../components/ui';
import { ROOM_STATUS, ROOM_STATUS_SHORT, stayDate, stayDateShort } from '../lib/format';
import type { Booking, Room, RoomEvent, RoomStatus, RoomType } from '../types';
import { refId } from '../types';

const ORDER: RoomStatus[] = ['VACANT_CLEAN', 'INSPECTED', 'VACANT_DIRTY', 'OCCUPIED', 'OUT_OF_ORDER'];

const ACTIONS: Record<RoomStatus, { event: RoomEvent; label: string; tone?: 'danger' | 'secondary' }[]> = {
  VACANT_CLEAN: [{ event: 'MARK_OUT_OF_ORDER', label: 'Take out of order', tone: 'danger' }],
  VACANT_DIRTY: [
    { event: 'CLEANED', label: 'Mark as cleaned' },
    { event: 'MARK_OUT_OF_ORDER', label: 'Take out of order', tone: 'danger' },
  ],
  INSPECTED: [
    { event: 'INSPECTION_PASSED', label: 'Passed — ready to sell' },
    { event: 'INSPECTION_FAILED', label: 'Failed — clean again', tone: 'secondary' },
  ],
  OUT_OF_ORDER: [{ event: 'REPAIRED', label: 'Repair finished' }],
  OCCUPIED: [],
};

export default function RoomRackPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const rack = useQuery({ queryKey: ['rack'], queryFn: deskApi.rack, refetchInterval: 30_000 });
  const overview = useQuery({ queryKey: ['desk-overview'], queryFn: deskApi.overview, refetchInterval: 60_000 });
  const [filter, setFilter] = useState<RoomStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Who is in which room, and who is due out today.
  const guestByRoom = useMemo(() => {
    const m = new Map<string, Booking>();
    overview.data?.inHouse.forEach((b) => {
      const id = refId(b.roomId as { _id: string } | string | undefined);
      if (id) m.set(id, b);
    });
    return m;
  }, [overview.data]);
  const dueOut = useMemo(() => new Set(overview.data?.departures.map((b) => refId(b.roomId as { _id: string } | string | undefined))), [overview.data]);

  const floors = useMemo(() => {
    const byFloor = new Map<number, Room[]>();
    rack.data?.rooms.forEach((r) => byFloor.set(r.floor, [...(byFloor.get(r.floor) ?? []), r]));
    return [...byFloor.entries()].sort((a, b) => b[0] - a[0]);
  }, [rack.data]);

  const room = rack.data?.rooms.find((r) => r._id === selected) ?? null;

  const update = useMutation({
    mutationFn: ({ event, notes }: { event: RoomEvent; notes?: string }) => deskApi.setRoomStatus(selected!, event, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rack'] });
      qc.invalidateQueries({ queryKey: ['desk-overview'] });
    },
  });

  return (
    <div className="stack">
      <PageHead
        title="Room rack"
        sub={rack.data ? `${rack.data.total} rooms. ${dueOut.size} guest${dueOut.size === 1 ? '' : 's'} due out today, marked with a dot.` : undefined}
      />

      {rack.isLoading && <Loading />}
      <ErrorNotice error={rack.error} />

      {rack.data && (
        <>
          <div className="rack-legend" role="group" aria-label="Show rooms by state">
            {ORDER.map((s) => (
              <button key={s} className="legend-item" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)}>
                <span className={`swatch ${s}`} aria-hidden="true" />
                {ROOM_STATUS[s]} <span className="n">{rack.data.summary[s] ?? 0}</span>
              </button>
            ))}
            {filter && <button className="btn ghost small" onClick={() => setFilter(null)}>Show all</button>}
          </div>

          <div className="rack">
            {floors.map(([floor, rooms]) => (
              <section className="floor" key={floor} aria-label={`Floor ${floor}`}>
                <div className="floor-label">
                  Floor {floor}
                  <span>{rooms.filter((r) => r.status === 'OCCUPIED').length}/{rooms.length} occupied</span>
                </div>
                <div className="fobs">
                  {rooms.map((r) => {
                    const guest = guestByRoom.get(r._id);
                    return (
                      <button
                        key={r._id}
                        className={`fob ${r.status} ${filter && filter !== r.status ? 'dim' : ''}`}
                        aria-pressed={selected === r._id}
                        aria-label={`Room ${r.roomNumber}, ${ROOM_STATUS[r.status]}${guest ? `, ${guest.guest.fullName}` : ''}`}
                        title={`${(r.roomTypeId as RoomType).name}${guest ? ` — ${guest.guest.fullName}` : ''}`}
                        onClick={() => { setSelected(r._id); update.reset(); }}
                      >
                        {dueOut.has(r._id) && <span className="due" aria-hidden="true">•</span>}
                        <span className="no">{r.roomNumber}</span>
                        <span className="st">{ROOM_STATUS_SHORT[r.status]}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {room && (
        <RoomDrawer
          room={room}
          guest={guestByRoom.get(room._id)}
          canUpdate={can('ROOM_STATUS_UPDATE')}
          busy={update.isPending}
          error={update.error}
          onAction={(event, notes) => update.mutate({ event, notes })}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function RoomDrawer({ room, guest, canUpdate, busy, error, onAction, onClose }: {
  room: Room;
  guest?: Booking;
  canUpdate: boolean;
  busy: boolean;
  error: unknown;
  onAction: (event: RoomEvent, notes?: string) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState('');
  const type = room.roomTypeId as RoomType;
  const actions = ACTIONS[room.status];

  return (
    <Drawer title={`Room ${room.roomNumber}`} onClose={onClose}>
      <div className="row between">
        <span className="muted">{type.name}, floor {room.floor}</span>
        <Status kind="room" value={room.status} />
      </div>

      {room.notes && <Notice tone="warn">{room.notes}</Notice>}

      {guest && (
        <div className="panel stack tight">
          <h3>{guest.guest.fullName}</h3>
          <p className="small muted">
            {stayDateShort(guest.checkInDate)} – {stayDate(guest.checkOutDate)}, {guest.adults} guest{guest.adults === 1 ? '' : 's'}
          </p>
          <Link to={`/staff/bookings/${guest._id}`} className="btn secondary">Open the stay</Link>
        </div>
      )}

      {room.status === 'OCCUPIED' && (
        <p className="small muted">An occupied room changes state only through check-out.</p>
      )}

      {canUpdate && actions.length > 0 && (
        <div className="stack tight">
          {actions.some((a) => a.event === 'MARK_OUT_OF_ORDER') && (
            <label className="field">
              Reason, if taking it out of order
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Shower drain blocked" />
            </label>
          )}
          <ErrorNotice error={error} />
          <div className="actions">
            {actions.map((a) => (
              <button
                key={a.event}
                className={`btn ${a.tone ?? ''}`}
                disabled={busy || (a.event === 'MARK_OUT_OF_ORDER' && !notes.trim())}
                onClick={() => onAction(a.event, a.event === 'MARK_OUT_OF_ORDER' ? notes.trim() : undefined)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!canUpdate && actions.length > 0 && <p className="small muted">Your role can view rooms but not change their state.</p>}
    </Drawer>
  );
}
