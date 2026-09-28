/**
 * «application logic» / «service» AuditService
 *
 * A cross-cutting service every subsystem writes to (§7.4.3): the audit trail is
 * a shared concern, not a dependency between business subsystems.
 *
 * Enforces: BR-49 the audit log is append-only and immutable. A write here must
 *           never fail the business transaction that triggered it — an audit
 *           outage is an operational problem, not a reason to refuse a booking.
 * Realizes: UC-A13 View System Audit Log, UC-A14 View Login History,
 *           UC-A15 Export Audit Log, and the audit obligation of every UC.
 */
import { AuditLog, IAuditLog } from '../models/hr.model';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  actorId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export class AuditService {
  /**
   * Appends one entry. Deliberately swallows its own errors: losing an audit
   * row is bad, but failing a guest's check-in because the audit write timed
   * out is worse. The failure is logged for the operator instead.
   */
  static async record(entry: AuditEntry): Promise<void> {
    try {
      await AuditLog.create({
        ...entry,
        // Never let a caller accidentally persist a secret.
        after: this.redact(entry.after),
        before: this.redact(entry.before),
        timestamp: new Date(),
      });
    } catch (err) {
      console.error('[AUDIT] failed to append entry', entry.action, err);
    }
  }

  /** UC-A13 — paged, filtered read of the trail. */
  static async query(filter: AuditQuery): Promise<{ rows: IAuditLog[]; total: number }> {
    const { page = 1, pageSize = 50 } = filter;
    const query: Record<string, unknown> = {};

    if (filter.actorId) query.actorId = filter.actorId;
    if (filter.action) query.action = filter.action;
    if (filter.entityType) query.entityType = filter.entityType;
    if (filter.from || filter.to) {
      query.timestamp = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lte: filter.to } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      AuditLog.countDocuments(query),
    ]);

    return { rows, total };
  }

  /** UC-A14 View Login History — the authentication slice of the trail. */
  static async loginHistory(userId: string, limit = 50): Promise<IAuditLog[]> {
    return AuditLog.find({
      actorId: userId,
      action: { $in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ACCOUNT_LOCKED'] },
    })
      .sort({ timestamp: -1 })
      .limit(limit);
  }

  /** UC-A15 Export Audit Log — CSV for the compliance officer. */
  static async exportCsv(filter: AuditQuery): Promise<string> {
    const { rows } = await this.query({ ...filter, pageSize: 10_000 });
    const header = 'timestamp,actorId,action,entityType,entityId,ipAddress';

    const lines = rows.map((r) =>
      [
        r.timestamp.toISOString(),
        r.actorId ?? '',
        r.action,
        r.entityType,
        r.entityId ?? '',
        r.ipAddress ?? '',
      ]
        // Quote every field so a comma in the data cannot shift the columns.
        .map((f) => `"${String(f).replace(/"/g, '""')}"`)
        .join(','),
    );

    return [header, ...lines].join('\n');
  }

  // ------------------------------------------------------------------------

  private static readonly SECRET_KEYS = [
    'password',
    'passwordHash',
    'token',
    'refreshToken',
    'otp',
    'cardNumber',
    'cvv',
  ];

  /** Strips credentials so the trail can be read by auditors safely. */
  private static redact(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;

    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(clone)) {
      if (this.SECRET_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        clone[key] = '«redacted»';
      }
    }
    return clone;
  }
}
