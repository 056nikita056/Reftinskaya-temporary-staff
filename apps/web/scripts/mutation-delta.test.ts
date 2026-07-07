import { strict as assert } from "node:assert";
import type { BootstrapData, Operation } from "../src/api/client";
import { applyMutationDelta, mergeBootstrapPage, type MutationDelta } from "../src/api/mutationDelta.ts";

const base: BootstrapData = {
  plans: [{
    id: "plan-1",
    owner_role: "factory",
    start_date: "18.06.2026",
    end_date: "19.06.2026",
    status: "В доработке",
    title: "План",
    required_staff: 1,
    staff_count: 0,
    outsource_count: 1
  }],
  sections: [],
  operations: [{
    id: "operation-1",
    plan_id: "plan-1",
    section_name: "Линия",
    section_order: 1,
    name: "Упаковка",
    required_staff: 1,
    staff_count: 0,
    outsource_count: 1,
    hours_per_day: 8,
    rate_per_hour: 300,
    assigned_count: 0
  }],
  employees: [{
    id: "employee-1",
    full_name: "Иванов Иван",
    country: "Россия",
    age: 31,
    status: "В резерве",
    needs_housing: 1
  }],
  assignments: [],
  employeeBusy: [],
  reservations: [],
  housingDorms: [{
    id: "dorm-1",
    name: "Общежитие № 1",
    room_count: 2,
    beds_per_room: 1,
    rooms: [
      { id: "room-1", dormitory_id: "dorm-1", block: "Этаж 1", number: "Комната № 1", beds: 2, order: 1 },
      { id: "room-2", dormitory_id: "dorm-1", block: "Этаж 1", number: "Комната № 2", beds: 1, order: 2 }
    ],
    sort_order: 1
  }],
  housingPlaces: [],
  facts: [{
    id: "fact-1",
    plan_id: "plan-1",
    operation_id: "operation-1",
    employee_id: "employee-1",
    side: "factory",
    work_date: "18.06.2026",
    operation_done: 0,
    start_done: 0,
    end_done: 0,
    penalty: 0,
    started_at: "",
    ended_at: ""
  }],
  explanations: [{
    id: "explanation-1",
    fact_entry_id: "fact-1",
    author_name: "Мастер",
    author_role: "Мастер фабрики",
    text: "Пояснение",
    created_at: "18.06.2026"
  }],
  settings: { defaultReservationCost: 30000 },
  summary: {
    totalBeds: 0,
    occupiedBeds: 0,
    freeBeds: 0,
    personnelToSettle: 0
  }
};

const updatedOperation: Operation = {
  ...base.operations[0],
  required_staff: 5,
  staff_count: 3,
  outsource_count: 2
};

const afterOperation = applyMutationDelta(base, {
  ok: true,
  action: "updated",
  resource: "operations",
  id: updatedOperation.id,
  data: updatedOperation
});

assert.equal(afterOperation.operations[0].required_staff, 5);
assert.equal(afterOperation.plans[0].required_staff, 5);
assert.equal(afterOperation.plans[0].staff_count, 3);
assert.equal(afterOperation.plans[0].outsource_count, 2);

const afterSection = applyMutationDelta(afterOperation, {
  ok: true,
  action: "created",
  resource: "sections",
  id: "section-1",
  data: {
    id: "section-1",
    factory_id: "reftinskaya-main",
    name: "Погрузка",
    order: 1,
    active: true,
    operation_count: 0
  }
});

assert.equal(afterSection.sections.length, 1);
assert.equal(afterSection.sections[0].name, "Погрузка");

const afterSettings = applyMutationDelta(afterSection, {
  ok: true,
  action: "updated",
  resource: "settings",
  id: "reftinskaya-main",
  data: { defaultReservationCost: 2500 }
});

assert.equal(afterSettings.settings?.defaultReservationCost, 2500);

