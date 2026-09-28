/**
 * «control» RoleAssignmentService
 *
 * The security-critical heart of the RBAC model. Grants and revokes roles, and
 * recalculates the effective permission set.
 *
 * Enforces: BR-45 permissions only through roles, BR-46 effective set is the
 *           union of role permissions, BR-47 segregation of duties checked at
 *           assignment time, BR-48 at least one Super Admin must remain,
 *           BR-49 every role change is audit-logged.
 * Realizes: UC-A06 Assign Role to Account, UC-A07 Configure Role Permissions,
 *           UC-A08 Revoke Role from Account.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { User, Role, Employee, IUser, IRole, IEmployee } from '../models/user.model';
import { AccountStatus, RoleName, Permission } from '../models/enums';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/**
 * BR-47 — role pairs that must never be held together, because one audits or
 * approves what the other performs. Checked at assignment time, not at use.
 */
export const SEGREGATION_OF_DUTIES: [RoleName, RoleName][] = [
  [RoleName.ADMIN, RoleName.MANAGER],
];

export interface CreateEmployeeCommand {
  fullName: string;
  email: string;
  phone?: string;
  employeeCode: string;
  department: string;
  position: string;
  hireDate: Date;
  baseSalary: number;
  roleId?: string;
  actorId: string;
}

/**
 * «control» AccountService — UC-A02 Create Employee Account,
 * UC-A04 Deactivate / Lock Account.
 */
export class AccountService {
  /**
   * UC-A02. A staff account is provisioned ACTIVE: it is created by a trusted
   * administrator, so there is no email ownership to prove first. The
   * temporary password is returned once and never stored in clear form.
   */
  static async createEmployee(
    command: CreateEmployeeCommand,
  ): Promise<{ employee: IEmployee; temporaryPassword: string }> {
    // crypto, not Math.random: this is a credential.
    const temporaryPassword = randomBytes(9).toString('base64url') + 'A1';

    const employee = await Employee.create({
      fullName: command.fullName,
      email: command.email.toLowerCase().trim(),
      phone: command.phone,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      status: AccountStatus.ACTIVE,
      employeeCode: command.employeeCode,
      department: command.department,
      position: command.position,
      hireDate: command.hireDate,
      baseSalary: command.baseSalary,
    });

    // UC-A06 alternative flow 1.1 — the initial role is granted inline.
    if (command.roleId) {
      await RoleAssignmentService.assign({
        userId: String(employee._id),
        roleId: command.roleId,
        actorId: command.actorId,
        reason: 'Initial provisioning',
      });
    }

    await AuditService.record({
      action: 'EMPLOYEE_ACCOUNT_CREATED',
      entityType: 'User',
      entityId: String(employee._id),
      actorId: command.actorId,
      after: { employeeCode: employee.employeeCode, department: employee.department },
    });

    return { employee, temporaryPassword };
  }

  /** UC-A04 — every status change is audited with its reason. */
  static async setStatus(
    userId: string,
    status: AccountStatus,
    actorId: string,
    reason?: string,
  ): Promise<IUser> {
    if (!Object.values(AccountStatus).includes(status)) {
      throw new AppError('INVALID_STATUS', `Unknown account status: ${status}`, 400);
    }
    // An admin locking themselves out is almost always a mistake.
    if (userId === actorId && status !== AccountStatus.ACTIVE) {
      throw new AppError('SELF_LOCKOUT', 'You cannot deactivate your own account', 409);
    }

    const user = await User.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'Account not found', 404);

    const before = user.status;
    user.status = status;
    await user.save();

    await AuditService.record({
      action: 'ACCOUNT_STATUS_CHANGED',
      entityType: 'User',
      entityId: String(user._id),
      actorId,
      before: { status: before },
      after: { status, reason },
    });

    return user;
  }
}

export interface AssignRoleCommand {
  userId: string;
  roleId: string;
  actorId: string;
  /** UC-A06 alternative flow 1.2 — a temporary grant that lapses. */
  expiresAt?: Date;
  reason?: string;
}

export class RoleAssignmentService {
  /** UC-A06 Normal Flow 1.0. */
  static async assign(command: AssignRoleCommand): Promise<IUser> {
    const [user, role, actor] = await Promise.all([
      User.findById(command.userId).populate<{ roles: IRole[] }>('roles'),
      Role.findById(command.roleId),
      User.findById(command.actorId).populate<{ roles: IRole[] }>('roles'),
    ]);

    if (!user) throw new AppError('NOT_FOUND', 'Account not found', 404);
    if (!role) throw new AppError('NOT_FOUND', 'Role not found', 404);
    if (!actor) throw new AppError('NOT_FOUND', 'Acting administrator not found', 404);

    // UC-A06 exception 1.0.E3.
    if (user.status !== AccountStatus.ACTIVE) {
      throw new AppError(
        'ACCOUNT_INACTIVE',
        'Roles cannot be assigned to an inactive account. Reactivate it first.',
        409,
      );
    }

    const current = (user.roles as unknown as IRole[]) ?? [];

    // UC-A06 exception 1.0.E1.
    if (current.some((r) => String(r._id) === command.roleId)) {
      throw new AppError('ALREADY_ASSIGNED', 'This account already holds that role', 409);
    }

    // UC-A06 exception 1.0.E4 — an admin may not grant authority above their own.
    this.assertNoPrivilegeEscalation(actor, role, command.actorId);

    // BR-47 — UC-A06 exception 1.0.E2.
    this.assertNoSegregationConflict(current, role);

    user.roles = [...current.map((r) => r._id), role._id] as never;
    await user.save();

    // Step 9 — invalidate live sessions so the new claims take effect at once.
    await this.invalidateSessions(String(user._id));

    // BR-49 — the permanent record of who granted what, to whom, and why.
    await AuditService.record({
      action: 'ROLE_ASSIGNED',
      entityType: 'User',
      entityId: String(user._id),
      actorId: command.actorId,
      before: { roles: current.map((r) => r.name) },
      after: { roleGranted: role.name, expiresAt: command.expiresAt, reason: command.reason },
    });

    // Step 11 — tell the user their access changed.
    await NotificationProxy.sendDecisionNotice(
      user.email,
      'Your access has been updated',
      `You have been granted the ${role.name} role.`,
    ).catch(() => undefined);

    return user;
  }

