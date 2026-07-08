import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { accessForRole, USER_ROLES, type AccessAction, type BootstrapData, type Factory, type MutationDelta, type MutationResource, type RoleAccess, type UserRole } from "@reftinskaya/contracts";
import { randomUUID } from "node:crypto";

import type { AccessTokenPayload } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

type CompatRecord = Record<string, unknown> & { id: string };

type CompatStore = {
  plans: Map<string, CompatRecord>;
  sections: Map<string, CompatRecord>;
  operations: Map<string, CompatRecord>;
  employees: Map<string, CompatRecord>;
  assignments: Map<string, CompatRecord>;
  reservations: Map<string, CompatRecord>;
  housingDorms: Map<string, CompatRecord>;
  facts: Map<string, CompatRecord>;
  explanations: Map<string, CompatRecord>;
  settings: Record<string, unknown>;
};

const compatStores = new Map<string, CompatStore>();
const userRoleSet = new Set<string>(USER_ROLES);

@ApiTags("compat")
@ApiBearerAuth()
@Controller("compat")
export class CompatController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("bootstrap")
  async bootstrap(@CurrentUser() user: AccessTokenPayload): Promise<BootstrapData> {
    const roles = await this.requireCurrentRoles(user.sub);
    const role = roles.includes(user.role) ? user.role : roles[0];
    const factory = await this.prisma.factory.findUnique({
      where: { id: user.factoryId }
    });
    const apiFactory: Factory | undefined = factory
      ? {
          id: factory.id,
          name: factory.name,
          timezone: factory.timezone,
          theme: factory.theme ?? undefined,
          active: factory.active
        }
      : undefined;
    const permissions = accessForRoles(roles);
    const planData = await this.loadPlanData(user.factoryId);
    const store = storeFor(user.factoryId);

    return {
      plans: planData.plans,
      sections: planData.sections,
      operationCatalog: planData.operationCatalog,
      operations: planData.operations,
      employees: values(store.employees) as BootstrapData["employees"],
      employeeBusy: [],
      assignments: values(store.assignments) as BootstrapData["assignments"],
      reservations: values(store.reservations) as BootstrapData["reservations"],
      housingDorms: values(store.housingDorms) as BootstrapData["housingDorms"],
      housingPlaces: [],
      facts: values(store.facts) as BootstrapData["facts"],
      explanations: values(store.explanations) as BootstrapData["explanations"],
      settings: store.settings,
      currentUser: {
        id: user.sub,
        factoryId: user.factoryId,
        login: user.login,
        role,
        roles,
        fullName: user.fullName,
        factory: apiFactory,
        access: permissions
      },
      factory: apiFactory,
      permissions,
      summary: {
        totalBeds: 0,
        occupiedBeds: 0,
        freeBeds: 0,
        personnelToSettle: 0
      }
    };
  }

  @Post(":resource")
  async create(@Param("resource") rawResource: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): Promise<MutationDelta> {
    const resource = normalizeResource(rawResource);
    const store = storeFor(user.factoryId);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "POST", body, store);

    if (resource === "plans") {
      const created = await this.createPlan(user, body);
      return created;
    }

    if (resource === "sections") {
      return this.createSection(user.factoryId, body);
    }

    if (resource === "operationCatalog") {
      return this.createOperationCatalogItem(body);
    }

    if (resource === "operations") {
      return this.createPlanOperation(user.factoryId, body);
    }

    if (resource === "facts") {
      const fact = upsertFact(store, body, user.factoryId);
      return {
        ok: true,
        action: "upserted",
        resource,
        id: fact.id,
        data: fact
      };
    }

    if (resource === "settings") {
      throw new BadRequestException({
        code: "INVALID_MUTATION_RESOURCE",
        message: "Настройки обновляются методом PUT"
      });
    }
    if (resource === "explanations") {
      const side = resolveExplanationSide(store, body);
      const id = stringValue(body.id) ?? randomUUID();
      const data = { id, factory_id: user.factoryId, ...body, side };
      store.explanations.set(id, data);
      return {
        ok: true,
        action: "created",
        resource,
        id,
        data
      };
    }

    const id = stringValue(body.id) ?? randomUUID();
    const data = { id, factory_id: user.factoryId, ...body };
    collectionFor(store, resource).set(id, data);
    return {
      ok: true,
      action: "created",
      resource,
      id,
      data
    };
  }

  @Put(":resource/:id")
  async update(@Param("resource") rawResource: string, @Param("id") id: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): Promise<MutationDelta> {
    const resource = normalizeResource(rawResource);
    if (resource === "settings") {
      throw new BadRequestException({
        code: "INVALID_MUTATION_RESOURCE",
        message: "Настройки обновляются без id"
      });
    }
    const store = storeFor(user.factoryId);
    const roles = await this.requireCurrentRoles(user.sub);
    requireMutationAccess(roles, resource, "PUT", body, store);
    if (resource === "plans") return this.updatePlan(user.factoryId, id, body, roles);
    if (resource === "sections") return this.updateSection(user.factoryId, id, body);
    if (resource === "operationCatalog") return this.updateOperationCatalogItem(id, body);
    if (resource === "operations") return this.updatePlanOperation(user.factoryId, id, body, roles);
    const collection = collectionFor(store, resource);
    const existing = requireExisting(collection, id, resource);
    const data = { ...existing, ...body, id };
    collection.set(id, data);
    return {
      ok: true,
      action: "updated",
      resource,
      id,
      data
    };
  }

  @Put(":resource")
  async updateSingleton(@Param("resource") rawResource: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): Promise<MutationDelta> {
    const resource = normalizeResource(rawResource);
    if (resource !== "settings") {
      throw new BadRequestException({
        code: "MUTATION_ID_REQUIRED",
        message: "Нужно указать id ресурса"
      });
    }
    const store = storeFor(user.factoryId);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "PUT", body, store);
    store.settings = { ...store.settings, ...body };
    return {
      ok: true,
      action: "updated",
      resource,
      data: store.settings
    };
  }

  @Delete(":resource/:id")
  async remove(@Param("resource") rawResource: string, @Param("id") id: string, @CurrentUser() user: AccessTokenPayload): Promise<MutationDelta> {
    const resource = normalizeResource(rawResource);
    if (resource === "settings") {
      throw new BadRequestException({
        code: "INVALID_MUTATION_RESOURCE",
        message: "Настройки удаляются отдельно"
      });
    }
    const store = storeFor(user.factoryId);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "DELETE", {}, store);
    if (resource === "plans") return this.deletePlan(user.factoryId, id);
    if (resource === "sections") return this.deleteSection(user.factoryId, id);
    if (resource === "operationCatalog") return this.deleteOperationCatalogItem(id);
    if (resource === "operations") return this.deletePlanOperation(user.factoryId, id);
    const collection = collectionFor(store, resource);
    requireExisting(collection, id, resource);
    collection.delete(id);
    return {
      ok: true,
      action: "deleted",
      resource,
      id
    };
  }

  private async loadPlanData(factoryId: string) {
    const [plans, territories, operationCatalog] = await Promise.all([
      this.prisma.plan.findMany({
        where: { factoryId },
        include: {
          status: true,
          operations: {
            include: {
              territory: true,
              operation: true
            },
            orderBy: { id: "asc" }
          }
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }]
      }),
      this.prisma.territoryTree.findMany({
        where: { factoryId },
        orderBy: [{ name: "asc" }],
        include: {
          _count: {
            select: { planOperations: true }
          }
        }
      }),
      this.prisma.operation.findMany({
        orderBy: [{ name: "asc" }],
        include: {
          _count: {
            select: { planOperations: true }
          }
        }
      })
    ]);

    return {
      plans: plans.map((plan) => mapPlan(plan)),
      sections: territories.map((territory, index) => mapSection(territory, index)),
      operationCatalog: operationCatalog.map(mapOperationCatalogItem),
      operations: plans.flatMap((plan) => plan.operations.map(mapPlanOperation))
    };
  }

  private async createPlan(user: AccessTokenPayload, body: Record<string, unknown>): Promise<MutationDelta> {
    const id = stringValue(body.id) ?? randomUUID();
    const rows = Array.isArray(body.operations) ? body.operations as Record<string, unknown>[] : [];
    const draftStatus = await this.requireStatusByCode("draft");
    const plan = await this.prisma.plan.create({
      data: {
        id,
        factoryId: user.factoryId,
        createdByUserId: user.sub,
        startDate: parseApiDate(requiredString(body.start_date, "START_DATE_REQUIRED")),
        endDate: parseApiDate(requiredString(body.end_date, "END_DATE_REQUIRED")),
        statusId: draftStatus.id,
        operations: {
          create: await Promise.all(rows.map((row) => this.planOperationCreateInput(user.factoryId, row)))
        }
      },
      include: {
        status: true,
        operations: {
          include: {
            territory: true,
            operation: true
          }
        }
      }
    });
    const operations = plan.operations.map(mapPlanOperation);
    return {
      ok: true,
      action: "created",
      resource: "plans",
      id: plan.id,
      data: mapPlan(plan),
      related: operations.length ? { operations } : undefined,
      createdPlanId: plan.id
    };
  }

  private async updatePlan(factoryId: string, id: string, body: Record<string, unknown>, roles: UserRole[]): Promise<MutationDelta> {
    const existing = await this.requirePlanWithStatus(factoryId, id);
    const data: Record<string, unknown> = {};
    if ("start_date" in body) data.startDate = parseApiDate(requiredString(body.start_date, "START_DATE_REQUIRED"));
    if ("end_date" in body) data.endDate = parseApiDate(requiredString(body.end_date, "END_DATE_REQUIRED"));
    if ("status" in body) {
      const nextStatus = await this.requireStatusByTitle(requiredString(body.status, "STATUS_REQUIRED"));
      assertPlanStatusTransition(existing.status, nextStatus, roles);
      data.statusId = nextStatus.id;
    }
    const plan = await this.prisma.plan.update({
      where: { id },
      data,
      include: {
        status: true,
        operations: {
          include: {
            territory: true,
            operation: true
          }
        }
      }
    });
    return {
      ok: true,
      action: "updated",
      resource: "plans",
      id,
      data: mapPlan(plan)
    };
  }

  private async deletePlan(factoryId: string, id: string): Promise<MutationDelta> {
    await this.requirePlan(factoryId, id);
    await this.prisma.plan.delete({ where: { id } });
    return {
      ok: true,
      action: "deleted",
      resource: "plans",
      id
    };
  }

  private async createPlanOperation(factoryId: string, body: Record<string, unknown>): Promise<MutationDelta> {
    const planId = requiredString(body.plan_id, "PLAN_REQUIRED");
    const plan = await this.requirePlanWithStatus(factoryId, planId);
    assertPlanOperationMutationStatus("POST", {}, plan.status);
    const created = await this.prisma.planOperation.create({
      data: {
        ...(await this.planOperationCreateInput(factoryId, body)),
        planId
      },
      include: {
        territory: true,
        operation: true
      }
    });
    return {
      ok: true,
      action: "created",
      resource: "operations",
      id: created.id,
      data: mapPlanOperation(created)
    };
  }

  private async updatePlanOperation(factoryId: string, id: string, body: Record<string, unknown>, roles: UserRole[]): Promise<MutationDelta> {
    const existing = await this.requirePlanOperationWithPlanStatus(factoryId, id);
    assertPlanOperationMutationStatus("PUT", body, existing.plan.status, roles);
    const data: Record<string, unknown> = {};
    if ("section_id" in body) {
      data.territoryId = requiredString(body.section_id, "TERRITORY_REQUIRED");
      await this.requireActiveSection(factoryId, data.territoryId as string);
    }
    if ("operation_id" in body) {
      data.operationId = requiredString(body.operation_id, "OPERATION_REQUIRED");
      await this.requireActiveOperationCatalogItem(data.operationId as string);
    }
    if ("required_staff" in body) data.requiredCount = numberValue(body.required_staff, 1);
    if ("staff_count" in body) data.staffCount = numberValue(body.staff_count, 0);
    if ("outsource_count" in body) data.outsourcingCount = numberValue(body.outsource_count, 0);
    if ("rate_per_hour" in body) data.hourlyPay = numberValue(body.rate_per_hour, 0);
    const updated = await this.prisma.planOperation.update({
      where: { id },
      data,
      include: {
        territory: true,
        operation: true
      }
    });
    return {
      ok: true,
      action: "updated",
      resource: "operations",
      id,
      data: mapPlanOperation(updated)
    };
  }

  private async deletePlanOperation(factoryId: string, id: string): Promise<MutationDelta> {
    const existing = await this.requirePlanOperationWithPlanStatus(factoryId, id);
    assertPlanOperationMutationStatus("DELETE", {}, existing.plan.status);
    await this.prisma.planOperation.delete({ where: { id } });
    return {
      ok: true,
      action: "deleted",
      resource: "operations",
      id
    };
  }

  private async createSection(factoryId: string, body: Record<string, unknown>): Promise<MutationDelta> {
    const created = await this.prisma.territoryTree.create({
      data: {
        id: stringValue(body.id) ?? randomUUID(),
        factoryId,
        name: requiredString(body.name, "TERRITORY_NAME_REQUIRED"),
        isFolder: false,
        active: body.active === undefined ? true : Boolean(body.active)
      },
      include: {
        _count: {
          select: { planOperations: true }
        }
      }
    });
    return {
      ok: true,
      action: "created",
      resource: "sections",
      id: created.id,
      data: mapSection(created, 0)
    };
  }

  private async updateSection(factoryId: string, id: string, body: Record<string, unknown>): Promise<MutationDelta> {
    await this.requireSection(factoryId, id);
    const updated = await this.prisma.territoryTree.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {})
      },
      include: {
        _count: {
          select: { planOperations: true }
        }
      }
    });
    return {
      ok: true,
      action: "updated",
      resource: "sections",
      id,
      data: mapSection(updated, numberValue(body.order, 0))
    };
  }

  private async deleteSection(factoryId: string, id: string): Promise<MutationDelta> {
    await this.requireSection(factoryId, id);
    const used = await this.prisma.planOperation.count({ where: { territoryId: id } });
    if (used > 0) {
      const updated = await this.prisma.territoryTree.update({
        where: { id },
        data: { active: false },
        include: {
          _count: {
            select: { planOperations: true }
          }
        }
      });
      return {
        ok: true,
        action: "updated",
        resource: "sections",
        id,
        data: mapSection(updated, 0)
      };
    }
    await this.prisma.territoryTree.delete({ where: { id } });
    return {
      ok: true,
      action: "deleted",
      resource: "sections",
      id
    };
  }

  private async createOperationCatalogItem(body: Record<string, unknown>): Promise<MutationDelta> {
    const created = await this.prisma.operation.create({
      data: {
        id: stringValue(body.id) ?? randomUUID(),
        name: requiredString(body.name, "OPERATION_NAME_REQUIRED"),
        active: body.active === undefined ? true : Boolean(body.active)
      },
      include: {
        _count: {
          select: { planOperations: true }
        }
      }
    });
    return {
      ok: true,
      action: "created",
      resource: "operationCatalog",
      id: created.id,
      data: mapOperationCatalogItem(created)
    };
  }

  private async updateOperationCatalogItem(id: string, body: Record<string, unknown>): Promise<MutationDelta> {
    await this.requireOperationCatalogItem(id);
    const updated = await this.prisma.operation.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {})
      },
      include: {
        _count: {
          select: { planOperations: true }
        }
      }
    });
    return {
      ok: true,
      action: "updated",
      resource: "operationCatalog",
      id,
      data: mapOperationCatalogItem(updated)
    };
  }

  private async deleteOperationCatalogItem(id: string): Promise<MutationDelta> {
    const operation = await this.requireOperationCatalogItem(id);
    const used = await this.prisma.planOperation.count({ where: { operationId: id } });
    if (used > 0) {
      const updated = await this.prisma.operation.update({
        where: { id },
        data: { active: false },
        include: {
          _count: {
            select: { planOperations: true }
          }
        }
      });
      return {
        ok: true,
        action: "updated",
        resource: "operationCatalog",
        id,
        data: mapOperationCatalogItem(updated)
      };
    }
    await this.prisma.operation.delete({ where: { id: operation.id } });
    return {
      ok: true,
      action: "deleted",
      resource: "operationCatalog",
      id
    };
  }

  private async planOperationCreateInput(factoryId: string, body: Record<string, unknown>) {
    const operationId = await this.resolveOperationId(body);
    const territoryId = requiredString(body.section_id, "TERRITORY_REQUIRED");
    await this.requireActiveSection(factoryId, territoryId);
    return {
      id: stringValue(body.id) ?? randomUUID(),
      territoryId,
      operationId,
      requiredCount: numberValue(body.required_staff, 1),
      staffCount: numberValue(body.staff_count, 0),
      outsourcingCount: numberValue(body.outsource_count, 0),
      hourlyPay: numberValue(body.rate_per_hour, 0)
    };
  }

  private async resolveOperationId(body: Record<string, unknown>): Promise<string> {
    const operationId = requiredString(body.operation_id, "OPERATION_REQUIRED");
    await this.requireActiveOperationCatalogItem(operationId);
    return operationId;
  }

  private async requireStatusByCode(code: string) {
    const status = await this.prisma.planStatus.findUnique({ where: { code } });
    if (!status) {
      throw new BadRequestException({
        code: "PLAN_STATUS_NOT_FOUND",
        message: "Статус плана не найден"
      });
    }
    return status;
  }

  private async requireStatusByTitle(title: string) {
    const status = await this.prisma.planStatus.findFirst({ where: { title } });
    if (!status) {
      throw new BadRequestException({
        code: "UNSUPPORTED_PLAN_STATUS",
        message: "Недопустимый статус плана"
      });
    }
    return status;
  }

  private async requirePlan(factoryId: string, id: string) {
    const plan = await this.prisma.plan.findFirst({ where: { id, factoryId } });
    if (!plan) throwNotFound("plans", id);
    return plan;
  }

  private async requirePlanWithStatus(factoryId: string, id: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id, factoryId },
      include: { status: true }
    });
    if (!plan) throwNotFound("plans", id);
    return plan;
  }

  private async requirePlanOperation(factoryId: string, id: string) {
    const operation = await this.prisma.planOperation.findFirst({
      where: {
        id,
        plan: { factoryId }
      }
    });
    if (!operation) throwNotFound("operations", id);
    return operation;
  }

  private async requirePlanOperationWithPlanStatus(factoryId: string, id: string) {
    const operation = await this.prisma.planOperation.findFirst({
      where: {
        id,
        plan: { factoryId }
      },
      include: {
        plan: {
          include: { status: true }
        }
      }
    });
    if (!operation) throwNotFound("operations", id);
    return operation;
  }

  private async requireSection(factoryId: string, id: string) {
    const section = await this.prisma.territoryTree.findFirst({ where: { id, factoryId } });
    if (!section) throwNotFound("sections", id);
    return section;
  }

  private async requireActiveSection(factoryId: string, id: string) {
    const section = await this.requireSection(factoryId, id);
    if (!section.active) {
      throw new BadRequestException({
        code: "INACTIVE_SECTION",
        message: "Архивный участок нельзя выбрать в плане"
      });
    }
    return section;
  }

  private async requireOperationCatalogItem(id: string) {
    const operation = await this.prisma.operation.findUnique({ where: { id } });
    if (!operation) throwNotFound("operationCatalog", id);
    return operation;
  }

  private async requireActiveOperationCatalogItem(id: string) {
    const operation = await this.requireOperationCatalogItem(id);
    if (!operation.active) {
      throw new BadRequestException({
        code: "INACTIVE_OPERATION",
        message: "Архивную операцию нельзя выбрать в плане"
      });
    }
    return operation;
  }

  private async requireCurrentRoles(userId: string): Promise<UserRole[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        usersRoles: {
          include: {
            role: true
          }
        }
      }
    });
    if (!user?.active) {
      throw new ForbiddenException({
        code: "USER_NOT_ACTIVE",
        message: "Пользователь недоступен"
      });
    }
    const roleCodes = user.usersRoles
      .filter((item) => item.role.active && userRoleSet.has(item.role.code))
      .map((item) => item.role.code as UserRole);
    const available = new Set(roleCodes);
    const roles = USER_ROLES.filter((role) => available.has(role));
    if (!roles.length) {
      throw new ForbiddenException({
        code: "NO_FACTORY_ROLE",
        message: "Нет назначенных ролей"
      });
    }
    return roles;
  }
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

