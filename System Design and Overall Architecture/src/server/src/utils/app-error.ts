/**
 * Cross-cutting utility — AppError
 *
 * A single error type carrying a machine-readable `code`, a human-readable
 * message and the HTTP status the boundary layer should return. Because the
 * «control» and «application logic» layers throw AppError rather than writing
 * HTTP responses, they stay free of any transport concern (§7.4.4 dependency
 * rules) and remain unit-testable without Express.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace?.(this, AppError);
  }

  /** True for errors we deliberately raised, as opposed to unexpected crashes. */
  static isAppError(err: unknown): err is AppError {
    return err instanceof AppError;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Thrown by the RBAC middleware when a role lacks the required permission. */
export class ForbiddenError extends AppError {
  constructor(permission: string) {
    super('FORBIDDEN', `Missing required permission: ${permission}`, 403);
  }
}

/** Thrown when no valid access token accompanies a protected request. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}
