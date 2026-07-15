import type {
  AdminUserRow,
  BootstrapData,
  BootstrapQuery,
  CurrentUserProfile,
  Factory,
  LoginResponse,
  MutationDelta,
  NotificationItem,
  RequestFactAnalyticsData,
  RequestFactAnalyticsQuery
} from "@reftinskaya/contracts";
import {
  ACCESS_POLICY,
  USER_ROLES,
  accessForRole,
  roleHasAction,
  roleHasModule
} from "@reftinskaya/contracts";
export type {
  AccessAction,
  AccessModule,
  AdminUserRow,
  Assignment,
  BootstrapData,
  BootstrapPageName,
  BootstrapQuery,
  CurrentUser,
  CurrentUserProfile,
  DictionaryItem,
  Dormitory,
  Employee,
  EmployeeBusy,
  Explanation,
  Factory,
  FactEntry,
  HousingPlace,
  LoginResponse,
  MutationDelta,
  NotificationItem,
  Operation,
  OperationCatalogItem,
  Plan,
  RequestFactAnalyticsData,
  RequestFactAnalyticsQuery,
  RequestFactAnalyticsRow,
  Reservation,
  Room,
  RoleAccess,
  Section,
  RoleKey
} from "@reftinskaya/contracts";
export { ACCESS_POLICY, USER_ROLES, accessForRole, roleHasAction, roleHasModule };

const viteEnv = import.meta.env ?? {};
const API_BASE = viteEnv.VITE_API_BASE_URL || "/api/v1";
const COMPAT_API_BASE = viteEnv.VITE_COMPAT_API_BASE_URL || `${API_BASE}/compat`;
const LEGACY_TOKEN_STORAGE_KEY = "reft-web-token-v1";
const TOKEN_STORAGE_KEY = "reft-web-auth-tokens-v1";
const AUTH_STATE_KEY = "reft-web-auth-v1";
const BOOTSTRAP_CACHE_KEY = "reft-web-bootstrap-cache-v1";
const MUTATION_QUEUE_KEY = "reft-web-mutation-queue-v1";
const OFFLINE_DB_NAME = "reft-web-offline-v1";
const OFFLINE_STORE_NAME = "records";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type MutateResult = BootstrapData | MutationDelta;

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
};

type QueuedMutation = {
  id: string;
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
  createdAt: string;
};

let memoryTokens: StoredTokens | null = null;
let storageNamespace = "anonymous";
let offlineDbPromise: Promise<IDBDatabase> | null = null;
const memoryOfflineStore = new Map<string, unknown>();

type OfflineRecord<T> = {
  key: string;
  value: T;
  expiresAt?: number;
};

function namespacedKey(key: string) {
  return `${storageNamespace}:${key}`;
}

function setStorageNamespace(userId: string | undefined) {
  storageNamespace = userId || "anonymous";
}

function openOfflineDb() {
  if (typeof indexedDB === "undefined") return null;
  offlineDbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return offlineDbPromise;
}

async function readOfflineRecord<T>(key: string): Promise<T | null> {
  const recordKey = namespacedKey(key);
  const dbPromise = openOfflineDb();
  if (!dbPromise) {
    const record = memoryOfflineStore.get(recordKey) as OfflineRecord<T> | undefined;
    if (!record) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      memoryOfflineStore.delete(recordKey);
      return null;
    }
    return record.value;
  }

  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OFFLINE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(OFFLINE_STORE_NAME);
    const request = store.get(recordKey);
    request.onsuccess = () => {
      const record = request.result as OfflineRecord<T> | undefined;
      if (!record) {
        resolve(null);
        return;
      }
      if (record.expiresAt && record.expiresAt <= Date.now()) {
        store.delete(recordKey);
        resolve(null);
        return;
      }
      resolve(record.value);
    };
    request.onerror = () => reject(request.error);
  });
}

