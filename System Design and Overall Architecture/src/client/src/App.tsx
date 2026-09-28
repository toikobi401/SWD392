/**
 * Application shell and route table.
 *
 * `RequirePermission` hides what the caller's token does not allow. This is a
 * usability measure only — the server re-checks every request (§7.4.4), so a
 * user who forges their way past this gate still gets a 403.
 */
import { ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './hooks';
import RoomSearchPage from './pages/RoomSearchPage';
import BookingWizardPage from './pages/BookingWizardPage';
import LoginPage from './pages/LoginPage';
import FrontDeskPage from './pages/FrontDeskPage';
import ApprovalQueuePage from './pages/ApprovalQueuePage';
import MyBookingsPage from './pages/MyBookingsPage';
import PaymentResultPage from './pages/PaymentResultPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { loading, isAuthenticated, can } = useAuth();

  if (loading) return <p className="page">Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!can(permission)) {
    return (
      <div className="page">
        <h1>Not authorized</h1>
        <p>Your account does not have the {permission} permission.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Header() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="app-header">
      <Link to="/" className="brand">
        HMS
      </Link>

      <nav>
        <Link to="/">Search</Link>
        {user && <Link to="/my-bookings">My bookings</Link>}
        {can('CHECK_IN') && <Link to="/front-desk">Front desk</Link>}
        {(can('APPROVE_LEAVE') || can('APPROVE_REFUND')) && (
          <Link to="/approvals">Approvals</Link>
        )}
      </nav>

      <div className="session">
        {user ? (
          <>
            <span>{user.fullName}</span>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login">Sign in</Link>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header />

        <main>
          <Routes>
            {/* Public — Guest */}
            <Route path="/" element={<RoomSearchPage />} />
            <Route path="/book" element={<BookingWizardPage />} />
            <Route path="/login" element={<LoginPage />} />

            {/* payOS returnUrl / cancelUrl (orderCode in the path, see PaymentService) */}
            <Route path="/payment/result/:orderCode" element={<PaymentResultPage />} />
            <Route
              path="/payment/cancelled/:orderCode"
              element={<PaymentResultPage cancelled />}
            />

            {/* Customer */}
            <Route path="/my-bookings" element={<MyBookingsPage />} />

            {/* Receptionist */}
            <Route
              path="/front-desk"
              element={
                <RequirePermission permission="CHECK_IN">
                  <FrontDeskPage />
                </RequirePermission>
              }
            />

            {/* Manager */}
            <Route
              path="/approvals"
              element={
                <RequirePermission permission="APPROVE_LEAVE">
                  <ApprovalQueuePage />
                </RequirePermission>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
