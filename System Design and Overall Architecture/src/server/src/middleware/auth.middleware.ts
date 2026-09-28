/**
 * «boundary» Authentication & RBAC middleware
 *
 * Enforces BR-45: a request reaches a controller only if the caller's token
 * carries the required permission. Because the check lives here rather than in
 * each controller, adding an endpoint cannot accidentally omit it.
 *
 * Realizes: UC-C02 Authenticate Session (verification half), and the
 *           authorization precondition of every protected use case.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Permission } from '../models/enums';
import { JwtClaims } from '../services/auth.service';
import { UnauthorizedError, ForbiddenError, AppError } from '../utils/app-error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtClaims;
    }
  }
}

/** Verifies the bearer token and attaches its claims to the request. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError());
  }

  try {
    req.auth = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as JwtClaims;
    next();
  } catch (err) {
    // Distinguish an expired token so the client knows to refresh rather than
    // sending the user back to the login screen.
    const expired = (err as Error).name === 'TokenExpiredError';
    next(
      new AppError(
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'Access token expired' : 'Invalid access token',
        401,
      ),
    );
  }
}

/**
 * Requires every listed permission. Use the narrowest permission that fits the
 * endpoint — `requirePermission(Permission.CHECK_IN)`, not a role name, so a
 * permission can be moved between roles without touching any route.
 */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());

    const held = new Set(req.auth.permissions ?? []);
    const missing = required.find((p) => !held.has(p));

    if (missing) return next(new ForbiddenError(missing));
    next();
  };
}

/**
 * Allows the request when the caller owns the resource, letting a Customer read
 * their own booking without holding a staff permission (UC-C11, UC-C12).
 */
export function requireSelfOr(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());

    const targetUserId = req.params.userId ?? req.params.id;
    if (targetUserId && targetUserId === req.auth.sub) return next();

    const held = new Set(req.auth.permissions ?? []);
    const missing = required.find((p) => !held.has(p));

    if (missing) return next(new ForbiddenError(missing));
    next();
  };
}

/** Attaches claims when a token is present, but never rejects — for UC-G01/G07,
 *  which serve both an anonymous Guest and a signed-in Customer. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  try {
    req.auth = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as JwtClaims;
  } catch {
    // An invalid token on a public endpoint is simply ignored.
  }
  next();
}