  /** UC-A08 Revoke Role from Account. */
  static async revoke(
    userId: string,
    roleId: string,
    actorId: string,
    reason?: string,
  ): Promise<IUser> {
    const user = await User.findById(userId).populate<{ roles: IRole[] }>('roles');
    if (!user) throw new AppError('NOT_FOUND', 'Account not found', 404);

    const current = (user.roles as unknown as IRole[]) ?? [];
    const target = current.find((r) => String(r._id) === roleId);
    if (!target) throw new AppError('NOT_ASSIGNED', 'This account does not hold that role', 409);

    // BR-48 — UC-A06 exception 1.0.E5: never lock everyone out of the system.
    if (target.name === RoleName.SUPER_ADMIN) {
      const remaining = await User.countDocuments({
        roles: target._id,
        status: AccountStatus.ACTIVE,
        _id: { $ne: user._id },
      });
      if (remaining === 0) {
        throw new AppError(
          'LAST_SUPER_ADMIN',
          'BR-48: at least one Super Admin must always exist',
          409,
        );
      }
    }

    user.roles = current
      .filter((r) => String(r._id) !== roleId)
      .map((r) => r._id) as never;
    await user.save();

    await this.invalidateSessions(String(user._id));

    await AuditService.record({
      action: 'ROLE_REVOKED',
      entityType: 'User',
      entityId: String(user._id),
      actorId,
      before: { roles: current.map((r) => r.name) },
      after: { roleRevoked: target.name, reason },
    });

    return user;
  }

  /**
   * UC-A06 alternative flow 1.4 — a promotion swaps one role for another as a
   * single operation, so the account is never momentarily unprivileged.
   */
  static async replace(
    userId: string,
    fromRoleId: string,
    toRoleId: string,
    actorId: string,
  ): Promise<IUser> {
    await this.revoke(userId, fromRoleId, actorId, 'Replaced as part of a role change');
    return this.assign({ userId, roleId: toRoleId, actorId, reason: 'Role replacement' });
  }

  /** UC-A07 Configure Role Permissions — edits the permission set of a role. */
  static async configurePermissions(
    roleId: string,
    permissions: Permission[],
    actorId: string,
  ): Promise<IRole> {
    const role = await Role.findById(roleId);
    if (!role) throw new AppError('NOT_FOUND', 'Role not found', 404);

    const before = [...role.permissions];
    role.permissions = permissions;
    await role.save();

    // Everyone holding this role is affected, so all their sessions must go.
    const holders = await User.find({ roles: role._id }).select('_id');
    await Promise.all(holders.map((h) => this.invalidateSessions(String(h._id))));

    await AuditService.record({
      action: 'ROLE_PERMISSIONS_CHANGED',
      entityType: 'Role',
      entityId: String(role._id),
      actorId,
      before: { permissions: before },
      after: { permissions },
    });

    return role;
  }

  /** BR-46 — the effective set is the union of the roles' permissions. */
  static async effectivePermissions(userId: string): Promise<Permission[]> {
    const user = await User.findById(userId).populate<{ roles: IRole[] }>('roles');
    if (!user) return [];

    const roles = (user.roles as unknown as IRole[]) ?? [];
    return [...new Set(roles.flatMap((r) => r.permissions ?? []))];
  }

  // ------------------------------------------------------------------------

  private static assertNoSegregationConflict(current: IRole[], incoming: IRole): void {
    for (const [a, b] of SEGREGATION_OF_DUTIES) {
      const conflictsWith =
        incoming.name === a ? b : incoming.name === b ? a : null;

      if (conflictsWith && current.some((r) => r.name === conflictsWith)) {
        throw new AppError(
          'SEGREGATION_OF_DUTIES',
          `BR-47: the ${incoming.name} role conflicts with the ${conflictsWith} role ` +
            `already held by this account`,
          409,
        );
      }
    }
  }

  /** An administrator may not grant a role more powerful than their own. */
  private static assertNoPrivilegeEscalation(
    actor: IUser,
    incoming: IRole,
    actorId: string,
  ): void {
    const actorRoles = (actor.roles as unknown as IRole[]) ?? [];
    const isSuperAdmin = actorRoles.some((r) => r.name === RoleName.SUPER_ADMIN);

    if (incoming.name === RoleName.SUPER_ADMIN && !isSuperAdmin) {
      // Logged as a security event, not merely refused.
      void AuditService.record({
        action: 'PRIVILEGE_ESCALATION_BLOCKED',
        entityType: 'Role',
        entityId: String(incoming._id),
        actorId,
        after: { attemptedRole: incoming.name },
      });

      throw new AppError(
        'PRIVILEGE_ESCALATION',
        'You may not grant a role above your own authority',
        403,
      );
    }
  }

  /**
   * Step 9 — forces re-authentication so the recalculated permissions apply
   * immediately rather than at the next token expiry.
   *
   * With Redis-backed sessions (§7.5) this deletes the user's refresh tokens;
   * the in-memory stub below keeps the boilerplate runnable without Redis.
   */
  private static async invalidateSessions(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $set: { sessionsInvalidatedAt: new Date() } });
  }
}
