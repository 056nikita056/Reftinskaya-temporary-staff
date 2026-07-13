import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Prisma } from "@prisma/client";
import { accessForRole, USER_ROLES, type Factory, type RoleAccess, type UserRole } from "@reftinskaya/contracts";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import { requireConfig } from "./auth.config";
import type { AccessTokenPayload, ApiLoginResponse, OkResponse, RefreshTokenPayload } from "./auth.types";
import type { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto } from "./dto/auth.dto";
import { jwtExpiresIn } from "./jwt-ttl";

const FAILED_LOGIN_LIMIT = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const userRoleSet = new Set<string>(USER_ROLES);
const sessionUserInclude = {
  profile: true,
  usersFactories: {
    include: {
      factory: true
    }
  },
  usersRoles: {
    include: {
      role: true
    }
  }
} satisfies Prisma.UserInclude;

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

type SessionContext = {
  payload: AccessTokenPayload;
  factory: Factory;
  factories: Factory[];
  roles: UserRole[];
  mustChangePassword: boolean;
};

type FactoryMembership = {
  factoryId: string;
  active: boolean;
  isPrimary: boolean;
  factory: {
    id: string;
    name: string;
    timezone: string;
    theme: unknown;
    active: boolean;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService
  ) {}

  async login(dto: LoginDto, meta: RequestMeta): Promise<ApiLoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { login: dto.login },
      include: {
        ...sessionUserInclude
      }
    });

    if (!user?.active) {
      throw this.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: "ACCOUNT_LOCKED",
        message: "Аккаунт временно заблокирован"
      });
    }
    if (user.passwordHash) {
      const passwordMatches = dto.password ? await bcrypt.compare(dto.password, user.passwordHash) : false;
      if (!passwordMatches) {
        await this.registerFailedLogin(user.id, user.failedAttempts);
        throw this.invalidCredentials();
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null
      }
    });

    const memberships = sortFactoryMemberships(user.usersFactories.filter((item) => item.active && item.factory.active));
    const primaryMembership = memberships.find((item) => item.isPrimary) ?? memberships[0];
    if (!primaryMembership) {
      throw new ForbiddenException({
        code: "NO_FACTORY_ACCESS",
        message: "Нет доступа к фабрике"
      });
    }

    const roles = this.rolesForUser(user.usersRoles);
    if (!roles.length) {
      throw new ForbiddenException({
        code: "NO_FACTORY_ROLE",
        message: "Нет назначенных ролей"
      });
    }
    const apiFactory = this.mapFactory(primaryMembership.factory);
    const factories = memberships.map((item) => this.mapFactory(item.factory));
    const fullName = user.profile?.fullName ?? user.login;
    const primaryRole = this.resolvePrimaryRole(roles);

    const context: SessionContext = {
      payload: {
        sub: user.id,
        factoryId: primaryMembership.factoryId,
        role: primaryRole,
        roles,
        login: user.login,
        fullName
      },
      factory: apiFactory,
      factories,
      roles,
      mustChangePassword: user.mustChangePassword
    };
    const response = await this.issueLoginResponse(context);

    await this.prisma.auditLog.create({
      data: {
        action: "login",
        userId: user.id,
        factoryId: primaryMembership.factoryId,
        ip: meta.ip,
        userAgent: meta.userAgent
      }
    });

    return response;
  }

  async refresh(dto: RefreshDto): Promise<ApiLoginResponse> {
    const payload = await this.verifyRefreshPayload(dto.refreshToken);
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti }
    });
    if (!tokenRecord) {
      throw this.invalidRefreshToken();
    }
    if (tokenRecord.revokedAt) {
      await this.revokeRefreshFamily(payload.familyId);
      throw this.invalidRefreshToken();
    }
    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw this.invalidRefreshToken();
    }

    const tokenMatches = await bcrypt.compare(dto.refreshToken, tokenRecord.tokenHash);
    if (!tokenMatches) {
      throw this.invalidRefreshToken();
    }

    const context = await this.buildSessionContext(payload.sub, payload.factoryId, payload.role);
    const response = await this.issueLoginResponse(context, payload.familyId, tokenRecord.jti);
    return response;
  }

  async selectFactory(user: AccessTokenPayload, factoryId: string, meta: RequestMeta): Promise<ApiLoginResponse> {
    const context = await this.buildSessionContext(user.sub, factoryId, user.role);
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: {
        userId: user.sub,
        revokedAt: null
      },
      data: { revokedAt: now }
    });
    const response = await this.issueLoginResponse(context);
    await this.prisma.auditLog.create({
      data: {
        action: "select_factory",
        userId: user.sub,
        factoryId: context.payload.factoryId,
        ip: meta.ip,
        userAgent: meta.userAgent
      }
    });
    return response;
  }

  async logout(user: AccessTokenPayload, meta: RequestMeta): Promise<OkResponse> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: {
          userId: user.sub,
          revokedAt: null
        },
        data: { revokedAt: now }
      }),
      this.prisma.auditLog.create({
        data: {
          action: "logout",
          userId: user.sub,
          factoryId: user.factoryId,
          ip: meta.ip,
          userAgent: meta.userAgent
        }
      })
    ]);
    return { ok: true };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<OkResponse> {
    const user = await this.prisma.user.findUnique({
      where: { login: dto.login }
    });
    if (!user) {
      return { ok: true };
    }

    const token = `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
    const tokenHash = await bcrypt.hash(token, BCRYPT_ROUNDS);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS)
      }
    });

    console.log(`Password reset token for ${dto.login}: ${token}`);
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<OkResponse> {
    const now = new Date();
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: {
          gt: now
        }
      },
      include: { user: true },
      orderBy: { createdAt: "desc" }
    });
    const resetToken = await this.findMatchingResetToken(dto.token, candidates);
    if (!resetToken) {
      throw new BadRequestException({
        code: "INVALID_RESET_TOKEN",
        message: "Токен сброса пароля недействителен"
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now }
      }),
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null
        },
        data: { revokedAt: now }
      })
    ]);

    return { ok: true };
  }

  async changePassword(user: AccessTokenPayload, dto: ChangePasswordDto): Promise<OkResponse> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub }
    });
    if (!dbUser?.active) {
      throw this.invalidCredentials();
    }

    const oldPasswordMatches = dbUser.passwordHash ? await bcrypt.compare(dto.oldPassword, dbUser.passwordHash) : true;
    if (!oldPasswordMatches) {
      throw this.invalidCredentials();
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.sub },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: user.sub,
          revokedAt: null
        },
        data: { revokedAt: now }
      })
    ]);

    return { ok: true };
  }

  private async issueLoginResponse(context: SessionContext, familyId?: string, revokeJti?: string): Promise<ApiLoginResponse> {
    const tokens = await this.createTokens(context.payload, familyId);
    const tokenHash = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    const createRefreshToken = this.prisma.refreshToken.create({
      data: {
        userId: context.payload.sub,
        jti: tokens.refreshPayload.jti,
        familyId: tokens.refreshPayload.familyId,
        tokenHash,
        expiresAt: tokens.refreshExpiresAt
      }
    });

    if (revokeJti) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.update({
          where: { jti: revokeJti },
          data: { revokedAt: new Date() }
        }),
        createRefreshToken
      ]);
    } else {
      await createRefreshToken;
    }

    const permissions = accessForRoles(context.roles);
    const response: ApiLoginResponse = {
      ok: true,
      role: context.payload.role,
      roles: context.roles,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: context.payload.sub,
        factoryId: context.payload.factoryId,
        login: context.payload.login,
        role: context.payload.role,
        roles: context.roles,
        fullName: context.payload.fullName,
        factory: context.factory,
        factories: context.factories,
        access: permissions
      },
      factory: context.factory,
      factories: context.factories,
      permissions
    };

    if (context.mustChangePassword) {
      response.mustChangePassword = true;
    }

    return response;
  }

  private async createTokens(payload: AccessTokenPayload, familyId?: string) {
    const accessSecret = requireConfig(this.config, "JWT_ACCESS_SECRET");
    const refreshSecret = requireConfig(this.config, "JWT_REFRESH_SECRET");
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") ?? "15m";
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL") ?? "30d";
    const refreshPayload: RefreshTokenPayload = {
      ...payload,
      jti: randomUUID(),
      familyId: familyId ?? randomUUID(),
      type: "refresh"
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: jwtExpiresIn(accessTtl)
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: jwtExpiresIn(refreshTtl)
      })
    ]);

    return {
      accessToken,
      refreshToken,
      refreshPayload,
      refreshExpiresAt: new Date(Date.now() + parseDurationMs(refreshTtl))
    };
  }

  private async verifyRefreshPayload(refreshToken: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: requireConfig(this.config, "JWT_REFRESH_SECRET")
      });
      if (
        payload.type !== "refresh" ||
        !payload.sub ||
        !payload.factoryId ||
        !payload.role ||
        !Array.isArray(payload.roles) ||
        !payload.login ||
        !payload.fullName ||
        !payload.jti ||
        !payload.familyId ||
        !isUserRole(payload.role) ||
        !payload.roles.every(isUserRole)
      ) {
        throw this.invalidRefreshToken();
      }
      return payload;
    } catch {
      throw this.invalidRefreshToken();
    }
  }

  private async buildSessionContext(userId: string, factoryId: string, role: UserRole): Promise<SessionContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        ...sessionUserInclude
      }
    });
    if (!user?.active) {
      throw this.invalidRefreshToken();
    }

    const memberships = sortFactoryMemberships(user.usersFactories.filter((item) => item.active && item.factory.active));
    const roles = this.rolesForUser(user.usersRoles);
    if (!roles.includes(role)) {
      throw new ForbiddenException({
        code: "ROLE_NOT_AVAILABLE",
        message: "Роль больше недоступна"
      });
    }

    const selectedMembership = memberships.find((item) => item.factoryId === factoryId);
    if (!selectedMembership) {
      throw new ForbiddenException({
        code: "FACTORY_NOT_AVAILABLE",
        message: "Фабрика больше недоступна"
      });
    }

    return {
      payload: {
        sub: user.id,
        factoryId: selectedMembership.factoryId,
        role,
        roles,
        login: user.login,
        fullName: user.profile?.fullName ?? user.login
      },
      factory: this.mapFactory(selectedMembership.factory),
      factories: memberships.map((item) => this.mapFactory(item.factory)),
      roles,
      mustChangePassword: user.mustChangePassword
    };
  }

  private async registerFailedLogin(userId: string, failedAttempts: number): Promise<void> {
    const nextAttempts = failedAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts: nextAttempts,
        lockedUntil: nextAttempts >= FAILED_LOGIN_LIMIT ? new Date(Date.now() + LOCK_DURATION_MS) : null
      }
    });
  }

  private rolesForUser(userRoles: Array<{ role: { code: string; active: boolean } }>): UserRole[] {
    const roleCodes = userRoles
      .filter((item) => item.role.active && isUserRole(item.role.code))
      .map((item) => item.role.code)
      .filter(isUserRole);
    const available = new Set(roleCodes);
    return USER_ROLES.filter((role) => available.has(role));
  }

  private resolvePrimaryRole(roles: UserRole[]): UserRole {
    const selectedRole = USER_ROLES.find((candidate) => roles.includes(candidate));
    if (!selectedRole) {
      throw new ForbiddenException({
        code: "NO_FACTORY_ROLE",
        message: "Нет роли на выбранной фабрике"
      });
    }
    return selectedRole;
  }

  private async revokeRefreshFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        familyId,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });
  }

  private async findMatchingResetToken<T extends { tokenHash: string }>(token: string, candidates: T[]): Promise<T | null> {
    for (const candidate of candidates) {
      if (await bcrypt.compare(token, candidate.tokenHash)) {
        return candidate;
      }
    }
    return null;
  }

  private mapFactory(factory: { id: string; name: string; timezone: string; theme: unknown; active: boolean }): Factory {
    return {
      id: factory.id,
      name: factory.name,
      timezone: factory.timezone,
      theme: factory.theme ?? undefined,
      active: factory.active
    };
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: "INVALID_CREDENTIALS",
      message: "Неверный логин или пароль"
    });
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: "INVALID_REFRESH_TOKEN",
      message: "Refresh-токен недействителен"
    });
  }
}

function isUserRole(role: string): role is UserRole {
  return userRoleSet.has(role);
}

function accessForRoles(roles: UserRole[]): RoleAccess {
  const modules = new Set<RoleAccess["modules"][number]>();
  const actions = new Set<RoleAccess["actions"][number]>();
  for (const role of roles) {
    const access = accessForRole(role);
    access.modules.forEach((module) => modules.add(module));
    access.actions.forEach((action) => actions.add(action));
  }
  return {
    modules: [...modules],
    actions: [...actions]
  };
}

function sortFactoryMemberships<T extends FactoryMembership>(memberships: T[]): T[] {
  return [...memberships].sort((left, right) => {
    const primaryCompare = Number(right.isPrimary) - Number(left.isPrimary);
    if (primaryCompare) {
      return primaryCompare;
    }
    const nameCompare = left.factory.name.localeCompare(right.factory.name, "ru");
    if (nameCompare) {
      return nameCompare;
    }
    return left.factoryId.localeCompare(right.factoryId);
  });
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return amount * multiplier[unit];
}
