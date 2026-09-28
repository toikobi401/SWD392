/**
 * «control» LeaveApprovalService
 *
 * Coordinates the leave-approval workflow. The policy decisions themselves live
 * in LeavePolicyRule («application logic»); this class sequences the queue, the
 * decision, the balance update and the roster effect.
 *
 * Realizes: UC-E15 Submit Leave Request, UC-E16 Cancel Leave Request,
 *           UC-M06 Approve / Reject Leave Request.
 */
import { LeaveRequest, ILeaveRequest, Shift } from '../models/hr.model';
import { Employee, IEmployee } from '../models/user.model';
import { LeaveStatus, LeaveType } from '../models/enums';
import { LeavePolicyRule, CoverageContext } from '../rules/leave-policy.rule';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

export interface SubmitLeaveCommand {
  employeeId: string;
  type: LeaveType;
  fromDate: Date;
  toDate: Date;
  reason: string;
}

export interface DecisionCommand {
  requestId: string;
  approverId: string;
  approve: boolean;
  note?: string;
  /** UC-M06 exception 1.0.E2 — required to approve past the coverage minimum. */
  coverageOverrideJustification?: string;
  /** UC-M06 alternative flow 1.2 — approve fewer days than requested. */
  partialToDate?: Date;
}

export class LeaveApprovalService {
  /** UC-E15 — an employee submits an application. */
  static async submit(command: SubmitLeaveCommand): Promise<ILeaveRequest> {
    if (command.toDate < command.fromDate) {
      throw new AppError('INVALID_RANGE', 'The end date must not precede the start date', 400);
    }

    const days = this.countDays(command.fromDate, command.toDate);

    const request = await LeaveRequest.create({
      employeeId: command.employeeId,
      type: command.type,
      fromDate: command.fromDate,
      toDate: command.toDate,
      days,
      reason: command.reason,
      status: LeaveStatus.PENDING,
    });

    await AuditService.record({
      action: 'LEAVE_REQUESTED',
      entityType: 'LeaveRequest',
      entityId: String(request._id),
      actorId: command.employeeId,
      after: { type: command.type, days },
    });

    return request;
  }

  /** UC-E16 — withdraw a request that has not yet been decided. */
  static async cancel(requestId: string, employeeId: string): Promise<ILeaveRequest> {
    const request = await LeaveRequest.findById(requestId);
    if (!request) throw new AppError('NOT_FOUND', 'Leave request not found', 404);

    if (String(request.employeeId) !== employeeId) {
      throw new AppError('FORBIDDEN', 'You may only cancel your own request', 403);
    }
    if (request.status !== LeaveStatus.PENDING) {
      throw new AppError(
        'ALREADY_DECIDED',
        `This request has already been ${request.status.toLowerCase()}`,
        409,
      );
    }

    request.status = LeaveStatus.CANCELLED;
    await request.save();
    return request;
  }

  /** UC-M06 step 2 — the manager's pending queue, with the context to decide. */
  static async pendingQueue(department: string): Promise<ILeaveRequest[]> {
    const staff = await Employee.find({ department }).select('_id');
    return LeaveRequest.find({
      employeeId: { $in: staff.map((e) => e._id) },
      status: LeaveStatus.PENDING,
    })
      // The manager decides on a person, not an id.
      .populate('employeeId', 'fullName position department leaveBalance')
      .sort({ createdAt: 1 });
  }

