/**
 * «boundary» Error handling & request validation middleware
 *
 * The single place where a thrown error becomes an HTTP response. Keeping this
 * translation here is what lets services and rules throw AppError and stay free
 * of transport concerns (§7.4.4).
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '../utils/app-error';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** 404 for any route that matched nothing. */
export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

/**
 * Converts an error into the response body.
 *
 * An AppError is deliberate and its message is safe to show. Anything else is a
 * bug, so the detail is logged server-side and the client gets a generic
 * message — an internal stack trace must never reach a guest's browser.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (AppError.isAppError(err)) {
    res.status(err.statusCode).json({ error: err.toJSON() });
    return;
  }

  // Mongoose duplicate key — surfaces as a conflict, not a 500.
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({
      error: { code: 'DUPLICATE_KEY', message: 'That value is already in use' },
    });
    return;
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }

  console.error('[UNHANDLED]', req.method, req.path, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

/**
 * Minimal declarative body validation. A real deployment would use zod or
 * express-validator; the shape of the check is what matters for the design.
 */
export interface FieldRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'date';
  min?: number;
  max?: number;
}

export function validateBody(rules: FieldRule[]): RequestHandler {
  return (req, _res, next) => {
    const problems: string[] = [];

    for (const rule of rules) {
      const value = req.body?.[rule.field];

      if (value === undefined || value === null || value === '') {
        if (rule.required) problems.push(`${rule.field} is required`);
        continue;
      }

      if (rule.type === 'number' && Number.isNaN(Number(value))) {
        problems.push(`${rule.field} must be a number`);
      }
      if (rule.type === 'date' && Number.isNaN(Date.parse(value))) {
        problems.push(`${rule.field} must be a valid date`);
      }
      if (rule.type === 'string' && typeof value !== 'string') {
        problems.push(`${rule.field} must be a string`);
      }
      if (rule.min !== undefined && Number(value) < rule.min) {
        problems.push(`${rule.field} must be at least ${rule.min}`);
      }
      if (rule.max !== undefined && Number(value) > rule.max) {
        problems.push(`${rule.field} must be at most ${rule.max}`);
      }
    }

    if (problems.length) {
      return next(new AppError('VALIDATION_ERROR', problems.join('; '), 400, problems));
    }
    next();
  };
}
