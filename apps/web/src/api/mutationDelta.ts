import type {
  Assignment,
  BootstrapData,
  BootstrapPageName,
  Dormitory,
  Employee,
  EmployeeBusy,
  Explanation,
  FactEntry,
  HousingPlace,
  MutationDelta,
  Operation,
  OperationCatalogItem,
  Plan,
  Reservation,
  Room,
  Section
} from "@reftinskaya/contracts";
export type { MutationDelta } from "@reftinskaya/contracts";

function activeReservation(status?: string) {
  return !["Выехал", "Отменено"].includes(status || "");
}

function housingBlockName(room: number) {
  return `Этаж ${Math.max(1, Math.ceil(room / 10))}`;
}

function dormRooms(dorm: Dormitory): Array<Pick<Room, "id" | "block" | "number" | "beds" | "order">> {
  if (dorm.rooms?.length) return dorm.rooms;
  return Array.from({ length: Math.max(1, dorm.room_count) }, (_, index) => {
    const roomNumber = index + 1;
    return {
      id: "",
      block: housingBlockName(roomNumber),
      number: `Комната № ${roomNumber}`,
      beds: Math.max(1, dorm.beds_per_room),
      order: roomNumber
    };
  });
}

function dormTotalBeds(dorm: Dormitory) {
  return dormRooms(dorm).reduce((sum, room) => sum + Math.max(1, room.beds), 0);
}

function calculateOutsource(required: unknown, staff: unknown) {
  return Math.max(0, Number(required || 0) - Number(staff || 0));
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [item, ...items];
}

function appendOrUpdateById<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [...items, item];
}

function applyRelatedEmployee(data: BootstrapData, related?: Record<string, unknown>) {
  const employee = related?.employee as Employee | undefined;
  if (!employee?.id) return data;
  return { ...data, employees: upsertById(data.employees, employee) };
}

function relatedStringSet(related: Record<string, unknown> | undefined, key: string) {
  const value = related?.[key];
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.map((item) => String(item)).filter(Boolean));
}

function matchesHousingPlace(place: Pick<HousingPlace, "room_id" | "bed_number" | "dorm" | "room" | "bed">, reservation: Reservation) {
  if (place.room_id && reservation.room_id) {
    return reservation.room_id === place.room_id && reservation.bed_number === place.bed_number;
  }
  return reservation.dorm === place.dorm && reservation.room === place.room && reservation.bed === place.bed;
}

function rebuildHousingPlaces(dorms: Dormitory[], reservations: Reservation[]) {
  const places: HousingPlace[] = [];
  for (const dorm of dorms) {
    for (const room of dormRooms(dorm)) {
      for (let bed = 1; bed <= Math.max(1, room.beds); bed += 1) {
        const bedName = `${bed}-е койко-место`;
        const place = {
          dorm_id: dorm.id,
          room_id: room.id || undefined,
          bed_number: bed,
          dorm: dorm.name,
          block: room.block || "Без блока",
          room: room.number,
          bed: bedName,
          label: `${dorm.name}, ${room.number}, ${bedName}`
        };
        places.push({
          ...place,
          reservation: reservations.find((reservation) => matchesHousingPlace(place, reservation) && activeReservation(reservation.status))
        });
      }
    }
  }
  return places;
}

function recalculateDerived(data: BootstrapData, pendingMutations: number) {
  const operations = data.operations.map((operation) => ({
    ...operation,
    assigned_count: data.assignments.filter((assignment) => assignment.operation_id === operation.id).length
  }));
  const plans = data.plans.map((plan) => {
    const rows = operations.filter((operation) => operation.plan_id === plan.id);
    const required_staff = rows.reduce((sum, operation) => sum + operation.required_staff, 0);
    const staff_count = rows.reduce((sum, operation) => sum + operation.staff_count, 0);
    return {
      ...plan,
      required_staff,
      staff_count,
      outsource_count: calculateOutsource(required_staff, staff_count)
    };
  });
  const housingPlaces = rebuildHousingPlaces(data.housingDorms, data.reservations);
  const totalBeds = data.housingDorms.reduce((sum, dorm) => sum + dormTotalBeds(dorm), 0);
  const occupiedBeds = data.reservations.filter((reservation) => activeReservation(reservation.status)).length;
  return {
    ...data,
    sections: data.sections || [],
    employeeBusy: data.employeeBusy || [],
    plans,
    operations,
    housingPlaces,
    summary: {
      totalBeds,
      occupiedBeds,
      freeBeds: Math.max(totalBeds - occupiedBeds, 0),
      personnelToSettle: data.employees.filter((employee) => employee.needs_housing).length
    },
    pendingMutations
  };
}

