/**
 * Demo operational data — a believable hotel on an ordinary day.
 *
 * Built from a per-room timeline rather than independent random rows: each
 * room gets a sequence of stays with gaps, and every status is DERIVED from
 * where "today" falls on that timeline. That makes the data consistent by
 * construction —
 *   • an OCCUPIED room has exactly one CHECKED_IN stay (BR-25);
 *   • no night is sold beyond the rooms of that type (availability ≥ 0);
 *   • folio totals equal their charges, and balance = charges − payments;
 *   • invoice numbers run gapless in check-out order (BR-30);
 * — and `verifyDemoInvariants` checks all of it afterwards.
 *
 * Deterministic: a fixed PRNG seed gives the same hotel on every run.
 * Development only. Run with `npm run seed:demo` (add `-- --reset` to replace
 * existing operational data; accounts, roles and rooms are kept).
 */
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Role, User, Customer, Employee, IEmployee } from '../models/user.model';
import {
  Booking,
  InventoryHold,
  LoyaltyAccount,
  Promotion,
  Room,
  RoomType,
  Service,
  IRoom,
  IRoomType,
} from '../models/booking.model';
import {
  Charge,
  DrawerSession,
  Folio,
  Invoice,
  InvoiceCounter,
  Payment,
  RefundRequest,
} from '../models/billing.model';
import { AuditLog, LeaveRequest, Shift, Task, Attendance, Payslip } from '../models/hr.model';
import {
  AccountStatus,
  BookingStatus,
  ChargeType,
  FolioStatus,
  LeaveStatus,
  LeaveType,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  RoleName,
  RoomStatus,
} from '../models/enums';
import { PricingRule, TAX_RATE } from '../rules/pricing.rule';
import { InvoiceNumberGenerator } from '../rules/invoice-number.generator';
import { hotelToday, addDays } from '../utils/hotel-time';
import { DEV_PASSWORD, seedAll } from './seed';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(20260929);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương'];
const MIDDLE_F = ['Thị', 'Ngọc', 'Thu', 'Minh', 'Thanh', 'Bảo'];
const MIDDLE_M = ['Văn', 'Đức', 'Minh', 'Quang', 'Hữu', 'Gia'];
const GIVEN_F = ['Hương', 'Lan', 'Mai', 'Linh', 'Trang', 'Hà', 'Thảo', 'Ngân', 'Vy', 'Anh', 'Quỳnh', 'Phương'];
const GIVEN_M = ['Minh', 'Hùng', 'Dũng', 'Nam', 'Tuấn', 'Khoa', 'Long', 'Phúc', 'Huy', 'Bình', 'Quân', 'Sơn'];
const FOREIGN = [
  'Emma Schmidt', 'Liam O\'Connor', 'Sakura Tanaka', 'Kim Min-jun', 'Olivia Brown', 'Lucas Martin',
  'Chen Wei', 'Sophie Dubois', 'Noah Wilson', 'Aiko Suzuki', 'Mateo García', 'Ava Johnson',
];

function vietnameseName(): string {
  const female = chance(0.5);
  return [pick(FAMILY), pick(female ? MIDDLE_F : MIDDLE_M), pick(female ? GIVEN_F : GIVEN_M)].join(' ');
}

function asciiSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function randomGuest() {
  const fullName = chance(0.8) ? vietnameseName() : pick(FOREIGN);
  return {
    fullName,
    email: `${asciiSlug(fullName)}${int(1, 99)}@example.com`,
    phone: `09${int(10000000, 99999999)}`,
  };
}

const STAFF = [
  { email: 'le.minh.tan@hms.local', fullName: 'Lê Minh Tân', department: 'Front Office', position: 'Receptionist', roles: [RoleName.RECEPTIONIST] },
  { email: 'tran.thu.ha@hms.local', fullName: 'Trần Thu Hà', department: 'Front Office', position: 'Receptionist', roles: [RoleName.RECEPTIONIST] },
  { email: 'nguyen.van.binh@hms.local', fullName: 'Nguyễn Văn Bình', department: 'Housekeeping', position: 'Housekeeping Supervisor', roles: [] },
  { email: 'pham.thi.lan@hms.local', fullName: 'Phạm Thị Lan', department: 'Housekeeping', position: 'Room Attendant', roles: [] },
  { email: 'do.thi.mai@hms.local', fullName: 'Đỗ Thị Mai', department: 'Housekeeping', position: 'Room Attendant', roles: [] },
  { email: 'hoang.van.nam@hms.local', fullName: 'Hoàng Văn Nam', department: 'Housekeeping', position: 'Room Attendant', roles: [] },
  { email: 'vu.duc.anh@hms.local', fullName: 'Vũ Đức Anh', department: 'F&B', position: 'Restaurant Captain', roles: [] },
  { email: 'ngo.thi.thu@hms.local', fullName: 'Ngô Thị Thu', department: 'F&B', position: 'Server', roles: [] },
  { email: 'bui.quang.huy@hms.local', fullName: 'Bùi Quang Huy', department: 'Maintenance', position: 'Technician', roles: [] },
  { email: 'dang.minh.khoa@hms.local', fullName: 'Đặng Minh Khoa', department: 'Maintenance', position: 'Technician', roles: [] },
];

