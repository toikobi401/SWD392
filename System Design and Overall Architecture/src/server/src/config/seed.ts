/**
 * Seed data — the RBAC catalogue, the room inventory and development accounts.
 *
 * ROLE_PERMISSIONS is the single source of truth for who may do what; the
 * smoke test seeds from it too, so tests can never grant a role more than the
 * real system does.
 *
 * Runs automatically on first start in development (empty database), or on
 * demand with `npm run seed`. It refuses to create demo accounts in production.
 */
import bcrypt from 'bcryptjs';
import { Role, User, Customer, Employee } from '../models/user.model';
import { RoomType, Room, Service, Promotion, LoyaltyAccount } from '../models/booking.model';
import { hotelDateOf, hotelDayEnd, hotelDayStart } from '../utils/hotel-time';
import { AccountStatus, DiscountType, Permission, RoleName } from '../models/enums';

const P = Permission;

/**
 * Derived from the actor use case diagrams. Receptionist, Manager and Admin
 * generalize Employee (§2.1), so every staff account also holds EMPLOYEE —
 * whose self-service endpoints need only authentication, hence no permissions.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.GUEST]: [],
  // Owns-only access to their bookings is enforced in the services; the
  // permission merely allows the cancel endpoint. NOT BOOKING_READ — that is
  // the staff right to read anyone's booking.
  [RoleName.CUSTOMER]: [P.BOOKING_CANCEL],
  [RoleName.EMPLOYEE]: [],
  [RoleName.RECEPTIONIST]: [
    P.BOOKING_READ, P.BOOKING_CREATE, P.BOOKING_MODIFY, P.BOOKING_CANCEL,
    P.CHECK_IN, P.CHECK_OUT, P.ROOM_STATUS_UPDATE, P.PROCESS_PAYMENT, P.PROCESS_REFUND,
  ],
  [RoleName.MANAGER]: [
    P.BOOKING_READ, P.APPROVE_LEAVE, P.APPROVE_REFUND, P.APPROVE_PAYROLL,
    P.MANAGE_INVENTORY, P.MANAGE_PRICING, P.VIEW_REPORTS,
  ],
  [RoleName.ADMIN]: [
    P.MANAGE_ACCOUNTS, P.MANAGE_ROLES, P.MANAGE_SETTINGS, P.VIEW_AUDIT_LOG, P.MANAGE_BACKUP,
  ],
  [RoleName.SUPER_ADMIN]: Object.values(Permission),
};

/** Development-only password for every seeded account (satisfies BR-01). */
export const DEV_PASSWORD = 'Dev@12345';

/** Upserts every role with its permission set. Safe to run repeatedly. */
export async function seedRoles(): Promise<void> {
  for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await Role.updateOne(
      { name },
      {
        $set: { permissions },
        $setOnInsert: {
          description: `${name} role`,
          // BR-48: system roles cannot be deleted.
          isSystemRole: name === RoleName.SUPER_ADMIN || name === RoleName.CUSTOMER,
        },
      },
      { upsert: true },
    );
  }
}

/** Six room types, 120 rooms — matching TOTAL_ROOMS / ROOM_TYPES. */
const ROOM_TYPES = [
  { name: 'Standard Single', capacity: 1, basePrice: 600_000, rooms: 30, amenities: ['WiFi', 'Air conditioning', 'Work desk'] },
  { name: 'Standard Double', capacity: 2, basePrice: 800_000, rooms: 30, amenities: ['WiFi', 'Air conditioning', 'Double bed'] },
  { name: 'Superior Twin', capacity: 2, basePrice: 1_100_000, rooms: 20, amenities: ['WiFi', 'Twin beds', 'City view', 'Minibar'] },
  { name: 'Deluxe Sea View', capacity: 2, basePrice: 1_600_000, rooms: 20, amenities: ['WiFi', 'King bed', 'Sea view', 'Bathtub', 'Minibar'] },
  { name: 'Family Suite', capacity: 4, basePrice: 2_500_000, rooms: 12, amenities: ['WiFi', 'Two bedrooms', 'Living room', 'Kitchenette'] },
  { name: 'Presidential Suite', capacity: 4, basePrice: 6_000_000, rooms: 8, amenities: ['WiFi', 'Butler service', 'Private terrace', 'Jacuzzi'] },
];