async function writeOfflineRecord<T>(key: string, value: T, ttlMs?: number) {
  const record: OfflineRecord<T> = {
    key: namespacedKey(key),
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined
  };
  const dbPromise = openOfflineDb();
  if (!dbPromise) {
    memoryOfflineStore.set(record.key, record);
    return;
  }

  const db = await dbPromise;
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(OFFLINE_STORE_NAME, "readwrite").objectStore(OFFLINE_STORE_NAME).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteOfflineRecord(key: string) {
  const recordKey = namespacedKey(key);
  const dbPromise = openOfflineDb();
  if (!dbPromise) {
    memoryOfflineStore.delete(recordKey);
    return;
  }

  const db = await dbPromise;
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(OFFLINE_STORE_NAME, "readwrite").objectStore(OFFLINE_STORE_NAME).delete(recordKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearOfflineRecords() {
  localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
  localStorage.removeItem(MUTATION_QUEUE_KEY);
  const prefix = `${storageNamespace}:`;
  for (const key of Array.from(memoryOfflineStore.keys())) {
    if (key.startsWith(prefix)) memoryOfflineStore.delete(key);
  }

  const dbPromise = openOfflineDb();
  if (!dbPromise) return;
  const db = await dbPromise;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OFFLINE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(OFFLINE_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function tokenStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readTokens(): StoredTokens | null {
  if (memoryTokens) return memoryTokens;
  const stored = tokenStorage()?.getItem(TOKEN_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as StoredTokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    memoryTokens = parsed;
    return parsed;
  } catch {
    tokenStorage()?.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
}

function writeTokens(tokens: StoredTokens) {
  memoryTokens = tokens;
  tokenStorage()?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

function sanitizeBootstrapCache(data: BootstrapData): BootstrapData {
  return {
    ...data,
    operationCatalog: (data.operationCatalog || []).map((operation) => ({ ...operation })),
    employees: data.employees.map((employee) => ({
      id: employee.id,
      full_name: employee.full_name,
      status: employee.status,
      needs_housing: employee.needs_housing
    })),
    sections: (data.sections || []).map((section) => ({ ...section })),
    employeeBusy: (data.employeeBusy || []).map((busy) => ({ ...busy })),
    reservations: data.reservations.map((reservation) => ({
      id: reservation.id,
      employee_id: reservation.employee_id,
      room_id: reservation.room_id,
      bed_number: reservation.bed_number,
      dorm: reservation.dorm,
      room: reservation.room,
      bed: reservation.bed,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      cost: reservation.cost,
      comment: reservation.comment,
      status: reservation.status
    })),
    housingPlaces: data.housingPlaces.map((place) => ({
      ...place,
      reservation: place.reservation ? {
        room_id: place.reservation.room_id,
        bed_number: place.reservation.bed_number,
        dorm: place.reservation.dorm,
        room: place.reservation.room,
        bed: place.reservation.bed,
        status: place.reservation.status
      } : undefined
    }))
  };
}

async function readBootstrapCache(): Promise<BootstrapData | null> {
  return readOfflineRecord<BootstrapData>(BOOTSTRAP_CACHE_KEY);
}

export function writeBootstrapCache(data: BootstrapData) {
  return writeOfflineRecord(BOOTSTRAP_CACHE_KEY, sanitizeBootstrapCache(data), CACHE_TTL_MS);
}

export function isMutationDelta(value: MutateResult): value is MutationDelta {
  return "ok" in value && value.ok === true && "resource" in value;
}

async function readMutationQueue() {
  return (await readOfflineRecord<QueuedMutation[]>(MUTATION_QUEUE_KEY)) || [];
}

async function writeMutationQueue(queue: QueuedMutation[]) {
  if (queue.length) await writeOfflineRecord(MUTATION_QUEUE_KEY, queue);
  else await deleteOfflineRecord(MUTATION_QUEUE_KEY);
}

async function queueMutation(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
  const queue = await readMutationQueue();
  queue.push({ id: crypto.randomUUID(), path, method, body, createdAt: new Date().toISOString() });
  await writeMutationQueue(queue);
  return queue.length;
}

export async function pendingMutationCount() {
  return (await readMutationQueue()).length;
}

export function clearAuthTokens() {
  memoryTokens = null;
  tokenStorage()?.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_STATE_KEY);
  void clearOfflineRecords();
}

export function hasAuthTokens() {
  return Boolean(readTokens()?.accessToken);
}

async function refreshAccessToken() {
  const tokens = readTokens();
  const refreshed = await request<LoginResponse>(API_BASE, "/auth/refresh", { method: "POST", body: tokens?.refreshToken ? { refreshToken: tokens.refreshToken } : undefined, auth: false, retry: false });
  if (refreshed.accessToken && refreshed.refreshToken) {
    writeTokens({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
    return refreshed.accessToken;
  }
  return null;
}

async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth !== false;
  const tokens = auth ? readTokens() : null;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 401 && auth && options.retry !== false) {
    const accessToken = await refreshAccessToken().catch(() => null);
    if (accessToken) return request<T>(baseUrl, path, { ...options, retry: false });
    clearAuthTokens();
  }
  const data = await response.json().catch(() => ({}));
  const rawMessage = Array.isArray(data.message) ? data.message.join(", ") : data.message || data.error || "Ошибка API";
  const message = rawMessage === "Invalid credentials" ? "Неверный логин или пароль" : rawMessage;
  if (!response.ok) throw new Error(message);
  return data;
}

function compatRequest<T>(path: string, options: RequestOptions = {}) {
  return request<T>(COMPAT_API_BASE, path, options);
}

function coreRequest<T>(path: string, options: RequestOptions = {}) {
  return request<T>(API_BASE, path, options);
}

function bootstrapPath(query: BootstrapQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString();
  return `/bootstrap${suffix ? `?${suffix}` : ""}`;
}

export const api = {
  async factories() {
    return coreRequest<Factory[]>("/factories", { auth: false });
  },
  async login(login: string, password?: string) {
    const response = await coreRequest<LoginResponse>("/auth/login", { method: "POST", body: { login: login.trim(), ...(password ? { password } : {}) }, auth: false });
    if (response.accessToken && response.refreshToken) {
      writeTokens({ accessToken: response.accessToken, refreshToken: response.refreshToken });
      setStorageNamespace(response.user?.id);
    }
    return { ...response, ok: true, role: response.user?.role || response.role };
  },
  async selectFactory(factoryId: string) {
    const response = await coreRequest<LoginResponse>("/auth/select-factory", { method: "POST", body: { factoryId } });
    if (response.accessToken && response.refreshToken) {
      writeTokens({ accessToken: response.accessToken, refreshToken: response.refreshToken });
      setStorageNamespace(response.user?.id);
    }
    return { ...response, ok: true, role: response.user?.role || response.role };
  },
  changePassword(oldPassword: string, newPassword: string) {
    return coreRequest<{ ok: true }>("/auth/change-password", { method: "POST", body: { oldPassword, newPassword } });
  },
  logout() {
    return coreRequest("/auth/logout", { method: "POST" }).finally(clearAuthTokens);
  },
  currentUser() {
    return coreRequest<CurrentUserProfile>("/users/me");
  },
  notifications() {
    return coreRequest<NotificationItem[]>("/notifications");
  },
  markNotificationRead(id: string) {
    return coreRequest<NotificationItem>(`/notifications/${id}/read`, { method: "PATCH" });
  },
  requestFactAnalytics(query: RequestFactAnalyticsQuery = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const suffix = params.toString();
    return coreRequest<RequestFactAnalyticsData>(`/analytics/request-fact${suffix ? `?${suffix}` : ""}`);
  },
  adminUsers(query: { search?: string; take?: number; skip?: number } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const suffix = params.toString();
    return coreRequest<AdminUserRow[]>(`/admin/users${suffix ? `?${suffix}` : ""}`);
  },
  async bootstrap(query: BootstrapQuery = {}) {
    await flushQueuedMutations().catch(() => undefined);
    try {
      const data = await compatRequest<BootstrapData>(bootstrapPath(query));
      const pendingMutations = await pendingMutationCount();
      const next = { ...data, pendingMutations };
      await writeBootstrapCache(next);
      return next;
    } catch (error) {
      if (isOffline()) {
        const cached = await readBootstrapCache();
        if (cached) return { ...cached, pendingMutations: await pendingMutationCount() };
      }
      throw error;
    }
  },
  async vapidPublicKey() {
    try {
      return await coreRequest<{ publicKey: string }>("/notifications/vapid-public-key");
    } catch {
      return { publicKey: "" };
    }
  },
  async subscribe(subscription: PushSubscriptionJSON) {
    try {
      return await coreRequest("/notifications/subscribe", { method: "POST", body: subscription });
    } catch {
      return { ok: false };
    }
  },
  async mutate(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
    if (isOffline()) {
      const pending = await queueMutation(path, method, body);
      const cached = await readBootstrapCache();
      if (cached) return { ...cached, pendingMutations: pending };
      throw new Error("Нет сети. Действие сохранено в очередь и будет отправлено позже.");
    }
    return compatRequest<MutationDelta>(path, { method, body });
  }
};

export async function flushQueuedMutations() {
  if (isOffline()) return { flushed: 0, pending: await pendingMutationCount() };
  const queue = await readMutationQueue();
  if (!queue.length) return { flushed: 0, pending: 0 };
  let flushed = 0;
  for (const item of queue) {
    try {
      await compatRequest<MutationDelta>(item.path, { method: item.method, body: item.body });
      flushed += 1;
    } catch {
      await writeMutationQueue(queue.slice(flushed));
      return { flushed, pending: await pendingMutationCount() };
    }
  }
  await writeMutationQueue([]);
  return { flushed, pending: 0 };
}