const DEMO_CUSTOMERS = [
  'Nguyễn Thị Hương', 'Trần Quang Huy', 'Lê Ngọc Anh', 'Phạm Đức Long', 'Võ Thanh Trang', 'Sakura Tanaka',
];

// ---------------------------------------------------------------------------

type Stay = {
  room: IRoom;
  roomType: IRoomType;
  checkIn: Date;
  checkOut: Date;
  status: BookingStatus;
};

const OUT_OF_ORDER_NOTES = [
  'Air conditioner compressor failed — technician ordered part',
  'Bathroom leak under the vanity — plumbing repair in progress',
  'Repainting after water damage — ready in 3 days',
];

const EXTRAS = [
  { description: 'Minibar', amount: 85_000 },
  { description: 'Laundry', amount: 100_000 },
  { description: 'Restaurant — dinner', amount: 320_000 },
  { description: 'Spa — 60 min', amount: 500_000 },
  { description: 'Room service', amount: 180_000 },
];

const OCCUPANCY: Record<string, number> = {
  'Standard Single': 0.68,
  'Standard Double': 0.72,
  'Superior Twin': 0.62,
  'Deluxe Sea View': 0.75,
  'Family Suite': 0.5,
  'Presidential Suite': 0.35,
};

const PAST_DAYS = 14;
const FUTURE_DAYS = 30;

/** Local 14:00 check-in / 11:00 check-out, as UTC instants (UTC+7). */
const at = (day: Date, hourLocal: number, minute = 0) =>
  new Date(day.getTime() + (hourLocal - 7) * 3_600_000 + minute * 60_000);

/**
 * History never happens in the future. A schedule time such as today's 14:00
 * check-in is still ahead at 03:00, so anything that "already happened" is
 * pulled back to shortly before now.
 */
let NOW = new Date();
// The offset is derived from the date itself rather than drawn from the PRNG,
// so clamping never shifts the random sequence (the data stays reproducible).
const past = (d: Date) =>
  d > NOW ? new Date(NOW.getTime() - (5 + (Math.floor(d.getTime() / 60_000) % 85)) * 60_000) : d;

// ---------------------------------------------------------------------------

