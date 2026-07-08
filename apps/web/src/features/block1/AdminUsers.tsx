import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Download, Plus, RefreshCcw, Save } from "lucide-react";
import type { AdminUserRow, CurrentUserProfile } from "../../api/client";
import { api } from "../../api/client";
import { Empty } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

function formatActivity(value: AdminUserRow["lastActivityAt"]) {
  if (!value) return "—";
  if (value instanceof Date) return value.toLocaleString("ru-RU");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export function AdminUsers({ profile }: { profile: CurrentUserProfile | null }) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useUiFeedback();
  const showNextIteration = (action: string) => notify(`${action} будет доступно в следующей итерации.`, "warning");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.adminUsers();
      setUsers(rows);
      setError("");
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Admin users endpoint недоступен");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-refDark md:text-3xl">Администрирование пользователей и ролей</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">Контроль доступа по ролям и обязательной привязке к фабрике</p>
        </div>
        <button className="btn-primary h-10 gap-2 self-start" onClick={() => showNextIteration("Создание пользователя")} type="button">
          <Plus size={17} />
          Создать пользователя
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-refGreen bg-emerald-50 px-4 py-2 text-sm font-black text-refGreen">Фабрика: {profile?.factoryName || "Рефтинская"}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">Роль: все</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">Статус: активные</span>
          <button className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50" onClick={() => showNextIteration("Экспорт пользователей")} type="button">
            <Download size={16} />
            Экспорт
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black text-refDark">Действия администратора</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionChip tone="green">создать пользователя</ActionChip>
          <ActionChip>изменить роль</ActionChip>
          <ActionChip>привязать к фабрике</ActionChip>
          <ActionChip tone="yellow">заблокировать / активировать</ActionChip>
          <p className="ml-auto max-w-xs text-xs font-semibold leading-5 text-slate-500">Все действия сохраняют журнал последнего входа или изменения.</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-black text-refDark">Пользователи</h2>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50" onClick={load}>
            <RefreshCcw size={15} />
            Обновить
          </button>
        </div>
        {loading && !users.length ? (
          <div className="h-80 animate-pulse rounded-lg bg-slate-100" />
        ) : error ? (
          <Empty title="Нет данных пользователей" text={error} />
        ) : users.length ? (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-[920px] w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <Th>ФИО</Th>
                  <Th>Логин</Th>
                  <Th>Роль</Th>
                  <Th>Фабрика</Th>
                  <Th>Статус</Th>
                  <Th>Последнее действие / вход</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.status === "inactive" ? "bg-red-50" : "bg-white"}>
                    <Td strong>{user.fullName}</Td>
                    <Td>{user.email || user.login}</Td>
                    <Td>{user.role}</Td>
                    <Td>{user.factoryName || "Фабрика не указана"}</Td>
                    <Td className={user.status === "inactive" ? "font-black text-red-700" : "font-black text-refGreen"}>{user.status === "inactive" ? "заблокирован" : "активен"}</Td>
                    <Td className={user.status === "inactive" ? "text-red-700" : ""}>{formatActivity(user.lastActivityAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Пользователи не найдены" text="В выбранной фабрике пока нет пользователей для отображения." />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-refDark">Быстрое редактирование выбранного пользователя</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionChip>Роль: hr</ActionChip>
            <ActionChip tone="green">Фабрика: {profile?.factoryName || "Рефтинская"}</ActionChip>
            <ActionChip tone="green">Статус: активен</ActionChip>
          </div>
        </div>
        <button className="btn-primary h-10 gap-2" onClick={() => showNextIteration("Быстрое редактирование")} type="button"><Save size={16} />Сохранить</button>
        <button className="h-10 rounded-md bg-red-600 px-4 text-sm font-black text-white transition hover:bg-red-700" onClick={() => showNextIteration("Блокировка пользователя")} type="button">Заблокировать</button>
      </section>
    </div>
  );
}

function ActionChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "green" | "yellow" }) {
  const className = {
    default: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-refGreen bg-emerald-50 text-refGreen",
    yellow: "border-amber-200 bg-amber-50 text-amber-700"
  }[tone];
  return <span className={`rounded-full border px-4 py-2 text-xs font-black ${className}`}>{children}</span>;
}

function Th({ children }: { children: string }) {
  return <th className="border-b border-r border-slate-200 px-3 py-3 last:border-r-0">{children}</th>;
}

function Td({ children, strong, className = "" }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <td className={`border-b border-r border-slate-200 px-3 py-4 align-top last:border-r-0 ${strong ? "font-black" : "font-semibold"} ${className}`}>{children}</td>;
}
