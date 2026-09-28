/** UC-G02 View Room / Room Type Details. */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { roomApi } from '../api/endpoints';
import { ErrorNotice, Loading } from '../components/ui';
import { money, stayDate } from '../lib/format';

export default function RoomTypePage() {
  const { id } = useParams<{ id: string }>();
  const { data: t, isLoading, error } = useQuery({ queryKey: ['room-type', id], queryFn: () => roomApi.type(id!) });

  return (
    <main className="site-main medium">
      {isLoading && <Loading />}
      <ErrorNotice error={error} />
      {t && (
        <div className="stack">
          <Link to="/" className="small">Back to all rooms</Link>
          <div>
            <h1>{t.name}</h1>
            <p className="muted" style={{ marginTop: 8 }}>{t.description}</p>
          </div>

          <div className="panel">
            <dl className="facts">
              <dt>Sleeps</dt>
              <dd>{t.capacity} {t.capacity === 1 ? 'guest' : 'guests'}</dd>
              <dt>Nightly rate</dt>
              <dd className="money">{money(t.basePrice)} before VAT</dd>
              <dt>Rooms of this type</dt>
              <dd>{t.totalRooms}</dd>
              <dt>In the room</dt>
              <dd>{t.amenities.join(', ')}</dd>
            </dl>
          </div>

          {t.seasonalRates && t.seasonalRates.length > 0 && (
            <div className="panel">
              <h3>Seasonal prices</h3>
              <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {t.seasonalRates.map((r) => (
                  <li key={r.from}>
                    {stayDate(r.from)} – {stayDate(r.to)}: <span className="money">{money(r.price)}</span> per night
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="actions">
            <Link to="/" className="btn">Check dates and book</Link>
          </div>
        </div>
      )}
    </main>
  );
}
