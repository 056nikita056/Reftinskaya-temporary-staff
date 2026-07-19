import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Download, Plus, RefreshCcw, Save } from "lucide-react";
import type { AdminCreateUserInput, AdminUserRow, AuditLogRow, CurrentUserProfile } from "../../api/client";
import { USER_ROLES, api } from "../../api/client";
import { Empty } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

function formatActivity(value: AdminUserRow["lastActivityAt"]) {
  if (!value) return "—";
  if (value instanceof Date) return value.toLocaleString("ru-RU");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

function formatAuditValue(value: AuditLogRow["createdAt"]) {
  return formatActivity(value);
}

function auditDetails(log: AuditLogRow) {
  const summary = typeof log.details?.summary === "string" ? log.details.summary : "";
  if (summary) return summary;
  const fieldLabel = typeof log.details?.fieldLabel === "string" ? log.details.fieldLabel : "";
  const valueLabel = typeof log.details?.newValueLabel === "string" ? log.details.newValueLabel : "";
  if (fieldLabel) return `${fieldLabel}: ${valueLabel || "—"}`;
  const field = typeof log.details?.field === "string" ? log.details.field : "";
  if (!field) return "";
  const value = log.details?.newValue;
  return `${field}: ${value == null ? "—" : String(value)}`;
}

function auditObject(log: AuditLogRow) {
  const objectLabel = typeof log.details?.objectLabel === "string" ? log.details.objectLabel : "";
  if (objectLabel) return objectLabel;
  const resourceTitle = typeof log.details?.resourceTitle === "string" ? log.details.resourceTitle : "";
  const entity = resourceTitle || log.entity || "";
  return entity || "—";
}

function csvValue(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadAuditCsv(rows: AuditLogRow[]) {
  const header = ["Дата", "Действие", "Что изменилось", "Объект", "Пользователь", "Фабрика"];
  const body = rows.map((log) => [
    formatAuditValue(log.createdAt),
    log.action,
    auditDetails(log),
    auditObject(log),
    log.userName || log.userLogin || "",
    log.factoryName || ""
  ]);
  const csv = [header, ...body].map((row) => row.map(csvValue).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const roleLabels: Record<AdminCreateUserInput["role"], string> = {
  factoryPlanner: "Планировщик фабрики",
  hr: "HR",
  directorOutsourcing: "Директор аутсорсинга",
  outsourcer: "Аутсорсер",
  outsourcerBrigadier: "Бригадир аутсорсера",
  hrOutsourcer: "HR аутсорсера",
  warden: "Комендант",
  factoryMaster: "Мастер фабрики",
  outMaster: "Мастер аутсорсинга",
  tempEmployee: "Временный сотрудник",
  admin: "Администратор"
};

function emptyCreateForm(factoryId?: string): AdminCreateUserInput {
  return {
    login: "",
    fullName: "",
    email: "",
    role: "factoryPlanner",
    factoryId,
    active: true
  };
}

export function AdminUsers({ profile }: { profile: CurrentUserProfile | null }) {
  const [activeTab, setActiveTab] = useState<"users" | "audit">("users");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<AdminCreateUserInput>(() => emptyCreateForm(profile?.factoryId));
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditUserId, setAuditUserId] = useState("");
  const [auditEntity, setAuditEntity] = useState("");
  const [auditEntityId, setAuditEntityId] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
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

  const loadAuditLogs = async (overrides: Partial<{ search: string; userId: string; entity: string; entityId: string; from: string; to: string }> = {}) => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const rows = await api.adminAuditLogs({
        search: overrides.search ?? auditSearch,
        userId: overrides.userId ?? auditUserId,
        entity: overrides.entity ?? auditEntity,
        entityId: overrides.entityId ?? auditEntityId,
        from: overrides.from ?? auditFrom,
        to: overrides.to ?? auditTo,
        take: 300
      });
      setAuditLogs(rows);
      setAuditError("");
    } catch (err) {
      setAuditLogs([]);
      setAuditError(err instanceof Error ? err.message : "Audit log endpoint недоступен");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadAuditLogs();
  }, []);

  useEffect(() => {
    setCreateForm((current) => ({ ...current, factoryId: current.factoryId || profile?.factoryId }));
  }, [profile?.factoryId]);

  const openCreateUser = () => {
    setCreateForm(emptyCreateForm(profile?.factoryId));
    setCreateError("");
    setCreateOpen(true);
    setActiveTab("users");
  };

  const createUser = async () => {
    setCreateSaving(true);
    setCreateError("");
    try {
      const created = await api.adminCreateUser(createForm);
      setUsers((current) => [created, ...current.filter((user) => user.id !== created.id)]);
      setCreateOpen(false);
      notify("Пользователь создан");
      void loadAuditLogs();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Не удалось создать пользователя");
    } finally {
      setCreateSaving(false);
    }
  };

  const showObjectHistory = (log: AuditLogRow) => {
    if (!log.entity || !log.entityId) return;
    setAuditEntity(log.entity);
    setAuditEntityId(log.entityId);
    setAuditSearch("");
    void loadAuditLogs({ search: "", entity: log.entity, entityId: log.entityId });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-normal tracking-tight text-refDark md:text-3xl">Администрирование пользователей и ролей</h1>
          <p className="mt-1 text-sm font-normal text-slate-500">Контроль доступа по ролям и обязательной привязке к фабрике</p>
        </div>
        <button className="btn-primary h-10 gap-2 self-start" onClick={openCreateUser} type="button">
          <Plus size={17} />
          Создать пользователя
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-refGreen bg-emerald-50 px-4 py-2 text-sm font-normal text-refGreen">Фабрика: {profile?.factoryName || "Рефтинская"}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal text-slate-600">Роль: все</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal text-slate-600">Статус: активные</span>
          <button className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-normal text-slate-700 transition hover:bg-slate-50" onClick={() => showNextIteration("Экспорт пользователей")} type="button">
            <Download size={16} />
            Экспорт
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        <AdminTab active={activeTab === "users"} onClick={() => setActiveTab("users")}>Пользователи</AdminTab>
        <AdminTab active={activeTab === "audit"} onClick={() => setActiveTab("audit")}>Журнал изменений</AdminTab>
      </div>

      {activeTab === "audit" ? <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-normal text-refDark">Журнал изменений</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="h-9 min-w-56 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20"
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadAuditLogs();
              }}
              placeholder="Поиск по действию, пользователю"
            />
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 hover:bg-slate-50" onClick={() => downloadAuditCsv(auditLogs)} disabled={!auditLogs.length}>
              <Download size={15} />
              Экспорт CSV
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 hover:bg-slate-50" onClick={() => void loadAuditLogs()} disabled={auditLoading}>
              <RefreshCcw size={15} />
              Обновить
            </button>
          </div>
        </div>
        <div className="mb-3 grid gap-2 md:grid-cols-5">
          <select className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" value={auditUserId} onChange={(event) => setAuditUserId(event.target.value)}>
            <option value="">Все пользователи</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.fullName || user.login}</option>
            ))}
          </select>
          <select className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" value={auditEntity} onChange={(event) => setAuditEntity(event.target.value)}>
            <option value="">Все объекты</option>
            <option value="plans">Планы</option>
            <option value="operations">Строки плана</option>
            <option value="employees">Сотрудники</option>
            <option value="assignments">Назначения</option>
            <option value="facts">Факты</option>
            <option value="settings">Настройки</option>
          </select>
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" value={auditEntityId} onChange={(event) => setAuditEntityId(event.target.value)} placeholder="ID объекта" />
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} />
          <input className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} />
        </div>
        {(auditUserId || auditEntity || auditEntityId || auditFrom || auditTo || auditSearch) && (
          <div className="mb-3 flex justify-end">
            <button
              className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => {
                setAuditSearch("");
                setAuditUserId("");
                setAuditEntity("");
                setAuditEntityId("");
                setAuditFrom("");
                setAuditTo("");
                void loadAuditLogs({ search: "", userId: "", entity: "", entityId: "", from: "", to: "" });
              }}
              type="button"
            >
              Сбросить фильтры
            </button>
          </div>
        )}
        {auditLoading && !auditLogs.length ? (
          <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
        ) : auditError ? (
          <Empty title="Нет журнала изменений" text={auditError} />
        ) : auditLogs.length ? (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-[1020px] w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-normal text-slate-500">
                <tr>
                  <Th>Дата</Th>
                  <Th>Действие</Th>
                  <Th>Что изменилось</Th>
                  <Th>Объект</Th>
                  <Th>Пользователь</Th>
                  <Th>Фабрика</Th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="bg-white">
                    <Td>{formatAuditValue(log.createdAt)}</Td>
                    <Td>{log.action}</Td>
                    <Td>{auditDetails(log) || "—"}</Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span>{auditObject(log)}</span>
                        {log.entity && log.entityId ? (
                          <button className="self-start text-xs text-refGreen hover:underline" onClick={() => showObjectHistory(log)} type="button">История объекта</button>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{log.userName || log.userLogin || "—"}</Td>
                    <Td>{log.factoryName || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Журнал пуст" text="Изменения появятся после действий пользователей." />
        )}
      </section> : null}

      {activeTab === "users" ? <>
      {createOpen ? (
        <section className="rounded-lg border border-refGreen bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-normal text-refDark">Новый пользователь</h2>
            <span className="text-xs text-slate-500">Создаётся без пароля</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">ФИО</span>
              <input className="field h-10" value={createForm.fullName} onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Логин</span>
              <input className="field h-10" value={createForm.login} onChange={(event) => setCreateForm((current) => ({ ...current, login: event.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Email</span>
              <input className="field h-10" value={createForm.email || ""} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Роль</span>
              <select className="field h-10" value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as AdminCreateUserInput["role"] }))}>
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>{roleLabels[role]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={createForm.active !== false} onChange={(event) => setCreateForm((current) => ({ ...current, active: event.target.checked }))} />
              Активен
            </label>
          </div>
          {createError ? <p className="mt-3 text-sm text-red-600">{createError}</p> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setCreateOpen(false)} type="button">Отмена</button>
            <button className="btn-primary h-10 gap-2" onClick={createUser} disabled={createSaving} type="button">
              <Save size={16} />
              {createSaving ? "Создаём..." : "Создать"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-normal text-refDark">Действия администратора</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionChip tone="green">создать пользователя</ActionChip>
          <ActionChip>изменить роль</ActionChip>
          <ActionChip>привязать к фабрике</ActionChip>
          <ActionChip tone="yellow">заблокировать / активировать</ActionChip>
          <p className="ml-auto max-w-xs text-xs font-normal leading-5 text-slate-500">Все действия сохраняют журнал последнего входа или изменения.</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-normal text-refDark">Пользователи</h2>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 hover:bg-slate-50" onClick={load}>
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
              <thead className="bg-slate-50 text-xs font-normal text-slate-500">
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
                    <Td className={user.status === "inactive" ? "font-normal text-red-700" : "font-normal text-refGreen"}>{user.status === "inactive" ? "заблокирован" : "активен"}</Td>
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
          <h2 className="font-normal text-refDark">Быстрое редактирование выбранного пользователя</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionChip>Роль: hr</ActionChip>
            <ActionChip tone="green">Фабрика: {profile?.factoryName || "Рефтинская"}</ActionChip>
            <ActionChip tone="green">Статус: активен</ActionChip>
          </div>
        </div>
        <button className="btn-primary h-10 gap-2" onClick={() => showNextIteration("Быстрое редактирование")} type="button"><Save size={16} />Сохранить</button>
        <button className="h-10 rounded-md bg-red-600 px-4 text-sm font-normal text-white transition hover:bg-red-700" onClick={() => showNextIteration("Блокировка пользователя")} type="button">Заблокировать</button>
      </section>
      </> : null}
    </div>
  );
}

function AdminTab({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      className={`border-b-2 px-4 py-3 text-sm font-normal transition ${active ? "border-refGreen text-refGreen" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ActionChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "green" | "yellow" }) {
  const className = {
    default: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-refGreen bg-emerald-50 text-refGreen",
    yellow: "border-amber-200 bg-amber-50 text-amber-700"
  }[tone];
  return <span className={`rounded-full border px-4 py-2 text-xs font-normal ${className}`}>{children}</span>;
}

function Th({ children }: { children: string }) {
  return <th className="border-b border-r border-slate-200 px-3 py-3 last:border-r-0">{children}</th>;
}

function Td({ children, strong, className = "" }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <td className={`border-b border-r border-slate-200 px-3 py-4 align-top last:border-r-0 ${strong ? "font-normal" : "font-normal"} ${className}`}>{children}</td>;
}