function normalizeResource(resource: string): MutationResource {
  const aliases: Record<string, MutationResource> = {
    plans: "plans",
    sections: "sections",
    "operation-catalog": "operationCatalog",
    operationCatalog: "operationCatalog",
    operations: "operations",
    employees: "employees",
    assignments: "assignments",
    "housing-dorms": "housingDorms",
    housingDorms: "housingDorms",
    reservations: "reservations",
    facts: "facts",
    explanations: "explanations",
    settings: "settings"
  };
  const normalized = aliases[resource];
  if (!normalized) {
    throw new BadRequestException({
      code: "UNKNOWN_MUTATION_RESOURCE",
      message: "Неизвестный ресурс изменения"
    });
  }
  return normalized;
}

function storeFor(factoryId: string): CompatStore {
  const existing = compatStores.get(factoryId);
  if (existing) return existing;
  const store: CompatStore = {
    plans: new Map(),
    sections: new Map(),
    operations: new Map(),
    employees: new Map(),
    assignments: new Map(),
    reservations: new Map(),
    housingDorms: new Map(),
    facts: new Map(),
    explanations: new Map(),
    settings: {}
  };
  compatStores.set(factoryId, store);
  return store;
}

function values(collection: Map<string, CompatRecord>): CompatRecord[] {
  return [...collection.values()];
}

