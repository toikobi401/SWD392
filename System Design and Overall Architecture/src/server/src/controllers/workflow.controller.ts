/**
 * «boundary» / I/O RefundController · LeaveController · AccountController
 *
 * The approval-workflow and administration endpoints.
 *
 * Realizes: UC-C17 Request Refund, UC-M14 Approve Refund,
 *           UC-E15/E16 leave submission, UC-M06 Approve / Reject Leave,
 *           UC-A01 Manage User Accounts, UC-A06 Assign Role,
 *           UC-A08 Revoke Role, UC-A13 View Audit Log, UC-A15 Export.
 */
import { Request, Response } from 'express';
import { RefundCoordinator } from '../services/refund.service';
import { LeaveApprovalService } from '../services/leave.service';
import { RoleAssignmentService, AccountService } from '../services/role.service';
import { AccountQueries } from '../services/query.service';
import { AuditService } from '../services/audit.service';
import { LeaveType, AccountStatus, Permission } from '../models/enums';
import { AppError } from '../utils/app-error';

export class RefundController {
  /** POST /api/refund-requests — UC-C17 */
  static async request(req: Request, res: Response): Promise<void> {
    const request = await RefundCoordinator.request({
      bookingId: req.body.bookingId,
      customerId: req.auth!.sub,
      amount: Number(req.body.amount),
      reasonCategory: req.body.reasonCategory,
      description: req.body.description,
    });

    res.status(201).json({
      referenceNumber: request.referenceNumber,
      status: request.status,
      requestedAmount: request.requestedAmount,
      approvedAmount: request.approvedAmount,
    });
  }

  /** GET /api/refund-requests/pending — UC-M14 queue */
  static async pending(_req: Request, res: Response): Promise<void> {
    const requests = await RefundCoordinator.pendingQueue();
    res.json({ requests, count: requests.length });
  }

  /** PATCH /api/refund-requests/:id/decision — UC-M14 */
  static async decide(req: Request, res: Response): Promise<void> {
    const request = await RefundCoordinator.decide({
      refundId: req.params.id,
      approverId: req.auth!.sub,
      approve: Boolean(req.body.approve),
      approvedAmount: req.body.approvedAmount ? Number(req.body.approvedAmount) : undefined,
      note: req.body.note,
    });

    res.json({
      referenceNumber: request.referenceNumber,
      status: request.status,
      approvedAmount: request.approvedAmount,
    });
  }
}

export class LeaveController {
  /** POST /api/leave-requests — UC-E15 */
  static async submit(req: Request, res: Response): Promise<void> {
    const request = await LeaveApprovalService.submit({
      employeeId: req.auth!.sub,
      type: req.body.type as LeaveType,
      fromDate: new Date(req.body.fromDate),
      toDate: new Date(req.body.toDate),
      reason: req.body.reason,
    });

    res.status(201).json(request);
  }

  /** POST /api/leave-requests/:id/cancel — UC-E16 */
  static async cancel(req: Request, res: Response): Promise<void> {
    const request = await LeaveApprovalService.cancel(req.params.id, req.auth!.sub);
    res.json({ id: request._id, status: request.status });
  }

  /** GET /api/leave-requests/pending?department= — UC-M06 step 2 */
  static async pending(req: Request, res: Response): Promise<void> {
    const department = String(req.query.department ?? '');
    if (!department) {
      throw new AppError('MISSING_DEPARTMENT', 'A department is required', 400);
    }

    const requests = await LeaveApprovalService.pendingQueue(department);
    res.json({ requests, count: requests.length });
  }

  /**
   * PATCH /api/leave-requests/:id/decision — UC-M06
   *
   * A 409 with `requiresOverride` is the coverage warning of exception 1.0.E2:
   * the client re-submits with a justification to proceed.
   */
  static async decide(req: Request, res: Response): Promise<void> {
    const request = await LeaveApprovalService.decide({
      requestId: req.params.id,
      approverId: req.auth!.sub,
      approve: Boolean(req.body.approve),
      note: req.body.note,
      coverageOverrideJustification: req.body.coverageOverrideJustification,
      partialToDate: req.body.partialToDate ? new Date(req.body.partialToDate) : undefined,
    });

    res.json({
      id: request._id,
      status: request.status,
      days: request.days,
      decidedAt: request.decidedAt,
    });
  }
}