export async function seedDemoData(options: { reset?: boolean } = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to generate demo data in production');
  }
  rand = mulberry32(20260929);
  NOW = new Date();

  await seedAll(); // roles, 6 room types / 120 rooms, services, dev accounts

  const existing = await Booking.countDocuments();
  if (existing && !options.reset) {
    throw new Error(
      `The database already has ${existing} booking(s). Re-run with --reset to replace ` +
        'operational data (accounts, roles and rooms are kept).',
    );
  }
  if (options.reset) await wipeOperational();

  const today = hotelToday();
  const staff = await ensureStaff();
  const receptionists = staff.filter((s) => s.position === 'Receptionist');
  const customers = await ensureCustomers();
  const demoCustomer = customers.find((c) => c.email === 'customer@hms.local')!;

  const roomTypes = await RoomType.find();
  const typeById = new Map(roomTypes.map((t) => [String(t._id), t]));
  const rooms = await Room.find().sort({ roomNumber: 1 });
  const breakfast = await Service.findOne({ name: 'Breakfast buffet' });
  const promotion = await Promotion.findOne({ code: 'WELCOME10' });

  // Re-seed here: creating accounts above draws random numbers only the first
  // time (they already exist on a --reset run), which would shift everything
  // after it. Re-seeding makes the hotel identical on every run.
  rand = mulberry32(20260929);

  // Three rooms are out of order today — spread across floors and types.
  const outOfOrder = new Set([rooms[7], rooms[74], rooms[101]].map((r) => String(r._id)));

  // ---- 1. Per-room timelines -------------------------------------------------
  const stays: Stay[] = [];
  for (const room of rooms) {
    const roomType = typeById.get(String(room.roomTypeId))!;
    const baseP = OCCUPANCY[roomType.name] ?? 0.6;
    const isOOO = outOfOrder.has(String(room._id));
    let cursor = addDays(today, -PAST_DAYS - int(0, 3));
    let occupiedNow = false;

    while (cursor < addDays(today, FUTURE_DAYS)) {
      const daysAhead = (cursor.getTime() - today.getTime()) / 86_400_000;
      // Demand thins out further ahead, as bookings arrive over time.
      const p = daysAhead <= 0 ? baseP : baseP * Math.max(0.15, 1 - daysAhead / 40);
      const nights = roomType.capacity >= 4 ? int(2, 6) : int(1, 5);
      const checkIn = cursor;
      const checkOut = addDays(cursor, nights);

      // An out-of-order room takes no stay that touches today or later.
      const blocked = isOOO && checkOut >= addDays(today, -1);

      if (!blocked && chance(p)) {
        let status: BookingStatus;
        if (checkOut < today) status = BookingStatus.CHECKED_OUT;
        else if (checkOut.getTime() === today.getTime()) {
          // Due out today: some have already left, some are still in house.
          status = chance(0.5) ? BookingStatus.CHECKED_OUT : BookingStatus.CHECKED_IN;
        } else if (checkIn < today) status = BookingStatus.CHECKED_IN;
        else if (checkIn.getTime() === today.getTime()) {
          // Arriving today: a few early arrivals are already in their room —
          // possible only if the previous guest has left.
          status = !occupiedNow && chance(0.3) ? BookingStatus.CHECKED_IN : BookingStatus.CONFIRMED;
        } else status = BookingStatus.CONFIRMED;

        if (status === BookingStatus.CHECKED_IN) occupiedNow = true;
        stays.push({ room, roomType, checkIn, checkOut, status });
        cursor = addDays(checkOut, int(0, 2));
      } else {
        cursor = addDays(cursor, int(1, 3));
      }
    }
  }

  // ---- 2. Bookings ----------------------------------------------------------
  let codeSeq = 0;
  const bookingCode = (created: Date) => {
    const ymd = created.toISOString().slice(0, 10).replace(/-/g, '');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const tail = Array.from({ length: 5 }, () => alphabet[int(0, alphabet.length - 1)]).join('');
    codeSeq++;
    return `HMS-${ymd}-${tail}`;
  };

  const guestFor = (customer?: { _id: Types.ObjectId; fullName: string; email: string; phone?: string }) =>
    customer
      ? { fullName: customer.fullName, email: customer.email, phone: customer.phone ?? '0900000000' }
      : randomGuest();

  type Row = Record<string, any> & { _stay?: Stay };
  const bookingRows: Row[] = [];

  function price(roomType: IRoomType, checkIn: Date, checkOut: Date, adults: number, withPromo: boolean) {
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    const addOns =
      breakfast && chance(0.3)
        ? [{ serviceId: String(breakfast._id), quantity: nights * adults, unitPrice: breakfast.price }]
        : [];
    const p = PricingRule.calculate(roomType, checkIn, checkOut, 1, addOns, withPromo ? promotion : null);
    return { p, addOns };
  }

  for (const stay of stays) {
    const created = past(addDays(stay.checkIn, -int(1, 25)));
    // Most guests book without an account; a few are our registered customers.
    const customer = chance(0.04) ? pick(customers) : undefined;
    const adults = Math.max(1, Math.min(stay.roomType.capacity, int(1, stay.roomType.capacity)));
    const children = stay.roomType.capacity >= 4 ? int(0, 2) : 0;
    const withPromo = Boolean(promotion) && chance(0.1);
    const { p, addOns } = price(stay.roomType, stay.checkIn, stay.checkOut, adults, withPromo);

    bookingRows.push({
      _id: new Types.ObjectId(),
      bookingCode: bookingCode(created),
      customerId: customer?._id,
      guest: guestFor(customer),
      roomTypeId: stay.roomType._id,
      roomId: stay.status === BookingStatus.CONFIRMED ? undefined : stay.room._id,
      checkInDate: stay.checkIn,
      checkOutDate: stay.checkOut,
      adults,
      children,
      status: stay.status,
      addOnServices: addOns.map((a) => ({ serviceId: a.serviceId, quantity: a.quantity, price: a.unitPrice })),
      promotionId: withPromo ? promotion?._id : undefined,
      subtotal: p.subtotal,
      discount: p.discount,
      tax: p.tax,
      totalAmount: p.total,
      actualCheckInAt: stay.status !== BookingStatus.CONFIRMED ? past(at(stay.checkIn, 14, int(0, 180))) : undefined,
      actualCheckOutAt: stay.status === BookingStatus.CHECKED_OUT ? past(at(stay.checkOut, 10, int(0, 90))) : undefined,
      nonRefundable: chance(0.08),
      createdAt: created,
      updatedAt: created,
      _stay: stay,
    });
  }

  // The demo customer gets one of everything, so their screens are not empty.
  const forDemo = (predicate: (r: Row) => boolean) => {
    const row = bookingRows.find((r) => predicate(r) && r.customerId === undefined);
    if (row) {
      row.customerId = demoCustomer._id;
      row.guest = guestFor(demoCustomer);
    }
  };
  forDemo((r) => r.status === BookingStatus.CHECKED_OUT);
  forDemo((r) => r.status === BookingStatus.CHECKED_IN);
  forDemo((r) => r.status === BookingStatus.CONFIRMED && r.checkInDate >= addDays(today, 5));

  // Cancellations and no-shows do not occupy rooms, so they sit outside the
  // timelines. The demo customer's first cancellation awaits a refund decision.
  const extraRows: Row[] = [];
  for (let i = 0; i < 12; i++) {
    const roomType = pick(roomTypes);
    const noShow = i >= 10;
    const checkIn = noShow ? addDays(today, -int(2, 8)) : addDays(today, int(-10, 20));
    const checkOut = addDays(checkIn, int(1, 3));
    const created = past(addDays(checkIn, -int(5, 20)));
    const customer = i === 0 ? demoCustomer : chance(0.4) ? pick(customers) : undefined;
    const { p } = price(roomType, checkIn, checkOut, 1, false);
    extraRows.push({
      _id: new Types.ObjectId(),
      bookingCode: bookingCode(created),
      customerId: customer?._id,
      guest: guestFor(customer),
      roomTypeId: roomType._id,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: 1,
      children: 0,
      status: noShow ? BookingStatus.NO_SHOW : BookingStatus.CANCELLED,
      addOnServices: [],
      subtotal: p.subtotal,
      discount: 0,
      tax: p.tax,
      totalAmount: p.total,
      cancelledAt: noShow ? undefined : past(addDays(created, int(1, 3))),
      cancellationReason: noShow
        ? undefined
        : pick(['Plans changed', 'Flight cancelled', 'Found another hotel', 'Illness in the family']),
      nonRefundable: noShow,
      createdAt: created,
      updatedAt: created,
    });
  }

  const allRows = [...bookingRows, ...extraRows];
  await Booking.insertMany(allRows.map(({ _stay, ...doc }) => doc));

  // ---- 3. Payments (every confirmed stay was prepaid through payOS) ----------
  let orderSeq = 1_000_000_000; // far below real, time-based payOS order codes
  const paymentRows: Row[] = allRows.map((b, i) => ({
    bookingId: b._id,
    amount: b.totalAmount,
    method: PaymentMethod.BANK_TRANSFER,
    status: PaymentStatus.PAID,
    idempotencyKey: `demo-pay-${i}`,
    gatewayOrderCode: orderSeq++,
    gatewayRef: `FT${String(orderSeq).slice(-8)}`,
    paidAt: past(new Date(b.createdAt.getTime() + int(2, 40) * 60_000)),
    createdAt: b.createdAt,
    updatedAt: b.createdAt,
  }));
  const payments = await Payment.insertMany(paymentRows);
  const paymentByBooking = new Map(payments.map((p) => [String(p.bookingId), p]));

  // ---- 4. Folios, charges, desk payments, invoices -------------------------
  const receptionistIds = receptionists.map((r) => r._id);
  const staysWithFolio = bookingRows
    .filter((b) => b.status === BookingStatus.CHECKED_IN || b.status === BookingStatus.CHECKED_OUT)
    .sort((a, b) => (a.actualCheckOutAt ?? a.checkOutDate) - (b.actualCheckOutAt ?? b.checkOutDate));

  const charges: Row[] = [];
  const deskPayments: Row[] = [];
  const auditRows: Row[] = [];
  const folioRows: Row[] = [];
  const invoicesToCreate: { booking: Row; folioId: Types.ObjectId; lines: Row[]; issuedAt: Date; issuedBy: Types.ObjectId }[] = [];

  /** Mirrors FolioLedger.post: a taxable line always brings its VAT line. */
  const post = (folioId: Types.ObjectId, type: ChargeType, description: string, amount: number, when: Date, by: Types.ObjectId) => {
    const lines: Row[] = [{ folioId, type, description, amount, quantity: 1, postedBy: by, postedAt: when, isDisputed: false }];
    if ([ChargeType.ROOM, ChargeType.SERVICE, ChargeType.SURCHARGE].includes(type)) {
      const tax = Math.round(amount * TAX_RATE);
      if (tax > 0) {
        lines.push({ folioId, type: ChargeType.TAX, description: `VAT on ${description}`, amount: tax, quantity: 1, postedBy: by, postedAt: when, isDisputed: false });
      }
    }
    charges.push(...lines);
    return lines;
  };

  for (const b of staysWithFolio) {
    const folioId = new Types.ObjectId();
    const by = pick(receptionistIds);
    const inAt: Date = b.actualCheckInAt;
    const lines: Row[] = [];

    lines.push(...post(folioId, ChargeType.ROOM, `Room & services — ${Math.round((b.checkOutDate - b.checkInDate) / 86_400_000)} night(s)`, b.subtotal - b.discount, inAt, by));

    // Extras during the stay; checked-out guests settled theirs at the desk.
    const extras = int(0, 3);
    const lastDay = b.status === BookingStatus.CHECKED_OUT ? b.checkOutDate : today;
    for (let e = 0; e < extras; e++) {
      const x = pick(EXTRAS);
      const when = past(new Date(inAt.getTime() + rand() * Math.max(3_600_000, lastDay.getTime() - inAt.getTime())));
      lines.push(...post(folioId, ChargeType.SERVICE, x.description, x.amount, when, by));
    }

    const totalCharges = lines.reduce((s, l) => s + l.amount * l.quantity, 0);
    const prepaid = paymentByBooking.get(String(b._id))!;
    let totalPayments = prepaid.amount;
    await Payment.updateOne({ _id: prepaid._id }, { $set: { folioId } });

    const outstanding = totalCharges - totalPayments;
    if (b.status === BookingStatus.CHECKED_OUT && outstanding > 0) {
      // BR-28: a closed folio is settled — extras were paid at the desk.
      deskPayments.push({
        bookingId: b._id,
        folioId,
        amount: outstanding,
        method: chance(0.6) ? PaymentMethod.CASH : PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.PAID,
        idempotencyKey: `demo-desk-${String(folioId)}`,
        gatewayRef: 'LOCAL',
        cashierId: by,
        paidAt: b.actualCheckOutAt,
        createdAt: b.actualCheckOutAt,
        updatedAt: b.actualCheckOutAt,
      });
      totalPayments += outstanding;
    }

    folioRows.push({
      _id: folioId,
      bookingId: b._id,
      status: b.status === BookingStatus.CHECKED_OUT ? FolioStatus.CLOSED : FolioStatus.OPEN,
      totalCharges,
      totalPayments,
      balance: totalCharges - totalPayments,
      depositHeld: 0,
      closedAt: b.status === BookingStatus.CHECKED_OUT ? b.actualCheckOutAt : undefined,
      createdAt: inAt,
      updatedAt: b.actualCheckOutAt ?? inAt,
    });

    if (b.status === BookingStatus.CHECKED_OUT) {
      invoicesToCreate.push({ booking: b, folioId, lines, issuedAt: b.actualCheckOutAt, issuedBy: by });
    }

    auditRows.push({ actorId: by, action: 'GUEST_CHECKED_IN', entityType: 'Booking', entityId: String(b._id), after: { roomNumber: b._stay!.room.roomNumber }, timestamp: inAt });
    if (b.status === BookingStatus.CHECKED_OUT) {
      auditRows.push({ actorId: by, action: 'GUEST_CHECKED_OUT', entityType: 'Booking', entityId: String(b._id), after: { total: totalCharges }, timestamp: b.actualCheckOutAt });
    }
  }

  await Folio.insertMany(folioRows);
  await Charge.insertMany(charges);
  if (deskPayments.length) await Payment.insertMany(deskPayments);

  // Invoices in check-out order, so numbering is chronological and gapless.
  for (const inv of invoicesToCreate) {
    const net = inv.lines.filter((l) => l.type !== ChargeType.TAX).reduce((s, l) => s + l.amount, 0);
    const tax = inv.lines.filter((l) => l.type === ChargeType.TAX).reduce((s, l) => s + l.amount, 0);
    await Invoice.create({
      invoiceNumber: await InvoiceNumberGenerator.next(inv.issuedAt),
      bookingId: inv.booking._id,
      folioId: inv.folioId,
      lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.amount, amount: l.amount * l.quantity })),
      subtotal: net,
      tax,
      total: net + tax,
      issuedAt: inv.issuedAt,
      issuedBy: inv.issuedBy,
    });
  }

  // ---- 5. Room states derived from the timelines ---------------------------
  const lastCheckout = new Map<string, Date>();
  for (const b of bookingRows) {
    if (b.status !== BookingStatus.CHECKED_OUT) continue;
    const key = String(b.roomId);
    const prev = lastCheckout.get(key);
    if (!prev || b.checkOutDate > prev) lastCheckout.set(key, b.checkOutDate);
  }
  const inHouseRooms = new Set(bookingRows.filter((b) => b.status === BookingStatus.CHECKED_IN).map((b) => String(b.roomId)));

  const roomUpdates = rooms.map((room) => {
    const id = String(room._id);
    let status = RoomStatus.VACANT_CLEAN;
    let notes: string | undefined;
    if (inHouseRooms.has(id)) status = RoomStatus.OCCUPIED;
    else if (outOfOrder.has(id)) {
      status = RoomStatus.OUT_OF_ORDER;
      notes = OUT_OF_ORDER_NOTES[[...outOfOrder].indexOf(id)];
    } else {
      const left = lastCheckout.get(id);
      // Rooms vacated today are still being turned around.
      if (left && left.getTime() === today.getTime()) status = chance(0.35) ? RoomStatus.INSPECTED : RoomStatus.VACANT_DIRTY;
    }
    return {
      updateOne: {
        filter: { _id: room._id },
        update: notes ? { $set: { status, version: 1, notes } } : { $set: { status, version: 1 }, $unset: { notes: 1 } },
      },
    };
  });
  await Room.bulkWrite(roomUpdates);

  // ---- 6. Cancellations: refunds ------------------------------------------
  const cancelled = extraRows.filter((b) => b.status === BookingStatus.CANCELLED);
  for (const [i, b] of cancelled.entries()) {
    const payment = paymentByBooking.get(String(b._id))!;
    if (i === 0) {
      // The demo customer's cancellation inside the penalty window: awaiting a manager.
      await RefundRequest.create({
        referenceNumber: `RF-DEMO-${String(i + 1).padStart(3, '0')}`,
        bookingId: b._id,
        paymentId: payment._id,
        requestedBy: b.customerId,
        requestedAmount: b.totalAmount,
        reasonCategory: 'CANCELLATION',
        description: 'Family emergency — asking for the full amount back',
        status: RefundStatus.PENDING,
        createdAt: b.cancelledAt,
      });
    } else if (i === 1) {
      await RefundRequest.create({
        referenceNumber: `RF-DEMO-${String(i + 1).padStart(3, '0')}`,
        bookingId: b._id,
        paymentId: payment._id,
        requestedBy: b.customerId ?? demoCustomer._id,
        requestedAmount: b.totalAmount,
        reasonCategory: 'CANCELLATION',
        description: 'Flight cancelled by the airline',
        status: RefundStatus.PENDING,
        createdAt: b.cancelledAt,
      });
    } else {
      // Free cancellations: payOS cannot refund by API, so each is a FAILED
      // reversal flagged for a manual bank transfer (BR-50).
      await Payment.create({
        bookingId: b._id,
        amount: b.totalAmount,
        method: PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.FAILED,
        idempotencyKey: `demo-refund-${i}`,
        gatewayMessage: 'payOS has no refund API — a manual bank transfer is required',
        reversalOfId: payment._id,
        createdAt: b.cancelledAt,
      });
    }
    auditRows.push({ actorId: b.customerId, action: 'BOOKING_CANCELLED', entityType: 'Booking', entityId: String(b._id), after: { reason: b.cancellationReason }, timestamp: b.cancelledAt });
  }

  // ---- 7. Loyalty (BR-29: credited on completed stays only) ----------------
  const points = new Map<string, number>();
  for (const b of bookingRows) {
    if (b.status !== BookingStatus.CHECKED_OUT || !b.customerId) continue;
    points.set(String(b.customerId), (points.get(String(b.customerId)) ?? 0) + Math.floor(b.subtotal * 0.01));
  }
  for (const c of customers) {
    const earned = points.get(String(c._id)) ?? 0;
    const tier = earned >= 200_000 ? 'GOLD' : earned >= 80_000 ? 'SILVER' : 'BRONZE';
    await LoyaltyAccount.updateOne(
      { customerId: c._id },
      { $set: { pointBalance: earned, lifetimePoints: earned, tier } },
      { upsert: true },
    );
  }

  // ---- 8. Staff: shifts, leave, tasks, cash drawers ------------------------
  await seedStaffOperations(staff, today, rooms, outOfOrder);
  for (const r of receptionists) {
    await DrawerSession.create({ cashierId: r._id, openingFloat: 2_000_000, expectedCash: 2_000_000, isOpen: true, openedAt: past(at(today, 6)) });
  }

  // ---- 9. Audit trail for the history above --------------------------------
  for (const b of allRows) {
    auditRows.push({ actorId: b.customerId, action: 'BOOKING_CREATED', entityType: 'Booking', entityId: String(b._id), after: { bookingCode: b.bookingCode, total: b.totalAmount }, timestamp: b.createdAt });
  }
  await AuditLog.insertMany(auditRows.filter((a) => a.timestamp));

  await summarize(today);
  await verifyDemoInvariants(today);
}