function collectionFor(store: CompatStore, resource: Exclude<MutationResource, "settings" | "operationCatalog">): Map<string, CompatRecord>;
function collectionFor(store: CompatStore, resource: MutationResource): Map<string, CompatRecord> {
  if (resource === "settings") {
    throw new BadRequestException({
      code: "INVALID_MUTATION_RESOURCE",
      message: "Настройки обновляются без id"
    });
  }
  if (resource === "operationCatalog") {
    throw new BadRequestException({
      code: "INVALID_MUTATION_RESOURCE",
      message: "Справочник операций хранится в базе"
    });
  }
  return store[resource];
}

function requireExisting(collection: Map<string, CompatRecord>, id: string, resource: MutationResource): CompatRecord {
  const record = collection.get(id);
  if (!record) {
    throw new NotFoundException({
      code: "MUTATION_TARGET_NOT_FOUND",
      message: "Изменяемая запись не найдена",
      resource,
      id
    });
  }
  return record;
}

function upsertFact(store: CompatStore, body: Record<string, unknown>, factoryId: string): CompatRecord {
  const id = stringValue(body.id);
  const existing =
    (id ? store.facts.get(id) : undefined) ??
    values(store.facts).find((fact) =>
      fact.plan_id === body.plan_id &&
      fact.operation_id === body.operation_id &&
      fact.employee_id === body.employee_id &&
      fact.side === body.side &&
      fact.work_date === body.work_date
    );
  const factId = existing?.id ?? randomUUID();
  const fact = {
    ...(existing ?? {}),
    id: factId,
    factory_id: factoryId,
    ...body
  };
  store.facts.set(factId, fact);
  return fact;
}

