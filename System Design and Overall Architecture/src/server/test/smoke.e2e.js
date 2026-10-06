/* End-to-end smoke test.

   Boots the real compiled app against an in-memory MongoDB and a FAKE payOS
   server, then walks the core use cases and business rules.

   The fake payOS re-implements payOS's side of the contract independently:
   it checks the x-client-id / x-api-key headers and recomputes the HMAC
   signature of every payment-link request, answering like the real API would.
   So a pass here means our signatures are accepted, not merely self-consistent.
   (Our signing code is also checked byte-for-byte against the official
   @payos/node SDK — see the payOS section of the design document.)

   Run: npm test */
const http = require('http');
const path = require('path');
const { createHmac } = require('crypto');
const SRV = path.resolve(__dirname, '..');
const req = (p) => require(path.join(SRV, p));

const PAYOS = { clientId: 'test-client', apiKey: 'test-api-key', checksumKey: 'test-checksum-key' };
const FRONTEND = 'http://localhost:3001';

// --- payOS signing, as payOS itself does it ---------------------------------
const hmac = (s) => createHmac('sha256', PAYOS.checksumKey).update(s).digest('hex');
function signObject(data) {
  const sorted = Object.keys(data).sort().reduce((a, k) => ((a[k] = data[k]), a), {});
  return hmac(
    Object.keys(sorted)
      .filter((k) => sorted[k] !== undefined)
      .map((k) => {
        let v = sorted[k];
        if (v && Array.isArray(v)) v = JSON.stringify(v.map((x) => Object.keys(x).sort().reduce((a, kk) => ((a[kk] = x[kk]), a), {})));
        if ([null, undefined, 'undefined', 'null'].includes(v)) v = '';
        return `${k}=${v}`;
      })
      .join('&'),
  );
}

// --- Fake payOS --------------------------------------------------------------
const links = new Map(); // orderCode -> link
const sentMail = []; // notification provider inbox
let rejectNextLink = false;
const seen = { badSignature: 0, badAuth: 0, created: 0 };

const fake = http.createServer((rq, rs) => {
  let raw = '';
  rq.on('data', (c) => (raw += c));
  rq.on('end', () => {
    rs.setHeader('Content-Type', 'application/json');
    const send = (o) => rs.end(JSON.stringify(o));
    const body = raw ? JSON.parse(raw) : {};

    if (rq.url === '/send') { sentMail.push(body); return send({}); } // notification provider

    if (rq.headers['x-client-id'] !== PAYOS.clientId || rq.headers['x-api-key'] !== PAYOS.apiKey) {
      seen.badAuth++;
      return send({ code: '401', desc: 'Unauthorized' });
    }

    if (rq.method === 'POST' && rq.url === '/v2/payment-requests') {
      const { amount, cancelUrl, description, orderCode, returnUrl, signature } = body;
      const expected = hmac(
        `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`,
      );
      if (signature !== expected) { seen.badSignature++; return send({ code: '201', desc: 'Chữ ký không hợp lệ' }); }
      if (links.has(orderCode)) return send({ code: '231', desc: 'Đơn thanh toán đã tồn tại' });
      if (description.length > 9) return send({ code: '20', desc: 'description too long' });
      if (rejectNextLink) { rejectNextLink = false; return send({ code: '20', desc: 'Thông tin truyền lên không đúng' }); }
      seen.created++;
      const link = { orderCode, amount, description, items: body.items, status: 'PENDING', amountPaid: 0, transactions: [], paymentLinkId: 'pl' + orderCode, returnUrl, cancelUrl };
      links.set(orderCode, link);
      return send({ code: '00', desc: 'success', data: {
        orderCode, amount, description, currency: 'VND', status: 'PENDING', paymentLinkId: link.paymentLinkId,
        checkoutUrl: 'https://pay.payos.vn/web/' + link.paymentLinkId, qrCode: '000201010212VIETQR' + orderCode,
      } });
    }

    const m = rq.url.match(/^\/v2\/payment-requests\/(\d+)(\/cancel)?$/);
    if (m) {
      const link = links.get(Number(m[1]));
      if (!link) return send({ code: '101', desc: 'Không tìm thấy đơn thanh toán' });
      if (m[2]) link.status = 'CANCELLED';
      return send({ code: '00', desc: 'success', data: {
        orderCode: link.orderCode, amount: link.amount, amountPaid: link.amountPaid,
        amountRemaining: link.amount - link.amountPaid, status: link.status, transactions: link.transactions,
      } });
    }

    if (rq.url === '/confirm-webhook') return send({ code: '00', desc: 'success', data: { webhookUrl: body.webhookUrl } });
    return send({ code: '404', desc: 'not found' });
  });
});

/** The guest pays in their banking app: payOS marks the link PAID and builds
 *  the signed webhook it would send us. */
function payAtBank(orderCode, { amount } = {}) {
  const link = links.get(orderCode);
  const paid = amount ?? link.amount;
  const reference = 'FT' + orderCode.toString().slice(-8);
  link.status = paid >= link.amount ? 'PAID' : 'UNDERPAID';
  link.amountPaid = paid;
  link.transactions = [{ reference, amount: paid }];
  const data = {
    orderCode, amount: paid, description: link.description, accountNumber: '0865124996', reference,
    transactionDateTime: '2026-09-29 10:00:00', currency: 'VND', paymentLinkId: link.paymentLinkId,
    code: '00', desc: 'Thành công', counterAccountBankId: '', counterAccountBankName: '',
    counterAccountName: null, counterAccountNumber: '', virtualAccountName: '', virtualAccountNumber: '',
  };
  return { code: '00', desc: 'success', success: true, data, signature: signObject(data) };
}

process.env.JWT_SECRET = 'test-secret-value-for-smoke-run';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-smoke-run';
process.env.NOTIFICATION_API_URL = 'http://127.0.0.1:4222';
process.env.PAYOS_BASE_URL = 'http://127.0.0.1:4222';
process.env.PAYOS_CLIENT_ID = PAYOS.clientId;
process.env.PAYOS_API_KEY = PAYOS.apiKey;
process.env.PAYOS_CHECKSUM_KEY = PAYOS.checksumKey;
process.env.FRONTEND_URL = FRONTEND;

