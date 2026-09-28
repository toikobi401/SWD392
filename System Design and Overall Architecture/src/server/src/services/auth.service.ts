/**
 * «control» AuthService
 *
 * Coordinates registration, authentication and session lifecycle.
 *
 * Enforces: BR-01 password strength, BR-02 lock after 5 failures, BR-03 token
 *           lifetimes, BR-04 one account per email, BR-05 24 h verification
 *           link, BR-06 terms accepted, BR-45/46 permissions come from roles.
 * Realizes: UC-G16 Register Account, UC-G17 Login, UC-C02 Authenticate Session,
 *           UC-C03 Reset Forgotten Password, UC-C04 Logout, UC-C05 Change Password.
 */
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Customer, Role, IUser, IRole } from '../models/user.model';
import { LoyaltyAccount } from '../models/booking.model';
import { AccountStatus, RoleName, Permission } from '../models/enums';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/** BR-02 — UC-G17 exception 1.0.E4. */
export const MAX_FAILED_ATTEMPTS = 5;
/** BR-03 — short-lived access token, longer refresh token. */
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';
/** BR-05. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;

export interface RegisterCommand {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  acceptedTerms: boolean;
}

export interface LoginCommand {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string; email: string; permissions: Permission[] };
}

export interface JwtClaims {
  sub: string;
  email: string;
  roles: string[];
  permissions: Permission[];
}

export class AuthService {
  /** UC-G16 Normal Flow 1.0. */
  static async register(command: RegisterCommand): Promise<IUser> {
    // BR-06 — the terms must be accepted explicitly.
    if (!command.acceptedTerms) {
      throw new AppError('TERMS_NOT_ACCEPTED', 'You must accept the terms of service', 400);
    }

    // UC-G16 exception 1.0.E3.
    if (command.password !== command.confirmPassword) {
      throw new AppError('PASSWORD_MISMATCH', 'Passwords do not match', 400);
    }

    // UC-G16 exception 1.0.E2.
    this.assertPasswordStrength(command.password);

    // BR-04 — UC-G16 exception 1.0.E1.
    const email = command.email.toLowerCase().trim();
    if (await User.findOne({ email })) {
      throw new AppError('EMAIL_IN_USE', 'This email is already in use', 409);
    }

    const customerRole = await Role.findOne({ name: RoleName.CUSTOMER });

    const user = await Customer.create({
      fullName: command.fullName,
      email,
      phone: command.phone,
      passwordHash: await bcrypt.hash(command.password, 12),
      status: AccountStatus.PENDING_VERIFICATION,
      roles: customerRole ? [customerRole._id] : [],
    });

    // UC-G16 step 8 — a loyalty account opens with a zero balance.
    await LoyaltyAccount.create({ customerId: user._id, pointBalance: 0 });

    // Step 9 — verification link, valid 24 h.
    const token = this.signVerificationToken(String(user._id));
    await NotificationProxy.sendVerificationLink(email, token).catch((err) =>
      console.error('[UC-G16] verification email failed, queued for retry', err),
    );

    await AuditService.record({
      action: 'ACCOUNT_REGISTERED',
      entityType: 'User',
      entityId: String(user._id),
      after: { email },
    });

    return user;
  }

  /** UC-G16 step 11 — activate the account from the emailed link. */
  static async verifyEmail(token: string): Promise<void> {
    let payload: { sub: string };
    try {
      payload = jwt.verify(token, this.secret()) as { sub: string };
    } catch {
      // UC-G16 exception 1.0.E4.
      throw new AppError('LINK_EXPIRED', 'This verification link has expired', 400);
    }

    await User.findByIdAndUpdate(payload.sub, {
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });
  }

  /**
   * UC-G17 Normal Flow 1.0 («include» UC-C02 Authenticate Session).
   *
   * Every credential failure returns the same generic message so an attacker
   * cannot tell a non-existent account from a wrong password — UC-G17
   * exceptions 1.0.E2 and 1.0.E3 deliberately share their wording.
   */
  static async login(command: LoginCommand): Promise<AuthTokens> {
    const email = command.email.toLowerCase().trim();

    // UC-G17 exception 1.0.E1.
    if (!email || !command.password) {
      throw new AppError('MISSING_CREDENTIALS', 'Username and password must not be empty', 400);
    }

    const user = await User.findOne({ email })
      .select('+passwordHash')
      .populate<{ roles: IRole[] }>('roles');

    if (!user) {
      await AuditService.record({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        after: { email, reason: 'NOT_FOUND' },
        ipAddress: command.ipAddress,
      });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }

    // UC-G17 exceptions 1.0.E4 / 1.0.E5 — checked before the password so a
    // locked account cannot be probed.
    if (user.status === AccountStatus.LOCKED) {
      throw new AppError('ACCOUNT_LOCKED', 'Account locked. Contact the administrator.', 403);
    }
    if (user.status === AccountStatus.DEACTIVATED) {
      throw new AppError('ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
    }

    if (!(await user.verifyPassword(command.password))) {
      user.failedLoginAttempts += 1;

      // BR-02 — lock on the fifth consecutive failure.
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.status = AccountStatus.LOCKED;
        await NotificationProxy.sendDecisionNotice(
          user.email,
          'Your account has been locked',
          'Your account was locked after 5 failed sign-in attempts.',
        ).catch(() => undefined);
      }
      await user.save();

      await AuditService.record({
        action: user.status === AccountStatus.LOCKED ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        entityType: 'User',
        entityId: String(user._id),
        actorId: String(user._id),
        ipAddress: command.ipAddress,
      });

      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }

    // PRE-2 / exception 1.0.E6 — the account must be verified (UC-G16 step 11).
    // Checked only after the password is proven, so an unverified status is
    // never revealed to someone who does not hold the credentials.
    if (user.status === AccountStatus.PENDING_VERIFICATION) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address before signing in',
        403,
      );
    }

    // Step 9 — a successful login clears the counter.
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await user.save();

    await AuditService.record({
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: String(user._id),
      actorId: String(user._id),
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
    });

    return this.issueTokens(user);
  }

  /** UC-C02 — exchange a refresh token for a new access token (BR-03). */
  static async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = jwt.verify(refreshToken, this.refreshSecret()) as { sub: string };
    } catch {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Session expired, please sign in again', 401);
    }

    const user = await User.findById(payload.sub).populate('roles');
    if (!user || !user.isActive()) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Session is no longer valid', 401);
    }

    return this.issueTokens(user);
  }

  /** UC-C03 step 2 — issue a one-time code. */
  static async requestPasswordReset(email: string, channel: 'EMAIL' | 'SMS'): Promise<void> {
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return normally: revealing which addresses exist would enable
    // account enumeration, the same reason login uses a generic message.
    if (!user) return;

    const otp = String(Math.floor(100_000 + Math.random() * 900_000));
    const hash = await bcrypt.hash(otp, 10);

    (user as unknown as Record<string, unknown>).resetOtpHash = hash;
    (user as unknown as Record<string, unknown>).resetOtpExpiresAt = new Date(
      Date.now() + OTP_TTL_MS,
    );
    await user.save();

    await NotificationProxy.sendOtp(
      channel === 'SMS' ? user.phone ?? user.email : user.email,
      otp,
      channel,
    );
  }

  /** UC-C03 steps 3–4 — verify the OTP and set the new password. */
  static async resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
    this.assertPasswordStrength(newPassword);

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      '+passwordHash',
    );
    const record = user as unknown as Record<string, unknown> | null;

    if (
      !user ||
      !record?.resetOtpHash ||
      !(record.resetOtpExpiresAt instanceof Date) ||
      record.resetOtpExpiresAt < new Date() ||
      !(await bcrypt.compare(otp, String(record.resetOtpHash)))
    ) {
      throw new AppError('INVALID_OTP', 'The code is invalid or has expired', 400);
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.failedLoginAttempts = 0;
    // A successful reset also unlocks an account locked by failed attempts.
    if (user.status === AccountStatus.LOCKED) user.status = AccountStatus.ACTIVE;
    record.resetOtpHash = undefined;
    record.resetOtpExpiresAt = undefined;
    await user.save();

    await AuditService.record({
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: String(user._id),
      actorId: String(user._id),
    });
  }

  /** UC-C05 Change Password — requires the current password. */
  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    this.assertPasswordStrength(newPassword);

    const user = await User.findById(userId).select('+passwordHash');
    if (!user || !(await user.verifyPassword(currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'The current password is incorrect', 401);
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    await AuditService.record({
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: userId,
      actorId: userId,
    });
  }

  // ------------------------------------------------------------------------

  /**
   * BR-45/46 — permissions are never stored on the account; the effective set
   * is the union of the permissions of the roles the account holds.
   */
  private static issueTokens(user: IUser): AuthTokens {
    const roles = (user.roles as unknown as { name: string; permissions: Permission[] }[]) ?? [];
    const permissions = [...new Set(roles.flatMap((r) => r.permissions ?? []))];

    const claims: JwtClaims = {
      sub: String(user._id),
      email: user.email,
      roles: roles.map((r) => r.name),
      permissions,
    };

    return {
      accessToken: jwt.sign(claims, this.secret(), { expiresIn: ACCESS_TOKEN_TTL }),
      refreshToken: jwt.sign({ sub: claims.sub, jti: randomUUID() }, this.refreshSecret(), {
        expiresIn: REFRESH_TOKEN_TTL,
      }),
      user: {
        id: claims.sub,
        fullName: user.fullName,
        email: user.email,
        permissions,
      },
    };
  }

  /** BR-01 — minimum 8 characters with upper, lower and a digit. */
  private static assertPasswordStrength(password: string): void {
    const problems: string[] = [];
    if (password.length < 8) problems.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
    if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
    if (!/[0-9]/.test(password)) problems.push('a digit');

    if (problems.length) {
      throw new AppError(
        'WEAK_PASSWORD',
        `BR-01: the password must contain ${problems.join(', ')}`,
        400,
      );
    }
  }

  private static signVerificationToken(userId: string): string {
    return jwt.sign({ sub: userId, nonce: randomBytes(8).toString('hex') }, this.secret(), {
      expiresIn: VERIFICATION_TTL_MS / 1000,
    });
  }

  private static secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s) throw new AppError('CONFIG_ERROR', 'JWT_SECRET is not configured', 500);
    return s;
  }

  private static refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? this.secret();
  }
}