export function applyMutationDelta(current: BootstrapData, delta: MutationDelta, pendingMutations = 0): BootstrapData {
  let next: BootstrapData = { ...current };
  const id = delta.id;

  if (delta.resource === "plans") {
    if (delta.action === "deleted" && id) {
      const factIds = new Set(next.facts.filter((fact) => fact.plan_id === id).map((fact) => fact.id));
      const assignmentIds = new Set(next.assignments.filter((assignment) => assignment.plan_id === id).map((assignment) => assignment.id));
      for (const assignmentId of relatedStringSet(delta.related, "assignmentIds")) assignmentIds.add(assignmentId);
      const employeeBusyRefIds = relatedStringSet(delta.related, "employeeBusyRefIds");
      for (const assignmentId of assignmentIds) employeeBusyRefIds.add(assignmentId);
      next = {
        ...next,
        plans: next.plans.filter((plan) => plan.id !== id),
        operations: next.operations.filter((operation) => operation.plan_id !== id),
        assignments: next.assignments.filter((assignment) => assignment.plan_id !== id),
        employeeBusy: (next.employeeBusy || []).filter((busy) => !employeeBusyRefIds.has(String(busy.ref_id || ""))),
        facts: next.facts.filter((fact) => fact.plan_id !== id),
        explanations: next.explanations.filter((explanation) => !factIds.has(explanation.fact_entry_id))
      };
    } else if (delta.data) {
      next = { ...next, plans: upsertById(next.plans, delta.data as Plan) };
      const relatedOperations = delta.related?.operations;
      if (Array.isArray(relatedOperations)) {
        const operations = relatedOperations as Operation[];
        next = {
          ...next,
          operations: [...operations, ...next.operations.filter((operation) => !operations.some((item) => item.id === operation.id))]
        };
      }
    }
  }

  if (delta.resource === "sections") {
    if (delta.action === "deleted" && id) {
      next = { ...next, sections: (next.sections || []).filter((section) => section.id !== id) };
    } else if (delta.data) {
      const section = delta.data as Section;
      const relatedOperations = delta.related?.operations;
      next = {
        ...next,
        sections: upsertById(next.sections || [], section),
        operations: next.operations.map((operation) => operation.section_id === section.id
          ? { ...operation, section_name: section.name, section_order: section.order }
          : operation)
      };
      if (Array.isArray(relatedOperations)) {
        const operations = relatedOperations as Operation[];
        next = {
          ...next,
          operations: [...operations, ...next.operations.filter((operation) => !operations.some((item) => item.id === operation.id))]
        };
      }
    }
  }

  if (delta.resource === "operationCatalog") {
    if (delta.action === "deleted" && id) {
      next = { ...next, operationCatalog: (next.operationCatalog || []).filter((operation) => operation.id !== id) };
    } else if (delta.data) {
      const catalogItem = delta.data as OperationCatalogItem;
      next = {
        ...next,
        operationCatalog: upsertById(next.operationCatalog || [], catalogItem),
        operations: next.operations.map((operation) => operation.operation_id === catalogItem.id
          ? { ...operation, name: catalogItem.name }
          : operation)
      };
    }
  }

  if (delta.resource === "operations") {
    if (delta.action === "deleted" && id) {
      const factIds = new Set(next.facts.filter((fact) => fact.operation_id === id).map((fact) => fact.id));
      const assignmentIds = new Set(next.assignments.filter((assignment) => assignment.operation_id === id).map((assignment) => assignment.id));
      for (const assignmentId of relatedStringSet(delta.related, "assignmentIds")) assignmentIds.add(assignmentId);
      const employeeBusyRefIds = relatedStringSet(delta.related, "employeeBusyRefIds");
      for (const assignmentId of assignmentIds) employeeBusyRefIds.add(assignmentId);
      next = {
        ...next,
        operations: next.operations.filter((operation) => operation.id !== id),
        assignments: next.assignments.filter((assignment) => assignment.operation_id !== id),
        employeeBusy: (next.employeeBusy || []).filter((busy) => !employeeBusyRefIds.has(String(busy.ref_id || ""))),
        facts: next.facts.filter((fact) => fact.operation_id !== id),
        explanations: next.explanations.filter((explanation) => !factIds.has(explanation.fact_entry_id))
      };
    } else if (delta.data) {
      next = { ...next, operations: appendOrUpdateById(next.operations, delta.data as Operation) };
    }
  }

  if (delta.resource === "employees") {
    if (delta.action === "deleted" && id) {
      next = {
        ...next,
        employees: next.employees.filter((employee) => employee.id !== id),
        assignments: next.assignments.filter((assignment) => assignment.employee_id !== id),
        reservations: next.reservations.filter((reservation) => reservation.employee_id !== id),
        facts: next.facts.filter((fact) => fact.employee_id !== id),
        employeeBusy: (next.employeeBusy || []).filter((busy) => busy.employee_id !== id)
      };
    } else if (delta.data) {
      next = { ...next, employees: upsertById(next.employees, delta.data as Employee) };
    }
  }

  if (delta.resource === "assignments") {
    if (delta.action === "deleted" && id) {
      const busyRefId = delta.related?.employeeBusyRefId as string | undefined;
      next = {
        ...next,
        assignments: next.assignments.filter((assignment) => assignment.id !== id),
        employeeBusy: (next.employeeBusy || []).filter((busy) => busy.ref_id !== (busyRefId || id))
      };
    } else if (delta.data) {
      next = { ...next, assignments: upsertById(next.assignments, delta.data as Assignment) };
      const busy = delta.related?.employeeBusy as EmployeeBusy | undefined;
      if (busy?.id) next = { ...next, employeeBusy: upsertById(next.employeeBusy || [], busy) };
    }
    next = applyRelatedEmployee(next, delta.related);
  }

  if (delta.resource === "housingDorms") {
    if (delta.action === "deleted" && id) {
      next = { ...next, housingDorms: next.housingDorms.filter((dorm) => dorm.id !== id) };
    } else if (delta.data) {
      const dorm = delta.data as Dormitory;
      const roomsById = new Map((dorm.rooms || []).map((room) => [room.id, room]));
      next = {
        ...next,
        housingDorms: upsertById(next.housingDorms, dorm),
        reservations: next.reservations.map((reservation) => {
          const room = reservation.room_id ? roomsById.get(reservation.room_id) : undefined;
          return room
            ? { ...reservation, dorm: dorm.name, room: room.number }
            : reservation;
        })
      };
    }
  }

  if (next.dictionaries && delta.resource in next.dictionaries) {
    const resource = delta.resource as keyof NonNullable<BootstrapData["dictionaries"]>;
    const collection = next.dictionaries[resource];
    next = {
      ...next,
      dictionaries: {
        ...next.dictionaries,
        [resource]: delta.action === "deleted" && id
          ? collection.filter((item) => item.id !== id)
          : delta.data
            ? upsertById(collection, delta.data as (typeof collection)[number])
            : collection
      }
    };
  }

  if (delta.resource === "reservations") {
    if (delta.action === "deleted" && id) {
      next = { ...next, reservations: next.reservations.filter((reservation) => reservation.id !== id) };
    } else if (delta.data) {
      next = { ...next, reservations: upsertById(next.reservations, delta.data as Reservation) };
    }
  }

  if (delta.resource === "facts") {
    if (delta.action === "deleted" && id) {
      next = {
        ...next,
        facts: next.facts.filter((fact) => fact.id !== id),
        explanations: next.explanations.filter((explanation) => explanation.fact_entry_id !== id)
      };
    } else if (delta.data) {
      next = { ...next, facts: upsertById(next.facts, delta.data as FactEntry) };
    }
  }

  if (delta.resource === "explanations" && delta.data) {
    next = { ...next, explanations: upsertById(next.explanations, delta.data as Explanation) };
  }

  if (delta.resource === "settings" && delta.data) {
    next = { ...next, settings: { ...(next.settings || {}), ...(delta.data as BootstrapData["settings"]) } };
  }

  return recalculateDerived({
    ...next,
    createdPlanId: delta.createdPlanId,
    createdEmployeeId: delta.createdEmployeeId,
    selectedDormId: delta.selectedDormId
  }, pendingMutations);
}

function mergeById<T extends { id: string }>(current: T[], page: T[]) {
  return [...current, ...page.filter((item) => !current.some((existing) => existing.id === item.id))];
}

export function mergeBootstrapPage(current: BootstrapData, page: BootstrapData, collection: BootstrapPageName): BootstrapData {
  const next = {
    ...current,
    scope: page.scope || current.scope,
    pagination: page.pagination || current.pagination,
    pendingMutations: page.pendingMutations ?? current.pendingMutations,
    plans: page.plans,
    sections: page.sections || current.sections || [],
    employeeBusy: page.employeeBusy || current.employeeBusy || [],
    operations: page.operations,
    assignments: page.assignments,
    housingDorms: page.housingDorms,
    employees: collection === "employees" ? mergeById(current.employees, page.employees) : current.employees,
    facts: collection === "facts" ? mergeById(current.facts, page.facts) : current.facts,
    explanations: collection === "facts" ? mergeById(current.explanations, page.explanations) : current.explanations,
    reservations: collection === "reservations" ? mergeById(current.reservations, page.reservations) : current.reservations
  };
  return recalculateDerived(next, next.pendingMutations || 0);
}
