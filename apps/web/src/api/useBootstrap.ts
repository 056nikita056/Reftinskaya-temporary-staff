import { useEffect, useRef, useState } from "react";
import { api, BootstrapData, BootstrapPageName, isMutationDelta, pendingMutationCount, writeBootstrapCache } from "./client";
import { applyMutationDelta, mergeBootstrapPage } from "./mutationDelta";

export type MutateBootstrap = (path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, message?: string) => Promise<BootstrapData | null>;

export type LoadMoreBootstrap = (collection: BootstrapPageName) => Promise<BootstrapData | null>;

function optimisticData(current: BootstrapData | null, path: string, method: "POST" | "PUT" | "DELETE", body?: unknown): BootstrapData | null {
  if (!current) return null;
  const payload = (body || {}) as Record<string, unknown>;
  const [, resource, id] = path.split("/");
  if (!id) return current;
  if (resource === "plans" && method === "PUT") {
    return { ...current, plans: current.plans.map((item) => (item.id === id ? { ...item, ...payload } : item)) };
  }
  if (resource === "operations" && method === "PUT") {
    return { ...current, operations: current.operations.map((item) => (item.id === id ? { ...item, ...payload } : item)) };
  }
  if (resource === "employees" && method === "PUT") {
    return { ...current, employees: current.employees.map((item) => (item.id === id ? { ...item, ...payload } : item)) };
  }
  if (resource === "reservations") {
    if (method === "DELETE") return { ...current, reservations: current.reservations.filter((item) => item.id !== id) };
    if (method === "PUT") return { ...current, reservations: current.reservations.map((item) => (item.id === id ? { ...item, ...payload } : item)) };
  }
  if (resource === "assignments" && method === "DELETE") {
    return { ...current, assignments: current.assignments.filter((item) => item.id !== id) };
  }
  return current;
}

export function useBootstrap(enabled: boolean) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const dataRef = useRef<BootstrapData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const commitData = (next: BootstrapData | null) => {
    dataRef.current = next;
    setData(next);
  };

  const refresh = async () => {
    try {
      const next = await api.bootstrap();
      commitData(next);
      setError("");
      if (next.pendingMutations) {
        setNotice(`Нет сети: в очереди ${next.pendingMutations} действ.`);
        window.setTimeout(() => setNotice(""), 2600);
      }
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "API недоступен");
      return null;
    }
  };

  const mutate: MutateBootstrap = async (path, method, body, message = method === "POST" ? "Добавлено" : method === "DELETE" ? "Удалено" : "Сохранено") => {
    try {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline) {
        setData((current) => {
          const nextOptimistic = optimisticData(current, path, method, body);
          dataRef.current = nextOptimistic;
          return nextOptimistic;
        });
      }
      const result = await api.mutate(path, method, body);
      const next = isMutationDelta(result)
        ? dataRef.current ? applyMutationDelta(dataRef.current, result, await pendingMutationCount()) : await refresh()
        : result;
      if (!next) throw new Error("Не удалось обновить локальные данные");
      const committed = offline ? optimisticData(next, path, method, body) : next;
      commitData(committed);
      if (committed) await writeBootstrapCache(committed);
      setError("");
      const pending = await pendingMutationCount();
      setNotice(offline ? `Нет сети: действие поставлено в очередь (${pending})` : message);
      window.setTimeout(() => setNotice(""), offline ? 3000 : 1800);
      return next;
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Не удалось сохранить";
      setError(messageText);
      setNotice(messageText);
      window.setTimeout(() => setNotice(""), 2600);
      return null;
    }
  };

  const loadMore: LoadMoreBootstrap = async (collection) => {
    const current = dataRef.current;
    const cursor = current?.pagination?.[collection]?.nextCursor;
    if (!current || !cursor) return current;
    try {
      const page = await api.bootstrap({
        from: current.scope?.from,
        to: current.scope?.to,
        planId: current.scope?.planId,
        take: current.pagination?.[collection]?.take,
        [`${collection}_cursor`]: cursor
      });
      const next = mergeBootstrapPage(current, page, collection);
      commitData(next);
      await writeBootstrapCache(next);
      setError("");
      setNotice("Данные дозагружены");
      window.setTimeout(() => setNotice(""), 1500);
      return next;
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Не удалось дозагрузить данные";
      setError(messageText);
      setNotice(messageText);
      window.setTimeout(() => setNotice(""), 2600);
      return null;
    }
  };

  useEffect(() => {
    if (enabled) void refresh();
    else commitData(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sync = () => {
      void refresh();
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [enabled]);

  return { data, error, notice, refresh, mutate, loadMore };
}