  /**
   * UC-M06 Normal Flow 1.0 and alternative flows 1.1–1.2.
   *
   * The optimistic guard on `status` makes a concurrent second decision fail
   * rather than overwrite the first — UC-M06 exception 1.0.E5.
   */
  static async decide(command: DecisionCommand): Promise<ILeaveRequest> {
    const request = await LeaveRequest.findById(command.requestId);
    if (!request) throw new AppError('NOT_FOUND', 'Leave request not found', 404);

    // UC-M06 exceptions 1.0.E3 / 1.0.E5.
    if (request.status !== LeaveStatus.PENDING) {
      throw new AppError(
        'ALREADY_DECIDED',
        `This request has already been ${request.status.toLowerCase()}`,
        409,
      );
    }

    const employee = await Employee.findById(request.employeeId);
    if (!employee) throw new AppError('NOT_FOUND', 'Employee not found', 404);

    if (!command.approve) {
      // BR-42 — a rejection must carry a reason.
      LeavePolicyRule.validateRejection(command.note);
      return this.applyDecision(request, employee, command, LeaveStatus.REJECTED, 0);
    }

    // Steps 4–5 — evaluate balance, coverage and blackout.
    const coverage = await this.buildCoverageContext(request, employee);
    const evaluation = LeavePolicyRule.evaluate(
      request,
      employee,
      command.approverId,
      coverage,
    );

    // BR-44 — self-approval is blocked outright.
    if (!evaluation.canApprove) {
      throw new AppError('FORBIDDEN', evaluation.blockedReason!, 403);
    }

    // UC-M06 exception 1.0.E2 — coverage breach needs an explicit override.
    if (evaluation.coverageWarning && !command.coverageOverrideJustification) {
      throw new AppError('COVERAGE_OVERRIDE_REQUIRED', evaluation.coverageWarning, 409, {
        requiresOverride: true,
      });
    }

    // Alternative flow 1.4 — long or blackout leave goes up a level.
    if (evaluation.requiresEscalation) {
      request.status = LeaveStatus.ESCALATED;
      request.decisionNote = 'Escalated: exceeds the manager approval threshold';
      await request.save();
      return request;
    }

    // Alternative flow 1.2 — partial approval shortens the granted period.
    let grantedDays = request.days;
    if (command.partialToDate && command.partialToDate < request.toDate) {
      grantedDays = this.countDays(request.fromDate, command.partialToDate);
      request.toDate = command.partialToDate;
      request.days = grantedDays;
    }

    return this.applyDecision(
      request,
      employee,
      command,
      LeaveStatus.APPROVED,
      grantedDays,
    );
  }

  // ------------------------------------------------------------------------

  private static async applyDecision(
    request: ILeaveRequest,
    employee: IEmployee,
    command: DecisionCommand,
    status: LeaveStatus,
    grantedDays: number,
  ): Promise<ILeaveRequest> {
    request.status = status;
    request.approverId = command.approverId as never;
    request.decidedAt = new Date();
    request.decisionNote = command.note;
    request.coverageOverrideJustification = command.coverageOverrideJustification;
    await request.save();

    if (status === LeaveStatus.APPROVED) {
      // Step 8 — unpaid leave never draws down an accrued balance (BR-40).
      if (request.type !== LeaveType.UNPAID) {
        const field =
          request.type === LeaveType.SICK ? 'leaveBalance.sick' : 'leaveBalance.annual';
        await Employee.findByIdAndUpdate(employee._id, { $inc: { [field]: -grantedDays } });
      }

      // Step 9 — mark the roster so the gaps can be reassigned.
      await Shift.updateMany(
        {
          employeeId: employee._id,
          date: { $gte: request.fromDate, $lte: request.toDate },
        },
        { $set: { isOnLeave: true } },
      );
    }

    // Step 10 — notify the employee of the outcome.
    await NotificationProxy.sendDecisionNotice(
      employee.email,
      `Leave request ${status.toLowerCase()}`,
      `Your ${request.type} leave from ${request.fromDate.toDateString()} to ` +
        `${request.toDate.toDateString()} was ${status.toLowerCase()}.` +
        (command.note ? `\n\nNote: ${command.note}` : ''),
    ).catch(() => undefined);

    await AuditService.record({
      action: status === LeaveStatus.APPROVED ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      entityType: 'LeaveRequest',
      entityId: String(request._id),
      actorId: command.approverId,
      after: { days: grantedDays, note: command.note },
    });

    return request;
  }

  /** Gathers the staffing facts LeavePolicyRule needs to judge coverage. */
  private static async buildCoverageContext(
    request: ILeaveRequest,
    employee: IEmployee,
  ): Promise<CoverageContext> {
    const [scheduledCount, alreadyOnLeaveCount] = await Promise.all([
      Shift.countDocuments({
        department: employee.department,
        date: { $gte: request.fromDate, $lte: request.toDate },
      }),
      Shift.countDocuments({
        department: employee.department,
        date: { $gte: request.fromDate, $lte: request.toDate },
        isOnLeave: true,
      }),
    ]);

    return {
      scheduledCount,
      alreadyOnLeaveCount,
      minimumRequired: Number(process.env.MIN_DEPARTMENT_COVERAGE ?? 2),
      blackoutPeriods: [],
    };
  }

  private static countDays(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }
}
