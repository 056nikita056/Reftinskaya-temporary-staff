import type { ReactNode } from "react";
import { CalendarDays, Check, ClipboardList, Hotel, Users } from "lucide-react";
import type { BootstrapData, RoleAccess } from "../../api/client";
import { Panel } from "../../components/common";
import { statusTone } from "../../domain/display";

export function Dashboard({ data, access }: { data: BootstrapData; access?: RoleAccess }) {
  const activePlans = data.plans.filter((plan) => !["Завершен", "Отменено"].includes(plan.status)).length;
  const activeFacts = data.facts.filter((fact) => fact.operation_done || fact.start_done || fact.end_done).length;
  const planStatuses = data.plans.map((plan) => displayStatusForAccess(plan.status, access));
  const statusCounts = Array.from(new Map(planStatuses.map((status) => [status, planStatuses.filter((item) => item === status).length])));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Активные планы" value={activePlans} icon={<ClipboardList />} />
        <Metric label="Персонал" value={data.employees.length} icon={<Users />} />
        <Metric label="Свободно койко-мест" value={data.summary.freeBeds} icon={<Hotel />} />
        <Metric label="Факт работ" value={activeFacts} icon={<Check />} />
      </div>
      <Panel title="Статусы планов" icon={<CalendarDays size={18} />}>
        <div className="grid gap-2 md:grid-cols-2">
          {statusCounts.length ? (
            statusCounts.map(([status, count]) => (
              <div key={status} className="flex items-center justify-between rounded-md bg-slate-50 p-3">
                <span className={`text-sm font-black ${statusTone(status)}`}>{status}</span>
                <span className="text-lg font-black">{count}</span>
              </div>
            ))
          ) : (
            <p className="rounded-md bg-slate-50 p-3 text-sm font-black text-slate-500 md:col-span-2">Нет данных</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function displayStatusForAccess(status: string, access?: RoleAccess) {
  const actions = access?.actions || [];
  const isHrView = actions.includes("plans.hr.edit") && !actions.includes("plans.factory.edit");
  if (isHrView && status === "Отправлено") return "Получено";
  return status;
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-refGreen text-white">{icon}</div>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
    </div>
  );
}