function requireMutationAccess(roles: UserRole[], resource: MutationResource, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>, store: CompatStore): void {
  const permissions = accessForRoles(roles);
  const requiredActions = requiredActionsForMutation(resource, method, body, store);
  const missingActions = requiredActions.filter((action) => !permissions.actions.includes(action));
  if (missingActions.length) {
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Недостаточно прав",
      missingActions
    });
  }
}

function requiredActionsForMutation(resource: MutationResource, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>, store: CompatStore): AccessAction[] {
  if (resource === "plans") {
    if (method === "POST" || method === "DELETE") return ["plans.factory.edit"];
    return actionsForPlanUpdate(body);
  }
  if (resource === "operations") return actionsForOperationMutation(method, body);
  if (resource === "sections" || resource === "operationCatalog") return ["sections.manage"];
  if (resource === "assignments") return ["plans.out.edit"];
  if (resource === "employees") return ["personnel.edit"];
  if (resource === "reservations" || resource === "housingDorms" || resource === "settings") return ["housing.edit"];
  if (resource === "facts") return [actionForFactSide(resolveFactSide(body))];
  if (resource === "explanations") return [actionForFactSide(resolveExplanationSide(store, body))];
  return [];
}

function actionsForPlanUpdate(body: Record<string, unknown>): AccessAction[] {
  const actions = new Set<AccessAction>();
  if ("start_date" in body || "end_date" in body) actions.add("plans.factory.edit");
  if ("status" in body) {
    const status = String(body.status ?? "");
    if (status === "Отправлено") actions.add("plans.factory.edit");
    else if (status === "Получено") actions.add("plans.hr.edit");
    else if (status === "На согласовании") actions.add("plans.out.edit");
    else if (status === "На очереди" || status === "Не утверждено") actions.add("plans.out.approve");
    else if (status === "В доработке") actions.add("plans.factory.edit");
    else {
      throw new BadRequestException({
        code: "UNSUPPORTED_PLAN_STATUS",
        message: "Недопустимый статус плана"
      });
    }
  }
  if (!actions.size) actions.add("plans.edit");
  return [...actions];
}

