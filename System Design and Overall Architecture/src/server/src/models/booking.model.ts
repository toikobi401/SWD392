/**
 * «entity» RoomType / Room / Booking / Service / Promotion / Review / LoyaltyAccount
 *
 * Static model: §5.2. Entity objects store the reservation data on which the
 * «control» coordinators and «application logic» rules operate.
 *
 * Realizes: UC-G01 Search, UC-G07 Book Room, UC-G14 Cancel, UC-R06 Check In,
 *           UC-R09 Check Out, UC-M09…UC-M12 inventory & pricing.
 */
import { Schema, model, Document, Types } from 'mongoose';
import { BookingStatus, RoomStatus, DiscountType, ReviewStatus } from './enums';

// --------------------------------------------------------------------------
// RoomType — UC-M10 Manage Room Type / Pricing
// --------------------------------------------------------------------------

export interface IRoomType extends Document {
  name: string;
  description: string;
  capacity: number;
  basePrice: number; // minor units per night
  amenities: string[];
  images: string[];
  totalRooms: number;
  /** Seasonal overrides applied per night by PricingRule (BR-09). */
  seasonalRates: { from: Date; to: Date; price: number }[];
  isActive: boolean;
}

const roomTypeSchema = new Schema<IRoomType>(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    capacity: { type: Number, required: true, min: 1 },
    basePrice: { type: Number, required: true, min: 0 },
    amenities: [String],
    images: [String],
    totalRooms: { type: Number, required: true, min: 0 },
    seasonalRates: [{ from: Date, to: Date, price: Number }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const RoomType = model<IRoomType>('RoomType', roomTypeSchema);

// --------------------------------------------------------------------------
// Room — UC-R08 Assign Room, UC-R13 Update Room Status (§6.5 state machine)
// --------------------------------------------------------------------------

export interface IRoom extends Document {
  roomNumber: string;
  roomTypeId: Types.ObjectId;
  floor: number;
  status: RoomStatus;
  /** Optimistic-lock guard for concurrent allocation — BR-25, UC-R06 exception 1.0.E6. */
  version: number;
  notes?: string;
  isAvailableForAllocation(): boolean;
}

const roomSchema = new Schema<IRoom>(
  {
    roomNumber: { type: String, required: true, unique: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    floor: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(RoomStatus),
      default: RoomStatus.VACANT_CLEAN,
      index: true,
    },
    version: { type: Number, default: 0 },
    notes: String,
  },
  { timestamps: true },
);

roomSchema.methods.isAvailableForAllocation = function (): boolean {
  return this.status === RoomStatus.VACANT_CLEAN;
};

export const Room = model<IRoom>('Room', roomSchema);

// --------------------------------------------------------------------------
// Booking — the central transaction entity (§6.4 state machine)
// --------------------------------------------------------------------------

export interface IBookingGuest {
  fullName: string;
  email: string;
  phone: string;
  specialRequest?: string;
}

export interface IBooking extends Document {
  bookingCode: string;
  customerId?: Types.ObjectId; // absent for an unregistered Guest
  guest: IBookingGuest;
  roomTypeId: Types.ObjectId;
  roomId?: Types.ObjectId; // allocated at check-in (UC-R08)
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
  children: number;
  status: BookingStatus;
  addOnServices: { serviceId: Types.ObjectId; quantity: number; price: number }[];
  promotionId?: Types.ObjectId;
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  actualCheckInAt?: Date;
  actualCheckOutAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  /** BR-20 — booked on a non-refundable rate. Set at booking time, never by
   *  the cancel request. */
  nonRefundable: boolean;

  nights(): number;
  canBeCancelled(): boolean;
}

const bookingSchema = new Schema<IBooking>(
  {
    // BR-11: format HMS-YYYYMMDD-XXXXX.
    bookingCode: { type: String, required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    guest: {
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      specialRequest: String,
    },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    checkInDate: { type: Date, required: true, index: true },
    checkOutDate: { type: Date, required: true },
    adults: { type: Number, required: true, min: 1 },
    children: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(BookingStatus),
      default: BookingStatus.PENDING,
      index: true,
    },
    addOnServices: [
      {
        serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
        quantity: { type: Number, default: 1 },
        price: Number,
      },
    ],
    promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion' },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    actualCheckInAt: Date,
    actualCheckOutAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
    nonRefundable: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Invariant §5.3: check-out must follow check-in, stay ≤ 30 nights (BR-07).
bookingSchema.pre('validate', function (next) {
  if (this.checkOutDate <= this.checkInDate) {
    return next(new Error('checkOutDate must be after checkInDate'));
  }
  const nights = Math.ceil(
    (this.checkOutDate.getTime() - this.checkInDate.getTime()) / 86_400_000,
  );
  if (nights > 30) return next(new Error('A booking may not exceed 30 nights'));
  next();
});

bookingSchema.methods.nights = function (): number {
  return Math.ceil((this.checkOutDate.getTime() - this.checkInDate.getTime()) / 86_400_000);
};

bookingSchema.methods.canBeCancelled = function (): boolean {
  return this.status === BookingStatus.CONFIRMED;
};

export const Booking = model<IBooking>('Booking', bookingSchema);

// --------------------------------------------------------------------------
// InventoryHold — supports BR-10 (15-minute hold) and UC-G07 exception 1.0.E2
// --------------------------------------------------------------------------

export interface IInventoryHold extends Document {
  roomTypeId: Types.ObjectId;
  checkInDate: Date;
  checkOutDate: Date;
  quantity: number;
  expiresAt: Date;
  bookingId?: Types.ObjectId;
}

const inventoryHoldSchema = new Schema<IInventoryHold>({
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
  checkInDate: { type: Date, required: true },
  checkOutDate: { type: Date, required: true },
  quantity: { type: Number, default: 1 },
  // TTL index: MongoDB removes the hold automatically — the «timer» HoldExpiryTimer.
  expiresAt: { type: Date, required: true, expires: 0 },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
});

export const InventoryHold = model<IInventoryHold>('InventoryHold', inventoryHoldSchema);

// --------------------------------------------------------------------------
// Service / Promotion / Review / LoyaltyAccount
// --------------------------------------------------------------------------

export interface IService extends Document {
  name: string;
  description: string;
  price: number;
  isActive: boolean;
}

export const Service = model<IService>(
  'Service',
  new Schema<IService>(
    {
      name: { type: String, required: true, unique: true },
      description: { type: String, default: '' },
      price: { type: Number, required: true, min: 0 },
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);

export interface IPromotion extends Document {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  validFrom: Date;
  validTo: Date;
  usageLimit: number;
  usedCount: number;
  minimumSpend: number;
  isActive: boolean;
  isValidOn(date: Date): boolean;
}

const promotionSchema = new Schema<IPromotion>(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    description: { type: String, default: '' },
    discountType: { type: String, enum: Object.values(DiscountType), required: true },
    discountValue: { type: Number, required: true, min: 0 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    minimumSpend: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// UC-G10 exception 1.0.E5 — expired or exhausted voucher.
promotionSchema.methods.isValidOn = function (date: Date): boolean {
  if (!this.isActive) return false;
  if (date < this.validFrom || date > this.validTo) return false;
  if (this.usageLimit > 0 && this.usedCount >= this.usageLimit) return false;
  return true;
};

export const Promotion = model<IPromotion>('Promotion', promotionSchema);

export interface IReview extends Document {
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  rating: number;
  comment: string;
  status: ReviewStatus;
  managerReply?: string;
}

export const Review = model<IReview>(
  'Review',
  new Schema<IReview>(
    {
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
      customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      rating: { type: Number, required: true, min: 1, max: 5 },
      comment: { type: String, default: '' },
      status: { type: String, enum: Object.values(ReviewStatus), default: ReviewStatus.PENDING },
      managerReply: String,
    },
    { timestamps: true },
  ),
);

export interface ILoyaltyAccount extends Document {
  customerId: Types.ObjectId;
  pointBalance: number;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  lifetimePoints: number;
}

export const LoyaltyAccount = model<ILoyaltyAccount>(
  'LoyaltyAccount',
  new Schema<ILoyaltyAccount>(
    {
      customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
      // Invariant §5.3: balance may never go negative.
      pointBalance: { type: Number, default: 0, min: 0 },
      tier: {
        type: String,
        enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'],
        default: 'BRONZE',
      },
      lifetimePoints: { type: Number, default: 0 },
    },
    { timestamps: true },
  ),
);
