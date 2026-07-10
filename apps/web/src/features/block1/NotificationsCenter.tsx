import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, Check, RefreshCcw } from "lucide-react";
import type { NotificationItem } from "../../api/client";
import { api } from "../../api/client";
import { Empty } from "../../components/common";
import type { ModuleKey } from "../../domain/types";

type FilterKey = "all" | "unread" | "requestFact";

const typeLabels: Record<NotificationItem["type"], string> = {
  planSubmitted: "Отправка плана",
  planApproved: "Согласование",
  explanationAdded: "Пояснение",
  statusChanged: "Смена статуса",
  requestFactDeviation: "Отклонение"
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function targetModule(item: NotificationItem): ModuleKey {
  if (item.targetType === "analytics" || item.type === "requestFactDeviation") return "dashboard";
  if (item.targetType === "plan") return "plans";
  if (item.targetType === "factEntry") return "facts";
  return "notifications";
}

export function NotificationsCenter({ onNavigate }: { onNavigate: (module: ModuleKey) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await api.notifications());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "unread") return items.filter((item) => !item.isRead);
    if (filter === "requestFact") return items.filter((item) => item.type === "requestFactDeviation");
    return items;
  }, [filter, items]);

  const markRead = async (item: NotificationItem) => {
    if (item.isRead) return item;
    const updated = await api.markNotificationRead(item.id);
    setItems((current) => current.map((row) => row.id === item.id ? updated : row));
    return updated;
  };

  const open = async (item: NotificationItem) => {
    try {
      const next = await markRead(item);
      const module = targetModule(next);
      if (module !== "notifications") onNavigate(module);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отметить уведомление");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-normal tracking-tight text-refDark md:text-3xl">Центр уведомлений</h1>
          <p className="mt-1 text-sm font-normal text-slate-500">{items.length} уведомлений</p>
        </div>
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-normal text-slate-700 transition hover:bg-slate-50" onClick={load}>
          <RefreshCcw size={16} />
          Обновить
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Все</FilterButton>
        <FilterButton active={filter === "unread"} onClick={() => setFilter("unread")}>Непрочитанные</FilterButton>
        <FilterButton active={filter === "requestFact"} onClick={() => setFilter("requestFact")}>Заявка / факт</FilterButton>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-normal text-red-700">{error}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {loading && !items.length ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : filtered.length ? (
          <div className="space-y-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                className={`w-full rounded-lg border p-3 text-left transition hover:border-refGreen hover:bg-emerald-50/40 ${item.isRead ? "border-slate-200 bg-white" : "border-refGreen bg-emerald-50"}`}
                onClick={() => void open(item)}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-slate-300" : "bg-refGreen"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-normal text-refGreen">{typeLabels[item.type]}</p>
                      <p className="text-xs font-normal text-slate-500">{formatDate(item.createdAt)}</p>
                    </div>
                    <p className="mt-2 text-base font-normal text-refDark">{item.title}</p>
                    <p className="mt-1 text-sm font-normal leading-5 text-slate-600">{item.message}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {item.targetType || item.targetId ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-normal text-slate-600">
                          {item.targetType || "target"} {item.targetId ? `#${item.targetId}` : ""}
                        </span>
                      ) : <span />}
                      <span className={`inline-flex items-center gap-1 text-xs font-normal ${item.isRead ? "text-slate-500" : "text-refGreen"}`}>
                        {item.isRead ? <Check size={14} /> : <Bell size={14} />}
                        {item.isRead ? "прочитано" : "не прочитано"}
                        {(item.targetType || item.targetId) && <ArrowRight size={14} />}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="Уведомлений нет" text="Для выбранного фильтра нет событий. Новые статусы, пояснения и отклонения появятся здесь." />
        )}
      </section>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button className={`rounded-full border px-4 py-2 text-sm font-normal transition ${active ? "border-refGreen bg-emerald-50 text-refGreen" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} onClick={onClick}>
      {children}
    </button>
  );
}
