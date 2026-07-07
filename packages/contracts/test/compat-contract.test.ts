import type { BootstrapData, HousingPlace, MutationDelta } from "../src";

const occupiedPlace = {
  dorm_id: "dorm-1",
  room_id: "room-1",
  bed_number: 1,
  dorm: "Dorm",
  block: "Block 1",
  room: "Room 1",
  bed: "Bed 1",
  label: "Dorm, Room 1, Bed 1",
  reservation: {
    room_id: "room-1",
    bed_number: 1,
    dorm: "Dorm",
    room: "Room 1",
    bed: "Bed 1",
    status: "Заехал"
  }
} satisfies HousingPlace;

const bootstrap = {
  plans: [],
  sections: [],
  operations: [],
  employees: [],
  employeeBusy: [],
  assignments: [],
  reservations: [],
  housingDorms: [],
  housingPlaces: [occupiedPlace],
  facts: [],
  explanations: [],
  settings: { defaultReservationCost: 30000 },
  summary: {
    totalBeds: 1,
    occupiedBeds: 1,
    freeBeds: 0,
    personnelToSettle: 0
  },
  pagination: {
    employees: { take: 250 },
    facts: { take: 250 },
    reservations: { take: 250 }
  }
} satisfies BootstrapData;

const delta = {
  ok: true,
  action: "created",
  resource: "employees",
  id: "employee-1",
  createdEmployeeId: "employee-1"
} satisfies MutationDelta;

void bootstrap;
void delta;
