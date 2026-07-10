import type { ReactNode } from "react";
import { CalendarDays, Check, ClipboardList, Hotel, Users } from "lucide-react";
import type { BootstrapData } from "../../api/client";
import { Panel } from "../../components/common";
import { internalPlanStatusLabel, statusTone } from "../../domain/display";

export function Dashboard({ data }: { data: BootstrapData }) {
  const activePlans = data.plans.length;
  const activeFacts = data.facts.filter((fact) => fact.operation_done || fact.start_done || fact.end_done).length;
  const planStatuses = data.plans.map((plan) => internalPlanStatusLabel(plan));
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
                <span className={`text-sm font-normal ${statusTone(status)}`}>{status}</span>
                <span className="text-lg font-normal">{count}</span>
              </div>
            ))
          ) : (
            <p className="rounded-md bg-slate-50 p-3 text-sm font-normal text-slate-500 md:col-span-2">Нет данных</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-refGreen text-white">{icon}</div>
      <p className="text-2xl font-normal">{value}</p>
      <p className="text-xs font-normal uppercase text-slate-500">{label}</p>
    </div>
  );
}
