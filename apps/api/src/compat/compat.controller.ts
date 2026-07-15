import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Logger, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
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

type PersistedResource = "assignments" | "reservations" | "housingDorms" | "facts" | "explanations";
type AuditSnapshot = {
  resourceTitle: string;
  objectLabel?: string;
  values: Record<string, unknown>;
};
type EmployeeWriteData = {
  fullName?: string;
  country?: string | null;
  age?: number | null;
  employeeStatusId?: string | null;
  phone?: string | null;
  email?: string | null;
  birthDate?: Date | null;
  passportNo?: string | null;
  passportIssued?: string | null;
  registration?: string | null;
  needsHousing?: boolean;
  needsRegistration?: boolean;
  driverCategories?: string | null;
};
type DictionaryResource =
  | "employeeStatuses"
  | "housingReservationStatuses"
  | "housingFactStatuses"
  | "dormitories"
  | "rooms"
  | "beds"
  | "priceList"
  | "roomPriceList";

const dictionaryResources = new Set<DictionaryResource>([
  "employeeStatuses",
  "housingReservationStatuses",
  "housingFactStatuses",
  "dormitories",
  "rooms",
  "beds",
  "priceList",
  "roomPriceList"
]);

const compatStores = new Map<string, CompatStore>();
const userRoleSet = new Set<string>(USER_ROLES);
const settingsRecordId = "__settings__";
const persistedResources = new Set<PersistedResource>(["assignments", "reservations", "housingDorms", "facts", "explanations"]);

@ApiTags("compat")
@ApiBearerAuth()
@Controller("compat")
export class CompatController {
  private readonly logger = new Logger(CompatController.name);

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
    const [rawPlanData, employees, dictionaries] = await Promise.all([
      this.loadPlanData(user.factoryId),
      this.loadEmployees(user.factoryId),
      this.loadDictionaries(user.factoryId, roles)
    ]);
    const planData = filterPlanDataForAccess(rawPlanData, permissions);
    const store = storeFor(user.factoryId);
    await this.hydrateStore(user.factoryId, store);

    return {
      plans: planData.plans,
      sections: planData.sections,
      operationCatalog: planData.operationCatalog,
      operations: planData.operations,
      employees,
      employeeBusy: [],
      assignments: values(store.assignments) as BootstrapData["assignments"],
      reservations: values(store.reservations) as BootstrapData["reservations"],
      housingDorms: values(store.housingDorms) as BootstrapData["housingDorms"],
      housingPlaces: [],
      dictionaries,
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
    await this.hydrateStore(user.factoryId, store);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "POST", body, store);
    this.logMutation("POST", resource, user, undefined, body);