// ---------------------------------------------------------------------------

async function ensureStaff(): Promise<IEmployee[]> {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  const roleIds = new Map((await Role.find()).map((r) => [r.name, r._id]));

  let seq = 10;
  for (const s of STAFF) {
    seq++;
    if (await User.exists({ email: s.email })) continue;
    await Employee.create({
      fullName: s.fullName,
      email: s.email,
      passwordHash,
      status: AccountStatus.ACTIVE,
      roles: [...s.roles, RoleName.EMPLOYEE].map((r) => roleIds.get(r)!),
      employeeCode: `E00${seq}`,
      department: s.department,
      position: s.position,
      hireDate: addDays(new Date(), -int(60, 900)),
      baseSalary: s.position.includes('Supervisor') ? 11_000_000 : 8_500_000,
    });
  }
  return Employee.find();
}

async function ensureCustomers() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  const customerRole = await Role.findOne({ name: RoleName.CUSTOMER });

  for (const fullName of DEMO_CUSTOMERS) {
    const email = `${asciiSlug(fullName)}@example.com`;
    if (await User.exists({ email })) continue;
    const c = await Customer.create({
      fullName,
      email,
      phone: `09${int(10000000, 99999999)}`,
      passwordHash,
      status: AccountStatus.ACTIVE,
      roles: [customerRole!._id],
    });
    await LoyaltyAccount.updateOne({ customerId: c._id }, { $setOnInsert: { pointBalance: 0 } }, { upsert: true });
  }
  return Customer.find() as unknown as Promise<{ _id: Types.ObjectId; fullName: string; email: string; phone?: string }[]>;
}

