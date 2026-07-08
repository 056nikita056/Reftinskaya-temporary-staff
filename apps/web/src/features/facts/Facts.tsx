import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { Assignment, BootstrapData, Employee, FactEntry, Operation, Plan, RoleAccess, RoleKey } from "../../api/client";
import type { BootstrapLoadMore, BootstrapMutate, ViewState } from "../../domain/types";
import { calculateOutsource, dateRange, displayEmployeeName, displayOperationName, displaySectionName, numberValue, operationGroups, planPeriod, statusTone, todayRu } from "../../domain/display";
import { Empty, Modal } from "../../components/common";

type FactSide = "factory" | "out";

type FactAccess = {
  factory: boolean;
  out: boolean;
};

function factAccessForPermissions(access: RoleAccess): FactAccess {
  return {
    factory: access.actions.includes("facts.factory.edit"),
    out: access.actions.includes("facts.out.edit")
  };
}

function preferredFactSide(role: RoleKey, access: FactAccess): FactSide {
  if (["outMaster", "outsourcerBrigadier"].includes(role) && access.out) return "out";
  if (access.factory) return "factory";
  if (access.out) return "out";
  return "factory";
}

export function FactsV2({ role, access: permissions, view, setView, data, mutate, loadMore }: { role: RoleKey; access: RoleAccess; view: ViewState; setView: (view: ViewState) => void; data: BootstrapData; mutate: BootstrapMutate; loadMore: BootstrapLoadMore }) {
  const access = factAccessForPermissions(permissions);
  const initialSide = preferredFactSide(role, access);
  const plans = data.plans.filter((plan) => ["На очереди", "В работе", "Завершен", "Утверждено"].includes(plan.status));

  if (view.type === "facts" && view.planId && view.operationId) {
    return (
      <FactWorkV2
        access={access}
        initialSide={initialSide}
        edit={Boolean(view.edit)}
        planId={view.planId}
        operationId={view.operationId}
        data={data}
        mutate={mutate}
        back={() => setView({ type: "facts", planId: view.planId })}
        openEdit={() => setView({ type: "facts", planId: view.planId, operationId: view.operationId, edit: true })}
        closeEdit={() => setView({ type: "facts", planId: view.planId, operationId: view.operationId })}
      />
    );
  }

  if (view.type === "facts" && view.planId) {
    const plan = data.plans.find((item) => item.id === view.planId);
    return <FactPlanViewV2 planId={view.planId} plan={plan} data={data} back={() => setView({ type: "list" })} openOperation={(operationId) => setView({ type: "facts", planId: view.planId, operationId })} />;
  }

  return (
    <div className="space-y-3 pb-2">
      <h2 className="text-xl font-black">Работа на участках</h2>
      {plans.map((plan) => {
        const operations = data.operations.filter((operation) => operation.plan_id === plan.id);
        const temporaryStaff = operations.reduce((sum, operation) => sum + factPersonnelCountV2(operation, data.assignments), 0);
        return (
          <button key={plan.id} className="w-full rounded-lg bg-slate-100 p-4 text-left shadow-sm transition hover:bg-slate-200" onClick={() => setView({ type: "facts", planId: plan.id })}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">План {planPeriod(plan)}</p>
                <p className="mt-1 text-xs font-black text-slate-600">Временный персонал: {temporaryStaff}</p>
              </div>
              <p className={`shrink-0 text-xs font-black ${statusTone(plan.status)}`}>{plan.status}</p>
            </div>
          </button>
        );
      })}
      {!plans.length && <FactsEmpty access={access} data={data} />}
      {data.pagination?.facts.nextCursor && (
        <button className="mx-auto flex rounded-md bg-slate-100 px-4 py-2 text-sm font-black text-refGreen hover:bg-emerald-50" onClick={() => loadMore("facts")}>
          Загрузить еще факты
        </button>
      )}
    </div>
  );
}

