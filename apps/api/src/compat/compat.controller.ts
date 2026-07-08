import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { accessForRole, type AccessAction, type BootstrapData, type Factory, type MutationDelta, type MutationResource, type RoleAccess, type UserRole } from "@reftinskaya/contracts";
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

@ApiTags("compat")
@ApiBearerAuth()
@Controller("compat")
export class CompatController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("bootstrap")
  async bootstrap(@CurrentUser() user: AccessTokenPayload): Promise<BootstrapData> {
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
    const permissions = accessForRoles(user.roles?.length ? user.roles : [user.role]);

    return {
      plans: values(storeFor(user.factoryId).plans) as BootstrapData["plans"],
      sections: values(storeFor(user.factoryId).sections) as BootstrapData["sections"],
      operations: values(storeFor(user.factoryId).operations) as BootstrapData["operations"],
      employees: values(storeFor(user.factoryId).employees) as BootstrapData["employees"],
      employeeBusy: [],
      assignments: values(storeFor(user.factoryId).assignments) as BootstrapData["assignments"],
      reservations: values(storeFor(user.factoryId).reservations) as BootstrapData["reservations"],
      housingDorms: values(storeFor(user.factoryId).housingDorms) as BootstrapData["housingDorms"],
      housingPlaces: [],
      facts: values(storeFor(user.factoryId).facts) as BootstrapData["facts"],
      explanations: values(storeFor(user.factoryId).explanations) as BootstrapData["explanations"],
      settings: storeFor(user.factoryId).settings,
      currentUser: {
        id: user.sub,
        factoryId: user.factoryId,
        login: user.login,
        role: user.role,
        roles: user.roles,
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
  create(@Param("resource") rawResource: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): MutationDelta {
    const resource = normalizeResource(rawResource);
    const store = storeFor(user.factoryId);
    requireMutationAccess(user, resource, "POST", body, store);

    if (resource === "plans") {
      const id = stringValue(body.id) ?? randomUUID();
      const operations = Array.isArray(body.operations)
        ? body.operations.map((operation) => ({ ...(operation as Record<string, unknown>), id: randomUUID(), plan_id: id, factory_id: user.factoryId }))
        : [];
      const { operations: _operations, ...planBody } = body;
      const plan = { id, factory_id: user.factoryId, ...planBody };
      store.plans.set(id, plan);
      for (const operation of operations) {
        store.operations.set(String(operation.id), operation);
      }
      return {
        ok: true,
        action: "created",
        resource,
        id,
        data: plan,
        related: operations.length ? { operations } : undefined,
        createdPlanId: id
      };
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
  update(@Param("resource") rawResource: string, @Param("id") id: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): MutationDelta {
    const resource = normalizeResource(rawResource);
    if (resource === "settings") {
      throw new BadRequestException({
        code: "INVALID_MUTATION_RESOURCE",
        message: "Настройки обновляются без id"
      });
    }
    const store = storeFor(user.factoryId);
    requireMutationAccess(user, resource, "PUT", body, store);
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
  updateSingleton(@Param("resource") rawResource: string, @Body() body: Record<string, unknown> = {}, @CurrentUser() user: AccessTokenPayload): MutationDelta {
    const resource = normalizeResource(rawResource);
    if (resource !== "settings") {
      throw new BadRequestException({
        code: "MUTATION_ID_REQUIRED",
        message: "Нужно указать id ресурса"
      });
    }
    const store = storeFor(user.factoryId);
    requireMutationAccess(user, resource, "PUT", body, store);
    store.settings = { ...store.settings, ...body };
    return {
      ok: true,
      action: "updated",
      resource,
      data: store.settings
    };
  }

  @Delete(":resource/:id")
  remove(@Param("resource") rawResource: string, @Param("id") id: string, @CurrentUser() user: AccessTokenPayload): MutationDelta {
    const resource = normalizeResource(rawResource);
    if (resource === "settings") {
      throw new BadRequestException({
        code: "INVALID_MUTATION_RESOURCE",
        message: "Настройки удаляются отдельно"
      });
    }
    const store = storeFor(user.factoryId);
    requireMutationAccess(user, resource, "DELETE", {}, store);
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

function collectionFor(store: CompatStore, resource: Exclude<MutationResource, "settings">): Map<string, CompatRecord>;
function collectionFor(store: CompatStore, resource: MutationResource): Map<string, CompatRecord> {
  if (resource === "settings") {
    throw new BadRequestException({
      code: "INVALID_MUTATION_RESOURCE",
      message: "Настройки обновляются без id"
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

function requireMutationAccess(user: AccessTokenPayload, resource: MutationResource, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>, store: CompatStore): void {
  const permissions = accessForRoles(user.roles?.length ? user.roles : [user.role]);
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
  if (resource === "sections") return ["sections.manage"];
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
    else if (status === "На очереди" || status === "Не утверждено" || status === "В доработке") actions.add("plans.factory.edit");
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

function actionsForOperationMutation(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>): AccessAction[] {
  if (method === "POST" || method === "DELETE") return ["plans.factory.edit"];
  const actions = new Set<AccessAction>();
  if ("name" in body || "section_id" in body || "section_name" in body || "required_staff" in body) actions.add("plans.factory.edit");
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
