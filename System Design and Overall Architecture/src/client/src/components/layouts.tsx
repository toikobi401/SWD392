/**
 * The two shells: the public site for guests, and the console for staff.
 * Route guards live here too. They hide what a token does not allow — the
 * server still refuses it (§7.4.4), so this is courtesy, not security.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_NAME } from '../lib/format';
import { Loading } from './ui';

function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark" aria-hidden="true" />
      Hotel HUB
    </Link>
  );
}

export function PublicLayout() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="site-head">
        <div className="inner">
          <Brand />
          <nav className="site-nav" aria-label="Main">
            <NavLink to="/" end>Rooms</NavLink>
            <NavLink to="/booking/lookup">Find my booking</NavLink>
            {profile && !profile.isStaff && <NavLink to="/my-bookings">My bookings</NavLink>}
            {profile?.isStaff && <NavLink to="/staff">Staff console</NavLink>}
          </nav>
          <div className="site-session">
            {profile ? (
              <>
                <NavLink to={profile.isStaff ? '/staff/account' : '/account'} className="muted">
                  {profile.fullName}
                </NavLink>
                <button
                  className="btn secondary small"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn secondary small">Sign in</Link>
                <Link to="/register" className="btn small">Create account</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </>
  );
}

type NavItem = { to: string; label: string; show: boolean; end?: boolean };

export function StaffLayout() {
  const { profile, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the page changes.
  useEffect(() => setOpen(false), [location.pathname]);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Front desk',
      items: [
        { to: '/staff', label: 'Today', show: can('BOOKING_READ'), end: true },
        { to: '/staff/rack', label: 'Room rack', show: can('BOOKING_READ') },
      ],
    },
    {
      title: 'Management',
      items: [{ to: '/staff/approvals', label: 'Approvals', show: can('APPROVE_LEAVE') || can('APPROVE_REFUND') }],
    },
    {
      title: 'Administration',
      items: [
        { to: '/staff/admin/accounts', label: 'Accounts', show: can('MANAGE_ACCOUNTS') },
        { to: '/staff/admin/roles', label: 'Roles & permissions', show: can('MANAGE_ROLES') },
        { to: '/staff/admin/audit', label: 'Audit log', show: can('VIEW_AUDIT_LOG') },
        { to: '/staff/admin/payments', label: 'Payment gateway', show: can('MANAGE_SETTINGS') },
      ],
    },
    {
      title: 'Me',
      items: [
        { to: '/staff/leave', label: 'My leave', show: true },
        { to: '/staff/account', label: 'Account', show: true },
      ],
    },
  ];

  const mainRole = profile?.roles.find((r) => r !== 'EMPLOYEE') ?? profile?.roles[0];

  return (
    <div className={`console ${open ? 'nav-open' : ''}`}>
      <div className="console-top">
        <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
          Menu
        </button>
        <Brand to="/staff" />
      </div>

      <aside className="sidebar" aria-label="Staff navigation">
        <Brand to="/staff" />
        {groups.map((g) => {
          const items = g.items.filter((i) => i.show);
          if (!items.length) return null;
          return (
            <nav className="nav-group" key={g.title} aria-label={g.title}>
              <h4>{g.title}</h4>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}>
                  {i.label}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="sidebar-foot">
          <div className="who">{profile?.fullName}</div>
          <div className="role">
            {mainRole ? ROLE_NAME[mainRole] ?? mainRole : ''}
            {profile?.employee?.department ? `, ${profile.employee.department}` : ''}
          </div>
          <div className="actions">
            <Link to="/" className="btn small">Guest site</Link>
            <button
              className="btn small"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="console-main">
        <Outlet />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (loading) return <main className="site-main"><Loading /></main>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  const location = useLocation();
  if (loading) return <main className="site-main"><Loading /></main>;
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile.isStaff) return <Navigate to="/my-bookings" replace />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const needed = Array.isArray(permission) ? permission : [permission];
  if (!needed.some(can)) {
    return (
      <div className="stack">
        <h1>Not available for your role</h1>
        <p className="muted">
          This page needs one of: {needed.join(', ')}. Ask an administrator if you need access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
