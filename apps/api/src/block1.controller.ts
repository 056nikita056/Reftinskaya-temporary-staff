import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { accessForRole, USER_ROLES, type AccessAction, type AdminUserRow, type NotificationItem, type RequestFactAnalyticsData, type RequestFactAnalyticsQuery, type RequestFactAnalyticsRow, type RoleAccess, type UserRole } from "@reftinskaya/contracts";
import type { Prisma } from "@prisma/client";

import type { AccessTokenPayload } from "./auth/auth.types";
import { CurrentUser } from "./auth/decorators/current-user.decorator";
import { PrismaService } from "./prisma/prisma.service";

const userRoleSet = new Set<string>(USER_ROLES);
const notifications = new Map<string, NotificationItem>();

@ApiTags("block1")
@ApiBearerAuth()
@Controller()
export class Block1Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Get("admin/users")
  async adminUsers(@CurrentUser() user: AccessTokenPayload, @Query("search") search?: string, @Query("take") rawTake?: string, @Query("skip") rawSkip?: string): Promise<AdminUserRow[]> {
    await this.requireAction(user.sub, "admin.users.manage");
    const take = clampNumber(rawTake, 1, 200, 100);
    const skip = clampNumber(rawSkip, 0, 10_000, 0);
    const where = search?.trim()
      ? {
          OR: [
            { login: { contains: search.trim(), mode: "insensitive" } },
            { profile: { fullName: { contains: search.trim(), mode: "insensitive" } } },
            { profile: { email: { contains: search.trim(), mode: "insensitive" } } }
          ]
        } satisfies Prisma.UserWhereInput
      : undefined;
    const users = await this.prisma.user.findMany({
      where,
      include: {
        profile: true,
        usersRoles: { include: { role: true } },
        usersFactories: { include: { factory: true } },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: [{ login: "asc" }],
      skip,
      take
    });

    return users.map((item) => {
      const roles = rolesForUser(item.usersRoles);
      const membership = item.usersFactories.find((factory) => factory.isPrimary && factory.active && factory.factory.active)
        ?? item.usersFactories.find((factory) => factory.active && factory.factory.active)
        ?? item.usersFactories[0];
      return {
        id: item.id,
        fullName: item.profile?.fullName ?? item.login,
        login: item.login,
        email: item.profile?.email ?? null,
        role: roles[0] ?? "tempEmployee",
        factoryId: membership?.factoryId ?? "",
        factoryName: membership?.factory.name ?? "",
        status: item.active ? "active" : "inactive",
        lastActivityAt: item.auditLogs[0]?.createdAt ?? null
      };
    });
  }

  @Get("analytics/request-fact")
  async requestFactAnalytics(@CurrentUser() user: AccessTokenPayload, @Query() query: RequestFactAnalyticsQuery): Promise<RequestFactAnalyticsData> {
    await this.requireAction(user.sub, "dashboard.requestFactAnalytics.view");
    const date = query.date || todayIso();
    const parsedDate = parseIsoDate(date);
    const operations = await this.prisma.planOperation.findMany({
      where: {
        plan: {
          factoryId: user.factoryId,
          startDate: { lte: parsedDate },
          endDate: { gte: parsedDate }
        },
        ...(query.sectionId ? { territoryId: query.sectionId } : {})
      },
      include: {
        territory: {
          include: { parent: true }
        }
      }
    });

    const sectionRows = new Map<string, RequestFactAnalyticsRow>();
    for (const operation of operations) {
      const section = operation.territory;
      const workshopName = section.parent?.name ?? section.name;
      if (query.workshopId && workshopName !== query.workshopId) continue;
      const existing = sectionRows.get(section.id) ?? emptyAnalyticsRow(section.id, section.name, workshopName, section.parent?.name ?? null, "section");
      existing.demandMonth += operation.requiredCount;
      existing.demandWeek += operation.requiredCount;
      existing.demandDay += operation.requiredCount;
      existing.deviationDay = existing.factTotal - existing.demandDay;
      existing.completionPercentDay = percent(existing.factTotal, existing.demandDay);
      existing.completionPercentWeek = percent(existing.factTotal, existing.demandWeek);
      existing.completionPercentMonth = percent(existing.factTotal, existing.demandMonth);
      sectionRows.set(section.id, existing);
    }

    const workshopRows = new Map<string, RequestFactAnalyticsRow>();
    for (const row of sectionRows.values()) {
      const id = `workshop:${row.workshopName}`;
      const existing = workshopRows.get(id) ?? emptyAnalyticsRow(id, row.workshopName, row.workshopName, null, "workshop");
      addAnalytics(existing, row);
      workshopRows.set(id, existing);
    }

    const total = emptyAnalyticsRow("total", "ИТОГО", "ИТОГО", null, "total");
    for (const row of sectionRows.values()) addAnalytics(total, row);
    const rows = [...workshopRows.values(), ...sectionRows.values()];
    if (rows.length) rows.push(total);

    return {
      factoryId: user.factoryId,
      filter: { ...query, date },
      summary: {
        demandMonth: total.demandMonth,
        demandWeek: total.demandWeek,
        demandDay: total.demandDay,
        factTotal: total.factTotal,
        factDay: total.factTotal,
        deviationDay: total.deviationDay,
        completionPercentDay: total.completionPercentDay,
        completionPercentWeek: total.completionPercentWeek,
        completionPercentMonth: total.completionPercentMonth,
        underfilledSectionsCount: [...sectionRows.values()].filter((row) => row.deviationDay < 0).length
      },
      rows,
      gaps: []
    };
  }

  @Get("notifications")
  async notificationList(@CurrentUser() user: AccessTokenPayload): Promise<NotificationItem[]> {
    await this.requireAction(user.sub, "notifications.view");
    return [...notifications.values()]
      .filter((item) => item.factoryId === user.factoryId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  @Patch("notifications/:id/read")
  async markNotificationRead(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string): Promise<NotificationItem> {
    await this.requireAction(user.sub, "notifications.view");
    const item = notifications.get(id);
    if (!item || item.factoryId !== user.factoryId) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Уведомление не найдено"
      });
    }
    const updated: NotificationItem = { ...item, isRead: true, readAt: new Date().toISOString() };
    notifications.set(id, updated);
    return updated;
  }

  @Get("notifications/vapid-public-key")
  async vapidPublicKey(@CurrentUser() user: AccessTokenPayload): Promise<{ publicKey: string }> {
    await this.requireAction(user.sub, "notifications.view");
    return { publicKey: this.config.get<string>("VAPID_PUBLIC_KEY") ?? "" };
  }

  @Post("notifications/subscribe")
  async subscribe(@CurrentUser() user: AccessTokenPayload): Promise<{ ok: true }> {
    await this.requireAction(user.sub, "notifications.view");
    return { ok: true };
  }

  private async requireAction(userId: string, action: AccessAction): Promise<void> {
    const roles = await this.currentRoles(userId);
    const access = accessForRoles(roles);
    if (!access.actions.includes(action)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Недостаточно прав",
        missingActions: [action]
      });
    }
  }

  private async currentRoles(userId: string): Promise<UserRole[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { usersRoles: { include: { role: true } } }
    });
    if (!user?.active) {
      throw new ForbiddenException({
        code: "USER_NOT_ACTIVE",
        message: "Пользователь недоступен"
      });
    }
    const roles = rolesForUser(user.usersRoles);
    if (!roles.length) {
      throw new ForbiddenException({
        code: "NO_FACTORY_ROLE",
        message: "Нет назначенных ролей"
      });
    }
    return roles;
  }
}