function assertPlanStatusTransition(current: { code: string; title: string }, next: { code: string; title: string }, roles: UserRole[] = []): void {
  if (current.code === next.code) return;
  const allowed: Record<string, string[]> = {
    draft: ["submitted_to_hr"],
    submitted_to_hr: ["received_by_outsourcer"],
    received_by_outsourcer: ["on_approval"],
    rejected: ["on_approval"],
    on_approval: ["approved", "rejected"],
    approved: []
  };
  const permissions = accessForRoles(roles);
  if (
    current.code === "draft" &&
    next.code === "received_by_outsourcer" &&
    permissions.actions.includes("plans.factory.edit") &&
    permissions.actions.includes("plans.hr.edit")
  ) {
    return;
  }
  if (!allowed[current.code]?.includes(next.code)) {
    throw new BadRequestException({
      code: "INVALID_PLAN_STATUS_TRANSITION",
      message: `Недопустимый переход статуса плана: ${current.title} -> ${next.title}`
    });
  }
}

function assertPlanOperationMutationStatus(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>, status: { code: string; title: string }, roles: UserRole[] = []): void {
  if (method === "POST" || method === "DELETE") {
    assertPlanStatusIn(status, ["draft"], "PLAN_OPERATION_STATUS_LOCKED", "Строки плана можно добавлять и удалять только в статусе «В доработке»");
    return;
  }

  if ("name" in body || "operation_id" in body || "section_id" in body || "section_name" in body || "required_staff" in body) {
    assertPlanStatusIn(status, ["draft"], "PLAN_OPERATION_STATUS_LOCKED", "Фабричные поля строки плана можно менять только в статусе «В доработке»");
  }
  if ("staff_count" in body || "outsource_count" in body) {
    const permissions = accessForRoles(roles);
    const canEditDraftAsFactoryHr = status.code === "draft" && permissions.actions.includes("plans.factory.edit") && permissions.actions.includes("plans.hr.edit");
    if (!canEditDraftAsFactoryHr) {
      assertPlanStatusIn(status, ["submitted_to_hr", "received_by_outsourcer"], "PLAN_OPERATION_STATUS_LOCKED", "HR-поля строки плана можно менять только на HR-этапе");
    }
  }
  if ("hours_per_day" in body || "rate_per_hour" in body) {
    assertPlanStatusIn(status, ["received_by_outsourcer", "rejected"], "PLAN_OPERATION_STATUS_LOCKED", "Поля аутсорсинга можно менять только на этапе аутсорсера");
  }
}

