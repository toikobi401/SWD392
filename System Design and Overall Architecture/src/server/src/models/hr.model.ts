/**
 * «entity» Shift / Attendance / LeaveRequest / Payslip / Task / AuditLog
 *
 * Static model: §5.2.
 * Realizes: UC-E09…UC-E24 employee self-service, UC-M01…UC-M08b management,
 *           UC-A13 View System Audit Log.
 */
import { Schema, model, Document, Types } from 'mongoose';
import { LeaveStatus, LeaveType, AttendanceStatus } from './enums';

// --------------------------------------------------------------------------
// Shift — UC-E12 View Work Schedule, UC-M05 Manage Work Schedule
// --------------------------------------------------------------------------

export interface IShift extends Document {
  employeeId: Types.ObjectId;
  date: Date;
  startTime: string; // "07:00"
  endTime: string; // "15:00"
  department: string;
  isOnLeave: boolean;
  swapRequestedWith?: Types.ObjectId;
}

export const Shift = model<IShift>(
  'Shift',
  new Schema<IShift>(
    {
      employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      date: { type: Date, required: true, index: true },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      department: { type: String, required: true },
      // Set by LeaveApprovalService when leave is approved (UC-M06 step 9).
      isOnLeave: { type: Boolean, default: false },
      swapRequestedWith: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  ),
);

// --------------------------------------------------------------------------
// Attendance — UC-E09 Check In / Check Out Attendance
// --------------------------------------------------------------------------

export interface IAttendance extends Document {
  employeeId: Types.ObjectId;
  date: Date;
  checkInTime?: Date;
  checkOutTime?: Date;
  status: AttendanceStatus;
  correctionRequested: boolean;
  correctionNote?: string;
  workedHours(): number;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true },
    checkInTime: Date,
    checkOutTime: Date,
    status: {
      type: String,
      enum: Object.values(AttendanceStatus),
      default: AttendanceStatus.PRESENT,
    },
    // UC-E11 Submit Attendance Correction Request → UC-M08 approval.
    correctionRequested: { type: Boolean, default: false },
    correctionNote: String,
  },
  { timestamps: true },
);

attendanceSchema.methods.workedHours = function (): number {
  if (!this.checkInTime || !this.checkOutTime) return 0;
  return (this.checkOutTime.getTime() - this.checkInTime.getTime()) / 3_600_000;
};

export const Attendance = model<IAttendance>('Attendance', attendanceSchema);

// --------------------------------------------------------------------------
// LeaveRequest — UC-E15 submit, UC-M06 approve/reject
// --------------------------------------------------------------------------

export interface ILeaveRequest extends Document {
  employeeId: Types.ObjectId;
  type: LeaveType;
  fromDate: Date;
  toDate: Date;
  days: number;
  reason: string;
  status: LeaveStatus;
  approverId?: Types.ObjectId;
  decidedAt?: Date;
  decisionNote?: string;
  /** Set when a Manager approves despite a coverage warning (UC-M06 exception 1.0.E2). */
  coverageOverrideJustification?: string;
}

const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(LeaveType), required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 1 },
    reason: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(LeaveStatus),
      default: LeaveStatus.PENDING,
      index: true,
    },
    approverId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
    coverageOverrideJustification: String,
  },
  { timestamps: true },
);

// BR-44: a Manager may not approve their own leave.
leaveRequestSchema.pre('save', function (next) {
  if (this.approverId && this.approverId.equals(this.employeeId)) {
    return next(new Error('BR-44: an employee may not approve their own leave request'));
  }
  next();
});

export const LeaveRequest = model<ILeaveRequest>('LeaveRequest', leaveRequestSchema);

// --------------------------------------------------------------------------
// Payslip — UC-E18 View Salary / Payslip, UC-M08b Approve Payroll
// --------------------------------------------------------------------------

export interface IPayslip extends Document {
  employeeId: Types.ObjectId;
  period: string; // "2026-09"
  baseSalary: number;
  allowances: { name: string; amount: number }[];
  bonuses: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  grossPay: number;
  netPay: number;
  isApproved: boolean;
  approvedBy?: Types.ObjectId;
}

export const Payslip = model<IPayslip>(
  'Payslip',
  new Schema<IPayslip>(
    {
      employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      period: { type: String, required: true },
      baseSalary: { type: Number, required: true },
      allowances: [{ name: String, amount: Number }],
      bonuses: [{ name: String, amount: Number }],
      deductions: [{ name: String, amount: Number }],
      grossPay: { type: Number, required: true },
      netPay: { type: Number, required: true },
      isApproved: { type: Boolean, default: false },
      approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  ).index({ employeeId: 1, period: 1 }, { unique: true }),
);

// --------------------------------------------------------------------------
// Task — UC-E21 View Assigned Tasks, UC-E22 Update Task Status
// --------------------------------------------------------------------------

export interface ITask extends Document {
  title: string;
  description: string;
  assignedTo: Types.ObjectId;
  assignedBy: Types.ObjectId;
  roomId?: Types.ObjectId;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  dueAt?: Date;
  completedAt?: Date;
}

export const Task = model<ITask>(
  'Task',
  new Schema<ITask>(
    {
      title: { type: String, required: true },
      description: { type: String, default: '' },
      assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      // Housekeeping tasks raised at check-out reference the room (UC-R09 step 11).
      roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
      status: {
        type: String,
        enum: ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'],
        default: 'TODO',
      },
      priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
      dueAt: Date,
      completedAt: Date,
    },
    { timestamps: true },
  ),
);

// --------------------------------------------------------------------------
// AuditLog — append-only (BR-49); supports UC-A13 / UC-A14 / UC-A15
// --------------------------------------------------------------------------

export interface IAuditLog extends Document {
  actorId?: Types.ObjectId;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true },
  entityId: String,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now, index: true },
});

// BR-49 / §5.3: the audit trail is immutable — block updates and deletes.
auditLogSchema.pre('updateOne', function (next) {
  next(new Error('BR-49: audit log entries are append-only'));
});
auditLogSchema.pre('deleteOne', function (next) {
  next(new Error('BR-49: audit log entries are append-only'));
});

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