function rolesForUser(userRoles: Array<{ role: { code: string; active: boolean } }>): UserRole[] {
  const available = new Set(userRoles.filter((item) => item.role.active && userRoleSet.has(item.role.code)).map((item) => item.role.code));
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

function clampNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "INVALID_DATE",
      message: "Некорректная дата"
    });
  }
  return date;
}

function percent(value: number, total: number): number | null {
  return total > 0 ? value / total : null;
}

function emptyAnalyticsRow(sectionId: string, sectionName: string, workshopName: string, parentName: string | null, rowType: RequestFactAnalyticsRow["rowType"]): RequestFactAnalyticsRow {
  return {
    sectionId,
    sectionName,
    workshopName,
    parentName,
    rowType,
    demandMonth: 0,
    demandWeek: 0,
    demandDay: 0,
    factTotal: 0,
    deviationDay: 0,
    completionPercentDay: null,
    completionPercentWeek: null,
    completionPercentMonth: null,
    deviationReason: null
  };
}

function addAnalytics(target: RequestFactAnalyticsRow, source: RequestFactAnalyticsRow): void {
  target.demandMonth += source.demandMonth;
  target.demandWeek += source.demandWeek;
  target.demandDay += source.demandDay;
  target.factTotal += source.factTotal;
  target.deviationDay = target.factTotal - target.demandDay;
  target.completionPercentDay = percent(target.factTotal, target.demandDay);
  target.completionPercentWeek = percent(target.factTotal, target.demandWeek);
  target.completionPercentMonth = percent(target.factTotal, target.demandMonth);
}