function assertPlanStatusIn(status: { code: string; title: string }, allowedCodes: string[], code: string, message: string): void {
  if (allowedCodes.includes(status.code)) return;
  throw new BadRequestException({
    code,
    message,
    status: status.title
  });
}

function actionsForOperationMutation(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>): AccessAction[] {
  if (method === "POST" || method === "DELETE") return ["plans.factory.edit"];
  const actions = new Set<AccessAction>();
  if ("name" in body || "operation_id" in body || "section_id" in body || "section_name" in body || "required_staff" in body) actions.add("plans.factory.edit");
  if ("staff_count" in body || "outsource_count" in body) actions.add("plans.hr.edit");
  if ("hours_per_day" in body || "rate_per_hour" in body) actions.add("plans.out.edit");
  if (!actions.size) actions.add("plans.edit");
  return [...actions];
}

function resolveFactSide(body: Record<string, unknown>): "factory" | "out" {
  const side = stringValue(body.side);
  if (side === "factory" || side === "out") return side;
  const authorRole = stringValue(body.author_role)?.toLowerCase() ?? "";
  if (authorRole.includes("аутсорсер")) return "out";
  if (authorRole.includes("фабрик")) return "factory";
  throw new BadRequestException({
    code: "FACT_SIDE_REQUIRED",
    message: "Нужно указать сторону факта"
  });
}

