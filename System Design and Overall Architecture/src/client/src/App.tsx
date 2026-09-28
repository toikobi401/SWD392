/**
 * Route table. Public pages sit in the site shell; staff pages in the console.
 * Each route is annotated with the use case it realizes (§9 traceability).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { PublicLayout, RequireAuth, RequirePermission, RequireStaff, StaffLayout } from './components/layouts';
import RoomSearchPage from './pages/RoomSearchPage';
import RoomTypePage from './pages/RoomTypePage';
import BookingWizardPage from './pages/BookingWizardPage';
import PaymentResultPage from './pages/PaymentResultPage';
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyEmailPage } from './pages/AuthPages';
import { AccountPage, BookingDetailPage, BookingLookupPage, MyBookingsPage } from './pages/CustomerPages';
import { FolioPage, FrontDeskPage, StaffBookingPage } from './pages/DeskPages';
import RoomRackPage from './pages/RoomRackPage';
import { ApprovalsPage, MyLeavePage } from './pages/StaffPages';
import { AccountsPage, AuditLogPage, PaymentSettingsPage, RolesPage } from './pages/AdminPages';
import { useAuth, homeFor } from './auth/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** /staff lands on the first page the role can use. */
function StaffHome() {
  const { profile, can } = useAuth();
  if (can('BOOKING_READ')) return <FrontDeskPage />;
  return <Navigate to={profile ? homeFor(profile) : '/login'} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Opt in to the v7 behaviours now, which also silences their warnings. */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<RoomSearchPage />} />                          {/* UC-G01 */}
              <Route path="/rooms/:id" element={<RoomTypePage />} />                   {/* UC-G02 */}
              <Route path="/book" element={<BookingWizardPage />} />                   {/* UC-G07 */}
              <Route path="/payment/result/:orderCode" element={<PaymentResultPage />} />  {/* UC-G10 */}
              <Route path="/payment/cancelled/:orderCode" element={<PaymentResultPage cancelled />} />
              <Route path="/booking/lookup" element={<BookingLookupPage />} />         {/* UC-G13 */}
              <Route path="/login" element={<LoginPage />} />                          {/* UC-G17 */}
              <Route path="/register" element={<RegisterPage />} />                    {/* UC-G16 */}
              <Route path="/verify" element={<VerifyEmailPage />} />                   {/* UC-G16 step 11 */}
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />       {/* UC-C03 */}
              <Route path="/my-bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />       {/* UC-C11 */}
              <Route path="/bookings/:id" element={<RequireAuth><BookingDetailPage /></RequireAuth>} />   {/* UC-C12, G14, C17 */}
              <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />             {/* UC-C05 */}
            </Route>

            <Route path="/staff" element={<RequireStaff><StaffLayout /></RequireStaff>}>
              <Route index element={<StaffHome />} />                                                    {/* front desk today */}
              <Route path="rack" element={<RequirePermission permission="BOOKING_READ"><RoomRackPage /></RequirePermission>} />   {/* UC-R12/R13 */}
              <Route path="bookings/:id" element={<RequirePermission permission="BOOKING_READ"><StaffBookingPage /></RequirePermission>} />  {/* UC-R06/R09 */}
              <Route path="folios/:id" element={<RequirePermission permission="BOOKING_READ"><FolioPage /></RequirePermission>} />  {/* UC-R15/R19 */}
              <Route path="approvals" element={<RequirePermission permission={['APPROVE_LEAVE', 'APPROVE_REFUND']}><ApprovalsPage /></RequirePermission>} />  {/* UC-M06/M14 */}
              <Route path="leave" element={<MyLeavePage />} />                                          {/* UC-E15/E16 */}
              <Route path="account" element={<AccountPage inConsole />} />
              <Route path="admin/accounts" element={<RequirePermission permission="MANAGE_ACCOUNTS"><AccountsPage /></RequirePermission>} />  {/* UC-A01..A08 */}
              <Route path="admin/roles" element={<RequirePermission permission="MANAGE_ROLES"><RolesPage /></RequirePermission>} />          {/* UC-A05/A07 */}
              <Route path="admin/audit" element={<RequirePermission permission="VIEW_AUDIT_LOG"><AuditLogPage /></RequirePermission>} />     {/* UC-A13..A15 */}
              <Route path="admin/payments" element={<RequirePermission permission="MANAGE_SETTINGS"><PaymentSettingsPage /></RequirePermission>} />  {/* UC-A12 */}
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
