import { Controller, Get, NotFoundException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { accessForRole, USER_ROLES, type CurrentUserProfile, type Factory, type RoleAccess, type UserRole } from "@reftinskaya/contracts";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AccessTokenPayload } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

const userRoleSet = new Set<string>(USER_ROLES);

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

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  async me(@CurrentUser() authUser: AccessTokenPayload): Promise<CurrentUserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.sub },
      include: {
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
      }
    });

    if (!user?.active) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "Пользователь не найден"
      });
    }

    const memberships = sortFactoryMemberships(user.usersFactories.filter((item) => item.active && item.factory.active));
    const primaryMembership =
      memberships.find((item) => item.factoryId === authUser.factoryId) ?? memberships.find((item) => item.isPrimary) ?? memberships[0];
    if (!primaryMembership) {
      throw new NotFoundException({
        code: "NO_FACTORY_ACCESS",
        message: "Нет доступа к фабрике"
      });
    }

    const roles = rolesForUser(user.usersRoles);
    const primaryRole = roles.includes(authUser.role) ? authUser.role : roles[0];
    const access = accessForRoles(roles);
    const factory = mapFactory(primaryMembership.factory);

    return {
      id: user.id,
      factoryId: primaryMembership.factoryId,
      login: user.login,
      role: primaryRole,
      roles,
      fullName: user.profile?.fullName ?? user.login,
      email: user.profile?.email ?? null,
      factoryName: factory.name,
      factory,
      factories: memberships.map((item) => mapFactory(item.factory)),
      access,
      modules: access.modules,
      actions: access.actions
    };
  }
}

function rolesForUser(userRoles: Array<{ role: { code: string; active: boolean } }>): UserRole[] {
  const roleCodes = userRoles
    .filter((item) => item.role.active && userRoleSet.has(item.role.code))
    .map((item) => item.role.code as UserRole);
  const available = new Set(roleCodes);
  return USER_ROLES.filter((role) => available.has(role));
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

function mapFactory(factory: { id: string; name: string; timezone: string; theme: unknown; active: boolean }): Factory {
  return {
    id: factory.id,
    name: factory.name,
    timezone: factory.timezone,
    theme: factory.theme ?? undefined,
    active: factory.active
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
