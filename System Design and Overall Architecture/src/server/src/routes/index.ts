/**
 * Route table — the mapping from HTTP endpoints to use cases.
 *
 * Each route names the use case it realizes, which makes §9's traceability
 * matrix verifiable by reading this one file. The permission on each protected
 * route is the authorization precondition from that use case's specification.
 */
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { BookingController, RoomController } from '../controllers/booking.controller';
import { FrontDeskController } from '../controllers/frontdesk.controller';
import { PaymentController } from '../controllers/payment.controller';
import {
  RefundController,
  LeaveController,
  AccountController,
  AuditController,
} from '../controllers/workflow.controller';
import {
  authenticate,
  optionalAuth,
  requirePermission,
} from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/error.middleware';
import { Permission } from '../models/enums';

const router = Router();
const h = asyncHandler;

// ---------------------------------------------------------------------------
// Public — Guest (no account required)
// ---------------------------------------------------------------------------

router.post(
  '/auth/register', // UC-G16
  validateBody([
    { field: 'fullName', required: true, type: 'string' },
    { field: 'email', required: true, type: 'string' },
    { field: 'password', required: true, type: 'string' },
    { field: 'confirmPassword', required: true, type: 'string' },
  ]),
  h(AuthController.register),
);
router.get('/auth/verify', h(AuthController.verifyEmail)); // UC-G16 step 11
router.post(
  '/auth/login', // UC-G17
  validateBody([
    { field: 'email', required: true, type: 'string' },
    { field: 'password', required: true, type: 'string' },
  ]),
  h(AuthController.login),
);
router.post('/auth/refresh', h(AuthController.refresh)); // UC-C02
router.post('/auth/forgot-password', h(AuthController.forgotPassword)); // UC-C03
router.post('/auth/reset-password', h(AuthController.resetPassword)); // UC-C03

router.get('/rooms/search', h(RoomController.search)); // UC-G01
router.get('/room-types', h(RoomController.list)); // room catalogue
router.get('/room-types/:id', h(RoomController.detail)); // UC-G02

// optionalAuth: the same endpoint serves an anonymous Guest and a signed-in
// Customer, who additionally accrues loyalty points (UC-G07 alt. flow 1.2).
router.post(
  '/bookings', // UC-G07
  optionalAuth,
  validateBody([
    { field: 'roomTypeId', required: true, type: 'string' },
    { field: 'checkInDate', required: true, type: 'date' },
    { field: 'checkOutDate', required: true, type: 'date' },
    { field: 'adults', required: true, type: 'number', min: 1 },
    { field: 'paymentMethod', required: true, type: 'string' },
  ]),
  h(BookingController.create),
);
router.get('/bookings/lookup', h(BookingController.lookup)); // UC-G13

// payOS — authenticated by HMAC signature, not by JWT (called by payOS itself).
router.post('/payments/payos/webhook', h(PaymentController.webhook)); // UC-G10 step 8
// Our result page, after the guest returns from the payOS checkout.
router.get('/payments/payos/:orderCode/reconcile', h(PaymentController.reconcile)); // UC-G10 alt. 1.3

// ---------------------------------------------------------------------------
// Authenticated — Customer self-service
// ---------------------------------------------------------------------------

router.use('/me', authenticate);
router.get('/me/bookings', h(BookingController.myBookings)); // UC-C11
router.get('/me/leave-requests', h(LeaveController.mine)); // UC-E15/E16/E17

router.post('/auth/logout', authenticate, h(AuthController.logout)); // UC-C04
router.post('/auth/change-password', authenticate, h(AuthController.changePassword)); // UC-C05
router.get('/auth/me', authenticate, h(AuthController.me));

router.get('/bookings/:id', authenticate, h(BookingController.detail)); // UC-C12 / UC-R02
router.post(
  '/bookings/:id/cancel', // UC-G14
  authenticate,
  requirePermission(Permission.BOOKING_CANCEL),
  h(BookingController.cancel),
);
router.post(
  '/refund-requests', // UC-C17
  authenticate,
  validateBody([
    { field: 'bookingId', required: true, type: 'string' },
    { field: 'amount', required: true, type: 'number', min: 1 },
    { field: 'reasonCategory', required: true, type: 'string' },
  ]),
  h(RefundController.request),
);

// ---------------------------------------------------------------------------
// Receptionist — front desk
// ---------------------------------------------------------------------------