(async () => {
  await new Promise((r) => fake.listen(4222, r));

  const { MongoMemoryServer } = req('node_modules/mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('hms');

  const { createApp, connectDatabase } = req('dist/app.js');
  await connectDatabase();

  const bcrypt = req('node_modules/bcryptjs');
  const { Role, User, Employee } = req('dist/models/user.model.js');
  const { RoomType, Room, Booking, LoyaltyAccount, InventoryHold } = req('dist/models/booking.model.js');
  const { Folio, Payment } = req('dist/models/billing.model.js');
  const { AuditLog } = req('dist/models/hr.model.js');

  // Roles come from the REAL permission table, never hand-written here: an
  // earlier hand-written CUSTOMER role wrongly held BOOKING_READ and hid an
  // IDOR bug (any customer could cancel any booking).
  const { seedRoles } = req('dist/config/seed.js');
  await seedRoles();
  const recRole = await Role.findOne({ name: 'RECEPTIONIST' });
  const adminRole = await Role.findOne({ name: 'ADMIN' });
  const mgrRole = await Role.findOne({ name: 'MANAGER' });
  const rt = await RoomType.create({
    name: 'Deluxe Double', description: 'Sea view', capacity: 2,
    basePrice: 1200000, amenities: ['WiFi'], images: [], totalRooms: 3,
  });
  await Room.create({ roomNumber: '301', roomTypeId: rt._id, floor: 3 });
  await Room.create({ roomNumber: '302', roomTypeId: rt._id, floor: 3 });

  const staff = [['1', 'rec1@hms.vn', recRole], ['2', 'rec2@hms.vn', recRole], ['9', 'admin@hms.vn', adminRole], ['3', 'mgr@hms.vn', mgrRole]];
  for (const [i, email, role] of staff) {
    await Employee.create({
      fullName: 'Staff ' + i, email, status: 'ACTIVE',
      passwordHash: await bcrypt.hash('Passw0rdX', 10), roles: [role._id],
      employeeCode: 'E00' + i, department: 'Front Office', position: 'Staff',
      hireDate: new Date(), baseSalary: 8000000,
    });
  }

  const server = createApp().listen(4111);
  const base = 'http://127.0.0.1:4111';
  const results = [];
  const check = (name, ok, extra) => {
    results.push({ name, ok });
    console.log(ok ? 'PASS  ' + name : 'FAIL  ' + name + '  << ' + (extra || ''));
  };
  const call = async (method, p, body, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = (p, b, t) => call('POST', p, b, t);
  const get = (p, t) => call('GET', p, undefined, t);
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const available = async (inD, outD) => {
    const r = await get('/api/rooms/search?checkIn=' + inD + '&checkOut=' + outD + '&adults=2');
    return r.body.results && r.body.results[0] ? r.body.results[0].availableCount : 0;
  };
  const paymentOf = async (bookingCode) => {
    const b = await Booking.findOne({ bookingCode });
    return { booking: b, payment: await Payment.findOne({ bookingId: b._id, reversalOfId: { $exists: false } }) };
  };
  const captures = async (paymentId) =>
    AuditLog.countDocuments({ action: 'PAYMENT_CAPTURED', entityId: String(paymentId) });
  let r;

  // ==========================================================================
  console.log('--- UC-G16 / UC-G17 authentication ---');
  r = await get('/health');
  check('GET /health reports a live db', r.status === 200 && r.body.db === 'connected', JSON.stringify(r.body));

  r = await post('/api/auth/register', { fullName: 'W', email: 'w@x.com', phone: '1', password: 'abc', confirmPassword: 'abc', acceptedTerms: true });
  check('UC-G16 rejects a weak password (BR-01)', r.status === 400 && r.body.error.code === 'WEAK_PASSWORD', JSON.stringify(r.body));
  r = await post('/api/auth/register', { fullName: 'N', email: 'n@x.com', phone: '1', password: 'Passw0rdX', confirmPassword: 'Passw0rdX', acceptedTerms: false });
  check('UC-G16 rejects unaccepted terms (BR-06)', r.status === 400 && r.body.error.code === 'TERMS_NOT_ACCEPTED', JSON.stringify(r.body));
  r = await post('/api/auth/register', { fullName: 'Le Dat', email: 'dat@x.com', phone: '0900', password: 'Passw0rdX', confirmPassword: 'Passw0rdX', acceptedTerms: true });
  check('UC-G16 registers a customer', r.status === 201, JSON.stringify(r.body));
  r = await post('/api/auth/register', { fullName: 'D', email: 'dat@x.com', phone: '1', password: 'Passw0rdX', confirmPassword: 'Passw0rdX', acceptedTerms: true });
  check('UC-G16 rejects a duplicate email (BR-04)', r.status === 409 && r.body.error.code === 'EMAIL_IN_USE', JSON.stringify(r.body));

  r = await post('/api/auth/login', { email: 'dat@x.com', password: 'Passw0rdX' });
  check('UC-G17 blocks an unverified account (PRE-2)', r.status === 403 && r.body.error.code === 'EMAIL_NOT_VERIFIED', JSON.stringify(r.body));
  await User.updateOne({ email: 'dat@x.com' }, { status: 'ACTIVE', failedLoginAttempts: 0 });
  r = await post('/api/auth/login', { email: 'dat@x.com', password: 'WrongPass1' });
  check('UC-G17 rejects a wrong password generically', r.status === 401 && r.body.error.message === 'Invalid username or password', JSON.stringify(r.body));
  r = await post('/api/auth/login', { email: 'dat@x.com', password: 'Passw0rdX' });
  const token = r.body.accessToken;
  check('UC-G17 issues access + refresh tokens', r.status === 200 && !!token && !!r.body.refreshToken, '');

  // ==========================================================================
  console.log('--- UC-G01 / UC-G07 search and book ---');
  const inD = day(1), outD = day(3);
  r = await get('/api/rooms/search?checkIn=' + inD + '&checkOut=' + outD + '&adults=2');
  const quote = r.body.results && r.body.results[0];
  check('BR-09 price = 2 nights x 1,200,000 + 10% VAT = 2,640,000',
    !!quote && quote.subtotal === 2400000 && quote.tax === 240000 && quote.total === 2640000, JSON.stringify(quote));

  const bookingBody = (over) => Object.assign({
    roomTypeId: String(rt._id), checkInDate: inD, checkOutDate: outD, adults: 2,
    guest: { fullName: 'Le Dat', email: 'dat@x.com', phone: '0900' }, paymentMethod: 'BANK_TRANSFER',
  }, over || {});

  r = await post('/api/bookings', bookingBody({ paymentMethod: 'CASH' }));
  check('UC-G07 refuses CASH for an online booking', r.status === 400 && r.body.error.code === 'INVALID_PAYMENT_METHOD', JSON.stringify(r.body));
  r = await post('/api/bookings', bookingBody({ adults: 9 }));
  check('UC-G07 enforces room capacity (BR-13)', r.status === 400 && r.body.error.code === 'CAPACITY_EXCEEDED', JSON.stringify(r.body));
  r = await post('/api/bookings', bookingBody({ checkOutDate: day(40) }));
  check('UC-G07 enforces the 30-night maximum (BR-07)', r.status === 400 && r.body.error.code === 'STAY_TOO_LONG', JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- payOS: create link (UC-G10 steps 4-5) ---');
  r = await post('/api/bookings', bookingBody(), token);
  const code1 = r.body.bookingCode;
  check('UC-G07 answers 202 PENDING with a payOS checkout URL',
    r.status === 202 && r.body.status === 'PENDING' && r.body.paymentPending === true &&
    /^https:\/\/pay\.payos\.vn\/web\//.test(r.body.paymentUrl || ''), JSON.stringify(r.body));
  check('payOS accepted our x-client-id / x-api-key and HMAC signature',
    seen.created === 1 && seen.badSignature === 0 && seen.badAuth === 0, JSON.stringify(seen));

  let { booking: b1, payment: p1 } = await paymentOf(code1);
  const link1 = links.get(p1.gatewayOrderCode);
  check('Payment row stores an integer orderCode, QR and checkout URL',
    Number.isSafeInteger(p1.gatewayOrderCode) && !!p1.qrCode && !!p1.checkoutUrl && p1.status === 'PENDING', JSON.stringify(p1));
  check('Bank memo is <= 9 chars and carries the booking code tail',
    link1.description.length <= 9 && link1.description === 'HMS' + code1.slice(-5), link1.description);
  check('returnUrl / cancelUrl carry the orderCode in the path',
    link1.returnUrl === FRONTEND + '/payment/result/' + p1.gatewayOrderCode &&
    link1.cancelUrl === FRONTEND + '/payment/cancelled/' + p1.gatewayOrderCode, link1.returnUrl);
  check('Payment link expires before the 15-min inventory hold',
    p1.expiresAt && p1.expiresAt.getTime() < Date.now() + 15 * 60000, String(p1.expiresAt));
  check('Unpaid booking still holds its room (hold, BR-10)', (await available(inD, outD)) === 2, 'available=' + (await available(inD, outD)));
  check('BR-29 no loyalty points before the stay', !(await LoyaltyAccount.findOne({ customerId: b1.customerId, pointBalance: { $gt: 0 } })), '');

  // ==========================================================================
  console.log('--- payOS: webhook (UC-G10 step 8) ---');
  const wh1 = payAtBank(p1.gatewayOrderCode);

  r = await post('/api/payments/payos/webhook', { ...wh1, signature: 'f'.repeat(64) });
  check('Webhook with a forged signature is rejected (400)', r.status === 400 && r.body.error.code === 'INVALID_SIGNATURE', JSON.stringify(r.body));
  r = await post('/api/payments/payos/webhook', { ...wh1, data: { ...wh1.data, amount: 1000 } });
  check('Webhook with a tampered amount is rejected (signature no longer matches)', r.status === 400, 'status=' + r.status);
  check('...and neither forged call moved the booking', (await Booking.findById(b1._id)).status === 'PENDING', '');

  r = await post('/api/payments/payos/webhook', wh1);
  ({ booking: b1, payment: p1 } = await paymentOf(code1));
  check('Genuine webhook: payment PAID, booking PENDING -> CONFIRMED',
    r.status === 200 && r.body.applied === true && p1.status === 'PAID' && b1.status === 'CONFIRMED', JSON.stringify(r.body));
  check('Bank transfer reference recorded on the payment', p1.gatewayRef === wh1.data.reference, p1.gatewayRef);
  check('Confirmed booking now holds the inventory; hold removed',
    (await available(inD, outD)) === 2 && !(await InventoryHold.findOne({ bookingId: b1._id })), '');

  r = await post('/api/payments/payos/webhook', wh1); // payOS retries delivery
  check('Duplicate webhook is idempotent: captured exactly once',
    r.status === 200 && (await captures(p1._id)) === 1, 'captures=' + (await captures(p1._id)));

  r = await post('/api/payments/payos/webhook', { ...payAtBank(p1.gatewayOrderCode), data: undefined });
  check('Webhook with no data is rejected', r.status === 400, 'status=' + r.status);

  const sample = { orderCode: 123, amount: 3000, description: 'VQRIO123', accountNumber: '12345678', reference: 'TF230204212323', transactionDateTime: '2023-02-04 18:25:00', currency: 'VND', paymentLinkId: 'x', code: '00', desc: 'success' };
  r = await post('/api/payments/payos/webhook', { code: '00', desc: 'success', success: true, data: sample, signature: signObject(sample) });
  check("payOS's registration test call (unknown order) is acknowledged", r.status === 200 && r.body.applied === false, JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- payOS: race + reconcile ---');
  r = await post('/api/bookings', bookingBody({ guest: { fullName: 'Tran An', email: 'an@x.com', phone: '0911' } }));
  let { booking: b2, payment: p2 } = await paymentOf(r.body.bookingCode);
  const wh2 = payAtBank(p2.gatewayOrderCode);
  // The guest returns to our result page (and refreshes it) while payOS
  // delivers — and retries — the webhook: 10 concurrent confirmations.
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? post('/api/payments/payos/webhook', wh2)
        : get('/api/payments/payos/' + p2.gatewayOrderCode + '/reconcile'),
    ),
  );
  ({ booking: b2, payment: p2 } = await paymentOf(b2.bookingCode));
  check('10 concurrent webhook/reconcile calls over HTTP: money booked exactly once',
    burst.every((x) => x.status === 200) && p2.status === 'PAID' && b2.status === 'CONFIRMED' && (await captures(p2._id)) === 1,
    JSON.stringify({ statuses: burst.map((x) => x.status), captures: await captures(p2._id) }));

  // HTTP requests arrive a few ms apart and tend to serialise on their own, so
  // the check above can pass even without the atomic guard. This one cannot:
  // all 10 calls start in the same tick, so every one reads PENDING before any
  // write lands. Removing `status: PENDING` from the update filter in
  // PaymentService.transition makes this test fail — it was verified to.
  const { PaymentService } = req('dist/services/payment.service.js');
  r = await post('/api/bookings', bookingBody({ checkInDate: day(14), checkOutDate: day(15) }));
  const { payment: pr } = await paymentOf(r.body.bookingCode);
  payAtBank(pr.gatewayOrderCode);
  await Promise.all(Array.from({ length: 10 }, () =>
    PaymentService.confirmFromGateway({ orderCode: pr.gatewayOrderCode, approved: true, reference: 'FTRACE', amount: pr.amount })));
  check('10 same-tick confirmations: exactly one capture (atomic guard)',
    (await captures(pr._id)) === 1, 'captures=' + (await captures(pr._id)));

  const in3 = day(5), out3 = day(7);
  r = await post('/api/bookings', bookingBody({ checkInDate: in3, checkOutDate: out3 }));
  let { booking: b3, payment: p3 } = await paymentOf(r.body.bookingCode);
  r = await get('/api/payments/payos/' + p3.gatewayOrderCode + '/reconcile');
  check('Reconcile before paying: still PENDING (typing ?status=PAID changes nothing)',
    r.status === 200 && r.body.paymentStatus === 'PENDING' && r.body.gatewayStatus === 'PENDING', JSON.stringify(r.body));
  payAtBank(p3.gatewayOrderCode); // paid, but the webhook never reaches localhost
  r = await get('/api/payments/payos/' + p3.gatewayOrderCode + '/reconcile');
  check('No webhook (localhost): reconcile asks payOS and confirms',
    r.body.paymentStatus === 'PAID' && r.body.bookingStatus === 'CONFIRMED' && r.body.bookingCode === b3.bookingCode, JSON.stringify(r.body));
  check('Reconcile reveals no guest details', !JSON.stringify(r.body).includes('@'), JSON.stringify(r.body));

  const in4 = day(8), out4 = day(9);
  const before4 = await available(in4, out4);
  r = await post('/api/bookings', bookingBody({ checkInDate: in4, checkOutDate: out4 }));
  const { payment: p4 } = await paymentOf(r.body.bookingCode);
  links.get(p4.gatewayOrderCode).status = 'CANCELLED'; // guest pressed "Huỷ" on payOS
  r = await get('/api/payments/payos/' + p4.gatewayOrderCode + '/reconcile');
  check('Guest cancels at payOS: payment FAILED, booking CANCELLED',
    r.body.paymentStatus === 'FAILED' && r.body.bookingStatus === 'CANCELLED', JSON.stringify(r.body));
  check('...and the held room is released', (await available(in4, out4)) === before4, 'available=' + (await available(in4, out4)));

  const in5 = day(20), out5 = day(21);
  r = await post('/api/bookings', bookingBody({ checkInDate: in5, checkOutDate: out5 }));
  const { payment: p5 } = await paymentOf(r.body.bookingCode);
  const under = payAtBank(p5.gatewayOrderCode, { amount: 1000000 }); // guest typed a smaller amount
  r = await post('/api/payments/payos/webhook', under);
  check('Underpaid transfer is NOT auto-confirmed; flagged for staff',
    (await Payment.findById(p5._id)).status === 'PENDING' &&
    (await AuditLog.findOne({ action: 'PAYMENT_AMOUNT_MISMATCH', entityId: String(p5._id) })) !== null, '');

  rejectNextLink = true;
  r = await post('/api/bookings', bookingBody({ checkInDate: day(22), checkOutDate: day(23) }));
  check('payOS refuses the link -> 402 PAYMENT_DECLINED, booking CANCELLED',
    r.status === 402 && r.body.error.code === 'PAYMENT_DECLINED' &&
    !!(await Booking.findOne({ status: 'CANCELLED', checkInDate: new Date(day(22)) })), JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- UC-G14 cancel -> refund (payOS has no refund API) ---');
  const in6 = day(10), out6 = day(12);
  r = await post('/api/bookings', bookingBody({ checkInDate: in6, checkOutDate: out6 }), token);
  const { booking: b6, payment: p6 } = await paymentOf(r.body.bookingCode);
  await post('/api/payments/payos/webhook', payAtBank(p6.gatewayOrderCode));
  // IDOR: a second customer must not be able to touch the first one's booking.
  await post('/api/auth/register', { fullName: 'Mallory', email: 'mal@x.com', phone: '0999', password: 'Passw0rdX', confirmPassword: 'Passw0rdX', acceptedTerms: true });
  await User.updateOne({ email: 'mal@x.com' }, { status: 'ACTIVE' });
  const mallory = (await post('/api/auth/login', { email: 'mal@x.com', password: 'Passw0rdX' })).body.accessToken;
  r = await post('/api/bookings/' + b6._id + '/cancel', { reason: 'not mine' }, mallory);
  check("IDOR: another customer cannot cancel someone else's booking",
    r.status === 404 && (await Booking.findById(b6._id)).status === 'CONFIRMED', JSON.stringify(r.body));
  r = await get('/api/bookings/' + b6._id, mallory);
  check("IDOR: another customer cannot read someone else's booking", r.status === 403, 'status=' + r.status);
  // BR-20: the rate type comes from the booking, not from the request body.
  r = await post('/api/bookings', bookingBody({ checkInDate: day(16), checkOutDate: day(17) }), token);
  const { booking: b7, payment: p7 } = await paymentOf(r.body.bookingCode);
  await post('/api/payments/payos/webhook', payAtBank(p7.gatewayOrderCode));
  await Booking.updateOne({ _id: b7._id }, { nonRefundable: true }); // booked on a non-refundable rate
  r = await post('/api/bookings/' + b7._id + '/cancel', { reason: 'x', isNonRefundableRate: false }, token);
  check('BR-20 non-refundable rate: client cannot claim a refund via the request body',
    r.status === 200 && r.body.refundable === 0 && r.body.refundStatus === 'NONE', JSON.stringify(r.body));

  r = await post('/api/bookings/' + b6._id + '/cancel', { reason: 'Plans changed' }, token);
  check('UC-G14 free cancellation: full refund due, routed to MANUAL_TRANSFER',
    r.status === 200 && r.body.status === 'CANCELLED' && r.body.refundable === 2640000 && r.body.refundStatus === 'MANUAL_TRANSFER', JSON.stringify(r.body));
  check('Refund recorded for the accounts team (audit REFUND_MANUAL_TRANSFER_REQUIRED)',
    !!(await AuditLog.findOne({ action: 'REFUND_MANUAL_TRANSFER_REQUIRED', entityId: String(p6._id) })), '');
  check('BR-33 original payment untouched', (await Payment.findById(p6._id)).status === 'PAID', '');
  r = await post('/api/refund-requests', { bookingId: String(b6._id), amount: 2640000, reasonCategory: 'CANCELLATION' }, token);
  check('BR-37 no second refund of money already being refunded', r.status === 409 && r.body.error.code === 'ALREADY_REFUNDED', JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- multi-room reservation (UC-G07, BR-08) ---');
  const { Promotion } = req('dist/models/booking.model.js');
  const suite = await RoomType.create({
    name: 'Family Suite', description: 'Two bedrooms', capacity: 4,
    basePrice: 2500000, amenities: ['WiFi'], images: [], totalRooms: 2,
  });
  const inM = day(25), outM = day(27);
  const createdBefore = seen.created;
  const mailBefore = sentMail.length;
  const partyBody = (rooms, over) => Object.assign({
    checkInDate: inM, checkOutDate: outM, paymentMethod: 'BANK_TRANSFER',
    guest: { fullName: 'Le Dat', email: 'dat@x.com', phone: '0900' }, rooms,
  }, over || {});

  r = await post('/api/bookings', partyBody([
    { roomTypeId: String(rt._id), adults: 2 },
    { roomTypeId: String(rt._id), adults: 1 },
    { roomTypeId: String(suite._id), adults: 2, children: 2 },
  ]), token);
  const resCode = r.body.reservationCode;
  // Deluxe: 2 × 1,200,000 + 10 % = 2,640,000 each; suite: 2 × 2,500,000 + 10 % = 5,500,000.
  check('Three rooms of two types book as one reservation (202)',
    r.status === 202 && r.body.rooms.length === 3 && r.body.total === 2640000 * 2 + 5500000,
    JSON.stringify(r.body).slice(0, 220));
  check('Rooms are numbered under the reservation code',
    r.body.rooms.map((x) => x.bookingCode).join() === [1, 2, 3].map((n) => resCode + '-' + n).join(), JSON.stringify(r.body.rooms));

  const party = await Booking.find({ reservationCode: resCode }).sort({ bookingCode: 1 });
  const partyPays = await Payment.find({ bookingId: { $in: party.map((b) => b._id) } });
  const partyOrder = partyPays[0] && partyPays[0].gatewayOrderCode;
  check('ONE payOS link for the whole reservation, for the total',
    seen.created === createdBefore + 1 && links.get(partyOrder).amount === r.body.total && links.get(partyOrder).items.length === 3,
    JSON.stringify({ created: seen.created - createdBefore, link: links.get(partyOrder) && links.get(partyOrder).amount }));
  check('One Payment per room, all sharing the order code',
    partyPays.length === 3 && partyPays.every((p) => p.gatewayOrderCode === partyOrder && p.status === 'PENDING') &&
    party.every((b) => partyPays.find((p) => String(p.bookingId) === String(b._id)).amount === b.totalAmount), '');
  check('Every room is held while the guest pays',
    (await available(inM, outM)) === 1 && party.every((b) => b.status === 'PENDING'), 'deluxe available=' + (await available(inM, outM)));

  r = await post('/api/payments/payos/webhook', payAtBank(partyOrder, { amount: 2640000 }));
  check('A transfer for one room only confirms NO room (amount must match the total)',
    (await Booking.countDocuments({ reservationCode: resCode, status: 'PENDING' })) === 3, '');

  const whParty = payAtBank(partyOrder);
  r = await post('/api/payments/payos/webhook', whParty);
  const confirmed = await Booking.find({ reservationCode: resCode });
  check('The genuine webhook confirms all three rooms at once',
    r.status === 200 && confirmed.every((b) => b.status === 'CONFIRMED'), JSON.stringify(confirmed.map((b) => b.status)));
  const partyCaptures = await Promise.all(partyPays.map((p) => captures(p._id)));
  check('Each room payment captured exactly once', partyCaptures.every((n) => n === 1), JSON.stringify(partyCaptures));
  check('Holds released; confirmed rooms keep the inventory',
    (await InventoryHold.countDocuments({ bookingId: { $in: party.map((b) => b._id) } })) === 0 && (await available(inM, outM)) === 1, '');

  // Same-tick race on a multi-room payment: callers may each settle some of
  // the rooms, yet the reservation must be confirmed and emailed ONCE.
  const { PaymentService: PS } = req('dist/services/payment.service.js');
  r = await post('/api/bookings', partyBody([
    { roomTypeId: String(rt._id), adults: 1 },
    { roomTypeId: String(suite._id), adults: 2 },
  ], { checkInDate: day(34), checkOutDate: day(35) }));
  const raceRes = r.body.reservationCode;
  const racePays = await Payment.find({ bookingId: { $in: (await Booking.find({ reservationCode: raceRes })).map((b) => b._id) } });
  const raceTotal = racePays.reduce((a, p) => a + p.amount, 0);
  payAtBank(racePays[0].gatewayOrderCode);
  const raceMailBefore = sentMail.length;
  await Promise.all(Array.from({ length: 10 }, () =>
    PS.confirmFromGateway({ orderCode: racePays[0].gatewayOrderCode, approved: true, reference: 'FTRACE2', amount: raceTotal })));
  await new Promise((res) => setTimeout(res, 200));
  const raceMail = sentMail.slice(raceMailBefore).filter((m) => (m.subject || '').includes(raceRes));
  const raceCaps = await Promise.all(racePays.map((p) => captures(p._id)));
  check('10 same-tick confirmations of a 2-room payment: each room once, ONE email',
    raceCaps.every((n) => n === 1) && raceMail.length === 1, JSON.stringify({ raceCaps, emails: raceMail.length }));

  await post('/api/payments/payos/webhook', whParty); // payOS retries
  const partyMail = sentMail.slice(mailBefore).filter((m) => (m.subject || '').includes(resCode));
  check('UC-G12 one confirmation email for the reservation, listing every room',
    partyMail.length === 1 && [1, 2, 3].every((n) => partyMail[0].body.includes(resCode + '-' + n)),
    JSON.stringify(partyMail.map((m) => m.subject)));

  r = await get('/api/bookings/lookup?code=' + resCode + '-2&email=dat@x.com');
  check('UC-G13 a room code finds the whole reservation', r.status === 200 && r.body.bookings.length === 3, 'status=' + r.status);
  r = await get('/api/bookings/' + party[0]._id, token);
  check('Booking detail lists its sibling rooms', r.status === 200 && r.body.reservation.rooms.length === 3, JSON.stringify(r.body.reservation));

  r = await post('/api/bookings/' + party[1]._id + '/cancel', { reason: 'One person cannot come' }, token);
  const afterCancel = await Booking.find({ reservationCode: resCode }).sort({ bookingCode: 1 });
  check('Cancelling one room leaves the others booked',
    r.status === 200 && afterCancel.map((b) => b.status).join() === 'CONFIRMED,CANCELLED,CONFIRMED' && r.body.refundable === 2640000,
    JSON.stringify({ statuses: afterCancel.map((b) => b.status), refundable: r.body.refundable }));
  check('...and returns just that room to inventory', (await available(inM, outM)) === 2, 'available=' + (await available(inM, outM)));

  const bookingsBefore = await Booking.countDocuments();
  const holdsBefore = await InventoryHold.countDocuments();
  const linksBefore = seen.created;
  r = await post('/api/bookings', partyBody([
    { roomTypeId: String(rt._id), adults: 1 },
    { roomTypeId: String(suite._id), adults: 2 },
    { roomTypeId: String(suite._id), adults: 2 },
  ]));
  check('All or nothing: one room short → 409, nothing held, booked or charged',
    r.status === 409 && r.body.error.code === 'NO_AVAILABILITY' &&
    (await Booking.countDocuments()) === bookingsBefore && (await InventoryHold.countDocuments()) === holdsBefore && seen.created === linksBefore,
    JSON.stringify(r.body));

  r = await post('/api/bookings', partyBody([{ roomTypeId: String(suite._id), adults: 5 }]));
  check('BR-13 capacity is checked per room', r.status === 400 && r.body.error.code === 'CAPACITY_EXCEEDED', JSON.stringify(r.body));
  r = await post('/api/bookings', partyBody(Array.from({ length: 6 }, () => ({ roomTypeId: String(rt._id), adults: 1 }))));
  check('BR-08 at most 5 rooms per reservation', r.status === 400 && r.body.error.code === 'TOO_MANY_ROOMS', JSON.stringify(r.body));

  await Promotion.create({ code: 'GROUP10', discountType: 'PERCENTAGE', discountValue: 10, validFrom: new Date(Date.now() - 86400000), validTo: day(60), usageLimit: 1 });
  r = await post('/api/bookings', partyBody([
    { roomTypeId: String(rt._id), adults: 2 },
    { roomTypeId: String(suite._id), adults: 3 },
  ], { checkInDate: day(30), checkOutDate: day(31), voucherCode: 'GROUP10' }), token);
  const vParty = await Booking.find({ reservationCode: r.body.reservationCode });
  const vGross = vParty.reduce((a, b) => a + b.subtotal, 0);
  const vDiscount = vParty.reduce((a, b) => a + b.discount, 0);
  check('Voucher: 10 % of the reservation, spread over its rooms',
    r.status === 202 && vDiscount === Math.round(vGross * 0.1) && vParty.every((b) => b.discount > 0),
    JSON.stringify(vParty.map((b) => ({ sub: b.subtotal, disc: b.discount }))));
  check('Voucher is not used up by an unpaid checkout', (await Promotion.findOne({ code: 'GROUP10' })).usedCount === 0, '');
  const vPay = await Payment.findOne({ bookingId: vParty[0]._id });
  await post('/api/payments/payos/webhook', payAtBank(vPay.gatewayOrderCode));
  check('Paid: the voucher counts ONE use for the whole reservation', (await Promotion.findOne({ code: 'GROUP10' })).usedCount === 1, '');
  r = await post('/api/bookings', partyBody([{ roomTypeId: String(rt._id), adults: 1 }], { checkInDate: day(32), checkOutDate: day(33), voucherCode: 'GROUP10' }));
  check('A used-up voucher is refused', r.status === 400 && r.body.error.code === 'INVALID_VOUCHER', JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- UC-A12 register webhook ---');
  const admin = (await post('/api/auth/login', { email: 'admin@hms.vn', password: 'Passw0rdX' })).body.accessToken;
  r = await post('/api/payments/payos/confirm-webhook', { webhookUrl: 'https://hms.example/api/payments/payos/webhook' }, token);
  check('Customer cannot register the webhook (RBAC)', r.status === 403, 'status=' + r.status);
  r = await post('/api/payments/payos/confirm-webhook', { webhookUrl: 'http://localhost:3000/hook' }, admin);
  check('Non-HTTPS webhook URL refused', r.status === 400 && r.body.error.code === 'INVALID_URL', JSON.stringify(r.body));
  r = await post('/api/payments/payos/confirm-webhook', { webhookUrl: 'https://hms.example/api/payments/payos/webhook' }, admin);
  check('Admin registers the webhook with payOS', r.status === 200, JSON.stringify(r.body));

  // ==========================================================================
  console.log('--- UC-M11 promotion codes ---');
  {
    const mgr = (await post('/api/auth/login', { email: 'mgr@hms.vn', password: 'Passw0rdX' })).body.accessToken;
    const recep = (await post('/api/auth/login', { email: 'rec1@hms.vn', password: 'Passw0rdX' })).body.accessToken;
    const patch = (p, b, t) => call('PATCH', p, b, t);
    const del = (p, t) => call('DELETE', p, undefined, t);
    const terms = (over) => Object.assign({
      code: 'spring20', description: 'Spring 20 % off', discountType: 'PERCENTAGE', discountValue: 20,
      validFrom: day(0), validTo: day(40), usageLimit: 0, minimumSpend: 0, isPublic: true,
    }, over || {});

    r = await get('/api/promotions', token);
    const customer403 = r.status;
    r = await get('/api/promotions', recep);
    const recep403 = r.status;
    r = await get('/api/promotions', admin);
    check('RBAC: only MANAGE_PRICING manages codes (customer, receptionist, admin → 403)',
      customer403 === 403 && recep403 === 403 && r.status === 403, [customer403, recep403, r.status].join());

    r = await post('/api/promotions', terms({ usedCount: 99, isActive: false }), mgr);
    const spring = r.body;
    check('UC-M20 creates a code, upper-cased, ACTIVE', r.status === 201 && spring.code === 'SPRING20' && spring.status === 'ACTIVE', JSON.stringify(r.body));
    check('...ignoring usedCount / isActive smuggled into the form', spring.usedCount === 0 && spring.isActive === true, JSON.stringify(spring));
    r = await post('/api/promotions', terms({ code: 'Spring20' }), mgr);
    check('BR-52 a code is unique, whatever its case (409)', r.status === 409 && r.body.error.code === 'PROMOTION_CODE_TAKEN', JSON.stringify(r.body));

    const bad = await Promise.all([
      post('/api/promotions', terms({ code: 'PCT150', discountValue: 150 }), mgr),
      post('/api/promotions', terms({ code: 'BACKWARD', validFrom: day(10), validTo: day(5) }), mgr),
      post('/api/promotions', terms({ code: 'HAS SPACE' }), mgr),
      post('/api/promotions', terms({ code: 'OVERDONE', validFrom: day(-10), validTo: day(-2) }), mgr),
      post('/api/promotions', terms({ code: 'NEGFIXED', discountType: 'FIXED_AMOUNT', discountValue: -5 }), mgr),
    ]);
    check('BR-53/54/52 refuses >100 %, end before start, spaces, an end in the past, a negative amount',
      bad.every((x) => x.status === 400 && x.body.error.code === 'VALIDATION_ERROR'), JSON.stringify(bad.map((x) => x.body.error)));

    r = await post('/api/promotions', terms({ code: 'CORPONLY', isPublic: false, discountValue: 5 }), mgr);
    const corp = r.body;
    await post('/api/promotions', terms({ code: 'BIGSPEND', discountType: 'FIXED_AMOUNT', discountValue: 500000, minimumSpend: 5000000 }), mgr);
    await post('/api/promotions', terms({ code: 'LATER', validFrom: day(10), validTo: day(20) }), mgr);

    r = await get('/api/promotions/public');
    const offers = (r.body.offers || []).map((o) => o.code);
    check('UC-G06 lists public, current codes only — not private or scheduled ones',
      offers.includes('SPRING20') && !offers.includes('CORPONLY') && !offers.includes('LATER'), offers.join());
    check('...and never shows usage or limits to guests', r.body.offers.every((o) => o.usedCount === undefined && o.usageLimit === undefined), '');

    r = await get('/api/promotions/validate?code=spring20&subtotal=1000000');
    check('UC-G11 preview: 20 % of 1,000,000 = 200,000', r.status === 200 && r.body.discount === 200000, JSON.stringify(r.body));
    r = await get('/api/promotions/validate?code=NOPE99&subtotal=1000000');
    check('UC-G11 unknown code → INVALID_VOUCHER', r.status === 400 && r.body.error.code === 'INVALID_VOUCHER', JSON.stringify(r.body));
    r = await get('/api/promotions/validate?code=BIGSPEND&subtotal=1000000');
    check('BR-56 below minimum spend → VOUCHER_MIN_SPEND, saying how much', r.status === 400 && r.body.error.code === 'VOUCHER_MIN_SPEND' && /5\.000\.000|5,000,000/.test(r.body.error.message), JSON.stringify(r.body));
    r = await get('/api/promotions/validate?code=LATER&subtotal=1000000');
    check('A scheduled code is refused until it starts', r.status === 400 && r.body.error.details.reason === 'SCHEDULED', JSON.stringify(r.body));

    const holds0 = await InventoryHold.countDocuments();
    const bookings0 = await Booking.countDocuments();
    r = await post('/api/bookings', partyBody([{ roomTypeId: String(rt._id), adults: 1 }], { checkInDate: day(34), checkOutDate: day(35), voucherCode: 'BIGSPEND' }));
    check('Booking below the minimum spend is refused and releases its hold',
      r.status === 400 && r.body.error.code === 'VOUCHER_MIN_SPEND' && (await InventoryHold.countDocuments()) === holds0 && (await Booking.countDocuments()) === bookings0,
      JSON.stringify(r.body));

    r = await patch('/api/promotions/' + spring.id + '/status', { isActive: false }, mgr);
    check('UC-M22 deactivates a code', r.status === 200 && r.body.status === 'INACTIVE', JSON.stringify(r.body));
    r = await post('/api/bookings', partyBody([{ roomTypeId: String(rt._id), adults: 1 }], { checkInDate: day(34), checkOutDate: day(35), voucherCode: 'SPRING20' }));
    const offersOff = (await get('/api/promotions/public')).body.offers.map((o) => o.code);
    check('...after which bookings refuse it and it leaves the offers page',
      r.status === 400 && r.body.error.details.reason === 'INACTIVE' && !offersOff.includes('SPRING20'), JSON.stringify(r.body));
    r = await patch('/api/promotions/' + spring.id + '/status', { isActive: true }, mgr);
    check('UC-M22 reactivates it', r.status === 200 && r.body.status === 'ACTIVE', JSON.stringify(r.body));

    r = await post('/api/bookings', partyBody([
      { roomTypeId: String(rt._id), adults: 1 },
      { roomTypeId: String(suite._id), adults: 2 },
    ], { checkInDate: day(34), checkOutDate: day(35), voucherCode: 'spring20' }), token);
    const sRooms = await Booking.find({ reservationCode: r.body.reservationCode });
    check('A booking with the code gets 20 % off the reservation',
      r.status === 202 && sRooms.reduce((a, b) => a + b.discount, 0) === Math.round(sRooms.reduce((a, b) => a + b.subtotal, 0) * 0.2),
      JSON.stringify(r.body));

    r = await patch('/api/promotions/' + spring.id, { discountValue: 50 }, mgr);
    check('BR-57 once booked with, the discount cannot change (409)', r.status === 409 && r.body.error.code === 'PROMOTION_TERMS_LOCKED', JSON.stringify(r.body));
    r = await patch('/api/promotions/' + spring.id, { code: 'SPRING25' }, mgr);
    check('BR-57 a code is never renamed (409)', r.status === 409 && r.body.error.code === 'PROMOTION_TERMS_LOCKED', JSON.stringify(r.body));
    r = await patch('/api/promotions/' + spring.id, { validTo: day(60), description: 'Spring, extended' }, mgr);
    check('UC-M21 dates and wording stay editable', r.status === 200 && r.body.validTo === day(60) && r.body.description === 'Spring, extended', JSON.stringify(r.body));
    r = await del('/api/promotions/' + spring.id, mgr);
    check('A code guests booked with cannot be deleted — deactivate instead (409)', r.status === 409 && r.body.error.code === 'PROMOTION_IN_USE', JSON.stringify(r.body));

    await post('/api/payments/payos/webhook', payAtBank((await Payment.findOne({ bookingId: sRooms[0]._id })).gatewayOrderCode));
    r = await get('/api/promotions', mgr);
    const sv = r.body.promotions.find((x) => x.code === 'SPRING20');
    check('UC-M19 usage: 1 use, 1 reservation of 2 rooms, discount given',
      sv.usedCount === 1 && sv.usage.reservations === 1 && sv.usage.rooms === 2 && sv.usage.discountGiven === sRooms.reduce((a, b) => a + b.discount, 0),
      JSON.stringify(sv));

    r = await patch('/api/promotions/' + spring.id, { usageLimit: 1 }, mgr);
    check('A limit equal to the uses made is allowed — and the code is USED_UP', r.status === 200 && r.body.status === 'USED_UP', JSON.stringify(r.body));
    await Promotion.updateOne({ _id: spring.id }, { $set: { usedCount: 3 } });
    r = await patch('/api/promotions/' + spring.id, { usageLimit: 2 }, mgr);
    check('BR-55 a limit below the uses already made is refused', r.status === 400 && /below/.test(r.body.error.message), JSON.stringify(r.body));

    r = await del('/api/promotions/' + corp.id, mgr);
    const gone = !(await Promotion.findById(corp.id));
    check('An unused code can be deleted', r.status === 204 && gone, 'status=' + r.status);

    // BR-55 under concurrency: a guest's payment lands between the Manager's
    // read and write. In-process, so the interleaving is exact, not hoped for.
    const { PromotionService } = req('dist/services/promotion.service.js');
    const mgrId = String((await User.findOne({ email: 'mgr@hms.vn' }))._id);
    const racer = await Promotion.create({
      code: 'RACE1', description: 'x', discountType: 'PERCENTAGE', discountValue: 5,
      validFrom: new Date(Date.now() - 86400000), validTo: new Date(Date.now() + 30 * 86400000), usedCount: 2,
    });
    const realExists = Booking.exists;
    Booking.exists = function (...args) {
      Booking.exists = realExists;
      return Promotion.updateOne({ _id: racer._id }, { $inc: { usedCount: 2 } }).then(() => realExists.apply(this, args));
    };
    let raceErr;
    try { await PromotionService.update(String(racer._id), { usageLimit: 3 }, mgrId); } catch (e) { raceErr = e; }
    Booking.exists = realExists;
    const raced = await Promotion.findById(racer._id);
    check('BR-55 a use landing mid-edit cannot leave uses above the new limit',
      raceErr && raceErr.code === 'PROMOTION_LIMIT_BELOW_USAGE' && raced.usageLimit === 0 && raced.usedCount === 4,
      JSON.stringify({ err: raceErr && raceErr.code, limit: raced.usageLimit, used: raced.usedCount }));

    const trail = await AuditLog.find({ entityType: 'Promotion' }).select('action actorId');
    const actions = new Set(trail.map((a) => a.action));
    check('BR-49 every change is audited, with the Manager as actor',
      ['PROMOTION_CREATED', 'PROMOTION_UPDATED', 'PROMOTION_DEACTIVATED', 'PROMOTION_ACTIVATED', 'PROMOTION_DELETED'].every((a) => actions.has(a)) &&
      trail.every((a) => a.actorId),
      [...actions].join());
  }

  // ==========================================================================
  console.log('--- UC-R06 / UC-R09 front desk ---');
  const rec1 = (await post('/api/auth/login', { email: 'rec1@hms.vn', password: 'Passw0rdX' })).body.accessToken;
  const rec2 = (await post('/api/auth/login', { email: 'rec2@hms.vn', password: 'Passw0rdX' })).body.accessToken;

  r = await get('/api/front-desk/allocatable?roomTypeId=' + rt._id, rec1);
  const target = r.body.rooms && r.body.rooms.find((x) => x.roomNumber === '301');
  const identity = (name) => ({ documentType: 'NATIONAL_ID', documentNumber: '0790' + name.length, fullName: name, dateOfBirth: '1995-01-01', expiryDate: '2035-01-01' });

  r = await post('/api/front-desk/check-in', { bookingId: String(b1._id), roomId: target.id, roomVersion: target.version, identity: identity('Someone Else') }, rec1);
  check('UC-R07 rejects an identity mismatch', r.status === 403 && r.body.error.code === 'IDENTITY_MISMATCH', JSON.stringify(r.body));

  const [a, b] = await Promise.all([
    post('/api/front-desk/check-in', { bookingId: String(b1._id), roomId: target.id, roomVersion: target.version, identity: identity('Le Dat') }, rec1),
    post('/api/front-desk/check-in', { bookingId: String(b2._id), roomId: target.id, roomVersion: target.version, identity: identity('Tran An') }, rec2),
  ]);
  check('QA-7 concurrent allocation: exactly one desk wins the room',
    [a.status, b.status].sort().join() === '200,409', JSON.stringify([a.status, b.status]));

  const winner = a.status === 200 ? { res: a, id: b1._id } : { res: b, id: b2._id };
  const folioId = winner.res.body.folioId;
  const folio = await Folio.findById(folioId);
  check('Prepaid (payOS) guest starts the stay at a zero folio balance',
    folio.balance === 0 && folio.totalCharges === 2640000 && folio.totalPayments === 2640000,
    JSON.stringify({ bal: folio.balance, ch: folio.totalCharges, pay: folio.totalPayments }));

  r = await post('/api/front-desk/check-out', { bookingId: String(winner.id), lateCheckoutSurcharge: 600000 }, rec1);
  check('BR-28 check-out blocked while the late surcharge is unpaid', r.status === 402 && r.body.error.code === 'OUTSTANDING_BALANCE', JSON.stringify(r.body));

  r = await post('/api/folios/' + folioId + '/payments', { amount: 700000, method: 'BANK_TRANSFER', idempotencyKey: 'desk-over' }, rec1);
  check('UC-R15 over-collection refused', r.status === 400 && r.body.error.code === 'AMOUNT_EXCEEDS_BALANCE', JSON.stringify(r.body));

  r = await post('/api/folios/' + folioId + '/payments', { amount: 660000, method: 'BANK_TRANSFER', idempotencyKey: 'desk-pay-1' }, rec1);
  const deskOrder = r.body.orderCode;
  check('UC-R15 desk payOS payment returns a VietQR; balance unchanged until paid',
    r.status === 201 && r.body.status === 'PENDING' && !!r.body.qrCode && r.body.balance === 660000, JSON.stringify(r.body));

  r = await post('/api/folios/' + folioId + '/payments', { amount: 660000, method: 'BANK_TRANSFER', idempotencyKey: 'desk-pay-1' }, rec1);
  check('BR-15 same key replays: no second payOS link', r.body.orderCode === deskOrder && (await Payment.countDocuments({ idempotencyKey: 'desk-pay-1' })) === 1, JSON.stringify(r.body));

  await post('/api/payments/payos/webhook', payAtBank(deskOrder));
  check('Guest scans the QR -> webhook settles the folio to zero', (await Folio.findById(folioId)).balance === 0, 'balance=' + (await Folio.findById(folioId)).balance);

  r = await call('PATCH', '/api/rooms/' + target.id + '/status', { event: 'ASSIGN' }, rec1);
  check('UC-R13 refuses a manual ASSIGN that would bypass check-in', r.status === 400 && r.body.error.code === 'USE_CHECK_IN_OUT', JSON.stringify(r.body));
  r = await get('/api/front-desk/bookings?q=' + encodeURIComponent('(Le'), rec1);
  check('UC-R01 search input is regex-escaped', r.status === 200, 'status=' + r.status);

  r = await post('/api/front-desk/check-out', { bookingId: String(winner.id), lateCheckoutSurcharge: 600000 }, rec1);
  check('UC-R09 retried check-out succeeds; surcharge posted once (3,300,000)',
    r.status === 200 && r.body.status === 'CHECKED_OUT' && r.body.total === 3300000, JSON.stringify(r.body));
  check('BR-30 gapless invoice numbering', /^INV-\d{4}-000001$/.test(r.body.invoiceNumber || ''), r.body.invoiceNumber);
  r = await post('/api/folios/' + folioId + '/charges', { description: 'Minibar', amount: 50000 }, rec1);
  check('UC-R19 refuses a charge on a closed folio', r.status === 409 && r.body.error.code === 'FOLIO_CLOSED', JSON.stringify(r.body));
  check('UC-R13 room released to VACANT_DIRTY', (await Room.findById(target.id)).status === 'VACANT_DIRTY', '');

  const wb = await Booking.findById(winner.id);
  const pts = wb.customerId ? await LoyaltyAccount.findOne({ customerId: wb.customerId }) : null;
  check('BR-29 loyalty credited once, on the completed stay', !wb.customerId || (pts && pts.pointBalance === 24000), 'points=' + (pts && pts.pointBalance));

  // A multi-room reservation where room 2 is someone else's (UC-R06 1.0.E2).
  r = await post('/api/bookings', {
    checkInDate: day(1), checkOutDate: day(2), paymentMethod: 'BANK_TRANSFER',
    guest: { fullName: 'Le Dat', email: 'dat@x.com', phone: '0900' },
    rooms: [{ roomTypeId: String(rt._id), adults: 1 }, { roomTypeId: String(rt._id), adults: 2, occupantName: 'Trần Thị Bé' }],
  });
  const famRooms = await Booking.find({ reservationCode: r.body.reservationCode }).sort({ bookingCode: 1 });
  await post('/api/payments/payos/webhook', payAtBank((await Payment.findOne({ bookingId: famRooms[0]._id })).gatewayOrderCode));
  const free = (await get('/api/front-desk/allocatable?roomTypeId=' + rt._id, rec1)).body.rooms[0];
  r = await post('/api/front-desk/check-in', { bookingId: String(famRooms[1]._id), roomId: free.id, roomVersion: free.version, identity: identity('Someone Else') }, rec1);
  check('Room 2 refuses a stranger’s ID', r.status === 403 && r.body.error.code === 'IDENTITY_MISMATCH', JSON.stringify(r.body));
  r = await post('/api/front-desk/check-in', { bookingId: String(famRooms[1]._id), roomId: free.id, roomVersion: free.version, identity: identity('Trần Thị Bé') }, rec1);
  check('Room 2 checks in with its own occupant’s ID (not only the booker’s)', r.status === 200 && r.body.status === 'CHECKED_IN', JSON.stringify(r.body));
  check('...and room 1 is untouched, still waiting', (await Booking.findById(famRooms[0]._id)).status === 'CONFIRMED', '');

  server.close();
  fake.close();
  await req('node_modules/mongoose').disconnect();
  await mongod.stop();

  const failed = results.filter((x) => !x.ok);
  console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE CRASHED:', e);
  process.exit(2);
});