function FactsEmpty({ access, data }: { access: FactAccess; data: BootstrapData }) {
  const factoryPlans = data.plans.filter((plan) => plan.owner_role === "factory");
  const waitingHr = factoryPlans.some((plan) => ["Отправлено", "Получено"].includes(plan.status));
  const waitingOutsourcer = factoryPlans.some((plan) => ["На согласовании", "Не утверждено"].includes(plan.status));
  const roleName = access.factory && access.out ? "мастеров" : access.out ? "мастера аутсорсера" : "мастера фабрики";

  if (!factoryPlans.length) {
    return (
      <Empty
        title="Планов для фиксации пока нет"
        text={`У ${roleName} появятся работы после того, как фабрика создаст план и он пройдет этапы HR и аутсорсера.`}
        steps={["Фабрика создает план.", "HR заполняет штат.", "Аутсорсер распределяет временный персонал.", "После перевода в работу план появится у мастеров."]}
      />
    );
  }

  if (waitingHr) {
    return (
      <Empty
        title="План еще не дошел до мастеров"
        text="Сейчас план находится на этапе HR или передачи аутсорсеру. Мастера увидят его только после распределения персонала и перевода в работу."
        steps={["HR заполняет штат и отправляет план аутсорсеру.", "Аутсорсер назначает временный персонал.", "После согласования план становится доступен для фиксации работ."]}
      />
    );
  }

  if (waitingOutsourcer) {
    return (
      <Empty
        title="План ожидает согласования"
        text="План уже прошел HR/аутсорсера, но еще не переведен в работу. Пока фиксировать смены нельзя."
        steps={["Проверьте согласование плана.", "После статуса «В работе» он появится у мастеров.", "Мастер сможет открыть участок и отметить факт работ."]}
      />
    );
  }

  return (
    <Empty
      title="Нет активных работ"
      text="Для текущего набора прав сейчас нет планов в статусе «В работе», «На очереди», «Утверждено» или «Завершен»."
      steps={["Проверьте статус плана у фабрики.", "Убедитесь, что по операциям назначен персонал.", "После запуска плана мастера увидят его здесь."]}
    />
  );
}

function FactPlanViewV2({ planId, plan, data, back, openOperation }: { planId: string; plan?: Plan; data: BootstrapData; back: () => void; openOperation: (operationId: string) => void }) {
  const operations = data.operations.filter((operation) => operation.plan_id === planId);
  const groups = operationGroups(operations);
  const days = dateRange(plan?.start_date, plan?.end_date).slice(0, 2);

  return (
    <div className="space-y-3 pb-2">
      <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-black" onClick={back}>Назад</button>
      <FactSummaryV2
        cells={[
          ["Начало работ", plan?.start_date || "-"],
          ["Окончание работ", plan?.end_date || "-"],
          ["Статус", plan?.status || "-"]
        ]}
      />
      {days.map((day, index) => (
        <section key={day} className="space-y-2">
          <div className="bg-slate-200 px-3 py-2 text-center text-sm font-black">{day}</div>
          {groups.flatMap(({ section, rows }) => rows.slice(0, 2).map((operation) => (
            <button key={`${day}-${operation.id}`} className="grid w-full grid-cols-[1fr_auto_2.75rem] items-center rounded border border-slate-400 bg-white text-sm font-bold" onClick={() => openOperation(operation.id)}>
              <span className="truncate px-3 py-2 text-left">{displaySectionName(section)}</span>
              <span className="border-l border-slate-400 px-3 py-2 text-slate-600">Персонал</span>
              <span className="border-l border-slate-400 px-2 py-2 text-center">{factPersonnelCountV2(operation, data.assignments)}</span>
            </button>
          )))}
          {index === 1 && <div className="bg-slate-200 px-3 py-2 text-center text-sm font-black">Дата плана</div>}
        </section>
      ))}
      {!operations.length && <Empty text="В плане пока нет участков для фиксации" />}
    </div>
  );
}