const assignmentDelta: MutationDelta = {
  ok: true,
  action: "created",
  resource: "assignments",
  id: "assignment-1",
  data: {
    id: "assignment-1",
    plan_id: "plan-1",
    operation_id: "operation-1",
    employee_id: "employee-1",
    status: "Назначен"
  },
  related: {
    employee: { ...base.employees[0], status: "В плане" },
    employeeBusy: {
      id: "busy-1",
      employee_id: "employee-1",
      start_at: "18.06.2026",
      end_at: "19.06.2026",
      source: "plan",
      ref_id: "assignment-1"
    }
  }
};

const afterAssignment = applyMutationDelta(afterSettings, assignmentDelta);
assert.equal(afterAssignment.assignments.length, 1);
assert.equal(afterAssignment.employeeBusy.length, 1);
assert.equal(afterAssignment.operations[0].assigned_count, 1);
assert.equal(afterAssignment.employees[0].status, "В плане");

const afterReservation = applyMutationDelta(afterAssignment, {
  ok: true,
  action: "created",
  resource: "reservations",
  id: "reservation-1",
  data: {
    id: "reservation-1",
    employee_id: "employee-1",
    employee_name: "Иванов Иван",
    room_id: "room-1",
    bed_number: 1,
    dorm: "Общежитие № 1",
    room: "Комната № 1",
    bed: "1-е койко-место",
    check_in: "18.06.2026",
    check_out: "19.06.2026",
    cost: 30000,
    comment: "",
    status: "Заехал"
  }
});

assert.equal(afterReservation.summary.totalBeds, 3);
assert.equal(afterReservation.summary.occupiedBeds, 1);
assert.equal(afterReservation.summary.freeBeds, 2);
assert.equal(afterReservation.housingPlaces[0].room_id, "room-1");
assert.equal(afterReservation.housingPlaces[0].bed_number, 1);
assert.equal(afterReservation.housingPlaces[0].block, "Этаж 1");
assert.equal(afterReservation.housingPlaces[0].reservation?.id, "reservation-1");

const afterDeleteOperation = applyMutationDelta(afterReservation, {
  ok: true,
  action: "deleted",
  resource: "operations",
  id: "operation-1",
  related: {
    assignmentIds: ["assignment-1"],
    employeeBusyRefIds: ["assignment-1"],
    planId: "plan-1"
  }
});

assert.equal(afterDeleteOperation.operations.length, 0);
assert.equal(afterDeleteOperation.assignments.length, 0);
assert.equal(afterDeleteOperation.employeeBusy.length, 0);
assert.equal(afterDeleteOperation.facts.length, 0);
assert.equal(afterDeleteOperation.explanations.length, 0);

const partialPlanState: BootstrapData = {
  ...afterReservation,
  assignments: [],
  employeeBusy: [{
    id: "busy-orphan-local",
    employee_id: "employee-1",
    start_at: "18.06.2026",
    end_at: "19.06.2026",
    source: "plan",
    ref_id: "assignment-from-server"
  }]
};

const afterDeletePlanWithRelatedIds = applyMutationDelta(partialPlanState, {
  ok: true,
  action: "deleted",
  resource: "plans",
  id: "plan-1",
  related: {
    assignmentIds: ["assignment-from-server"],
    employeeBusyRefIds: ["assignment-from-server"]
  }
});

assert.equal(afterDeletePlanWithRelatedIds.plans.length, 0);
assert.equal(afterDeletePlanWithRelatedIds.employeeBusy.length, 0);

const mergedEmployees = mergeBootstrapPage(base, {
  ...base,
  employees: [{ id: "employee-2", full_name: "Петров Петр", status: "В резерве" }],
  pagination: {
    employees: { take: 1 },
    facts: { take: 1 },
    reservations: { take: 1 }
  }
}, "employees");

assert.equal(mergedEmployees.employees.length, 2);
assert.equal(mergedEmployees.employees.some((employee) => employee.id === "employee-2"), true);
assert.equal(mergedEmployees.facts.length, base.facts.length);
