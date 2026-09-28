/**
 * «boundary» / I/O AuthController
 *
 * Translates HTTP into service commands and back. Per §7.4.4 a controller holds
 * no business logic and never touches a model directly — every decision belongs
 * to AuthService.
 *
 * Realizes: UC-G16 Register, UC-G17 Login, UC-C02 Authenticate Session,
 *           UC-C03 Reset Password, UC-C04 Logout, UC-C05 Change Password.
 */
import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { AuditService } from '../services/audit.service';
import { ProfileQueries } from '../services/query.service';

export class AuthController {
  /** POST /api/auth/register — UC-G16 */
  static async register(req: Request, res: Response): Promise<void> {
    const user = await AuthService.register({
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password,
      confirmPassword: req.body.confirmPassword,
      acceptedTerms: Boolean(req.body.acceptedTerms),
    });

    res.status(201).json({
      message: 'Please check your email to verify your account',
      user: { id: user._id, email: user.email, fullName: user.fullName },
    });
  }

  /** GET /api/auth/verify?token= — UC-G16 step 11 */
  static async verifyEmail(req: Request, res: Response): Promise<void> {
    await AuthService.verifyEmail(String(req.query.token));
    res.json({ message: 'Your account is now active. You may sign in.' });
  }

  /** POST /api/auth/login — UC-G17 */
  static async login(req: Request, res: Response): Promise<void> {
    const tokens = await AuthService.login({
      email: req.body.email,
      password: req.body.password,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json(tokens);
  }

  /** POST /api/auth/refresh — UC-C02 */
  static async refresh(req: Request, res: Response): Promise<void> {
    res.json(await AuthService.refresh(req.body.refreshToken));
  }

  /** POST /api/auth/logout — UC-C04 */
  static async logout(req: Request, res: Response): Promise<void> {
    await AuditService.record({
      action: 'LOGOUT',
      entityType: 'User',
      entityId: req.auth!.sub,
      actorId: req.auth!.sub,
      ipAddress: req.ip,
    });

    res.json({ message: 'Signed out' });
  }

  /** POST /api/auth/forgot-password — UC-C03 step 2 */
  static async forgotPassword(req: Request, res: Response): Promise<void> {
    await AuthService.requestPasswordReset(req.body.email, req.body.channel ?? 'EMAIL');

    // Always the same response, whether or not the address exists — otherwise
    // this endpoint becomes an account-enumeration oracle.
    res.json({ message: 'If that account exists, a verification code has been sent' });
  }

  /** POST /api/auth/reset-password — UC-C03 steps 3–4 */
  static async resetPassword(req: Request, res: Response): Promise<void> {
    await AuthService.resetPassword(req.body.email, req.body.otp, req.body.newPassword);
    res.json({ message: 'Your password has been reset' });
  }

  /** POST /api/auth/change-password — UC-C05 */
  static async changePassword(req: Request, res: Response): Promise<void> {
    await AuthService.changePassword(
      req.auth!.sub,
      req.body.currentPassword,
      req.body.newPassword,
    );
    res.json({ message: 'Your password has been changed' });
  }

  /** GET /api/auth/me — the caller's own claims, for the client to render by. */
  static async me(req: Request, res: Response): Promise<void> {
    res.json(await ProfileQueries.me(req.auth!.sub));
  }
}
