import type { RoleAccess, UserRole } from "@reftinskaya/contracts";
import type { Request } from "express";

export type AccessTokenPayload = {
  sub: string;
  factoryId: string;
  role: UserRole;
  login: string;
  fullName: string;
};

export type RefreshTokenPayload = AccessTokenPayload & {
  jti: string;
  familyId: string;
  type: "refresh";
};

export type AuthenticatedRequest = Request & {
  user: AccessTokenPayload;
};

export type ApiLoginResponse = {
  ok: true;
  role: UserRole;
  roles: UserRole[];
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    factoryId: string;
    login: string;
    role: UserRole;
    fullName: string;
    factory: {
      id: string;
      name: string;
      timezone: string;
      theme?: unknown;
      active: boolean;
    };
    access: RoleAccess;
  };
  factory: {
    id: string;
    name: string;
    timezone: string;
    theme?: unknown;
    active: boolean;
  };
  permissions: RoleAccess;
  mustChangePassword?: true;
};

export type OkResponse = {
  ok: true;
};