function resolveExplanationSide(store: CompatStore, body: Record<string, unknown>): "factory" | "out" {
  const factEntryId = stringValue(body.fact_entry_id);
  if (!factEntryId) {
    throw new BadRequestException({
      code: "FACT_ENTRY_REQUIRED",
      message: "Нужно указать факт для пояснения"
    });
  }
  const fact = store.facts.get(factEntryId);
  if (!fact) {
    throw new NotFoundException({
      code: "FACT_NOT_FOUND",
      message: "Факт для пояснения не найден"
    });
  }
  return resolveFactSide(fact);
}

function actionForFactSide(side: "factory" | "out"): AccessAction {
  return side === "out" ? "facts.out.edit" : "facts.factory.edit";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, code: string): string {
  const normalized = stringValue(value);
  if (!normalized) {
    throw new BadRequestException({
      code,
      message: "Обязательное поле не заполнено"
    });
  }
  return normalized;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseApiDate(value: string): Date {
  const ruMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (ruMatch) {
    return new Date(Date.UTC(Number(ruMatch[3]), Number(ruMatch[2]) - 1, Number(ruMatch[1])));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "INVALID_DATE",
      message: "Некорректная дата"
    });
  }
  return date;
}

function formatApiDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

function mapPlan(plan: {
  id: string;
  startDate: Date;
  endDate: Date;
  status: { title: string };
  operations: Array<{ requiredCount: number; staffCount: number | null; outsourcingCount: number | null }>;
}) {
  const requiredStaff = plan.operations.reduce((sum, row) => sum + row.requiredCount, 0);
  const staffCount = plan.operations.reduce((sum, row) => sum + (row.staffCount ?? 0), 0);
  return {
    id: plan.id,
    owner_role: "factory",
    start_date: formatApiDate(plan.startDate),
    end_date: formatApiDate(plan.endDate),
    status: plan.status.title,
    title: "План",
    required_staff: requiredStaff,
    staff_count: staffCount,
    outsource_count: plan.operations.reduce((sum, row) => sum + (row.outsourcingCount ?? Math.max(row.requiredCount - (row.staffCount ?? 0), 0)), 0)
  };
}