function FactWorkV2({ access, initialSide, edit, planId, operationId, data, mutate, back, openEdit, closeEdit }: { access: FactAccess; initialSide: FactSide; edit: boolean; planId: string; operationId: string; data: BootstrapData; mutate: BootstrapMutate; back: () => void; openEdit: () => void; closeEdit: () => void }) {
  const plan = data.plans.find((item) => item.id === planId);
  const operation = data.operations.find((item) => item.id === operationId);
  const assignments = data.assignments.filter((item) => item.operation_id === operationId);
  const workers = assignments.map((assignment) => data.employees.find((employee) => employee.id === assignment.employee_id)).filter(Boolean) as Employee[];
  const [explain, setExplain] = useState<{ employee: Employee; fact?: FactEntry } | null>(null);
  const [side, setSide] = useState<FactSide>(initialSide);
  const workDate = plan?.start_date || todayRu();
  const sideAllowed = side === "out" ? access.out : access.factory;
  const operationLocked = !edit || !sideAllowed || side === "out";
  const penaltyLocked = !edit || !sideAllowed;

  return (
    <div className="relative space-y-3 pb-2">
      <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-black" onClick={back}>Назад</button>
      {access.factory && access.out && (
        <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-black">
          <button className={`rounded px-3 py-2 ${side === "factory" ? "bg-white text-refGreen shadow-sm" : "text-slate-600"}`} onClick={() => setSide("factory")} type="button">
            Фабрика
          </button>
          <button className={`rounded px-3 py-2 ${side === "out" ? "bg-white text-refGreen shadow-sm" : "text-slate-600"}`} onClick={() => setSide("out")} type="button">
            Аутсорсинг
          </button>
        </div>
      )}
      <FactSummaryV2
        cells={[
          ["Участок", displaySectionName(operation?.section_name)],
          ["Дата", workDate],
          ["Персонал", String(workers.length)]
        ]}
      />
      {workers.map((employee) => {
        const fact = data.facts.find((item) => item.plan_id === planId && item.operation_id === operationId && item.employee_id === employee.id && item.side === side && item.work_date === workDate);
        const upsert = (patch: Partial<FactEntry>, message = "Факт сохранен") => mutate("/facts", "POST", { plan_id: planId, operation_id: operationId, employee_id: employee.id, side, work_date: workDate, ...fact, ...patch }, message);
        const openExplain = () => {
          if (sideAllowed) setExplain({ employee, fact });
        };
        return (
          <div key={employee.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="bg-slate-200 px-3 py-2 text-center text-sm font-black">{displayEmployeeName(employee)}</div>
            <div className="space-y-2 p-3">
              <FactLineV2 label="Операция" checked={fact?.operation_done} value={displayOperationName(operation?.name)} disabled={operationLocked} explainDisabled={!sideAllowed} onToggle={() => upsert({ operation_done: fact?.operation_done ? 0 : 1 })} onExplain={openExplain} />
              <FactLineV2 label="Начало" checked={fact?.start_done} value={fact?.started_at || (edit ? "10:00" : "--:--")} disabled={operationLocked} explainDisabled={!sideAllowed} onToggle={() => upsert({ start_done: fact?.start_done ? 0 : 1, started_at: fact?.started_at || "10:00" })} onExplain={openExplain} />
              <FactLineV2 label="Конец" checked={fact?.end_done} value={fact?.ended_at || (edit ? "18:00" : "--:--")} disabled={operationLocked} explainDisabled={!sideAllowed} onToggle={() => upsert({ end_done: fact?.end_done ? 0 : 1, ended_at: fact?.ended_at || "18:00" })} onExplain={openExplain} />
              <FactLineV2 label="Штраф" checked={fact?.penalty} value={fact?.penalty ? "Да" : ""} bad disabled={penaltyLocked} explainDisabled={!sideAllowed} onToggle={() => upsert({ penalty: fact?.penalty ? 0 : 1 })} onExplain={openExplain} />
            </div>
          </div>
        );
      })}
      {!workers.length && <Empty text="На операцию пока не назначены сотрудники" />}
      {!edit && sideAllowed ? (
        <button className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-refGreen text-white shadow-panel" onClick={openEdit} title="Редактировать">
          <Pencil size={24} />
        </button>
      ) : edit ? (
        <button className="fixed bottom-20 right-5 z-20 rounded-full bg-refGreen px-5 py-3 text-sm font-black text-white shadow-panel" onClick={closeEdit}>
          Сохранить
        </button>
      ) : null}
      {explain && <ExplainModalV2 canEdit={sideAllowed} context={explain} data={data} mutate={mutate} close={() => setExplain(null)} planId={planId} operationId={operationId} side={side} workDate={workDate} />}
    </div>
  );
}

function factPersonnelCountV2(operation: Operation, assignments: Assignment[]) {
  const assigned = assignments.filter((item) => item.operation_id === operation.id).length;
  return assigned || calculateOutsource(operation.required_staff, operation.staff_count) || numberValue(operation.outsource_count);
}

function FactSummaryV2({ cells }: { cells: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-md bg-refGreen text-center text-xs font-black text-white shadow-sm">
      {cells.map(([label, value]) => (
        <div key={label} className="px-2 py-3">
          <p>{label}</p>
          <p className="mt-1 font-bold opacity-90">{value}</p>
        </div>
      ))}
    </div>
  );
}

function FactLineV2({ label, checked, value, bad, disabled, explainDisabled, onToggle, onExplain }: { label: string; checked?: number; value: string; bad?: boolean; disabled?: boolean; explainDisabled?: boolean; onToggle: () => void; onExplain: () => void }) {
  return (
    <div className="grid grid-cols-[4.2rem_1.75rem_1fr_auto] items-center gap-2 text-sm">
      <span className="font-black">{label}</span>
      <button
        className={`flex h-7 w-7 items-center justify-center rounded border-2 text-white ${checked ? (bad ? "border-red-600 bg-red-600" : "border-refGreen bg-refGreen") : "border-slate-400 bg-white"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        disabled={disabled}
        onClick={onToggle}
      >
        {checked ? (bad ? <X size={18} /> : <Check size={18} />) : null}
      </button>
      <div className="min-h-7 rounded border border-slate-400 bg-white px-2 py-1 text-center font-bold leading-5">{value || ""}</div>
      <button className="text-xs font-black text-blue-700 underline disabled:cursor-not-allowed disabled:text-slate-400" disabled={explainDisabled} onClick={onExplain}>Пояснение...</button>
    </div>
  );
}

function ExplainModalV2({ canEdit, context, data, mutate, close, planId, operationId, side, workDate }: { canEdit: boolean; context: { employee: Employee; fact?: FactEntry }; data: BootstrapData; mutate: BootstrapMutate; close: () => void; planId: string; operationId: string; side: string; workDate: string }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const fact = context.fact || data.facts.find((item) => item.plan_id === planId && item.operation_id === operationId && item.employee_id === context.employee.id && item.side === side && item.work_date === workDate);
  const explanations = fact ? data.explanations.filter((item) => item.fact_entry_id === fact.id) : [];
  const save = async () => {
    if (!canEdit) return;
    let factId = fact?.id;
    if (!factId) {
      const next = await mutate("/facts", "POST", { plan_id: planId, operation_id: operationId, employee_id: context.employee.id, side, work_date: workDate }, "Факт создан");
      factId = next?.facts.find((item) => item.plan_id === planId && item.operation_id === operationId && item.employee_id === context.employee.id && item.side === side && item.work_date === workDate)?.id;
    }
    if (factId && text.trim()) {
      await mutate("/explanations", "POST", { fact_entry_id: factId, side, author_name: side === "out" ? "Мастер аутсорсера" : "Мастер фабрики", author_role: side === "out" ? "Мастер от Аутсорсера" : "Мастер от Фабрики", text }, "Пояснение добавлено");
    }
    close();
  };
  return (
    <Modal title="Пояснение" close={close}>
      <div className="space-y-3">
        {explanations.length ? explanations.map((item) => (
          <div key={item.id} className="rounded-xl bg-slate-100 p-4 text-sm">
            <p className="font-black">{item.author_name}</p>
            <p className="text-xs font-bold text-slate-600">{item.author_role}</p>
            <p className="mt-3">{item.text}</p>
            <p className="mt-2 text-right text-xs text-slate-500">{item.created_at || workDate}</p>
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm">
            <p className="font-black">Пояснений пока нет</p>
            <p className="mt-1 text-xs font-bold text-slate-600">{displayEmployeeName(context.employee)} · {workDate}</p>
            <p className="mt-3 text-slate-500">Добавьте комментарий по этому сотруднику, операции и дню.</p>
          </div>
        )}
        {adding && <textarea className="field h-28 py-2" value={text} onChange={(event) => setText(event.target.value)} placeholder={`${displayEmployeeName(context.employee)}, ${workDate}. Добавьте пояснение...`} />}
        <div className="flex justify-center gap-3 pt-2">
          {!adding ? (
            <>
              <button className="rounded-full bg-red-600 px-6 py-3 text-sm font-black text-white" onClick={close}>Закрыть</button>
              {canEdit && <button className="rounded-full bg-refGreen px-6 py-3 text-sm font-black text-white" onClick={() => setAdding(true)}>Добавить</button>}
            </>
          ) : (
            <>
              <button className="rounded-full bg-red-600 px-6 py-3 text-sm font-black text-white" onClick={() => setAdding(false)}>Отменить</button>
              <button className="rounded-full bg-refGreen px-6 py-3 text-sm font-black text-white disabled:bg-slate-300" onClick={save} disabled={!text.trim()}>Сохранить</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