router.get(
  '/front-desk/bookings', // UC-R01
  authenticate,
  requirePermission(Permission.BOOKING_READ),
  h(FrontDeskController.searchBooking),
);
router.get(
  '/front-desk/overview', // arrivals / in-house / departures
  authenticate,
  requirePermission(Permission.BOOKING_READ),
  h(FrontDeskController.overview),
);
router.get(
  '/front-desk/bookings/:id/folio',
  authenticate,
  requirePermission(Permission.BOOKING_READ),
  h(FrontDeskController.folioForBooking),
);
router.get(
  '/front-desk/allocatable', // UC-R06 step 6
  authenticate,
  requirePermission(Permission.CHECK_IN),
  h(FrontDeskController.allocatableRooms),
);
router.post(
  '/front-desk/check-in', // UC-R06
  authenticate,
  requirePermission(Permission.CHECK_IN),
  validateBody([
    { field: 'bookingId', required: true, type: 'string' },
    { field: 'roomId', required: true, type: 'string' },
    { field: 'roomVersion', required: true, type: 'number' },
  ]),
  h(FrontDeskController.checkIn),
);
router.post(
  '/front-desk/check-out', // UC-R09
  authenticate,
  requirePermission(Permission.CHECK_OUT),
  validateBody([{ field: 'bookingId', required: true, type: 'string' }]),
  h(FrontDeskController.checkOut),
);
router.get(
  '/rooms/availability', // UC-R12
  authenticate,
  requirePermission(Permission.BOOKING_READ),
  h(FrontDeskController.roomRack),
);
router.patch(
  '/rooms/:id/status', // UC-R13
  authenticate,
  requirePermission(Permission.ROOM_STATUS_UPDATE),
  h(FrontDeskController.updateRoomStatus),
);
router.get(
  '/folios/:id',
  authenticate,
  requirePermission(Permission.BOOKING_READ),
  h(FrontDeskController.folio),
);
router.post(
  '/folios/:id/charges', // UC-R19
  authenticate,
  requirePermission(Permission.PROCESS_PAYMENT),
  h(FrontDeskController.postCharge),
);
router.post(
  '/folios/:id/payments', // UC-R15
  authenticate,
  requirePermission(Permission.PROCESS_PAYMENT),
  validateBody([
    { field: 'amount', required: true, type: 'number', min: 1 },
    { field: 'method', required: true, type: 'string' },
  ]),
  h(FrontDeskController.takePayment),
);

// ---------------------------------------------------------------------------
// Employee self-service & Manager approvals
// ---------------------------------------------------------------------------

router.post('/leave-requests', authenticate, h(LeaveController.submit)); // UC-E15
router.post('/leave-requests/:id/cancel', authenticate, h(LeaveController.cancel)); // UC-E16
router.get(
  '/leave-requests/pending', // UC-M06 queue
  authenticate,
  requirePermission(Permission.APPROVE_LEAVE),
  h(LeaveController.pending),
);
router.patch(
  '/leave-requests/:id/decision', // UC-M06
  authenticate,
  requirePermission(Permission.APPROVE_LEAVE),
  h(LeaveController.decide),
);

router.get(
  '/refund-requests/pending', // UC-M14 queue
  authenticate,
  requirePermission(Permission.APPROVE_REFUND),
  h(RefundController.pending),
);
router.patch(
  '/refund-requests/:id/decision', // UC-M14
  authenticate,
  requirePermission(Permission.APPROVE_REFUND),
  h(RefundController.decide),
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

router.get(
  '/accounts', // UC-A01
  authenticate,
  requirePermission(Permission.MANAGE_ACCOUNTS),
  h(AccountController.list),
);
router.post(
  '/accounts', // UC-A02
  authenticate,
  requirePermission(Permission.MANAGE_ACCOUNTS),
  h(AccountController.createEmployee),
);
router.patch(
  '/accounts/:id/status', // UC-A04
  authenticate,
  requirePermission(Permission.MANAGE_ACCOUNTS),
  h(AccountController.setStatus),
);
router.post(
  '/accounts/:id/roles', // UC-A06
  authenticate,
  requirePermission(Permission.MANAGE_ROLES),
  h(AccountController.assignRole),
);
router.delete(
  '/accounts/:id/roles/:roleId', // UC-A08
  authenticate,
  requirePermission(Permission.MANAGE_ROLES),
  h(AccountController.revokeRole),
);
router.get(
  '/roles', // UC-A05
  authenticate,
  requirePermission(Permission.MANAGE_ROLES),
  h(AccountController.listRoles),
);
router.put(
  '/roles/:id/permissions', // UC-A07
  authenticate,
  requirePermission(Permission.MANAGE_ROLES),
  h(AccountController.configurePermissions),
);

router.post(
  '/payments/payos/confirm-webhook', // UC-A12 Configure Payment Gateway
  authenticate,
  requirePermission(Permission.MANAGE_SETTINGS),
  validateBody([{ field: 'webhookUrl', required: true, type: 'string' }]),
  h(PaymentController.registerWebhook),
);

router.get(
  '/audit-logs', // UC-A13
  authenticate,
  requirePermission(Permission.VIEW_AUDIT_LOG),
  h(AuditController.query),
);
router.get(
  '/audit-logs/login-history/:userId', // UC-A14
  authenticate,
  requirePermission(Permission.VIEW_AUDIT_LOG),
  h(AuditController.loginHistory),
);
router.get(
  '/audit-logs/export', // UC-A15
  authenticate,
  requirePermission(Permission.VIEW_AUDIT_LOG),
  h(AuditController.exportCsv),
);

export default router;
