/**
 * «entity» User / Role / Customer / Employee
 *
 * Static model: §5.2. Object category: entity object (Ch. 8) — stores information
 * and provides limited access to it through its own operations.
 *
 * Realizes: UC-G16 Register Account, UC-G17 Login, UC-A01 Manage User Accounts,
 *           UC-A06 Assign Role to Account.
 */
import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { AccountStatus, RoleName, Permission } from './enums';

// --------------------------------------------------------------------------
// Role — UC-A05 Manage Roles, UC-A07 Configure Role Permissions
// --------------------------------------------------------------------------

export interface IRole extends Document {
  name: RoleName;
  description: string;
  permissions: Permission[];
  isSystemRole: boolean;
  hasPermission(permission: Permission): boolean;
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, enum: Object.values(RoleName), required: true, unique: true },
    description: { type: String, default: '' },
    permissions: [{ type: String, enum: Object.values(Permission) }],
    // BR-48: a system role (e.g. SUPER_ADMIN) may not be deleted.
    isSystemRole: { type: Boolean, default: false },
  },
  { timestamps: true },
);

roleSchema.methods.hasPermission = function (permission: Permission): boolean {
  return this.permissions.includes(permission);
};

export const Role = model<IRole>('Role', roleSchema);

// --------------------------------------------------------------------------
// User — base entity for both Customer and Employee (§5.2 generalization)
// --------------------------------------------------------------------------

export interface IUser extends Document {
  email: string;
  phone?: string;
  passwordHash: string;
  fullName: string;
  status: AccountStatus;
  /**
   * Unpopulated this holds ObjectIds; after `.populate('roles')` it holds the
   * IRole documents themselves. Both shapes are declared so a populated user
   * still satisfies IUser (BR-45: permissions are reached only through roles).
   */
  roles: Types.ObjectId[] | IRole[];
  failedLoginAttempts: number;
  lastLoginAt?: Date;
  emailVerifiedAt?: Date;
  avatarUrl?: string;

  verifyPassword(plain: string): Promise<boolean>;
  isActive(): boolean;
}

const userSchema = new Schema<IUser>(
  {
    // BR-04: one account per email.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.PENDING_VERIFICATION,
    },
    roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    // BR-02: lock the account after 5 consecutive failures (UC-G17 exception 1.0.E4).
    failedLoginAttempts: { type: Number, default: 0 },
    lastLoginAt: Date,
    emailVerifiedAt: Date,
    avatarUrl: String,
  },
  { timestamps: true, discriminatorKey: 'userType' },
);

userSchema.methods.verifyPassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.isActive = function (): boolean {
  return this.status === AccountStatus.ACTIVE;
};

export const User = model<IUser>('User', userSchema);

// --------------------------------------------------------------------------
// Customer — specializes User. UC-C06…UC-C21.
// --------------------------------------------------------------------------

export interface ICustomer extends IUser {
  dateOfBirth?: Date;
  address?: string;
  nationality?: string;
  savedPaymentMethods: { token: string; last4: string; brand: string }[];
  notificationPreferences: { email: boolean; sms: boolean; push: boolean };
}

export const Customer = User.discriminator<ICustomer>(
  'Customer',
  new Schema({
    dateOfBirth: Date,
    address: String,
    nationality: String,
    // BR-16: only the gateway token is stored — raw card data never reaches HMS.
    savedPaymentMethods: [{ token: String, last4: String, brand: String }],
    notificationPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },
  }),
);

// --------------------------------------------------------------------------
// Employee — specializes User. UC-E01…UC-E24, UC-M01…UC-M08b.
// --------------------------------------------------------------------------

export interface IEmployee extends IUser {
  employeeCode: string;
  department: string;
  position: string;
  hireDate: Date;
  baseSalary: number; // integer minor units (BR: avoid floating-point error)
  managerId?: Types.ObjectId;
  leaveBalance: { annual: number; sick: number };
}

export const Employee = User.discriminator<IEmployee>(
  'Employee',
  new Schema({
    employeeCode: { type: String, required: true, unique: true },
    department: { type: String, required: true },
    position: { type: String, required: true },
    hireDate: { type: Date, required: true },
    baseSalary: { type: Number, required: true, min: 0 },
    managerId: { type: Schema.Types.ObjectId, ref: 'User' },
    leaveBalance: {
      annual: { type: Number, default: 12 },
      sick: { type: Number, default: 30 },
    },
  }),
);
