import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type UserRole = 'admin' | 'reviewer' | 'user';

export type Permission =
  | 'manage_users'
  | 'manage_backup'
  | 'configure_ai'
  | 'edit_activity_data'
  | 'use_ai_assistant'
  | 'review_inventory'
  | 'lock_boundary_and_snapshot'
  | 'export_official_reports';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    'manage_users',
    'manage_backup',
    'configure_ai',
    'edit_activity_data',
    'use_ai_assistant',
    'review_inventory',
    'lock_boundary_and_snapshot',
    'export_official_reports',
  ],
  reviewer: [
    'review_inventory',
    'lock_boundary_and_snapshot',
    'export_official_reports',
    'use_ai_assistant',
  ],
  user: ['edit_activity_data', 'use_ai_assistant'],
};

export interface UserAccount {
  username: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  password_salt: string;
  active: boolean;
  created_at: string;
}

export interface PublicUser {
  username: string;
  display_name: string;
  role: UserRole;
  active: boolean;
  permissions: readonly Permission[];
}

export interface SessionPayload {
  username: string;
  role: UserRole;
  exp: number;
}

export class UnauthorizedError extends Error {
  constructor(message = '未登入或憑證無效') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(role: UserRole, permission: Permission) {
    super(`權限不足：角色 "${role}" 無權執行 "${permission}"`);
    this.name = 'ForbiddenError';
  }
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

export class AuthManager {
  private readonly users = new Map<string, UserAccount>();
  private readonly sessionSecret: Buffer;

  constructor(sessionSecretHex?: string) {
    this.sessionSecret = sessionSecretHex
      ? Buffer.from(sessionSecretHex, 'hex')
      : randomBytes(32);
  }

  createUser(params: {
    username: string;
    display_name: string;
    role: UserRole;
    password: string;
  }): PublicUser {
    if (!params.username || params.username.trim().length < 2) {
      throw new Error('帳號名稱長度至少須 2 個字元');
    }
    if (!params.password || params.password.length < 6) {
      throw new Error('密碼長度至少須 6 個字元');
    }
    if (this.users.has(params.username)) {
      throw new Error(`帳號 "${params.username}" 已存在`);
    }

    const saltHex = randomBytes(16).toString('hex');
    const account: UserAccount = {
      username: params.username,
      display_name: params.display_name,
      role: params.role,
      password_salt: saltHex,
      password_hash: hashPassword(params.password, saltHex),
      active: true,
      created_at: new Date().toISOString(),
    };
    this.users.set(account.username, account);
    return this.toPublicUser(account);
  }

  authenticate(username: string, password: string): { token: string; user: PublicUser } {
    const account = this.users.get(username);
    if (!account || !account.active) {
      throw new UnauthorizedError('帳號或密碼錯誤');
    }

    const computed = Buffer.from(hashPassword(password, account.password_salt), 'hex');
    const stored = Buffer.from(account.password_hash, 'hex');
    if (computed.length !== stored.length || !timingSafeEqual(computed, stored)) {
      throw new UnauthorizedError('帳號或密碼錯誤');
    }

    const payload: SessionPayload = {
      username: account.username,
      role: account.role,
      exp: Date.now() + 8 * 60 * 60 * 1000, // 8 小時
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.sessionSecret).update(payloadB64).digest('base64url');

    return {
      token: `${payloadB64}.${sig}`,
      user: this.toPublicUser(account),
    };
  }

  verifyToken(token: string | undefined): PublicUser {
    if (!token || !token.includes('.')) {
      throw new UnauthorizedError();
    }
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) {
      throw new UnauthorizedError();
    }

    const expectedSig = createHmac('sha256', this.sessionSecret)
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedError('Token 簽章驗證失敗');
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as SessionPayload;

    if (Date.now() > payload.exp) {
      throw new UnauthorizedError('登入階段已過期，請重新登入');
    }

    const account = this.users.get(payload.username);
    if (!account || !account.active) {
      throw new UnauthorizedError('帳號已停用或不存在');
    }
    return this.toPublicUser(account);
  }

  hasPermission(role: UserRole, permission: Permission): boolean {
    return ROLE_PERMISSIONS[role].includes(permission);
  }

  assertPermission(user: PublicUser, permission: Permission): void {
    if (!this.hasPermission(user.role, permission)) {
      throw new ForbiddenError(user.role, permission);
    }
  }

  listUsers(): PublicUser[] {
    return Array.from(this.users.values()).map((u) => this.toPublicUser(u));
  }

  exportUsers(): UserAccount[] {
    return Array.from(this.users.values()).map((u) => ({ ...u }));
  }

  importUsers(accounts: UserAccount[]): void {
    this.users.clear();
    for (const acc of accounts) {
      this.users.set(acc.username, { ...acc });
    }
  }

  private toPublicUser(u: UserAccount): PublicUser {
    return {
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      active: u.active,
      permissions: ROLE_PERMISSIONS[u.role],
    };
  }
}
