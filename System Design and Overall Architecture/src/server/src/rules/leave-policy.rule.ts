/**
 * «application logic» / «business logic» LeavePolicyRule
 *
 * Enforces: BR-40 balance, BR-41 departmental coverage, BR-42 rejection reason,
 *           BR-44 no self-approval.
 * Realizes: UC-M06 steps 4–5 and exceptions 1.0.E1, 1.0.E2, 1.0.E4.
 */
import { IEmployee } from '../models/user.model';
import { ILeaveRequest } from '../models/hr.model';
import { LeaveType } from '../models/enums';

/** UC-M06 alternative flow 1.4 — escalate long absences. */
export const ESCALATION_THRESHOLD_DAYS = 10;

export interface LeaveEvaluation {
  canApprove: boolean;
  requiresEscalation: boolean;
  /** Set when coverage would drop below the minimum — needs an explicit override. */
  coverageWarning: string | null;
  balanceWarning: string | null;
  blockedReason: string | null;
}

export interface CoverageContext {
  /** Staff scheduled in the department on the requested dates. */
  scheduledCount: number;
  /** Staff already on approved leave over the same dates. */
  alreadyOnLeaveCount: number;
  minimumRequired: number;
  /** Declared peak-season blackout windows (UC-M06 exception 1.0.E4). */
  blackoutPeriods?: { from: Date; to: Date }[];
}

export class LeavePolicyRule {
  static evaluate(
    request: ILeaveRequest,
    employee: IEmployee,
    approverId: string,
    coverage: CoverageContext,
  ): LeaveEvaluation {
    const result: LeaveEvaluation = {
      canApprove: true,
      requiresEscalation: false,
      coverageWarning: null,
      balanceWarning: null,
      blockedReason: null,
    };

    // BR-44 — a manager may never decide on their own request.
    if (String(request.employeeId) === String(approverId)) {
      result.canApprove = false;
      result.blockedReason = 'BR-44: an employee may not approve their own leave request';
      return result;
    }

    // BR-40 — unpaid leave is the escape hatch when the balance is exhausted.
    if (request.type !== LeaveType.UNPAID) {
      const balance =
        request.type === LeaveType.SICK
          ? employee.leaveBalance.sick
          : employee.leaveBalance.annual;

      if (request.days > balance) {
        result.balanceWarning =
          `BR-40: the employee has only ${balance} day(s) of ${request.type} leave remaining ` +
          `but requested ${request.days}. Approve partially, reject, or convert to unpaid leave.`;
      }
    }

    // BR-41 — coverage must not fall below the departmental minimum.
    const remainingStaff =
      coverage.scheduledCount - coverage.alreadyOnLeaveCount - 1;
    if (remainingStaff < coverage.minimumRequired) {
      result.coverageWarning =
        `BR-41: approving this leave leaves ${remainingStaff} staff on duty, ` +
        `below the minimum of ${coverage.minimumRequired}. An override justification is required.`;
    }

    // UC-M06 exception 1.0.E4 — blackout period needs higher authority.
    const inBlackout = coverage.blackoutPeriods?.some(
      (p) => request.fromDate <= p.to && request.toDate >= p.from,
    );

    if (inBlackout || request.days > ESCALATION_THRESHOLD_DAYS) {
      result.requiresEscalation = true;
    }

    return result;
  }

  /** BR-42 — a rejection must always carry a reason. */
  static validateRejection(note?: string): void {
    if (!note || note.trim().length === 0) {
      throw new Error('BR-42: a rejection requires a reason');
    }
  }
}