export async function seedCatalogue(): Promise<void> {
  if (await RoomType.exists({})) return;

  // One seasonal example (BR-09): the Tết peak window, priced +30 %.
  const year = new Date().getFullYear() + 1;
  const tet = { from: new Date(`${year}-01-25`), to: new Date(`${year}-02-10`) };

  let roomSeq = 0;
  for (const t of ROOM_TYPES) {
    const rt = await RoomType.create({
      name: t.name,
      description: `${t.name} — sleeps ${t.capacity}.`,
      capacity: t.capacity,
      basePrice: t.basePrice,
      amenities: t.amenities,
      images: [],
      totalRooms: t.rooms,
      seasonalRates: [{ ...tet, price: Math.round(t.basePrice * 1.3) }],
    });

    // 20 rooms per floor: 101–120, 201–220, … 601–620.
    const rooms = Array.from({ length: t.rooms }, () => {
      const floor = Math.floor(roomSeq / 20) + 1;
      const number = floor * 100 + (roomSeq % 20) + 1;
      roomSeq++;
      return { roomNumber: String(number), roomTypeId: rt._id, floor };
    });
    await Room.insertMany(rooms);
  }

  await Service.insertMany([
    { name: 'Breakfast buffet', price: 150_000, description: 'Per person, per day' },
    { name: 'Airport pickup', price: 350_000, description: 'Noi Bai airport, one way' },
    { name: 'Spa — 60 min', price: 500_000, description: 'Traditional Vietnamese massage' },
    { name: 'Laundry', price: 100_000, description: 'Per bag' },
  ]);

  const today = hotelDateOf(new Date());
  await Promotion.create({
    code: 'WELCOME10',
    description: '10 % off your stay',
    discountType: DiscountType.PERCENTAGE,
    discountValue: 10,
    // Hotel days, as the Manager's form sets them (UC-M20).
    validFrom: hotelDayStart(today),
    validTo: hotelDayEnd(hotelDateOf(new Date(Date.now() + 365 * 86_400_000))),
    isPublic: true,
  });
}

/** One account per actor, for trying the system out. Never in production. */
export async function seedDevAccounts(): Promise<{ email: string; roles: string }[]> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create demo accounts in production');
  }

  const roleId = async (name: RoleName) => (await Role.findOne({ name }))!._id;
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  const staff = [
    { email: 'admin@hms.local', fullName: 'System Admin', roles: [RoleName.SUPER_ADMIN, RoleName.EMPLOYEE], code: 'E0001', position: 'IT Administrator', department: 'IT' },
    { email: 'manager@hms.local', fullName: 'Hotel Manager', roles: [RoleName.MANAGER, RoleName.EMPLOYEE], code: 'E0002', position: 'Front Office Manager', department: 'Front Office' },
    { email: 'reception@hms.local', fullName: 'Front Desk', roles: [RoleName.RECEPTIONIST, RoleName.EMPLOYEE], code: 'E0003', position: 'Receptionist', department: 'Front Office' },
  ];

  const created: { email: string; roles: string }[] = [];

  for (const s of staff) {
    if (await User.exists({ email: s.email })) continue;
    await Employee.create({
      fullName: s.fullName,
      email: s.email,
      passwordHash,
      status: AccountStatus.ACTIVE,
      roles: await Promise.all(s.roles.map(roleId)),
      employeeCode: s.code,
      department: s.department,
      position: s.position,
      hireDate: new Date(),
      baseSalary: 12_000_000,
    });
    created.push({ email: s.email, roles: s.roles.join(' + ') });
  }

  if (!(await User.exists({ email: 'customer@hms.local' }))) {
    const customer = await Customer.create({
      fullName: 'Demo Customer',
      email: 'customer@hms.local',
      phone: '0900000000',
      passwordHash,
      status: AccountStatus.ACTIVE,
      roles: [await roleId(RoleName.CUSTOMER)],
    });
    await LoyaltyAccount.create({ customerId: customer._id });
    created.push({ email: 'customer@hms.local', roles: RoleName.CUSTOMER });
  }

  return created;
}

/** Everything, idempotently. */
export async function seedAll(): Promise<void> {
  await seedRoles();
  await seedCatalogue();

  if (process.env.NODE_ENV !== 'production') {
    const accounts = await seedDevAccounts();
    if (accounts.length) {
      console.log('[seed] development accounts (password for all: ' + DEV_PASSWORD + ')');
      for (const a of accounts) console.log(`[seed]   ${a.email.padEnd(22)} ${a.roles}`);
    }
  }
}

/** Called at startup: seeds only a database that has never been seeded. */
export async function seedIfEmpty(): Promise<void> {
  if (await Role.exists({})) return;
  console.log('[seed] empty database — seeding roles, 6 room types / 120 rooms, services');
  await seedAll();
}