async function seedStaffOperations(staff: IEmployee[], today: Date, rooms: IRoom[], outOfOrder: Set<string>) {
  const byEmail = (email: string) => staff.find((s) => s.email === email)!;

  // Shifts: one week back, two weeks ahead. Front Office rotates three shifts.
  const FRONT = [['06:00', '14:00'], ['14:00', '22:00'], ['22:00', '06:00']];
  const shiftRows: Record<string, unknown>[] = [];
  staff.forEach((s, idx) => {
    for (let d = -7; d <= 14; d++) {
      const date = addDays(today, d);
      if ((d + idx) % 7 === 6) continue; // one day off a week, staggered
      const [start, end] =
        s.department === 'Front Office' ? FRONT[(idx + Math.floor((d + 7) / 7)) % 3]
        : s.department === 'F&B' ? ['10:00', '22:00']
        : ['07:00', '15:00'];
      shiftRows.push({ employeeId: s._id, date, startTime: start, endTime: end, department: s.department ?? 'Front Office', isOnLeave: false });
    }
  });
  await Shift.insertMany(shiftRows);

  // Leave: pending requests fill the Front Office manager's queue.
  const leave = [
    { email: 'reception@hms.local', type: LeaveType.ANNUAL, from: 6, days: 2, status: LeaveStatus.PENDING, reason: 'Sister’s wedding in Hải Phòng' },
    { email: 'reception@hms.local', type: LeaveType.SICK, from: -20, days: 1, status: LeaveStatus.APPROVED, reason: 'Fever' },
    { email: 'le.minh.tan@hms.local', type: LeaveType.ANNUAL, from: 10, days: 3, status: LeaveStatus.PENDING, reason: 'Family trip to Đà Lạt' },
    { email: 'tran.thu.ha@hms.local', type: LeaveType.ANNUAL, from: 3, days: 1, status: LeaveStatus.PENDING, reason: 'Moving house' },
    { email: 'tran.thu.ha@hms.local', type: LeaveType.ANNUAL, from: -12, days: 2, status: LeaveStatus.REJECTED, reason: 'Long weekend', note: 'Peak weekend — two colleagues already off' },
    { email: 'nguyen.van.binh@hms.local', type: LeaveType.ANNUAL, from: 8, days: 2, status: LeaveStatus.APPROVED, reason: 'Hometown visit' },
    { email: 'pham.thi.lan@hms.local', type: LeaveType.SICK, from: 1, days: 1, status: LeaveStatus.PENDING, reason: 'Medical appointment' },
  ];
  const manager = await User.findOne({ email: 'manager@hms.local' });
  for (const l of leave) {
    const emp = byEmail(l.email);
    if (!emp) continue;
    const fromDate = addDays(today, l.from);
    const toDate = addDays(fromDate, l.days - 1);
    const decided = l.status !== LeaveStatus.PENDING;
    await LeaveRequest.create({
      employeeId: emp._id,
      type: l.type,
      fromDate,
      toDate,
      days: l.days,
      reason: l.reason,
      status: l.status,
      approverId: decided ? manager?._id : undefined,
      decidedAt: decided ? past(addDays(fromDate, -3)) : undefined,
      decisionNote: l.note,
    });
    if (l.status === LeaveStatus.APPROVED) {
      const field = l.type === LeaveType.SICK ? 'leaveBalance.sick' : 'leaveBalance.annual';
      await Employee.updateOne({ _id: emp._id }, { $inc: { [field]: -l.days } });
      await Shift.updateMany({ employeeId: emp._id, date: { $gte: fromDate, $lte: toDate } }, { $set: { isOnLeave: true } });
    }
  }

  // Tasks: housekeeping for rooms being turned around, maintenance for OOO.
  const housekeepers = staff.filter((s) => s.department === 'Housekeeping' && s.position === 'Room Attendant');
  const supervisor = byEmail('nguyen.van.binh@hms.local');
  const technicians = staff.filter((s) => s.department === 'Maintenance');
  const current = await Room.find({ status: { $in: [RoomStatus.VACANT_DIRTY, RoomStatus.INSPECTED, RoomStatus.OUT_OF_ORDER] } });
  const tasks = current.map((room, i) => {
    if (room.status === RoomStatus.VACANT_DIRTY) {
      return { title: `Clean room ${room.roomNumber}`, description: 'Guest checked out today — full turnaround', assignedTo: housekeepers[i % housekeepers.length]._id, assignedBy: supervisor._id, roomId: room._id, status: pick(['TODO', 'TODO', 'IN_PROGRESS']), priority: 'HIGH', dueAt: at(today, 14) };
    }
    if (room.status === RoomStatus.INSPECTED) {
      return { title: `Inspect room ${room.roomNumber}`, description: 'Cleaned — ready for supervisor inspection', assignedTo: supervisor._id, assignedBy: supervisor._id, roomId: room._id, status: 'TODO', priority: 'MEDIUM', dueAt: at(today, 13) };
    }
    return { title: `Repair room ${room.roomNumber}`, description: room.notes ?? 'Out of order', assignedTo: technicians[i % technicians.length]._id, assignedBy: supervisor._id, roomId: room._id, status: 'IN_PROGRESS', priority: 'HIGH', dueAt: addDays(today, 2) };
  });
  if (tasks.length) await Task.insertMany(tasks);
  void rooms;
  void outOfOrder;
}