export class AccountController {
  /** GET /api/accounts — UC-A01 */
  static async list(req: Request, res: Response): Promise<void> {
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 25), 100);

    const { users, total } = await AccountQueries.list({
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
      page,
      pageSize,
    });

    res.json({ users, total, page, pageSize });
  }

  /** POST /api/accounts — UC-A02 Create Employee Account */
  static async createEmployee(req: Request, res: Response): Promise<void> {
    const { employee, temporaryPassword } = await AccountService.createEmployee({
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      employeeCode: req.body.employeeCode,
      department: req.body.department,
      position: req.body.position,
      hireDate: new Date(req.body.hireDate),
      baseSalary: Number(req.body.baseSalary),
      roleId: req.body.roleId,
      actorId: req.auth!.sub,
    });

    res.status(201).json({
      id: employee._id,
      employeeCode: employee.employeeCode,
      email: employee.email,
      // Shown once so the admin can hand it over; never stored in clear form.
      temporaryPassword,
    });
  }

  /** PATCH /api/accounts/:id/status — UC-A04 Deactivate / Lock Account */
  static async setStatus(req: Request, res: Response): Promise<void> {
    const user = await AccountService.setStatus(
      req.params.id,
      req.body.status as AccountStatus,
      req.auth!.sub,
      req.body.reason,
    );
    res.json({ id: user._id, status: user.status });
  }

  /** POST /api/accounts/:id/roles — UC-A06 */
  static async assignRole(req: Request, res: Response): Promise<void> {
    const user = await RoleAssignmentService.assign({
      userId: req.params.id,
      roleId: req.body.roleId,
      actorId: req.auth!.sub,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      reason: req.body.reason,
    });

    const permissions = await RoleAssignmentService.effectivePermissions(String(user._id));
    res.json({ id: user._id, roles: user.roles, effectivePermissions: permissions });
  }

  /** DELETE /api/accounts/:id/roles/:roleId — UC-A08 */
  static async revokeRole(req: Request, res: Response): Promise<void> {
    const user = await RoleAssignmentService.revoke(
      req.params.id,
      req.params.roleId,
      req.auth!.sub,
      req.body?.reason,
    );

    const permissions = await RoleAssignmentService.effectivePermissions(String(user._id));
    res.json({ id: user._id, roles: user.roles, effectivePermissions: permissions });
  }

  /** GET /api/roles — the assignable role catalogue (UC-A05) */
  static async listRoles(_req: Request, res: Response): Promise<void> {
    res.json({ roles: await AccountQueries.roles() });
  }

  /** PUT /api/roles/:id/permissions — UC-A07 */
  static async configurePermissions(req: Request, res: Response): Promise<void> {
    const role = await RoleAssignmentService.configurePermissions(
      req.params.id,
      req.body.permissions as Permission[],
      req.auth!.sub,
    );
    res.json(role);
  }
}

export class AuditController {
  /** GET /api/audit-logs — UC-A13 */
  static async query(req: Request, res: Response): Promise<void> {
    const result = await AuditService.query({
      actorId: req.query.actorId as string,
      action: req.query.action as string,
      entityType: req.query.entityType as string,
      from: req.query.from ? new Date(String(req.query.from)) : undefined,
      to: req.query.to ? new Date(String(req.query.to)) : undefined,
      page: Number(req.query.page ?? 1),
      pageSize: Math.min(Number(req.query.pageSize ?? 50), 200),
    });

    res.json(result);
  }

  /** GET /api/audit-logs/login-history/:userId — UC-A14 */
  static async loginHistory(req: Request, res: Response): Promise<void> {
    res.json({ entries: await AuditService.loginHistory(req.params.userId) });
  }

  /** GET /api/audit-logs/export — UC-A15 */
  static async exportCsv(req: Request, res: Response): Promise<void> {
    const csv = await AuditService.exportCsv({
      from: req.query.from ? new Date(String(req.query.from)) : undefined,
      to: req.query.to ? new Date(String(req.query.to)) : undefined,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  }
}