function mapPlanOperation(row: {
  id: string;
  planId: string;
  territoryId: string;
  operationId: string;
  requiredCount: number;
  staffCount: number | null;
  outsourcingCount: number | null;
  hourlyPay: unknown;
  territory: { name: string };
  operation: { name: string };
}) {
  const staffCount = row.staffCount ?? 0;
  return {
    id: row.id,
    plan_id: row.planId,
    operation_id: row.operationId,
    section_id: row.territoryId,
    section_name: row.territory.name,
    section_order: 0,
    name: row.operation.name,
    required_staff: row.requiredCount,
    staff_count: staffCount,
    outsource_count: row.outsourcingCount ?? Math.max(row.requiredCount - staffCount, 0),
    hours_per_day: 8,
    rate_per_hour: Number(row.hourlyPay ?? 0),
    assigned_count: 0
  };
}

function mapSection(section: { id: string; factoryId: string; name: string; active: boolean; _count?: { planOperations: number } }, index: number) {
  return {
    id: section.id,
    factory_id: section.factoryId,
    name: section.name,
    order: index + 1,
    active: section.active,
    operation_count: section._count?.planOperations ?? 0
  };
}

function mapOperationCatalogItem(operation: { id: string; name: string; active: boolean; _count?: { planOperations: number } }) {
  return {
    id: operation.id,
    name: operation.name,
    active: operation.active,
    operation_count: operation._count?.planOperations ?? 0
  };
}

function throwNotFound(resource: MutationResource, id: string): never {
  throw new NotFoundException({
    code: "MUTATION_TARGET_NOT_FOUND",
    message: "Изменяемая запись не найдена",
    resource,
    id
  });
}