    if (resource === "plans") {
      const created = await this.createPlan(user, body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (resource === "sections") {
      const created = await this.createSection(user.factoryId, body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (resource === "operationCatalog") {
      const created = await this.createOperationCatalogItem(body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (resource === "operations") {
      const created = await this.createPlanOperation(user.factoryId, body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (resource === "employees") {
      const created = await this.createEmployee(body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (isDictionaryResource(resource)) {
      const created = await this.createDictionaryItem(user.factoryId, resource, body);
      await this.auditMutation("POST", resource, user, created.id);
      return created;
    }

    if (resource === "facts") {
      const fact = upsertFact(store, body, user.factoryId);
      await this.persistCompatRecord(user.factoryId, resource, fact.id, fact);
      const delta: MutationDelta = {
        ok: true,
        action: "upserted",
        resource,
        id: fact.id,
        data: fact
      };
      await this.auditMutation("POST", resource, user, delta.id);
      return delta;
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
      await this.persistCompatRecord(user.factoryId, resource, id, data);
      const delta: MutationDelta = {
        ok: true,
        action: "created",
        resource,
        id,
        data
      };
      await this.auditMutation("POST", resource, user, delta.id);
      return delta;
    }

    const id = stringValue(body.id) ?? randomUUID();
    const data = { id, factory_id: user.factoryId, ...body };
    collectionFor(store, resource).set(id, data);
    await this.persistCompatRecord(user.factoryId, resource, id, data);
    const delta: MutationDelta = {
      ok: true,
      action: "created",
      resource,
      id,
      data
    };
    await this.auditMutation("POST", resource, user, delta.id);
    return delta;
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
    await this.hydrateStore(user.factoryId, store);
    const roles = await this.requireCurrentRoles(user.sub);
    requireMutationAccess(roles, resource, "PUT", body, store);
    this.logMutation("PUT", resource, user, id, body);
    if (resource === "plans") {
      const previous = await this.planAuditSnapshot(user.factoryId, id);
      return this.withAudit("PUT", resource, user, await this.updatePlan(user.factoryId, id, body, roles, user.role), id, body, previous);
    }
    if (resource === "sections") return this.withAudit("PUT", resource, user, await this.updateSection(user.factoryId, id, body), id);
    if (resource === "operationCatalog") return this.withAudit("PUT", resource, user, await this.updateOperationCatalogItem(id, body), id);
    if (resource === "operations") {
      const previous = await this.operationAuditSnapshot(user.factoryId, id);
      return this.withAudit("PUT", resource, user, await this.updatePlanOperation(user.factoryId, id, body, roles), id, body, previous);
    }
    if (resource === "employees") return this.withAudit("PUT", resource, user, await this.updateEmployee(id, body), id);
    if (isDictionaryResource(resource)) return this.withAudit("PUT", resource, user, await this.updateDictionaryItem(user.factoryId, resource, id, body), id);
    const collection = collectionFor(store, resource);
    const existing = requireExisting(collection, id, resource);
    const data = { ...existing, ...body, id };
    collection.set(id, data);
    await this.persistCompatRecord(user.factoryId, resource, id, data);
    const delta: MutationDelta = {
      ok: true,
      action: "updated",
      resource,
      id,
      data
    };
    return this.withAudit("PUT", resource, user, delta, id);
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
    await this.hydrateStore(user.factoryId, store);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "PUT", body, store);
    this.logMutation("PUT", resource, user, undefined, body);
    store.settings = { ...store.settings, ...body };
    await this.persistCompatRecord(user.factoryId, resource, settingsRecordId, store.settings);
    const delta: MutationDelta = {
      ok: true,
      action: "updated",
      resource,
      data: store.settings
    };
    return this.withAudit("PUT", resource, user, delta, settingsRecordId);
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
    await this.hydrateStore(user.factoryId, store);
    requireMutationAccess(await this.requireCurrentRoles(user.sub), resource, "DELETE", {}, store);
    this.logMutation("DELETE", resource, user, id);
    if (resource === "plans") return this.withAudit("DELETE", resource, user, await this.deletePlan(user.factoryId, id), id);
    if (resource === "sections") return this.withAudit("DELETE", resource, user, await this.deleteSection(user.factoryId, id), id);
    if (resource === "operationCatalog") return this.withAudit("DELETE", resource, user, await this.deleteOperationCatalogItem(id), id);
    if (resource === "operations") return this.withAudit("DELETE", resource, user, await this.deletePlanOperation(user.factoryId, id), id);
    if (resource === "employees") return this.withAudit("DELETE", resource, user, await this.deleteEmployee(id), id);
    if (isDictionaryResource(resource)) return this.withAudit("DELETE", resource, user, await this.deleteDictionaryItem(user.factoryId, resource, id), id);
    const collection = collectionFor(store, resource);
    requireExisting(collection, id, resource);
    collection.delete(id);
    await this.deleteCompatRecord(user.factoryId, resource, id);
    const delta: MutationDelta = {
      ok: true,
      action: "deleted",
      resource,
      id
    };
    return this.withAudit("DELETE", resource, user, delta, id);
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
            orderBy: [{ createdAt: "desc" }, { id: "asc" }]
          }
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }]
      }),
      this.prisma.territoryTree.findMany({
        where: { factoryId },
        orderBy: [{ parentId: "asc" }, { name: "asc" }],
        include: {
          _count: {
            select: { planOperations: true }
          }
        }
      }),
      this.prisma.operation.findMany({
        orderBy: [{ parentId: "asc" }, { name: "asc" }],
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

  private logMutation(method: "POST" | "PUT" | "DELETE", resource: MutationResource, user: AccessTokenPayload, id?: string, body?: Record<string, unknown>): void {
    this.logger.log({
      event: "compat_mutation",
      method,
      resource,
      id,
      userId: user.sub,
      role: user.role,
      factoryId: user.factoryId,
      bodyKeys: body ? Object.keys(body) : []
    });
  }

  private async withAudit(method: "POST" | "PUT" | "DELETE", resource: MutationResource, user: AccessTokenPayload, delta: MutationDelta, fallbackId?: string, body?: Record<string, unknown>, previous?: AuditSnapshot): Promise<MutationDelta> {
    await this.auditMutation(method, resource, user, delta.id ?? fallbackId, body, previous, auditSnapshotFromDelta(resource, delta));
    return delta;
  }

  private async auditMutation(method: "POST" | "PUT" | "DELETE", resource: MutationResource, user: AccessTokenPayload, id?: string, body?: Record<string, unknown>, previous?: AuditSnapshot, next?: AuditSnapshot): Promise<void> {
    const cellResource = method === "PUT" && isPlanCellResource(resource) ? resource : undefined;
    const cellBody = cellResource ? body : undefined;
    const entries = cellResource && cellBody
      ? Object.keys(cellBody).map((field) => readablePlanCellAuditEntry(cellResource, field, cellBody[field], previous, next))
      : [readableAuditEntry(method, resource, previous ?? next)];
    await this.prisma.auditLog.createMany({
      data: entries.map((entry) => ({
        factoryId: user.factoryId,
        userId: user.sub,
        action: entry.action,
        entity: resource,
        entityId: isUuid(id) ? id : null,
        details: entry.details
      }))
    }).catch((error) => this.logger.warn({ event: "audit_log_failed", error: error instanceof Error ? error.message : String(error), resource, id }));
  }

  private async planAuditSnapshot(factoryId: string, id: string): Promise<AuditSnapshot | undefined> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, factoryId },
      include: { status: true }
    });
    if (!plan) return undefined;
    return {
      resourceTitle: auditResourceTitle("plans"),
      objectLabel: `План ${formatApiDate(plan.startDate)} - ${formatApiDate(plan.endDate)}`,
      values: {
        start_date: formatApiDate(plan.startDate),
        end_date: formatApiDate(plan.endDate),
        status: plan.status.title,
        status_code: plan.status.code
      }
    };
  }

  private async operationAuditSnapshot(factoryId: string, id: string): Promise<AuditSnapshot | undefined> {
    const operation = await this.prisma.planOperation.findFirst({
      where: { id, plan: { factoryId } },
      include: {
        plan: true,
        territory: true,
        operation: true
      }
    });
    if (!operation) return undefined;
    const staffCount = operation.staffCount ?? 0;
    return {
      resourceTitle: auditResourceTitle("operations"),
      objectLabel: operationAuditLabel(operation),
      values: {
        plan_id: `План ${formatApiDate(operation.plan.startDate)} - ${formatApiDate(operation.plan.endDate)}`,
        section_id: operation.territory?.name ?? "не заполнено",
        section_name: operation.territory?.name ?? "не заполнено",
        operation_id: operation.operation?.name ?? "не заполнено",
        name: operation.operation?.name ?? "не заполнено",
        required_staff: operation.requiredCount,
        staff_count: staffCount,
        outsource_count: operation.outsourcingCount ?? Math.max(operation.requiredCount - staffCount, 0),
        hours_per_day: 8,
        rate_per_hour: Number(operation.hourlyPay ?? 0)
      }
    };
  }

  private async loadEmployees(factoryId: string): Promise<BootstrapData["employees"]> {
    await this.importCompatEmployees(factoryId);
    const employees = await this.prisma.employee.findMany({
      include: { status: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }]
    });
    return employees.map(mapEmployee);
  }

  private async loadDictionaries(factoryId: string, roles: UserRole[]): Promise<NonNullable<BootstrapData["dictionaries"]>> {
    if (isFactoryPlannerOnly(roles)) return emptyDictionaries();
    const [
      employeeStatuses,
      housingReservationStatuses,
      housingFactStatuses,
      dormitories,
      rooms,
      beds,
      priceList,
      roomPriceList
    ] = await Promise.all([
      this.prisma.employeeStatus.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { title: "asc" } }),
      this.prisma.housingReservationStatus.findMany({ include: { _count: { select: { reservations: true } } }, orderBy: { title: "asc" } }),
      this.prisma.housingFactStatus.findMany({ include: { _count: { select: { facts: true } } }, orderBy: { title: "asc" } }),
      this.prisma.dormitory.findMany({ where: { factoryId }, include: { _count: { select: { roomsDormitories: true } } }, orderBy: { name: "asc" } }),
      this.prisma.room.findMany({ include: { roomsDormitories: { include: { dormitory: true } }, _count: { select: { beds: true, roomPrices: true } } }, orderBy: { roomNumber: "asc" } }),
      this.prisma.bed.findMany({ include: { room: true, _count: { select: { housingReservations: true, housingFacts: true } } }, orderBy: [{ roomId: "asc" }, { bedNumber: "asc" }] }),
      this.prisma.priceList.findMany({ include: { operation: true, section: true }, orderBy: [{ dateApplied: "desc" }, { id: "asc" }] }),
      this.prisma.roomPriceList.findMany({ include: { room: true }, orderBy: [{ dateApplied: "desc" }, { id: "asc" }] })
    ]);
    return {
      employeeStatuses: employeeStatuses.map((item) => dictionaryItem(item.id, item.title, { active: item.active, usageCount: item._count.employees })),
      housingReservationStatuses: housingReservationStatuses.map((item) => dictionaryItem(item.id, item.title, { active: item.active, usageCount: item._count.reservations, fields: { is_final: item.isFinal ?? false } })),
      housingFactStatuses: housingFactStatuses.map((item) => dictionaryItem(item.id, item.title, { active: item.active, usageCount: item._count.facts, fields: { is_final: item.isFinal ?? false } })),
      dormitories: dormitories.map((item) => dictionaryItem(item.id, item.name, { subtitle: item.address, active: item.active, usageCount: item._count.roomsDormitories, fields: { address: item.address } })),
      rooms: rooms.map((item) => {
        const dormitory = item.roomsDormitories[0]?.dormitory;
        return dictionaryItem(item.id, item.roomNumber, { subtitle: dormitory?.name, active: item.active, usageCount: item._count.beds + item._count.roomPrices, fields: { dormitory_id: dormitory?.id ?? "", room_number: item.roomNumber } });
      }),
      beds: beds.map((item) => dictionaryItem(item.id, item.bedNumber ? `${item.bedNumber}-е койко-место` : "Койко-место", { subtitle: item.room.roomNumber, active: item.active, usageCount: item._count.housingReservations + item._count.housingFacts, fields: { room_id: item.roomId, bed_number: item.bedNumber ?? 1 } })),
      priceList: priceList.map((item) => dictionaryItem(item.id, item.operation.name, { subtitle: item.section.name, active: true, usageCount: 0, fields: { operation_id: item.operationId, section_id: item.sectionId, cost: item.cost, date_applyed: item.dateApplied ? formatApiDate(item.dateApplied) : "" } })),
      roomPriceList: roomPriceList.map((item) => dictionaryItem(item.id, item.room.roomNumber, { active: true, usageCount: 0, fields: { room_id: item.roomId, cost: item.cost == null ? "" : Number(item.cost), date_applyed: item.dateApplied ? formatApiDate(item.dateApplied) : "" } }))
    };
  }

  private async createDictionaryItem(factoryId: string, resource: DictionaryResource, body: Record<string, unknown>): Promise<MutationDelta> {
    if (resource === "employeeStatuses") {
      const created = await this.prisma.employeeStatus.create({ data: { id: stringValue(body.id) ?? randomUUID(), title: requiredString(body.title ?? body.name, "TITLE_REQUIRED"), active: body.active === undefined ? true : Boolean(body.active) }, include: { _count: { select: { employees: true } } } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.title, { active: created.active, usageCount: created._count.employees }));
    }
    if (resource === "housingReservationStatuses") {
      const created = await this.prisma.housingReservationStatus.create({ data: { id: stringValue(body.id) ?? randomUUID(), title: requiredString(body.title ?? body.name, "TITLE_REQUIRED"), isFinal: Boolean(body.is_final), active: body.active === undefined ? true : Boolean(body.active) }, include: { _count: { select: { reservations: true } } } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.title, { active: created.active, usageCount: created._count.reservations, fields: { is_final: created.isFinal ?? false } }));
    }
    if (resource === "housingFactStatuses") {
      const created = await this.prisma.housingFactStatus.create({ data: { id: stringValue(body.id) ?? randomUUID(), title: requiredString(body.title ?? body.name, "TITLE_REQUIRED"), isFinal: Boolean(body.is_final), active: body.active === undefined ? true : Boolean(body.active) }, include: { _count: { select: { facts: true } } } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.title, { active: created.active, usageCount: created._count.facts, fields: { is_final: created.isFinal ?? false } }));
    }
    if (resource === "dormitories") {
      const created = await this.prisma.dormitory.create({ data: { id: stringValue(body.id) ?? randomUUID(), factoryId, name: requiredString(body.title ?? body.name, "TITLE_REQUIRED"), address: stringValue(body.address) ?? "", active: body.active === undefined ? true : Boolean(body.active) }, include: { _count: { select: { roomsDormitories: true } } } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.name, { subtitle: created.address, active: created.active, usageCount: created._count.roomsDormitories, fields: { address: created.address } }));
    }
    if (resource === "rooms") {
      const created = await this.prisma.room.create({ data: { id: stringValue(body.id) ?? randomUUID(), roomNumber: requiredString(body.room_number ?? body.title ?? body.name, "ROOM_NUMBER_REQUIRED"), active: body.active === undefined ? true : Boolean(body.active), roomsDormitories: stringValue(body.dormitory_id) ? { create: { dormitoryId: requiredString(body.dormitory_id, "DORMITORY_REQUIRED") } } : undefined }, include: { roomsDormitories: { include: { dormitory: true } }, _count: { select: { beds: true, roomPrices: true } } } });
      const dormitory = created.roomsDormitories[0]?.dormitory;
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.roomNumber, { subtitle: dormitory?.name, active: created.active, usageCount: created._count.beds + created._count.roomPrices, fields: { dormitory_id: dormitory?.id ?? "", room_number: created.roomNumber } }));
    }
    if (resource === "beds") {
      const created = await this.prisma.bed.create({ data: { id: stringValue(body.id) ?? randomUUID(), roomId: requiredString(body.room_id, "ROOM_REQUIRED"), bedNumber: Math.trunc(numberValue(body.bed_number, 1)), active: body.active === undefined ? true : Boolean(body.active) }, include: { room: true, _count: { select: { housingReservations: true, housingFacts: true } } } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.bedNumber ? `${created.bedNumber}-е койко-место` : "Койко-место", { subtitle: created.room.roomNumber, active: created.active, usageCount: 0, fields: { room_id: created.roomId, bed_number: created.bedNumber ?? 1 } }));
    }
    if (resource === "priceList") {
      const created = await this.prisma.priceList.create({ data: { id: stringValue(body.id) ?? randomUUID(), operationId: requiredString(body.operation_id, "OPERATION_REQUIRED"), sectionId: requiredString(body.section_id, "SECTION_REQUIRED"), cost: numberValue(body.cost, 0), dateApplied: optionalApiDate(body.date_applyed) ?? null }, include: { operation: true, section: true } });
      return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.operation.name, { subtitle: created.section.name, active: true, fields: { operation_id: created.operationId, section_id: created.sectionId, cost: created.cost, date_applyed: created.dateApplied ? formatApiDate(created.dateApplied) : "" } }));
    }
    const created = await this.prisma.roomPriceList.create({ data: { id: stringValue(body.id) ?? randomUUID(), roomId: requiredString(body.room_id, "ROOM_REQUIRED"), cost: numberValue(body.cost, 0), dateApplied: optionalApiDate(body.date_applyed) ?? null }, include: { room: true } });
    return dictionaryDelta("created", resource, created.id, dictionaryItem(created.id, created.room.roomNumber, { active: true, fields: { room_id: created.roomId, cost: created.cost == null ? "" : Number(created.cost), date_applyed: created.dateApplied ? formatApiDate(created.dateApplied) : "" } }));
  }

  private async updateDictionaryItem(factoryId: string, resource: DictionaryResource, id: string, body: Record<string, unknown>): Promise<MutationDelta> {
    if (resource === "employeeStatuses") {
      const updated = await this.prisma.employeeStatus.update({ where: { id }, data: statusDictionaryWrite(body), include: { _count: { select: { employees: true } } } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.title, { active: updated.active, usageCount: updated._count.employees }));
    }
    if (resource === "housingReservationStatuses") {
      const updated = await this.prisma.housingReservationStatus.update({ where: { id }, data: finalStatusDictionaryWrite(body), include: { _count: { select: { reservations: true } } } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.title, { active: updated.active, usageCount: updated._count.reservations, fields: { is_final: updated.isFinal ?? false } }));
    }
    if (resource === "housingFactStatuses") {
      const updated = await this.prisma.housingFactStatus.update({ where: { id }, data: finalStatusDictionaryWrite(body), include: { _count: { select: { facts: true } } } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.title, { active: updated.active, usageCount: updated._count.facts, fields: { is_final: updated.isFinal ?? false } }));
    }
    if (resource === "dormitories") {
      await this.requireFactoryDormitory(factoryId, id);
      const updated = await this.prisma.dormitory.update({ where: { id }, data: { ...(typeof (body.title ?? body.name) === "string" ? { name: requiredString(body.title ?? body.name, "TITLE_REQUIRED") } : {}), ...("address" in body ? { address: stringValue(body.address) ?? "" } : {}), ...(typeof body.active === "boolean" ? { active: body.active } : {}) }, include: { _count: { select: { roomsDormitories: true } } } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.name, { subtitle: updated.address, active: updated.active, usageCount: updated._count.roomsDormitories, fields: { address: updated.address } }));
    }
    if (resource === "rooms") {
      const data = { ...(typeof (body.room_number ?? body.title ?? body.name) === "string" ? { roomNumber: requiredString(body.room_number ?? body.title ?? body.name, "ROOM_NUMBER_REQUIRED") } : {}), ...(typeof body.active === "boolean" ? { active: body.active } : {}) };
      const room = await this.prisma.room.update({ where: { id }, data });
      if ("dormitory_id" in body) {
        await this.prisma.roomsDormitory.deleteMany({ where: { roomId: id } });
        const dormitoryId = stringValue(body.dormitory_id);
        if (dormitoryId) await this.prisma.roomsDormitory.create({ data: { dormitoryId, roomId: id } });
      }
      const updated = await this.prisma.room.findUniqueOrThrow({ where: { id: room.id }, include: { roomsDormitories: { include: { dormitory: true } }, _count: { select: { beds: true, roomPrices: true } } } });
      const dormitory = updated.roomsDormitories[0]?.dormitory;
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.roomNumber, { subtitle: dormitory?.name, active: updated.active, usageCount: updated._count.beds + updated._count.roomPrices, fields: { dormitory_id: dormitory?.id ?? "", room_number: updated.roomNumber } }));
    }
    if (resource === "beds") {
      const updated = await this.prisma.bed.update({ where: { id }, data: { ...("room_id" in body ? { roomId: requiredString(body.room_id, "ROOM_REQUIRED") } : {}), ...("bed_number" in body ? { bedNumber: Math.trunc(numberValue(body.bed_number, 1)) } : {}), ...(typeof body.active === "boolean" ? { active: body.active } : {}) }, include: { room: true, _count: { select: { housingReservations: true, housingFacts: true } } } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.bedNumber ? `${updated.bedNumber}-е койко-место` : "Койко-место", { subtitle: updated.room.roomNumber, active: updated.active, usageCount: updated._count.housingReservations + updated._count.housingFacts, fields: { room_id: updated.roomId, bed_number: updated.bedNumber ?? 1 } }));
    }
    if (resource === "priceList") {
      const updated = await this.prisma.priceList.update({ where: { id }, data: { ...("operation_id" in body ? { operationId: requiredString(body.operation_id, "OPERATION_REQUIRED") } : {}), ...("section_id" in body ? { sectionId: requiredString(body.section_id, "SECTION_REQUIRED") } : {}), ...("cost" in body ? { cost: numberValue(body.cost, 0) } : {}), ...("date_applyed" in body ? { dateApplied: optionalApiDate(body.date_applyed) ?? null } : {}) }, include: { operation: true, section: true } });
      return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.operation.name, { subtitle: updated.section.name, active: true, fields: { operation_id: updated.operationId, section_id: updated.sectionId, cost: updated.cost, date_applyed: updated.dateApplied ? formatApiDate(updated.dateApplied) : "" } }));
    }
    const updated = await this.prisma.roomPriceList.update({ where: { id }, data: { ...("room_id" in body ? { roomId: requiredString(body.room_id, "ROOM_REQUIRED") } : {}), ...("cost" in body ? { cost: numberValue(body.cost, 0) } : {}), ...("date_applyed" in body ? { dateApplied: optionalApiDate(body.date_applyed) ?? null } : {}) }, include: { room: true } });
    return dictionaryDelta("updated", resource, id, dictionaryItem(updated.id, updated.room.roomNumber, { active: true, fields: { room_id: updated.roomId, cost: updated.cost == null ? "" : Number(updated.cost), date_applyed: updated.dateApplied ? formatApiDate(updated.dateApplied) : "" } }));
  }

  private async deleteDictionaryItem(factoryId: string, resource: DictionaryResource, id: string): Promise<MutationDelta> {
    const usageCount = await this.dictionaryUsageCount(factoryId, resource, id);
    if (usageCount > 0 && supportsDictionaryArchive(resource)) {
      return this.updateDictionaryItem(factoryId, resource, id, { active: false });
    }
    if (usageCount > 0) {
      throw new BadRequestException({ code: "DICTIONARY_ITEM_USED", message: "Элемент используется и не может быть удален" });
    }
    if (resource === "employeeStatuses") await this.prisma.employeeStatus.delete({ where: { id } });
    else if (resource === "housingReservationStatuses") await this.prisma.housingReservationStatus.delete({ where: { id } });
    else if (resource === "housingFactStatuses") await this.prisma.housingFactStatus.delete({ where: { id } });
    else if (resource === "dormitories") { await this.requireFactoryDormitory(factoryId, id); await this.prisma.dormitory.delete({ where: { id } }); }
    else if (resource === "rooms") await this.prisma.room.delete({ where: { id } });
    else if (resource === "beds") await this.prisma.bed.delete({ where: { id } });
    else if (resource === "priceList") await this.prisma.priceList.delete({ where: { id } });
    else await this.prisma.roomPriceList.delete({ where: { id } });
    return { ok: true, action: "deleted", resource, id };
  }

  private async dictionaryUsageCount(factoryId: string, resource: DictionaryResource, id: string): Promise<number> {
    if (resource === "employeeStatuses") return this.prisma.employee.count({ where: { employeeStatusId: id } });
    if (resource === "housingReservationStatuses") return this.prisma.housingReservation.count({ where: { statusId: id } });
    if (resource === "housingFactStatuses") return this.prisma.housingFact.count({ where: { statusId: id } });
    if (resource === "dormitories") return this.prisma.roomsDormitory.count({ where: { dormitoryId: id, dormitory: { factoryId } } });
    if (resource === "rooms") return (await this.prisma.bed.count({ where: { roomId: id } })) + (await this.prisma.roomPriceList.count({ where: { roomId: id } }));
    if (resource === "beds") return (await this.prisma.housingReservation.count({ where: { bedId: id } })) + (await this.prisma.housingFact.count({ where: { bedId: id } }));
    return 0;
  }

  private async requireFactoryDormitory(factoryId: string, id: string) {
    const dormitory = await this.prisma.dormitory.findFirst({ where: { id, factoryId } });
    if (!dormitory) throwNotFound("dormitories", id);
    return dormitory;
  }

  private async importCompatEmployees(factoryId: string): Promise<void> {
    const records = await this.prisma.compatRecord.findMany({
      where: { factoryId, resource: "employees" }
    });
    if (!records.length) return;
    for (const record of records) {
      if (!isCompatData(record.data)) continue;
      const exists = await this.prisma.employee.findUnique({ where: { id: record.recordId } });
      if (exists) continue;
      const statusId = await this.resolveEmployeeStatusId(record.data.status);
      await this.prisma.employee.create({
        data: {
          id: record.recordId,
          fullName: stringValue(record.data.full_name) ?? "Новый сотрудник",
          ...employeeWriteInput(record.data, statusId)
        }
      });
    }
  }

  private async hydrateStore(factoryId: string, store: CompatStore): Promise<void> {
    for (const resource of persistedResources) {
      collectionFor(store, resource).clear();
    }
    store.settings = {};
    const records = await this.prisma.compatRecord.findMany({
      where: { factoryId }
    });
    for (const record of records) {
      if (record.resource === "settings" && isCompatData(record.data)) {
        store.settings = { ...record.data };
        continue;
      }
      if (!isPersistedResource(record.resource) || !isCompatData(record.data)) continue;
      collectionFor(store, record.resource).set(record.recordId, { id: record.recordId, ...record.data });
    }
  }

  private async persistCompatRecord(factoryId: string, resource: MutationResource, recordId: string, data: Record<string, unknown>): Promise<void> {
    if (resource !== "settings" && !isPersistedResource(resource)) return;
    await this.prisma.compatRecord.upsert({
      where: {
        factoryId_resource_recordId: {
          factoryId,
          resource,
          recordId
        }
      },
      update: {
        data: data as Prisma.InputJsonValue
      },
      create: {
        factoryId,
        resource,
        recordId,
        data: data as Prisma.InputJsonValue
      }
    });
  }

  private async deleteCompatRecord(factoryId: string, resource: MutationResource, recordId: string): Promise<void> {
    if (!isPersistedResource(resource)) return;
    await this.prisma.compatRecord.deleteMany({
      where: {
        factoryId,
        resource,
        recordId
      }
    });
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

  private async updatePlan(factoryId: string, id: string, body: Record<string, unknown>, roles: UserRole[], activeRole: UserRole): Promise<MutationDelta> {
    const existing = await this.requirePlanWithStatus(factoryId, id);
    const data: Record<string, unknown> = {};
    if ("start_date" in body) data.startDate = parseApiDate(requiredString(body.start_date, "START_DATE_REQUIRED"));
    if ("end_date" in body) data.endDate = parseApiDate(requiredString(body.end_date, "END_DATE_REQUIRED"));
    if ("status" in body || "status_code" in body) {
      const nextStatus = await this.requireStatusByInput(requiredString(body.status_code ?? body.status, "STATUS_REQUIRED"));
      assertPlanStatusTransition(existing.status, nextStatus, roles, activeRole);
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
    if ("plan_id" in body) {
      const targetPlan = await this.requirePlanWithStatus(factoryId, requiredString(body.plan_id, "PLAN_REQUIRED"));
      assertPlanStatusIn(targetPlan.status, ["draft"], "PLAN_OPERATION_TARGET_STATUS_LOCKED", "Строки можно переносить только в план со статусом «В доработке»");
      data.planId = targetPlan.id;
    }
    if ("section_id" in body) {
      data.territoryId = requiredString(body.section_id, "TERRITORY_REQUIRED");
      await this.requireActiveSection(factoryId, data.territoryId as string);
    }
    if ("operation_id" in body || "name" in body) data.operationId = await this.resolveOperationId(body);
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

  private async createEmployee(body: Record<string, unknown>): Promise<MutationDelta> {
    const statusId = await this.resolveEmployeeStatusId(body.status);
    const created = await this.prisma.employee.create({
      data: {
        id: stringValue(body.id) ?? randomUUID(),
        fullName: stringValue(body.full_name) ?? "Новый сотрудник",
        ...employeeWriteInput(body, statusId)
      },
      include: { status: true }
    });
    return {
      ok: true,
      action: "created",
      resource: "employees",
      id: created.id,
      data: mapEmployee(created),
      createdEmployeeId: created.id
    };
  }

  private async updateEmployee(id: string, body: Record<string, unknown>): Promise<MutationDelta> {
    await this.requireEmployee(id);
    const statusId = "status" in body ? await this.resolveEmployeeStatusId(body.status) : undefined;
    const updated = await this.prisma.employee.update({
      where: { id },
      data: employeeWriteInput(body, statusId),
      include: { status: true }
    });
    return {
      ok: true,
      action: "updated",
      resource: "employees",
      id,
      data: mapEmployee(updated)
    };
  }

  private async deleteEmployee(id: string): Promise<MutationDelta> {
    await this.requireEmployee(id);
    await this.prisma.employee.delete({ where: { id } });
    return {
      ok: true,
      action: "deleted",
      resource: "employees",
      id
    };
  }

  private async requireEmployee(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException({
        code: "EMPLOYEE_NOT_FOUND",
        message: "Сотрудник не найден"
      });
    }
    return employee;
  }

  private async resolveEmployeeStatusId(value: unknown): Promise<string | null> {
    const title = stringValue(value)?.trim();
    if (!title) return null;
    const existing = await this.prisma.employeeStatus.findFirst({
      where: { title }
    });
    if (existing) return existing.id;
    const created = await this.prisma.employeeStatus.create({
      data: {
        id: randomUUID(),
        title,
        active: true
      }
    });
    return created.id;
  }

  private async createSection(factoryId: string, body: Record<string, unknown>): Promise<MutationDelta> {
    const parentId = stringValue(body.parent_id);
    if (parentId) await this.requireActiveParentSection(factoryId, parentId);
    const created = await this.prisma.territoryTree.create({
      data: {
        id: stringValue(body.id) ?? randomUUID(),
        factoryId,
        parentId: parentId ?? null,
        name: requiredString(body.name, "TERRITORY_NAME_REQUIRED"),
        isFolder: typeof body.is_folder === "boolean" ? body.is_folder : false,
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
    const existing = await this.requireSection(factoryId, id);
    const parentId = "parent_id" in body ? stringValue(body.parent_id) ?? null : undefined;
    if (parentId) {
      if (parentId === id) {
        throw new BadRequestException({ code: "INVALID_PARENT", message: "Элемент не может быть родителем самому себе" });
      }
      await this.requireActiveParentSection(factoryId, parentId);
      await this.assertSectionParentDoesNotCreateCycle(factoryId, id, parentId);
    }
    if (body.is_folder === true && existing.isFolder === false) {
      const used = await this.prisma.planOperation.count({ where: { territoryId: id } });
      if (used > 0) {
        throw new BadRequestException({ code: "SECTION_USED_AS_ELEMENT", message: "Используемый в планах участок нельзя сделать папкой" });
      }
    }
    const updated = await this.prisma.territoryTree.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
        ...(typeof body.is_folder === "boolean" ? { isFolder: body.is_folder } : {}),
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
    const childCount = await this.prisma.territoryTree.count({ where: { factoryId, parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException({
        code: "SECTION_HAS_CHILDREN",
        message: "Сначала удалите или перенесите дочерние элементы"
      });
    }
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
    const parentId = stringValue(body.parent_id);
    const parent = parentId ? await this.requireActiveParentOperationCatalogItem(parentId) : null;
    const sectionId = stringValue(body.section_id) ?? parent?.sectionId ?? null;
    if (sectionId) await this.requireActiveSectionForCatalog(sectionId);
    const created = await this.prisma.operation.create({
      data: {
        id: stringValue(body.id) ?? randomUUID(),
        parentId: parentId ?? null,
        sectionId,
        name: requiredString(body.name, "OPERATION_NAME_REQUIRED"),
        isFolder: typeof body.is_folder === "boolean" ? body.is_folder : false,
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
    const existing = await this.requireOperationCatalogItem(id);
    const parentId = "parent_id" in body ? stringValue(body.parent_id) ?? null : undefined;
    let parentSectionId: string | null | undefined;
    if (parentId) {
      if (parentId === id) {
        throw new BadRequestException({ code: "INVALID_PARENT", message: "Элемент не может быть родителем самому себе" });
      }
      const parent = await this.requireActiveParentOperationCatalogItem(parentId);
      parentSectionId = parent.sectionId;
      await this.assertOperationParentDoesNotCreateCycle(id, parentId);
    }
    const sectionId = "section_id" in body ? stringValue(body.section_id) ?? null : parentSectionId;
    if (sectionId) await this.requireActiveSectionForCatalog(sectionId);
    if (body.is_folder === true && existing.isFolder === false) {
      const used = await this.prisma.planOperation.count({ where: { operationId: id } });
      if (used > 0) {
        throw new BadRequestException({ code: "OPERATION_USED_AS_ELEMENT", message: "Используемую в планах операцию нельзя сделать папкой" });
      }
    }
    const updated = await this.prisma.operation.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
        ...(sectionId !== undefined ? { sectionId } : {}),
        ...(typeof body.is_folder === "boolean" ? { isFolder: body.is_folder } : {}),
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
    const childCount = await this.prisma.operation.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException({
        code: "OPERATION_HAS_CHILDREN",
        message: "Сначала удалите или перенесите дочерние элементы"
      });
    }
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
    const operationId = stringValue(body.operation_id);
    if (operationId) {
      await this.requireActiveOperationCatalogItem(operationId);
      return operationId;
    }
    const name = requiredString(body.name, "OPERATION_REQUIRED");
    const sectionId = stringValue(body.section_id);
    const existing = await this.prisma.operation.findFirst({
      where: {
        name,
        sectionId: sectionId ?? null,
        active: true
      }
    });
    if (existing) return existing.id;
    const created = await this.prisma.operation.create({
      data: {
        name,
        sectionId: sectionId ?? null,
        active: true,
        isFolder: false
      }
    });
    return created.id;
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

  private async requireStatusByInput(input: string) {
    const code = statusCodeFromPlanTitle(input);
    const status = await this.prisma.planStatus.findFirst({ where: { OR: [{ code }, { title: input }] } });
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

  private async requireActiveParentSection(factoryId: string, id: string) {
    const section = await this.requireSection(factoryId, id);
    if (!section.active) {
      throw new BadRequestException({
        code: "INVALID_PARENT_SECTION",
        message: "Родителем может быть только активный элемент справочника"
      });
    }
    return section;
  }

  private async assertSectionParentDoesNotCreateCycle(factoryId: string, id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 256; depth += 1) {
      if (cursor === id) {
        throw new BadRequestException({ code: "HIERARCHY_CYCLE", message: "Нельзя перенести элемент внутрь собственного потомка" });
      }
      const parent: { parentId: string | null } | null = await this.prisma.territoryTree.findFirst({ where: { id: cursor, factoryId }, select: { parentId: true } });
      cursor = parent?.parentId ?? null;
    }
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

  private async requireActiveParentOperationCatalogItem(id: string) {
    const operation = await this.requireOperationCatalogItem(id);
    if (!operation.active) {
      throw new BadRequestException({
        code: "INVALID_PARENT_OPERATION",
        message: "Родителем может быть только активный элемент справочника"
      });
    }
    return operation;
  }

  private async requireActiveSectionForCatalog(id: string) {
    const section = await this.requireSectionForAnyFactory(id);
    if (!section.active) {
      throw new BadRequestException({
        code: "INACTIVE_PARENT_SECTION",
        message: "Операцию можно привязать только к активному узлу структуры"
      });
    }
    return section;
  }

  private async requireSectionForAnyFactory(id: string) {
    const section = await this.prisma.territoryTree.findUnique({ where: { id } });
    if (!section) {
      throw new BadRequestException({
        code: "SECTION_NOT_FOUND",
        message: "Узел структуры не найден"
      });
    }
    return section;
  }

  private async assertOperationParentDoesNotCreateCycle(id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 256; depth += 1) {
      if (cursor === id) {
        throw new BadRequestException({ code: "HIERARCHY_CYCLE", message: "Нельзя перенести элемент внутрь собственного потомка" });
      }
      const parent: { parentId: string | null } | null = await this.prisma.operation.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = parent?.parentId ?? null;
    }
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

function isFactoryPlannerOnly(roles: UserRole[]): boolean {
  return roles.length === 1 && roles[0] === "factoryPlanner";
}

function emptyDictionaries(): NonNullable<BootstrapData["dictionaries"]> {
  return {
    employeeStatuses: [],
    housingReservationStatuses: [],
    housingFactStatuses: [],
    dormitories: [],
    rooms: [],
    beds: [],
    priceList: [],
    roomPriceList: []
  };
}

type BootstrapPlanData = Pick<BootstrapData, "plans" | "sections" | "operationCatalog" | "operations">;

function filterPlanDataForAccess(planData: BootstrapPlanData, permissions: RoleAccess): BootstrapPlanData {
  const visiblePlans = planData.plans.filter((plan) => canReadPlan(plan, permissions));
  const visiblePlanIds = new Set(visiblePlans.map((plan) => plan.id));
  return {
    ...planData,
    plans: visiblePlans,
    operations: planData.operations.filter((operation) => visiblePlanIds.has(operation.plan_id))
  };
}

function canReadPlan(plan: BootstrapData["plans"][number], permissions: RoleAccess): boolean {
  const actions = permissions.actions;
  const canEditFactory = actions.includes("plans.factory.edit");
  const canEditHr = actions.includes("plans.hr.edit");
  const canEditOut = actions.includes("plans.out.edit");
  const canApproveOut = actions.includes("plans.out.approve");
  const statusCode = plan.status_code || statusCodeFromPlanTitle(plan.status);
  if (canEditFactory && plan.owner_role === "factory") return true;
  if (canEditHr && plan.owner_role === "factory" && statusCode !== "draft") return true;
  if (
    canEditOut &&
    plan.owner_role === "factory" &&
    ["received_by_outsourcer", "rejected", "on_approval", "approved"].includes(statusCode) &&
    planOutsourceNeed(plan) > 0
  ) {
    return true;
  }
  if (
    canApproveOut &&
    plan.owner_role === "factory" &&
    ["on_approval", "approved", "rejected"].includes(statusCode) &&
    planOutsourceNeed(plan) > 0
  ) {
    return true;
  }
  return actions.includes("plans.view") && !canEditFactory && !canEditHr && !canEditOut && !canApproveOut && plan.owner_role === "factory";
}

function planOutsourceNeed(plan: BootstrapData["plans"][number]): number {
  return Math.max(0, numberValue(plan.required_staff) - numberValue(plan.staff_count));
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
    "employee-statuses": "employeeStatuses",
    employeeStatuses: "employeeStatuses",
    "housing-reservation-statuses": "housingReservationStatuses",
    housingReservationStatuses: "housingReservationStatuses",
    "housing-fact-statuses": "housingFactStatuses",
    housingFactStatuses: "housingFactStatuses",
    dormitories: "dormitories",
    rooms: "rooms",
    beds: "beds",
    "price-list": "priceList",
    priceList: "priceList",
    "room-price-list": "roomPriceList",
    roomPriceList: "roomPriceList",
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

function isPersistedResource(resource: string): resource is PersistedResource {
  return persistedResources.has(resource as PersistedResource);
}

function isCompatData(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (isDictionaryResource(resource)) {
    throw new BadRequestException({
      code: "INVALID_MUTATION_RESOURCE",
      message: "Справочник хранится в базе"
    });
  }
  return store[resource];
}

function isDictionaryResource(resource: MutationResource): resource is DictionaryResource {
  return dictionaryResources.has(resource as DictionaryResource);
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
  if (resource === "sections" || resource === "operationCatalog") return ["admin.users.manage"];
  if (resource === "assignments") return ["plans.out.edit"];
  if (resource === "employees") return ["personnel.edit"];
  if (isDictionaryResource(resource)) {
    if (resource === "employeeStatuses") return ["personnel.edit"];
    if (resource === "housingReservationStatuses" || resource === "housingFactStatuses" || resource === "dormitories" || resource === "rooms" || resource === "beds" || resource === "roomPriceList") return ["housing.edit"];
    return ["admin.users.manage"];
  }
  if (resource === "reservations" || resource === "housingDorms" || resource === "settings") return ["housing.edit"];
  if (resource === "facts") return [actionForFactSide(resolveFactSide(body))];
  if (resource === "explanations") return [actionForFactSide(resolveExplanationSide(store, body))];
  return [];
}

function actionsForPlanUpdate(body: Record<string, unknown>): AccessAction[] {
  const actions = new Set<AccessAction>();
  if ("start_date" in body || "end_date" in body) actions.add("plans.factory.edit");
  if ("status" in body || "status_code" in body) {
    const statusCode = statusCodeFromPlanTitle(String(body.status_code ?? body.status ?? ""));
    if (statusCode === "submitted_to_hr") actions.add("plans.factory.edit");
    else if (statusCode === "received_by_outsourcer") actions.add("plans.hr.edit");
    else if (statusCode === "on_approval") actions.add("plans.out.edit");
    else if (statusCode === "approved" || statusCode === "rejected") actions.add("plans.out.approve");
    else if (statusCode === "draft") actions.add("plans.factory.edit");
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

function statusCodeFromPlanTitle(status: string): string {
  const aliases: Record<string, string> = {
    "В доработке": "draft",
    "У планировщика фабрики": "draft",
    "Отправлено": "submitted_to_hr",
    "У HR": "submitted_to_hr",
    "Получено": "received_by_outsourcer",
    "У аутсорсера": "received_by_outsourcer",
    "На согласовании": "on_approval",
    "У согласующего": "on_approval",
    "На очереди": "approved",
    "Утверждено": "approved",
    "У мастеров": "approved",
    "Не утверждено": "rejected",
    "У аутсорсера (доработка)": "rejected"
  };
  return aliases[status] || status;
}

function assertPlanStatusTransition(current: { code: string; title: string }, next: { code: string; title: string }, roles: UserRole[] = [], activeRole?: UserRole): void {
  if (current.code === next.code) return;
  const allowed: Record<string, string[]> = {
    draft: ["submitted_to_hr"],
    submitted_to_hr: ["received_by_outsourcer"],
    received_by_outsourcer: ["on_approval"],
    rejected: ["on_approval"],
    on_approval: ["approved", "rejected"],
    approved: []
  };
  if (!allowed[current.code]?.includes(next.code)) {
    throw new BadRequestException({
      code: "INVALID_PLAN_STATUS_TRANSITION",
      message: `Недопустимый переход статуса плана: ${current.title} -> ${next.title}`
    });
  }
  const requiredAction = actionForStatusTransition(next.code);
  if (requiredAction && activeRole && !accessForRole(activeRole).actions.includes(requiredAction)) {
    throw new ForbiddenException({
      code: "FORBIDDEN_ACTIVE_ROLE",
      message: "Активная роль не может выполнить этот переход статуса",
      activeRole,
      requiredAction
    });
  }
}

function actionForStatusTransition(nextStatusCode: string): AccessAction | null {
  if (nextStatusCode === "submitted_to_hr") return "plans.factory.edit";
  if (nextStatusCode === "received_by_outsourcer") return "plans.hr.edit";
  if (nextStatusCode === "on_approval") return "plans.out.edit";
  if (nextStatusCode === "approved" || nextStatusCode === "rejected") return "plans.out.approve";
  if (nextStatusCode === "draft") return "plans.factory.edit";
  return null;
}

function assertPlanOperationMutationStatus(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>, status: { code: string; title: string }, roles: UserRole[] = []): void {
  if (method === "POST" || method === "DELETE") {
    assertPlanStatusIn(status, ["draft"], "PLAN_OPERATION_STATUS_LOCKED", "Строки плана можно добавлять и удалять только в статусе «В доработке»");
    return;
  }

  if ("plan_id" in body || "name" in body || "operation_id" in body || "section_id" in body || "section_name" in body || "required_staff" in body) {
    assertPlanStatusIn(status, ["draft"], "PLAN_OPERATION_STATUS_LOCKED", "Фабричные поля строки плана можно менять только в статусе «В доработке»");
  }
  if ("staff_count" in body || "outsource_count" in body) {
    const permissions = accessForRoles(roles);
    const canEditDraftAsFactoryHr = status.code === "draft" && permissions.actions.includes("plans.factory.edit") && permissions.actions.includes("plans.hr.edit");
    if (!canEditDraftAsFactoryHr) {
      assertPlanStatusIn(status, ["submitted_to_hr"], "PLAN_OPERATION_STATUS_LOCKED", "HR-поля строки плана можно менять только до отправки аутсорсеру");
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
  if ("plan_id" in body || "name" in body || "operation_id" in body || "section_id" in body || "section_name" in body || "required_staff" in body) actions.add("plans.factory.edit");
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlanCellResource(resource: MutationResource): resource is "plans" | "operations" {
  return resource === "plans" || resource === "operations";
}

function normalizeAuditValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function readableAuditEntry(method: "POST" | "PUT" | "DELETE", resource: MutationResource, snapshot?: AuditSnapshot) {
  const resourceTitle = snapshot?.resourceTitle ?? auditResourceTitle(resource);
  const actionByMethod = {
    POST: `Создано: ${resourceTitle}`,
    PUT: `Изменено: ${resourceTitle}`,
    DELETE: `Удалено: ${resourceTitle}`
  };
  return {
    action: actionByMethod[method].slice(0, 64),
    details: {
      resource,
      resourceTitle,
      objectLabel: snapshot?.objectLabel,
      technicalAction: `${method} ${resource}`
    }
  };
}

function readablePlanCellAuditEntry(resource: "plans" | "operations", field: string, value: unknown, previous?: AuditSnapshot, next?: AuditSnapshot) {
  const fieldLabel = auditFieldLabel(field);
  const resourceTitle = next?.resourceTitle ?? previous?.resourceTitle ?? auditResourceTitle(resource);
  const newValue = normalizeAuditValue(value);
  const previousValue = normalizeAuditValue(previous?.values[field]);
  const nextValue = normalizeAuditValue(next?.values[field] ?? value);
  const previousValueLabel = auditValueLabel(field, previous?.values[field]);
  const newValueLabel = auditValueLabel(field, next?.values[field] ?? value);
  const summary = previous && previousValueLabel !== newValueLabel
    ? `${fieldLabel}: ${previousValueLabel} → ${newValueLabel}`
    : `${fieldLabel}: ${newValueLabel}`;
  const action = auditCellAction(resource, field, fieldLabel);
  return {
    action: action.slice(0, 64),
    details: {
      resource,
      resourceTitle,
      objectLabel: next?.objectLabel ?? previous?.objectLabel,
      field,
      fieldLabel,
      previousValue,
      previousValueLabel,
      newValue: nextValue ?? newValue,
      newValueLabel,
      summary,
      reason: auditReason(field, value),
      technicalAction: `PUT ${resource}.${field}`
    }
  };
}

function auditCellAction(resource: "plans" | "operations", field: string, fieldLabel: string): string {
  if (resource === "operations" && field === "plan_id") return "Строка плана перенесена в другой план";
  if (resource === "plans" && (field === "status" || field === "status_code")) return "Изменён статус плана";
  return `${auditResourceTitle(resource)}: изменено поле «${fieldLabel}»`;
}

function auditFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    start_date: "Дата начала",
    end_date: "Дата окончания",
    status: "Статус",
    status_code: "Статус",
    owner_role: "Ответственный",
    title: "Название",
    plan_id: "План",
    section_id: "Территория",
    section_name: "Территория",
    operation_id: "Операция",
    name: "Операция",
    required_staff: "Требуется персонала",
    staff_count: "Закрыто штатными",
    outsource_count: "Требуется аутсорсинг",
    hours_per_day: "Часов в день",
    rate_per_hour: "Ставка в час"
  };
  return labels[field] ?? field;
}

function auditResourceTitle(resource: MutationResource): string {
  const labels: Record<string, string> = {
    plans: "План",
    sections: "Территория",
    operationCatalog: "Операция в справочнике",
    operations: "Строка плана",
    employees: "Сотрудник",
    assignments: "Назначение сотрудника",
    reservations: "Бронирование жилья",
    housingDorms: "Общежитие",
    facts: "Факт",
    explanations: "Пояснение",
    settings: "Настройки",
    employeeStatuses: "Статус сотрудника",
    housingReservationStatuses: "Статус бронирования",
    housingFactStatuses: "Статус проживания",
    dormitories: "Общежитие",
    rooms: "Комната",
    beds: "Койко-место",
    priceList: "Прайс-лист",
    roomPriceList: "Прайс-лист жилья"
  };
  return labels[resource] ?? resource;
}

function auditValueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "не заполнено";
  if (field === "status" || field === "status_code") return auditPlanStatusLabel(String(value));
  if (field === "owner_role") return value === "factory" ? "Фабрика" : String(value);
  if (field === "section_id" || field === "operation_id") return "выбрано";
  if (field === "plan_id") return "перенесено в другой план";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function auditReason(field: string, value: unknown): string | undefined {
  if (field !== "status" && field !== "status_code") return undefined;
  const status = String(value ?? "");
  if (status === "rejected") return "План отклонён, причина указывается в комментарии к действию";
  if (status === "approved") return "План согласован";
  return undefined;
}

function auditPlanStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "В доработке у фабрики",
    submitted_to_hr: "Отправлен в HR",
    received_by_outsourcer: "Отправлен аутсорсеру",
    on_approval: "На согласовании",
    approved: "Согласован",
    rejected: "Отклонён"
  };
  return labels[status] ?? status;
}

function auditSnapshotFromDelta(resource: MutationResource, delta: MutationDelta): AuditSnapshot | undefined {
  if (!delta.data || typeof delta.data !== "object") return undefined;
  if (resource === "plans") return planAuditSnapshotFromRecord(delta.data as BootstrapData["plans"][number]);
  if (resource === "operations") return operationAuditSnapshotFromRecord(delta.data as BootstrapData["operations"][number]);
  return {
    resourceTitle: auditResourceTitle(resource),
    values: {}
  };
}

function planAuditSnapshotFromRecord(plan: BootstrapData["plans"][number]): AuditSnapshot {
  return {
    resourceTitle: auditResourceTitle("plans"),
    objectLabel: `План ${plan.start_date} - ${plan.end_date}`,
    values: {
      start_date: plan.start_date,
      end_date: plan.end_date,
      status: plan.status,
      status_code: plan.status_code ?? plan.status
    }
  };
}

function operationAuditSnapshotFromRecord(operation: BootstrapData["operations"][number]): AuditSnapshot {
  const staffCount = numberValue(operation.staff_count);
  return {
    resourceTitle: auditResourceTitle("operations"),
    objectLabel: operationAuditLabel({
      plan: null,
      territory: operation.section_name ? { name: operation.section_name } : null,
      operation: operation.name ? { name: operation.name } : null
    }),
    values: {
      plan_id: operation.plan_id,
      section_id: operation.section_name || "не заполнено",
      section_name: operation.section_name || "не заполнено",
      operation_id: operation.name || "не заполнено",
      name: operation.name || "не заполнено",
      required_staff: operation.required_staff,
      staff_count: staffCount,
      outsource_count: operation.outsource_count,
      hours_per_day: operation.hours_per_day,
      rate_per_hour: operation.rate_per_hour
    }
  };
}

function operationAuditLabel(operation: { plan?: { startDate: Date; endDate: Date } | null; territory?: { name: string } | null; operation?: { name: string } | null }): string {
  const parts = [
    operation.plan ? `план ${formatApiDate(operation.plan.startDate)} - ${formatApiDate(operation.plan.endDate)}` : "",
    operation.territory?.name ? `территория «${operation.territory.name}»` : "",
    operation.operation?.name ? `операция «${operation.operation.name}»` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Строка плана";
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

function dictionaryItem(id: string, title: string, options: { subtitle?: string | null; active?: boolean; usageCount?: number; fields?: Record<string, unknown> } = {}) {
  return {
    id,
    title,
    subtitle: options.subtitle ?? undefined,
    active: options.active ?? true,
    usageCount: options.usageCount ?? 0,
    fields: options.fields
  };
}

function dictionaryDelta(action: "created" | "updated", resource: DictionaryResource, id: string, data: unknown): MutationDelta {
  return { ok: true, action, resource, id, data };
}

function statusDictionaryWrite(body: Record<string, unknown>) {
  return {
    ...(typeof (body.title ?? body.name) === "string" ? { title: requiredString(body.title ?? body.name, "TITLE_REQUIRED") } : {}),
    ...(typeof body.active === "boolean" ? { active: body.active } : {})
  };
}

function finalStatusDictionaryWrite(body: Record<string, unknown>) {
  return {
    ...statusDictionaryWrite(body),
    ...("is_final" in body ? { isFinal: Boolean(body.is_final) } : {})
  };
}

function supportsDictionaryArchive(resource: DictionaryResource) {
  return resource !== "priceList" && resource !== "roomPriceList";
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

function optionalApiDate(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  const normalized = stringValue(value);
  return normalized ? parseApiDate(normalized) : undefined;
}

function employeeWriteInput(body: Record<string, unknown>, statusId?: string | null): EmployeeWriteData {
  const data: EmployeeWriteData = {};
  if ("full_name" in body) data.fullName = stringValue(body.full_name) ?? "Новый сотрудник";
  if ("country" in body) data.country = stringValue(body.country) ?? null;
  if ("age" in body) data.age = Math.trunc(numberValue(body.age, 0)) || null;
  if (statusId !== undefined) data.employeeStatusId = statusId;
  if ("phone" in body) data.phone = stringValue(body.phone) ?? null;
  if ("email" in body) data.email = stringValue(body.email) ?? null;
  if ("birth_date" in body) data.birthDate = optionalApiDate(body.birth_date);
  if ("passport_no" in body) data.passportNo = stringValue(body.passport_no) ?? null;
  if ("passport_issued" in body) data.passportIssued = stringValue(body.passport_issued) ?? null;
  if ("registration" in body) data.registration = stringValue(body.registration) ?? null;
  if ("needs_housing" in body) data.needsHousing = Boolean(numberValue(body.needs_housing, body.needs_housing ? 1 : 0));
  if ("needs_registration" in body) data.needsRegistration = Boolean(numberValue(body.needs_registration, body.needs_registration ? 1 : 0));
  if ("driver_categories" in body) data.driverCategories = stringValue(body.driver_categories) ?? null;
  return data;
}

function mapEmployee(employee: {
  id: string;
  fullName: string;
  country: string | null;
  age: number | null;
  status: { title: string } | null;
  phone: string | null;
  email: string | null;
  birthDate: Date | null;
  passportNo: string | null;
  passportIssued: string | null;
  registration: string | null;
  needsHousing: boolean;
  needsRegistration: boolean;
  driverCategories: string | null;
}): BootstrapData["employees"][number] {
  return {
    id: employee.id,
    full_name: employee.fullName,
    country: employee.country ?? undefined,
    age: employee.age ?? undefined,
    status: employee.status?.title ?? "В резерве",
    phone: employee.phone ?? undefined,
    email: employee.email ?? undefined,
    birth_date: employee.birthDate ? formatApiDate(employee.birthDate) : undefined,
    passport_no: employee.passportNo ?? undefined,
    passport_issued: employee.passportIssued ?? undefined,
    registration: employee.registration ?? undefined,
    needs_housing: employee.needsHousing ? 1 : 0,
    needs_registration: employee.needsRegistration ? 1 : 0,
    driver_categories: employee.driverCategories ?? undefined
  };
}

function mapPlan(plan: {
  id: string;
  startDate: Date;
  endDate: Date;
  status: { code: string; title: string };
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
    status_code: plan.status.code,
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

function mapSection(section: { id: string; factoryId: string; parentId: string | null; name: string; isFolder: boolean | null; active: boolean; _count?: { planOperations: number } }, index: number) {
  return {
    id: section.id,
    factory_id: section.factoryId,
    parent_id: section.parentId,
    name: section.name,
    order: index + 1,
    is_folder: Boolean(section.isFolder),
    active: section.active,
    operation_count: section._count?.planOperations ?? 0
  };
}

function mapOperationCatalogItem(operation: { id: string; parentId: string | null; sectionId: string | null; name: string; isFolder: boolean; active: boolean; _count?: { planOperations: number } }) {
  return {
    id: operation.id,
    parent_id: operation.parentId,
    section_id: operation.sectionId,
    name: operation.name,
    is_folder: operation.isFolder,
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