async function wipeOperational(): Promise<void> {
  await Promise.all([
    Booking.deleteMany({}),
    InventoryHold.deleteMany({}),
    Folio.deleteMany({}),
    Charge.deleteMany({}),
    Payment.deleteMany({}),
    Invoice.deleteMany({}),
    InvoiceCounter.deleteMany({}),
    RefundRequest.deleteMany({}),
    DrawerSession.deleteMany({}),
    Shift.deleteMany({}),
    Attendance.deleteMany({}),
    LeaveRequest.deleteMany({}),
    Payslip.deleteMany({}),
    Task.deleteMany({}),
    // The audit log is append-only in the application (BR-49); a demo reset
    // is the one place it may be cleared, and only outside production.
    AuditLog.collection.deleteMany({}),
    Promotion.updateMany({}, { $set: { usedCount: 0 } }),
    LoyaltyAccount.updateMany({}, { $set: { pointBalance: 0, lifetimePoints: 0, tier: 'BRONZE' } }),
    Employee.updateMany({}, { $set: { 'leaveBalance.annual': 12, 'leaveBalance.sick': 30 } }),
  ]);
  await Room.updateMany({}, { $set: { status: RoomStatus.VACANT_CLEAN, version: 0 }, $unset: { notes: 1 } });
}

// ---------------------------------------------------------------------------

