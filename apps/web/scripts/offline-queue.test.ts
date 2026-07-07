import { strict as assert } from "node:assert";
import type { BootstrapData } from "../src/api/client.ts";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => "queued-mutation-1" },
  configurable: true
});

const { api, clearAuthTokens, pendingMutationCount, writeBootstrapCache } = await import("../src/api/client.ts");

const cached: BootstrapData = {
  plans: [],
  sections: [],
  operations: [],
  employees: [{
    id: "employee-1",
    full_name: "Employee One",
    status: "active",
    phone: "+7 000 000-00-00",
    email: "employee@example.com",
    passport_no: "1234 567890",
    registration: "Registration address"
  }],
  employeeBusy: [],
  assignments: [],
  reservations: [],
  housingDorms: [],
  housingPlaces: [],
  facts: [],
  explanations: [],
  summary: {
    totalBeds: 0,
    occupiedBeds: 0,
    freeBeds: 0,
    personnelToSettle: 0
  }
};

await writeBootstrapCache(cached);
const queuedWithCache = await api.mutate("/assignments", "POST", {
  plan_id: "plan-1",
  operation_id: "operation-1",
  employee_id: "employee-1"
});

assert.equal(await pendingMutationCount(), 1);
assert.equal("pendingMutations" in queuedWithCache, true);
assert.equal(queuedWithCache.pendingMutations, 1);
assert.equal(queuedWithCache.employees[0].phone, undefined);
assert.equal(queuedWithCache.employees[0].email, undefined);
assert.equal(queuedWithCache.employees[0].passport_no, undefined);
assert.equal(queuedWithCache.employees[0].registration, undefined);
assert.equal(localStorage.getItem("reft-web-bootstrap-cache-v1"), null);
assert.equal(localStorage.getItem("reft-web-mutation-queue-v1"), null);

clearAuthTokens();
assert.equal(await pendingMutationCount(), 0);

await assert.rejects(api.mutate("/assignments", "POST", {
  plan_id: "plan-1",
  operation_id: "operation-1",
  employee_id: "employee-1"
}), Error);
assert.equal(await pendingMutationCount(), 1);
assert.equal(localStorage.getItem("reft-web-mutation-queue-v1"), null);

clearAuthTokens();
assert.equal(await pendingMutationCount(), 0);