async function summarize(today: Date): Promise<void> {
  const tomorrow = addDays(today, 1);
  const [rooms, byStatus, arrivals, departures] = await Promise.all([
    Room.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.countDocuments({ status: BookingStatus.CONFIRMED, checkInDate: { $gte: today, $lt: tomorrow } }),
    Booking.countDocuments({ status: BookingStatus.CHECKED_IN, checkOutDate: { $lt: tomorrow } }),
  ]);
  const fmt = (xs: { _id: string; n: number }[]) => xs.map((x) => `${x._id} ${x.n}`).join(', ');
  const occupied = rooms.find((r) => r._id === RoomStatus.OCCUPIED)?.n ?? 0;

  console.log(`[demo] hotel date ${today.toISOString().slice(0, 10)} (Asia/Ho_Chi_Minh)`);
  console.log(`[demo] rooms     ${fmt(rooms)}  → occupancy ${Math.round((occupied / 120) * 100)} %`);
  console.log(`[demo] bookings  ${fmt(byStatus)}`);
  console.log(`[demo] today     ${arrivals} arrival(s) to check in, ${departures} departure(s) due`);
  console.log(`[demo] folios ${await Folio.countDocuments()}, charges ${await Charge.countDocuments()}, invoices ${await Invoice.countDocuments()}, payments ${await Payment.countDocuments()}`);
  console.log(`[demo] staff ${await Employee.countDocuments()}, customers ${await Customer.countDocuments()}, shifts ${await Shift.countDocuments()}, leave ${await LeaveRequest.countDocuments()}, tasks ${await Task.countDocuments()}`);
}

/** Re-checks the business invariants the generator is meant to guarantee. */
export async function verifyDemoInvariants(today: Date): Promise<void> {
  const problems: string[] = [];

  // BR-25 — OCCUPIED ⇔ exactly one CHECKED_IN stay in that room.
  const inHouse = await Booking.find({ status: BookingStatus.CHECKED_IN });
  const perRoom = new Map<string, number>();
  for (const b of inHouse) perRoom.set(String(b.roomId), (perRoom.get(String(b.roomId)) ?? 0) + 1);
  for (const [room, n] of perRoom) if (n > 1) problems.push(`room ${room} has ${n} in-house stays`);
  const occupied = await Room.find({ status: RoomStatus.OCCUPIED });
  if (occupied.length !== perRoom.size) problems.push(`${occupied.length} OCCUPIED rooms vs ${perRoom.size} rooms with an in-house stay`);
  for (const r of occupied) if (!perRoom.has(String(r._id))) problems.push(`room ${r.roomNumber} OCCUPIED with no guest`);

  // No night from today on is sold beyond the sellable rooms of its type.
  const types = await RoomType.find();
  for (const t of types) {
    const sellable = await Room.countDocuments({ roomTypeId: t._id, status: { $ne: RoomStatus.OUT_OF_ORDER } });
    for (let d = 0; d < FUTURE_DAYS; d++) {
      const night = addDays(today, d);
      const sold = await Booking.countDocuments({
        roomTypeId: t._id,
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        checkInDate: { $lte: night },
        checkOutDate: { $gt: night },
      });
      if (sold > sellable) problems.push(`${t.name} oversold on ${night.toISOString().slice(0, 10)}: ${sold}/${sellable}`);
    }
  }

  // Folio arithmetic.
  for (const f of await Folio.find()) {
    const lines = await Charge.find({ folioId: f._id });
    const sum = lines.reduce((s, c) => s + c.amount * c.quantity, 0);
    const paid = (await Payment.find({ folioId: f._id, status: PaymentStatus.PAID })).reduce((s, p) => s + p.amount, 0);
    if (sum !== f.totalCharges) problems.push(`folio ${f._id}: charges ${sum} ≠ total ${f.totalCharges}`);
    if (paid !== f.totalPayments) problems.push(`folio ${f._id}: payments ${paid} ≠ total ${f.totalPayments}`);
    if (f.balance !== f.totalCharges - f.totalPayments) problems.push(`folio ${f._id}: balance mismatch`);
    if (f.status === FolioStatus.CLOSED && f.balance > 0) problems.push(`folio ${f._id}: closed with balance ${f.balance} (BR-28)`);
  }

  // BR-30 — gapless invoice numbers per year.
  const numbers = (await Invoice.find().select('invoiceNumber')).map((i) => i.invoiceNumber).sort();
  const byYear = new Map<string, number[]>();
  for (const n of numbers) {
    const [, year, seq] = n.split('-');
    byYear.set(year, [...(byYear.get(year) ?? []), Number(seq)]);
  }
  for (const [year, seqs] of byYear) {
    seqs.sort((a, b) => a - b);
    seqs.forEach((s, i) => { if (s !== i + 1) problems.push(`invoice gap in ${year} at ${i + 1}`); });
  }

  // Every checked-out stay has a closed folio and an invoice; in-house an open one.
  const checkedOut = await Booking.countDocuments({ status: BookingStatus.CHECKED_OUT });
  if ((await Invoice.countDocuments()) !== checkedOut) problems.push('invoice count ≠ checked-out stays');
  if ((await Folio.countDocuments({ status: FolioStatus.OPEN })) !== inHouse.length) problems.push('open folios ≠ in-house stays');

  if (problems.length) {
    console.error(`[demo] ${problems.length} invariant violation(s):`);
    for (const p of problems.slice(0, 20)) console.error('  - ' + p);
    throw new Error('Demo data failed its invariant checks');
  }
  console.log('[demo] invariants OK — BR-25 one guest per room, no oversold night, folio arithmetic, gapless invoices');
}
