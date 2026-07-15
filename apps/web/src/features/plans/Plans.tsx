import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { CatalogPicker, PlanOperationCard, buildOperationTree, buildSectionTree, type PickerEntry, type PlanEditAccess } from "./PlanOperationCard";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus, Save, Search, Send, Trash2 } from "lucide-react";
import type { Assignment, BootstrapData, Employee, Operation, OperationCatalogItem, Plan, RoleAccess, RoleKey, Section } from "../../api/client";
import type { BootstrapMutate, PlanKind, ToastTone, ViewState } from "../../domain/types";
import { calculateOutsource, canEditPlan, defaultEndRu, displayEmployeeMeta, displayEmployeeName, displayOperationName, displayPlanStatusForRole, displaySectionName, internalPlanStatusLabel, numberValue, operationGroups, planApprovalText, planPeriod, planStatusCode, statusTone, todayRu } from "../../domain/display";
import { Empty, Modal, Readonly, SectionTitle } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

const NEW_PLAN_ID = "__new-plan__";

type PlanAccess = {
  view: boolean;
  factory: boolean;
  hr: boolean;
  out: boolean;
  outApprove: boolean;
  admin: boolean;
};

type NewPlanDraft = {
  dates: { start_date: string; end_date: string };
  operations: Operation[];
};

function createDraftOperation(sectionOrder: number, planId = NEW_PLAN_ID): Operation {
  return {
    id: `draft-operation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    plan_id: planId,
    operation_id: undefined,
    section_id: undefined,
    section_name: "",
    section_order: sectionOrder,
    name: "",
    required_staff: 0,
    staff_count: 0,
    outsource_count: 0,
    hours_per_day: 8,
    rate_per_hour: 300,
    assigned_count: 0
  };
}

function createNewPlanDraft(): NewPlanDraft {
  return {
    dates: { start_date: todayRu(), end_date: defaultEndRu() },
    operations: []
  };
}

function planAccessForPermissions(access: RoleAccess): PlanAccess {
  return {
    view: access.actions.includes("plans.view"),
    factory: access.actions.includes("plans.factory.edit"),
    hr: access.actions.includes("plans.hr.edit"),
    out: access.actions.includes("plans.out.edit"),
    outApprove: access.actions.includes("plans.out.approve"),
    admin: access.actions.includes("admin.users.manage")
  };
}

function primaryKind(access: PlanAccess, fallbackRole: RoleKey): PlanKind {
  if (fallbackRole === "hr" && access.hr) return "hr";
  if (fallbackRole === "outsourcer" && access.out) return "out";
  if (fallbackRole === "outsourcerBrigadier" && access.outApprove) return "out";
  if (access.factory) return "factory";
  if (access.hr) return "hr";
  if (access.out || access.outApprove) return "out";
  return "factory";
}

function editAccessForPlan(access: PlanAccess, plan: Plan, kind: PlanKind): PlanEditAccess {
  const code = planStatusCode(plan);
  return {
    factory: access.factory && code === "draft",
    hr: access.hr && (kind === "hr" ? canEditPlan("hr", plan) : access.factory && code === "draft"),
    out: access.out && kind === "out" && canEditPlan("out", plan)
  };
}

function hasEditAccess(access: PlanEditAccess) {
  return access.factory || access.hr || access.out;
}

function sendKindForPlan(access: PlanEditAccess, plan: Plan): PlanKind | null {
  const code = planStatusCode(plan);
  if (code === "draft" && access.factory) return "factory";
  if (code === "submitted_to_hr" && access.hr) return "hr";
  if (["received_by_outsourcer", "rejected"].includes(code) && access.out) return "out";
  return null;
}

function canReadPlan(plan: Plan, access: PlanAccess) {
  const code = planStatusCode(plan);
  if (access.factory && plan.owner_role === "factory") return true;
  if (access.hr && plan.owner_role === "factory" && code !== "draft") return true;
  if (access.out) return plan.owner_role === "factory" && ["received_by_outsourcer", "rejected", "on_approval", "approved"].includes(code) && calculateOutsource(plan.required_staff, plan.staff_count) > 0;
  if (access.outApprove) return plan.owner_role === "factory" && ["on_approval", "approved", "rejected"].includes(code) && calculateOutsource(plan.required_staff, plan.staff_count) > 0;
  return access.view && !access.factory && !access.hr && !access.out && !access.outApprove && plan.owner_role === "factory";
}

function displayPlanStatus(plan: Plan, kind: PlanKind, access: PlanAccess) {
  const code = planStatusCode(plan);
  if (kind === "out" && access.outApprove && !access.out) {
    if (code === "on_approval") return "Получено";
    if (code === "approved" || code === "rejected") return "Отправлено";
    if (code === "received_by_outsourcer") return "Ожидает аутсорсера";
  }
  return displayPlanStatusForRole(plan, kind);
}

function operationCreatePayload(row: Operation) {
  const required = numberValue(row.required_staff);
  const staff = numberValue(row.staff_count);
  return {
    section_id: row.section_id,
    operation_id: row.operation_id,
    section_name: row.section_name,
    section_order: numberValue(row.section_order, 99),
    name: row.name,
    required_staff: required,
    staff_count: staff,
    hours_per_day: numberValue(row.hours_per_day, 8),
    rate_per_hour: numberValue(row.rate_per_hour, 300)
  };
}

function missingSectionRows(rows: Operation[]) {
  return rows.filter((row) => !row.section_id);
}

function missingOperationRows(rows: Operation[]) {
  return rows.filter((row) => !row.operation_id && !row.name.trim());
}

function isDraftOperation(row: Operation) {
  return row.id.startsWith("draft-operation-");
}

function parseRuDate(value: string) {
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

function busyOverlapsPeriod(busy: { start_at: string; end_at: string }, period: { from: string; to: string }) {
  return parseRuDate(busy.start_at) < parseRuDate(period.to) && parseRuDate(busy.end_at) > parseRuDate(period.from);
}

export function Plans({ role, access: permissions, view, setView, data, mutate }: { role: RoleKey; access: RoleAccess; view: ViewState; setView: (view: ViewState) => void; data: BootstrapData; mutate: BootstrapMutate }) {
  const access = planAccessForPermissions(permissions);
  const kind = primaryKind(access, role);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planSearch, setPlanSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");
  const clearPlanSelectionRef = useRef<(() => void) | null>(null);
  const { confirm, notify } = useUiFeedback();
  const visiblePlans = data.plans.filter((plan) => canReadPlan(plan, access));
  const visiblePlanIds = new Set(visiblePlans.map((plan) => plan.id));
  const visibleOperations = data.operations.filter((operation) => visiblePlanIds.has(operation.plan_id));
  const normalizedSearch = planSearch.trim().toLowerCase();
  const statusOptions = Array.from(new Set(visiblePlans.map((plan) => displayPlanStatus(plan, kind, access)))).sort((a, b) => a.localeCompare(b, "ru"));
  const usedSectionIds = new Set(visibleOperations.map((operation) => operation.section_id).filter(Boolean));
  const usedOperationIds = new Set(visibleOperations.map((operation) => operation.operation_id).filter(Boolean));
  const sectionOptions = (data.sections || [])
    .filter((section) => usedSectionIds.has(section.id))
    .sort((a, b) => displaySectionName(a.name).localeCompare(displaySectionName(b.name), "ru"));
  const operationOptions = (data.operationCatalog || [])
    .filter((operation) => usedOperationIds.has(operation.id))
    .sort((a, b) => displayOperationName(a.name).localeCompare(displayOperationName(b.name), "ru"));
  const filteredOperationIds = new Set<string>();
  const filteredPlans = visiblePlans.filter((plan) => {
    const displayStatus = displayPlanStatus(plan, kind, access);
    if (statusFilter !== "all" && displayStatus !== statusFilter) return false;

    const planRows = visibleOperations.filter((operation) => operation.plan_id === plan.id);
    const rowsBySelects = planRows.filter((operation) => (
      (sectionFilter === "all" || operation.section_id === sectionFilter)
      && (operationFilter === "all" || operation.operation_id === operationFilter)
    ));
    const hasSelectFilters = sectionFilter !== "all" || operationFilter !== "all";
    if (hasSelectFilters && !rowsBySelects.length) return false;

    const planText = `${planPeriod(plan)} ${displayStatus}`.toLowerCase();
    const planMatchesSearch = !normalizedSearch || planText.includes(normalizedSearch);
    const rowsBySearch = !normalizedSearch
      ? rowsBySelects
      : rowsBySelects.filter((operation) => `${displaySectionName(operation.section_name)} ${displayOperationName(operation.name)}`.toLowerCase().includes(normalizedSearch));
    if (normalizedSearch && !planMatchesSearch && !rowsBySearch.length) return false;

    const rowsToShow = planMatchesSearch ? rowsBySelects : rowsBySearch;
    for (const row of rowsToShow) filteredOperationIds.add(row.id);
    return true;
  });
  const filteredOperations = visibleOperations.filter((operation) => filteredOperationIds.has(operation.id));
  const activeFilterCount = [planSearch.trim(), statusFilter !== "all", sectionFilter !== "all", operationFilter !== "all"].filter(Boolean).length;
  const resetFilters = () => {
    setPlanSearch("");
    setStatusFilter("all");
    setSectionFilter("all");
    setOperationFilter("all");
  };

  if (view.type === "plan") {
    return <PlanDetail kind={view.kind} access={access} edit={view.edit} planId={view.planId} data={data} mutate={mutate} back={() => setView({ type: "list" })} openEdit={() => setView({ type: "plan", kind: view.kind, planId: view.planId, edit: true })} openOperation={(operationId) => setView({ type: "assignment", planId: view.planId, operationId })} />;
  }

  if (view.type === "assignment") {
    return <AssignmentScreen canEditOut={access.out} planId={view.planId} operationId={view.operationId} data={data} mutate={mutate} back={() => setView({ type: "plan", kind: "out", planId: view.planId })} />;
  }

  const createPlanInList = async () => {
    if (creatingPlan) return;
    const section = (data.sections || []).find((item) => item.active);
    const catalogOperation = (data.operationCatalog || []).find((item) => item.active);
    if (!section || !catalogOperation) {
      notify("Для создания плана нужны активные территории и операции в справочниках.", "warning");
      return;
    }
    setCreatingPlan(true);
    try {
      await mutate("/plans", "POST", {
        owner_role: "factory",
        start_date: todayRu(),
        end_date: defaultEndRu(),
        status: "У планировщика фабрики",
        status_code: "draft",
        operations: [{
          section_id: section.id,
          operation_id: catalogOperation.id,
          section_name: section.name,
          section_order: section.order ?? 99,
          name: catalogOperation.name,
          required_staff: 0,
          staff_count: 0,
          outsource_count: 0,
          rate_per_hour: 300
        }]
      }, "План добавлен");
    } finally {
      setCreatingPlan(false);
    }
  };

  return (
    <div className="min-h-[70vh] space-y-3" onClick={() => clearPlanSelectionRef.current?.()}>
      <div className="flex items-center justify-between gap-2" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-xl font-normal">Планы</h2>
        {access.factory && (
          <button className="btn-primary gap-2 disabled:bg-slate-300" disabled={creatingPlan} onClick={createPlanInList}>
            <Plus size={17} /> {creatingPlan ? "Создание..." : "План"}
          </button>
        )}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" onClick={(event) => event.stopPropagation()}>
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1.4fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-normal text-slate-500">Поиск</span>
            <span className="relative block">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                className="field h-10 pl-9"
                value={planSearch}
                onChange={(event) => setPlanSearch(event.target.value)}
                placeholder="Период, территория, операция"
              />
            </span>
          </label>
          <PlanFilterSelect label="Статус" value={statusFilter} onChange={setStatusFilter} options={[["all", "Все"], ...statusOptions.map((status) => [status, status] as [string, string])]} />
          <PlanFilterSelect label="Территория" value={sectionFilter} onChange={setSectionFilter} options={[["all", "Все"], ...sectionOptions.map((section) => [section.id, displaySectionName(section.name)] as [string, string])]} />
          <PlanFilterSelect label="Операция" value={operationFilter} onChange={setOperationFilter} options={[["all", "Все"], ...operationOptions.map((operation) => [operation.id, displayOperationName(operation.name)] as [string, string])]} />
          <button
            className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-normal text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!activeFilterCount}
            onClick={resetFilters}
          >
            Сбросить{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      </section>
      {visiblePlans.length ? (
        filteredPlans.length ? (
          <PlanExcelList
            access={access}
            kind={kind}
            plans={filteredPlans}
            operations={filteredOperations}
            assignments={data.assignments}
            sections={data.sections || []}
            operationCatalog={data.operationCatalog || []}
            mutate={mutate}
            notify={notify}
            confirm={confirm}
            createdPlanId={data.createdPlanId}
            clearSelectionRef={clearPlanSelectionRef}
          />
        ) : (
          <Empty title="Планы не найдены" text="Измените фильтры или сбросьте их, чтобы увидеть планы." />
        )
      ) : (
        <PlansEmpty kind={kind} data={data} />
      )}
    </div>
  );
}

function PlanFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-normal text-slate-500">{label}</span>
      <select className="field h-10" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function PlanExcelList({ access, kind, plans, operations, assignments, sections, operationCatalog, mutate, notify, confirm, createdPlanId, clearSelectionRef }: { access: PlanAccess; kind: PlanKind; plans: Plan[]; operations: Operation[]; assignments: Assignment[]; sections: Section[]; operationCatalog: OperationCatalogItem[]; mutate: BootstrapMutate; notify: (message: string, tone?: ToastTone) => void; confirm: (options: { title: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: ToastTone }) => Promise<boolean>; createdPlanId?: string; clearSelectionRef?: MutableRefObject<(() => void) | null> }) {
  const [selectedPlanId, setSelectedPlanId] = useState(createdPlanId || "");
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const seenPlanIdsRef = useRef<Set<string>>(new Set(plans.map((plan) => plan.id)));
  const [collapsedPlanIds, setCollapsedPlanIds] = useState<Set<string>>(() => new Set(plans.map((plan) => plan.id).filter((id) => id !== createdPlanId)));
  const visiblePlanIds = new Set(plans.map((plan) => plan.id));
  const visibleOperations = operations.filter((operation) => visiblePlanIds.has(operation.plan_id));
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const selectedOperation = operations.find((operation) => operation.id === selectedOperationId && operation.plan_id === selectedPlanId);
  const selectedEditAccess = selectedPlan ? editAccessForPlan(access, selectedPlan, kind) : undefined;
  const selectedSendKind = selectedPlan && selectedEditAccess ? sendKindForPlan(selectedEditAccess, selectedPlan) : null;
  const totalRequired = visibleOperations.reduce((sum, operation) => sum + numberValue(operation.required_staff), 0);
  const totalStaff = visibleOperations.reduce((sum, operation) => sum + numberValue(operation.staff_count), 0);
  const totalOutsource = visibleOperations.reduce((sum, operation) => sum + calculateOutsource(operation.required_staff, operation.staff_count), 0);
  const allPlansCollapsed = plans.length > 0 && plans.every((plan) => collapsedPlanIds.has(plan.id));
  useEffect(() => {
    const nextVisiblePlanIds = new Set(plans.map((plan) => plan.id));
    const newPlanIds = plans.map((plan) => plan.id).filter((id) => !seenPlanIdsRef.current.has(id));
    if (!newPlanIds.length && seenPlanIdsRef.current.size === nextVisiblePlanIds.size) return;
    setCollapsedPlanIds((current) => {
      const next = new Set([...current].filter((id) => nextVisiblePlanIds.has(id)));
      for (const id of newPlanIds) next.delete(id);
      return next;
    });
    if (newPlanIds[0]) {
      setSelectedPlanId(newPlanIds[0]);
      setSelectedOperationId("");
    }
    seenPlanIdsRef.current = nextVisiblePlanIds;
  }, [plans]);
  useEffect(() => {
    if (!createdPlanId || !plans.some((plan) => plan.id === createdPlanId)) return;
    setCollapsedPlanIds((current) => {
      const next = new Set(current);
      next.delete(createdPlanId);
      return next;
    });
    setSelectedPlanId(createdPlanId);
    setSelectedOperationId("");
  }, [createdPlanId, plans]);
  const togglePlanCollapsed = (planId: string) => {
    setCollapsedPlanIds((current) => {
      const next = new Set(current);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };
  const toggleAllPlansCollapsed = () => {
    setCollapsedPlanIds(allPlansCollapsed ? new Set() : new Set(plans.map((plan) => plan.id)));
  };
  const clearSelection = () => {
    setSelectedPlanId("");
    setSelectedOperationId("");
  };
  useEffect(() => {
    if (!clearSelectionRef) return;
    clearSelectionRef.current = clearSelection;
    return () => {
      if (clearSelectionRef.current === clearSelection) clearSelectionRef.current = null;
    };
  }, [clearSelectionRef]);
  const createOperation = async (plan: Plan, source?: Operation) => {
    const section = source?.section_id ? sections.find((item) => item.id === source.section_id) : sections.find((item) => item.active);
    const catalogOperation = source?.operation_id ? operationCatalog.find((item) => item.id === source.operation_id) : operationCatalog.find((item) => item.active);
    if (!section || !catalogOperation) {
      notify("Для добавления строки нужны активные территории и операции в справочниках.", "warning");
      return;
    }
    await mutate("/operations", "POST", {
      plan_id: plan.id,
      section_id: section.id,
      operation_id: catalogOperation.id,
      name: catalogOperation.name,
      required_staff: source ? numberValue(source.required_staff) : 0,
      staff_count: source ? numberValue(source.staff_count) : 0,
      outsource_count: source ? calculateOutsource(source.required_staff, source.staff_count) : 0,
      rate_per_hour: source ? numberValue(source.rate_per_hour, 300) : 300
    }, source ? "Строка продублирована" : "Строка добавлена");
  };
  const removeOperation = async (plan: Plan, operation: Operation) => {
    const planRows = operations.filter((row) => row.plan_id === plan.id);
    if (planRows.length <= 1) {
      const ok = await confirm({
        title: "Удалить план?",
        message: `Это последняя строка. План ${planPeriod(plan)} будет удален полностью.`,
        confirmLabel: "Удалить",
        cancelLabel: "Отменить",
        tone: "error"
      });
      if (!ok) return;
      await mutate(`/plans/${plan.id}`, "DELETE", undefined, "План удален");
      return;
    }
    const ok = await confirm({
      title: "Удалить строку?",
      message: `${displaySectionName(operation.section_name)} / ${displayOperationName(operation.name)}`,
      confirmLabel: "Удалить",
      cancelLabel: "Отменить",
      tone: "warning"
    });
    if (!ok) return;
    await mutate(`/operations/${operation.id}`, "DELETE", undefined, "Строка удалена");
  };
  const removeSelected = async () => {
    if (!selectedPlan || !selectedEditAccess?.factory) return;
    if (selectedOperation) {
      await removeOperation(selectedPlan, selectedOperation);
      setSelectedOperationId("");
      return;
    }
    const ok = await confirm({
      title: "Удалить план?",
      message: `План ${planPeriod(selectedPlan)} будет удален вместе со строками, назначениями и фактами.`,
      confirmLabel: "Удалить",
      cancelLabel: "Отменить",
      tone: "error"
    });
    if (!ok) return;
    await mutate(`/plans/${selectedPlan.id}`, "DELETE", undefined, "План удален");
    setSelectedPlanId("");
    setSelectedOperationId("");
  };
  const copyPlan = async (plan: Plan) => {
    const rows = operations.filter((operation) => operation.plan_id === plan.id);
    if (!rows.length) {
      notify("В плане нет строк для копирования.", "warning");
      return;
    }
    await mutate("/plans", "POST", {
      owner_role: "factory",
      start_date: plan.start_date,
      end_date: plan.end_date,
      status: "У планировщика фабрики",
      status_code: "draft",
      operations: rows.map(operationCreatePayload)
    }, "План скопирован");
  };
  const sendPlan = async (plan: Plan) => {
    const rows = operations.filter((operation) => operation.plan_id === plan.id);
    const editAccess = editAccessForPlan(access, plan, kind);
    const sendKind = sendKindForPlan(editAccess, plan);
    if (!sendKind) return;
    if (!rows.length) {
      notify("В плане нет строк для отправки.", "warning");
      return;
    }
    const invalidRows = rows.flatMap((row) => {
      const missing: string[] = [];
      if (sendKind === "factory") {
        if (!row.section_id) missing.push("территория");
        if (!row.operation_id) missing.push("операция");
        if (numberValue(row.required_staff) <= 0) missing.push("персонал");
      }
      if (sendKind === "out" && numberValue(row.rate_per_hour) <= 0) missing.push("ставка");
      return missing.length ? [`${displaySectionName(row.section_name)} / ${displayOperationName(row.name)}: ${missing.join(", ")}`] : [];
    });
    if (invalidRows.length) {
      notify(`Проверьте поля: ${invalidRows[0]}`, "warning");
      return;
    }
    if (sendKind === "out") {
      const notReady = rows.some((operation) => {
        const need = calculateOutsource(operation.required_staff, operation.staff_count);
        const assigned = assignments.filter((assignment) => assignment.operation_id === operation.id).length;
        return assigned < need;
      });
      if (notReady) {
        notify("Нужно распределить временный персонал по всем операциям перед отправкой.", "warning");
        return;
      }
    }
    const question = sendKind === "factory" ? "Отправить план HR?" : sendKind === "hr" ? "Отправить план аутсорсеру?" : "Отправить план на согласование?";
    if (!await confirm({ title: "Отправка плана", message: question, confirmLabel: "Отправить" })) return;
    const status_code = sendKind === "factory" ? "submitted_to_hr" : sendKind === "hr" ? "received_by_outsourcer" : "on_approval";
    await mutate(`/plans/${plan.id}`, "PUT", { status_code }, sendKind === "factory" ? "План отправлен в HR" : sendKind === "hr" ? "План отправлен аутсорсеру" : "План отправлен на согласование");
  };
  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm" onClick={clearSelection}>
      <div className="sticky top-[57px] z-20 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur lg:top-0" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0">
          <p className="text-xs font-normal uppercase text-slate-500">Выбранный план</p>
          <p className="truncate text-sm font-normal text-refDark">{selectedPlan ? planPeriod(selectedPlan) : "Не выбран"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToolbarAction title={allPlansCollapsed ? "Развернуть все планы" : "Свернуть все планы"} disabled={!plans.length} onClick={toggleAllPlansCollapsed}>
            {allPlansCollapsed ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {allPlansCollapsed ? "Развернуть все" : "Свернуть все"}
          </ToolbarAction>
          <ToolbarAction title={selectedOperation ? "Копировать запись" : "Копировать план"} disabled={!selectedPlan || !access.factory || (Boolean(selectedOperation) && !selectedEditAccess?.factory)} onClick={() => selectedPlan && (selectedOperation ? createOperation(selectedPlan, selectedOperation) : copyPlan(selectedPlan))}>
            <Copy size={16} /> Копировать
          </ToolbarAction>
          <ToolbarAction title="Отправить план" primary disabled={!selectedPlan || !selectedSendKind} onClick={() => selectedPlan && sendPlan(selectedPlan)}>
            <Send size={16} /> Отправить
          </ToolbarAction>
          <ToolbarAction title="Добавить строку" disabled={!selectedPlan || !selectedEditAccess?.factory} onClick={() => selectedPlan && createOperation(selectedPlan)}>
            <Plus size={16} /> Добавить
          </ToolbarAction>
          <ToolbarAction title={selectedOperation ? "Удалить запись" : "Удалить план"} danger disabled={!selectedPlan || !selectedEditAccess?.factory} onClick={removeSelected}>
            <Trash2 size={16} /> Удалить
          </ToolbarAction>
        </div>
      </div>
      <div className="overflow-hidden rounded-b-lg" onClick={clearSelection}>
      <table className="w-full table-fixed border-collapse text-[11px] sm:text-xs xl:text-sm">
        <colgroup>
          <col className="w-10 xl:w-12" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[18%]" />
          <col className="w-[24%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-white text-xs font-normal uppercase text-slate-500 shadow-sm">
          <tr>
            <Th>{""}</Th>
            <Th short="Стат.">Статус</Th>
            <Th short="Нач.">Начало</Th>
            <Th short="Окон.">Окончание</Th>
            <Th short="Терр.">Территория</Th>
            <Th short="Опер.">Операция</Th>
            <Th numeric short="Перс.">Персонал</Th>
            <Th numeric>Штат</Th>
            <Th numeric short="Аутс.">Аутсорсинг</Th>
          </tr>
        </thead>
        <tbody>
          {plans.flatMap((plan) => {
            const rows = operations.filter((operation) => operation.plan_id === plan.id);
            const editAccess = editAccessForPlan(access, plan, kind);
            const displayStatus = displayPlanStatus(plan, kind, access);
            const rowSendKind = sendKindForPlan(editAccess, plan);
            const collapsed = collapsedPlanIds.has(plan.id);
            const canCollapse = rows.length > 0;
            const planRequired = rows.reduce((sum, operation) => sum + numberValue(operation.required_staff), 0);
            const planStaff = rows.reduce((sum, operation) => sum + numberValue(operation.staff_count), 0);
            const planOutsource = rows.reduce((sum, operation) => sum + calculateOutsource(operation.required_staff, operation.staff_count), 0);
            const planSelected = selectedPlanId === plan.id && !selectedOperationId;
            const planRow = (
              <tr
                key={`${plan.id}-plan`}
                className={`border-t-2 border-slate-300 bg-emerald-50/40 hover:bg-emerald-50 ${planSelected ? "border-l-4 border-l-refGreen bg-emerald-100 shadow-[inset_0_0_0_2px_rgba(0,122,83,0.28)]" : "border-l-4 border-l-transparent"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedPlanId(plan.id);
                  setSelectedOperationId("");
                }}
                onDoubleClick={() => togglePlanCollapsed(plan.id)}
              >
                <Td>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-refGreen text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    type="button"
                    disabled={!rowSendKind}
                    title="Отправить план"
                    onClick={(event) => {
                      event.stopPropagation();
                      void sendPlan(plan);
                    }}
                  >
                    <Send size={16} />
                  </button>
                </Td>
                <Td className="text-left">
                  <span className={`inline-flex max-w-full items-center rounded-full bg-white px-1.5 py-1 text-[10px] font-normal leading-none ring-1 ring-slate-200 xl:px-2.5 xl:text-xs ${statusTone(displayStatus)}`}>
                    <span className="truncate">{displayStatus}</span>
                  </span>
                </Td>
                <Td>
                  <div className="flex min-w-0 items-center justify-center gap-1">
                    {canCollapse ? (
                      <button
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-refGreen"
                        type="button"
                        title={collapsed ? "Развернуть" : "Свернуть"}
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePlanCollapsed(plan.id);
                        }}
                      >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                    ) : (
                      <span className="h-6 w-6 shrink-0" />
                    )}
                    <PlanDateInput value={plan.start_date} editable={editAccess.factory} onSave={(value) => mutate(`/plans/${plan.id}`, "PUT", { start_date: value }, "Дата сохранена")} />
                  </div>
                </Td>
                <Td><PlanDateInput value={plan.end_date} editable={editAccess.factory} onSave={(value) => mutate(`/plans/${plan.id}`, "PUT", { end_date: value }, "Дата сохранена")} /></Td>
                <Td>{""}</Td>
                <Td className="text-left"><span className="inline-flex max-w-full rounded-full bg-white px-1.5 py-1 text-[10px] font-normal leading-none text-slate-600 ring-1 ring-slate-200 xl:px-2.5 xl:text-xs"><span className="truncate">{rows.length ? `Записей: ${rows.length}` : "Нет записей"}</span></span></Td>
                <Td numeric className="font-normal text-refDark">{planRequired}</Td>
                <Td numeric className="font-normal text-refDark">{planStaff}</Td>
                <Td numeric className="font-normal text-refDark">{planOutsource}</Td>
              </tr>
            );
            const operationRows = collapsed ? [] : rows.map((operation) => (
              <tr
                key={`${plan.id}-${operation.id}`}
                className={`border-t border-slate-100 bg-white hover:bg-emerald-50/30 ${selectedPlanId === plan.id && selectedOperationId === operation.id ? "border-l-4 border-l-refGreen bg-emerald-100 shadow-[inset_0_0_0_2px_rgba(0,122,83,0.24)]" : "border-l-4 border-l-transparent"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedPlanId(plan.id);
                  setSelectedOperationId(operation.id);
                }}
              >
                <Td colSpan={3} className="text-left"><CatalogCell mode="section" operation={operation} editable={editAccess.factory} sections={sections} operationCatalog={operationCatalog} mutate={mutate} /></Td>
                <Td colSpan={3} className="text-left"><CatalogCell mode="operation" operation={operation} editable={editAccess.factory} sections={sections} operationCatalog={operationCatalog} mutate={mutate} /></Td>
                <Td numeric><NumberCell value={operation.required_staff} editable={editAccess.factory} onSave={(value) => mutate(`/operations/${operation.id}`, "PUT", { required_staff: value }, "Персонал сохранен")} /></Td>
                <Td numeric><NumberCell value={operation.staff_count} editable={editAccess.hr} onSave={(value) => mutate(`/operations/${operation.id}`, "PUT", { staff_count: value, outsource_count: calculateOutsource(operation.required_staff, value) }, "Штат сохранен")} /></Td>
                <Td numeric>{calculateOutsource(operation.required_staff, operation.staff_count)}</Td>
              </tr>
            ));
            const addOperationRow = !collapsed && editAccess.factory ? (
              <tr key={`${plan.id}-add-operation`} className="border-t border-dashed border-slate-200 bg-slate-50/60">
                <Td>{""}</Td>
                <Td colSpan={8} className="text-left">
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-refGreen bg-white px-3 text-sm font-normal text-refGreen transition hover:bg-emerald-50"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPlanId(plan.id);
                      setSelectedOperationId("");
                      void createOperation(plan);
                    }}
                  >
                    <Plus size={16} /> Добавить операцию
                  </button>
                </Td>
              </tr>
            ) : null;
            return [planRow, ...operationRows, addOperationRow].filter(Boolean);
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-slate-100 font-normal text-refDark">
          <tr className="border-t-2 border-slate-300">
            <Td>Итого</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td numeric>{totalRequired}</Td>
            <Td numeric>{totalStaff}</Td>
            <Td numeric>{totalOutsource}</Td>
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}

function CatalogCell({ mode, operation, editable, sections, operationCatalog, mutate }: { mode: "section" | "operation"; operation: Operation; editable: boolean; sections: Section[]; operationCatalog: OperationCatalogItem[]; mutate: BootstrapMutate }) {
  const [open, setOpen] = useState(false);
  const entries = mode === "section" ? buildSectionTree(sections) : buildOperationTree(operationCatalog);
  const selectedId = mode === "section" ? operation.section_id ? `section:${operation.section_id}` : "" : operation.operation_id ? `operation:${operation.operation_id}` : "";
  const label = mode === "section" ? displaySectionName(operation.section_name) : displayOperationName(operation.name);
  const select = async (entry: PickerEntry) => {
    if (!editable) return;
    if (mode === "section") {
      const section = sections.find((item) => item.id === entry.id);
      await mutate(`/operations/${operation.id}`, "PUT", {
        section_id: section?.id,
        section_name: section?.name || "",
        section_order: section?.order ?? operation.section_order
      }, "Территория сохранена");
    } else {
      const catalogOperation = operationCatalog.find((item) => item.id === entry.id);
      await mutate(`/operations/${operation.id}`, "PUT", {
        operation_id: catalogOperation?.id,
        name: catalogOperation?.name || entry.name
      }, "Операция сохранена");
    }
    setOpen(false);
  };

  if (!editable) return <span className="block truncate">{label}</span>;

  return (
    <>
      <button className="h-8 w-full truncate rounded bg-slate-100 px-2 text-left text-sm font-normal text-refDark outline-none ring-1 ring-slate-200 transition hover:bg-emerald-50 focus:bg-white focus:ring-2 focus:ring-refGreen/30" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <CatalogPicker
          title={mode === "section" ? "Выбор территории" : "Выбор операции"}
          emptyText={mode === "section" ? "Нет территорий." : "Нет операций."}
          entries={entries}
          selectedId={selectedId}
          selectable={() => true}
          onSelect={select}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ToolbarAction({ children, title, primary, danger, disabled, onClick }: { children: ReactNode; title: string; primary?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  const tone = danger
    ? "bg-red-50 text-red-600 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400"
    : primary
      ? "bg-refGreen text-white hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-white"
      : "bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:text-slate-400";
  return (
    <button className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-normal transition disabled:cursor-not-allowed ${tone}`} type="button" title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function PlanDateInput({ value, editable, onSave }: { value: string; editable: boolean; onSave: (value: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editable) return <span className="font-normal">{value}</span>;
  return (
    <input
      className="h-8 w-full min-w-0 rounded border border-slate-300 px-1 text-center font-normal outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20 xl:px-2"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
    />
  );
}

function NumberCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (value: number) => Promise<unknown> }) {
  const displayValue = (nextValue: unknown) => numberValue(nextValue) === 0 ? "" : String(nextValue ?? 0);
  const [draft, setDraft] = useState(displayValue(value));
  const lastSavedRef = useRef(numberValue(value));
  useEffect(() => {
    const nextValue = numberValue(value);
    setDraft(displayValue(value));
    lastSavedRef.current = nextValue;
  }, [value]);
  const save = () => {
    const next = numberValue(draft);
    if (next !== lastSavedRef.current) {
      lastSavedRef.current = next;
      void onSave(next);
    }
  };
  if (!editable) return <span className="font-normal">{value ?? 0}</span>;
  return (
    <input
      className="h-8 w-full min-w-0 rounded border border-slate-300 px-1 text-center font-normal outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20 xl:px-2"
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Th({ children, numeric, short }: { children: string; numeric?: boolean; short?: string }) {
  return (
    <th className={`break-words border-r border-slate-200 px-1.5 py-2 leading-tight last:border-r-0 xl:px-2 ${numeric ? "text-right" : "text-left"}`}>
      {short ? (
        <>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{children}</span>
        </>
      ) : children}
    </th>
  );
}

function Td({ children, numeric, className = "", colSpan }: { children: ReactNode; numeric?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={`max-w-0 overflow-hidden border-r border-slate-200 px-1.5 py-2 align-middle font-normal last:border-r-0 xl:px-2 ${numeric ? "text-right tabular-nums" : "text-center"} ${className}`}>{children}</td>;
}

function NewPlanDetail({ access, data, mutate, back }: { access: PlanAccess; data: BootstrapData; mutate: BootstrapMutate; back: () => void }) {
  const [initialDraft] = useState(createNewPlanDraft);
  const [dates, setDates] = useState(initialDraft.dates);
  const [drafts, setDrafts] = useState(initialDraft.operations);
  const [saving, setSaving] = useState(false);
  const { confirm, notify } = useUiFeedback();
  const changed = dates.start_date !== initialDraft.dates.start_date || dates.end_date !== initialDraft.dates.end_date || drafts.length > 0;
  const requiredStaff = drafts.reduce((sum, row) => sum + numberValue(row.required_staff), 0);
  const staffCount = drafts.reduce((sum, row) => sum + numberValue(row.staff_count), 0);
  const plan: Plan = {
    id: NEW_PLAN_ID,
    owner_role: "factory",
    start_date: dates.start_date,
    end_date: dates.end_date,
    status: "У планировщика фабрики",
    status_code: "draft",
    title: "План",
    required_staff: requiredStaff,
    staff_count: staffCount,
    outsource_count: calculateOutsource(requiredStaff, staffCount)
  };
  const editAccess: PlanEditAccess = {
    factory: access.factory,
    hr: access.hr,
    out: false
  };

  const cancel = async () => {
    if (!changed) {
      back();
      return;
    }
    const discard = await confirm({
      title: "Выйти без сохранения?",
      message: "Несохраненный план и добавленные операции будут отброшены.",
      confirmLabel: "Выйти",
      cancelLabel: "Остаться",
      tone: "warning"
    });
    if (discard) back();
  };

  const save = async () => {
    if (saving) return;
    if (missingSectionRows(drafts).length || missingOperationRows(drafts).length) {
      notify("Выберите территорию и операцию из справочников", "warning");
      return;
    }
    setSaving(true);
    try {
      const next = await mutate("/plans", "POST", {
        owner_role: "factory",
        start_date: dates.start_date,
        end_date: dates.end_date,
        status: "У планировщика фабрики",
        status_code: "draft",
        operations: drafts.map(operationCreatePayload)
      }, "План сохранен");
      if (next) back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal" onClick={cancel}>Назад</button>
      </div>
      <PlanHeader plan={plan} displayStatus={displayPlanStatusForRole(plan, "factory")} dates={dates} setDates={setDates} edit />
      <PlanFlowNotice kind="factory" plan={plan} />
      <PlanEditor
        kind="factory"
        editAccess={editAccess}
        sections={data.sections || []}
        operationCatalog={data.operationCatalog || []}
        drafts={drafts}
        setDrafts={setDrafts}
        onRemoveOperation={(row) => setDrafts(drafts.filter((draft) => draft.id !== row.id))}
        onAddOperation={() => setDrafts([...drafts, createDraftOperation(drafts.length + 1)])}
      />
      <div className="mt-2 flex items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-panel">
        <button className="rounded-md bg-slate-300 px-4 py-2 text-sm font-normal disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" disabled={saving} onClick={save}>
          <Save size={16} className="inline" /> {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function PlansEmpty({ kind, data }: { kind: PlanKind; data: BootstrapData }) {
  const factoryPlans = data.plans.filter((plan) => plan.owner_role === "factory");
  const plansWithOutsource = factoryPlans.filter((plan) => calculateOutsource(plan.required_staff, plan.staff_count) > 0);

  if (kind === "factory") {
    return (
      <Empty
        title="Планов пока нет"
        text="Создайте первый план численности персонала. После отправки он уйдет в HR для заполнения штатного персонала."
        steps={["Нажмите «План».", "Добавьте территории и операции.", "Отправьте план в HR."]}
      />
    );
  }

  if (kind === "hr") {
    const waitingFactory = factoryPlans.some((plan) => planStatusCode(plan) === "draft");
    return (
      <Empty
        title="Нет планов для HR"
        text={waitingFactory ? "Фабрика еще готовит план. Он появится здесь после отправки из роли «Фабрика»." : "HR видит только планы, отправленные фабрикой."}
        steps={["Проверьте роль «Фабрика».", "У плана должен быть статус «Отправлено».", "После этого HR заполнит штат и отправит план аутсорсеру."]}
      />
    );
  }

  if (!plansWithOutsource.length) {
    return (
      <Empty
        title="Аутсорсинг не требуется"
        text="В текущих планах потребность закрыта штатным персоналом, поэтому распределять временный персонал не нужно."
        steps={["HR заполняет поле «Штат».", "Если штат меньше потребности, аутсорсинг посчитается автоматически.", "Тогда план появится у аутсорсера."]}
      />
    );
  }

  return (
    <Empty
      title="Нет планов для распределения"
      text="План с потребностью в аутсорсинге есть, но он еще не передан аутсорсеру в рабочем статусе."
      steps={["HR должен заполнить штатный персонал.", "HR нажимает «Отправить».", "После статуса «Получено» план появится здесь для распределения сотрудников."]}
    />
  );
}

function PlanDetail({ kind, access, planId, edit, data, mutate, back, openEdit, openOperation }: { kind: PlanKind; access: PlanAccess; planId: string; edit?: boolean; data: BootstrapData; mutate: BootstrapMutate; back: () => void; openEdit: () => void; openOperation: (operationId: string) => void }) {
  const plan = data.plans.find((item) => item.id === planId);
  const operations = data.operations.filter((operation) => operation.plan_id === planId);
  const [drafts, setDrafts] = useState(() => operations.map((operation) => ({ ...operation })));
  const [dates, setDates] = useState({ start_date: plan?.start_date || todayRu(), end_date: plan?.end_date || defaultEndRu() });
  const { confirm, notify } = useUiFeedback();

  useEffect(() => {
    setDrafts(operations.map((operation) => ({ ...operation })));
    setDates({ start_date: plan?.start_date || todayRu(), end_date: plan?.end_date || defaultEndRu() });
  }, [planId, data.operations.length]);

  if (!plan) return <Empty text="План не найден" />;
  const editAccess = editAccessForPlan(access, plan, kind);
  const editable = hasEditAccess(editAccess);
  const isEdit = Boolean(edit && editable);
  const sendKind = sendKindForPlan(editAccess, plan);
  const canDeletePlan = access.admin || editAccess.factory;

  const save = async () => {
    if (editAccess.factory && (missingSectionRows(drafts).length || missingOperationRows(drafts).length)) {
      notify("Выберите территорию и операцию из справочников", "warning");
      return;
    }
    if (editAccess.factory) {
      await mutate(`/plans/${plan.id}`, "PUT", dates, "Период сохранен");
    }
    for (const row of drafts) {
      const required = numberValue(row.required_staff);
      const staff = numberValue(row.staff_count);
      const method = isDraftOperation(row) ? "POST" : "PUT";
      const path = isDraftOperation(row) ? "/operations" : `/operations/${row.id}`;
      await mutate(path, method, {
        ...(isDraftOperation(row) ? { plan_id: plan.id } : {}),
        ...(editAccess.factory ? { name: row.name, section_id: row.section_id, operation_id: row.operation_id, required_staff: required } : {}),
        ...(editAccess.hr ? { staff_count: staff, outsource_count: calculateOutsource(required, staff) } : {}),
        ...(editAccess.out ? { rate_per_hour: numberValue(row.rate_per_hour, 300) } : {})
      }, "Сохранено");
    }
  };
  const removeOperation = async (row: Operation) => {
    if (isDraftOperation(row)) {
      setDrafts(drafts.filter((draft) => draft.id !== row.id));
      return;
    }
    const ok = await confirm({
      title: "Удалить операцию?",
      message: `${displaySectionName(row.section_name)} / ${displayOperationName(row.name)}`,
      confirmLabel: "Удалить",
      cancelLabel: "Отменить",
      tone: "warning"
    });
    if (!ok) return;
    await mutate(`/operations/${row.id}`, "DELETE", undefined, "Операция удалена");
    setDrafts(drafts.filter((draft) => draft.id !== row.id));
  };

  const send = async () => {
    if (!sendKind) return;
    if (sendKind === "factory" && (missingSectionRows(drafts).length || missingOperationRows(drafts).length)) {
      notify("Выберите территорию и операцию из справочников", "warning");
      return;
    }
    const invalidRows = drafts.flatMap((row) => {
      const missing: string[] = [];
      if (sendKind === "factory") {
        if (!row.section_id) missing.push("территория");
        if (!row.operation_id) missing.push("операция");
        if (numberValue(row.required_staff) <= 0) missing.push("персонал");
      }
      if (sendKind === "out" && numberValue(row.rate_per_hour) <= 0) missing.push("ставка/час");
      return missing.length ? [`${displaySectionName(row.section_name)} / ${displayOperationName(row.name)}: ${missing.join(", ")}`] : [];
    });
    if (invalidRows.length) {
      notify(`Проверьте поля: ${invalidRows[0]}`, "warning");
      return;
    }
    if (sendKind === "out") {
      const notReady = operations.some((operation) => {
        const need = calculateOutsource(operation.required_staff, operation.staff_count);
        const assigned = data.assignments.filter((assignment) => assignment.operation_id === operation.id).length;
        return assigned < need;
      });
      if (notReady) {
        notify("Нужно распределить временный персонал по всем операциям перед отправкой на согласование.", "warning");
        return;
      }
    }
    const question = sendKind === "factory" ? "Отправить план HR?" : sendKind === "hr" ? "Отправить план Аутсорсеру?" : "Отправить план на согласование?";
    if (!await confirm({ title: "Отправка плана", message: question, confirmLabel: "Отправить" })) return;
    await save();
    const status_code = sendKind === "factory" ? "submitted_to_hr" : sendKind === "hr" ? "received_by_outsourcer" : "on_approval";
    await mutate(`/plans/${plan.id}`, "PUT", { status_code }, sendKind === "factory" ? "План отправлен в HR" : sendKind === "hr" ? "План отправлен аутсорсеру" : "План отправлен на согласование");
    back();
  };

  const approveOutsourcePlan = async () => {
    if (!await confirm({
      title: "Согласование аутсорсера",
      message: "Утвердить распределение аутсорсера и передать план мастерам?",
      confirmLabel: "Утвердить"
    })) return;
    await mutate(`/plans/${plan.id}`, "PUT", { status_code: "approved" }, "План утвержден и передан мастерам");
    back();
  };

  const returnOutsourcePlan = async () => {
    if (!await confirm({
      title: "Вернуть аутсорсеру",
      message: "Вернуть план аутсорсеру на доработку распределения?",
      confirmLabel: "Вернуть",
      tone: "warning"
    })) return;
    await mutate(`/plans/${plan.id}`, "PUT", { status_code: "rejected" }, "План возвращен аутсорсеру");
    back();
  };

  const deletePlan = async () => {
    if (!await confirm({
      title: "Удалить план?",
      message: `План ${planPeriod(plan)} будет удален вместе со строками, назначениями и фактами.`,
      confirmLabel: "Удалить",
      cancelLabel: "Отменить",
      tone: "error"
    })) return;
    await mutate(`/plans/${plan.id}`, "DELETE", undefined, "План удален");
    back();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal" onClick={back}>Назад</button>
        <div className="flex gap-2">
          {access.admin && <button className="inline-flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-normal text-red-600 hover:bg-red-100" onClick={deletePlan}><Trash2 size={16} /> Удалить</button>}
          {!edit && editable && <button className="btn-primary gap-2" onClick={openEdit}><Pencil size={16} /> Редактировать</button>}
        </div>
      </div>
      <PlanHeader plan={plan} displayStatus={displayPlanStatus(plan, kind, access)} dates={dates} setDates={setDates} edit={isEdit && editAccess.factory} />
      <PlanFlowNotice kind={kind} plan={plan} />
      {edit && !editable && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-normal text-red-700">План уже отправлен. Редактирование закрыто.</div>}
      {isEdit ? (
        <PlanEditor kind={kind} editAccess={editAccess} sections={data.sections || []} operationCatalog={data.operationCatalog || []} drafts={drafts} setDrafts={setDrafts} planId={plan.id} onRemoveOperation={removeOperation} />
      ) : (
        <PlanTable kind={access.out ? "out" : kind} editAccess={{ factory: false, hr: false, out: access.out }} operations={operations} openOperation={openOperation} assignments={data.assignments} employees={data.employees} />
      )}
      {isEdit && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-panel">
          {canDeletePlan && !access.admin && <button className="rounded-md p-2 text-red-600" onClick={deletePlan}><Trash2 /></button>}
          <div className="ml-auto flex gap-2">
            <button className="rounded-md bg-slate-300 px-4 py-2 text-sm font-normal" onClick={save}><Save size={16} className="inline" /> Сохранить</button>
            <button className="btn-primary gap-2" onClick={send}><Send size={16} /> Отправить</button>
          </div>
        </div>
      )}
      {!isEdit && access.outApprove && planStatusCode(plan) === "on_approval" && (
        <div className="mt-2 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm sm:grid-cols-2">
          <button className="h-11 rounded-md bg-orange-500 px-4 text-sm font-normal text-white" onClick={returnOutsourcePlan}>
            Вернуть аутсорсеру
          </button>
          <button className="btn-primary" onClick={approveOutsourcePlan}>
            Утвердить и передать мастерам
          </button>
        </div>
      )}
    </div>
  );
}

function PlanFlowNotice({ kind, plan }: { kind: PlanKind; plan: Plan }) {
  const text = planApprovalText(plan);
  const code = planStatusCode(plan);
  if (!text && !(kind === "out" && code === "received_by_outsourcer")) return null;
  const body =
    kind === "out" && code === "received_by_outsourcer"
      ? "После распределения временного персонала план уйдет на согласование."
      : text;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-normal text-blue-800">
      {body}
    </div>
  );
}

function PlanHeader({ plan, displayStatus = internalPlanStatusLabel(plan), dates, setDates, edit }: { plan: Plan; displayStatus?: string; dates: { start_date: string; end_date: string }; setDates: (value: { start_date: string; end_date: string }) => void; edit: boolean }) {
  if (edit) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[12rem_12rem_1fr]">
          <label className="text-[11px] font-normal uppercase text-slate-500">
            Начало работ
            <input className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-center text-sm font-normal text-refDark outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" value={dates.start_date} onChange={(e) => setDates({ ...dates, start_date: e.target.value })} />
          </label>
          <label className="text-[11px] font-normal uppercase text-slate-500">
            Окончание работ
            <input className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-center text-sm font-normal text-refDark outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" value={dates.end_date} onChange={(e) => setDates({ ...dates, end_date: e.target.value })} />
          </label>
          <div className="text-[11px] font-normal uppercase text-slate-500">
            Статус
            <div className="mt-1 flex h-9 items-center rounded border border-slate-200 bg-slate-50 px-2 text-sm font-normal normal-case text-refDark">{displayStatus}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-refGreen p-3 text-white">
      <div className="grid grid-cols-3 gap-2 text-center text-xs font-normal">
        <div>Начало работ<br />{edit ? <input className="mt-1 w-full rounded px-2 py-1 text-center text-refDark" value={dates.start_date} onChange={(e) => setDates({ ...dates, start_date: e.target.value })} /> : plan.start_date}</div>
        <div>Окончание работ<br />{edit ? <input className="mt-1 w-full rounded px-2 py-1 text-center text-refDark" value={dates.end_date} onChange={(e) => setDates({ ...dates, end_date: e.target.value })} /> : plan.end_date}</div>
        <div>Статус<br />{displayStatus}</div>
      </div>
    </div>
  );
}

function PlanTable({ kind, editAccess, operations, openOperation, assignments, employees }: { kind: PlanKind; editAccess?: PlanEditAccess; operations: Operation[]; openOperation: (operationId: string) => void; assignments: Assignment[]; employees: Employee[] }) {
  return (
    <div className="space-y-3">
      {operationGroups(operations).map(({ section, rows }) => (
        <section key={section}>
          <SectionTitle title={displaySectionName(section)} count={rows.reduce((sum, row) => sum + numberValue(kind === "factory" ? row.required_staff : kind === "hr" ? row.staff_count : row.outsource_count), 0)} />
          <div className="space-y-1.5">
            {rows.map((row) => {
              const assigned = assignments.filter((item) => item.operation_id === row.id).map((item) => {
                const employee = employees.find((candidate) => candidate.id === item.employee_id);
                return employee ? displayEmployeeName(employee) : "";
              }).filter(Boolean);
              return (
                <PlanOperationCard key={row.id} kind={kind} editAccess={editAccess} row={row} assigned={assigned} onOpen={() => openOperation(row.id)} />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function AssignmentScreen({ canEditOut, planId, operationId, data, mutate, back }: { canEditOut: boolean; planId: string; operationId: string; data: BootstrapData; mutate: BootstrapMutate; back: () => void }) {
  const operation = data.operations.find((item) => item.id === operationId);
  const plan = data.plans.find((item) => item.id === planId);
  const operationAssignments = data.assignments.filter((item) => item.operation_id === operationId);
  const assignedEmployees = operationAssignments.map((assignment) => ({
    assignment,
    employee: data.employees.find((employee) => employee.id === assignment.employee_id)
  }));
  const needed = Math.max(calculateOutsource(operation?.required_staff, operation?.staff_count), assignedEmployees.length, 1);
  const slots = Array.from({ length: needed }, (_, index) => assignedEmployees[index] || null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const { confirm } = useUiFeedback();

  if (!operation || !plan) return <Empty text="Операция не найдена" />;
  const editable = canEditOut && canEditPlan("out", plan);

  return (
    <div className="space-y-3">
      <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal" onClick={back}>Назад</button>
      <PlanHeader plan={plan} dates={{ start_date: plan.start_date, end_date: plan.end_date }} setDates={() => undefined} edit={false} />
      <SectionTitle title={displayOperationName(operation.name)} count={operationAssignments.length} />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="grid gap-2 text-xs font-normal text-slate-600 md:grid-cols-4">
          <Readonly label="Территория" value={displaySectionName(operation.section_name)} />
          <Readonly label="Требуется аутсорсинг" value={calculateOutsource(operation.required_staff, operation.staff_count)} />
          <Readonly label="Назначено" value={operationAssignments.length} />
          <Readonly label="Ставка/час" value={operation.rate_per_hour} />
        </div>
      </div>

      <div className="space-y-2">
        {slots.map((slot, index) => (
          <div key={`${operationId}-${index}`} className="grid grid-cols-[36px_1fr_auto] items-center gap-2 rounded-md border border-slate-300 bg-white p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 text-sm font-normal">{index + 1}</div>
            <button className="min-h-9 rounded-md border border-slate-300 bg-slate-50 px-3 text-left text-sm font-normal hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70" disabled={!editable} onClick={() => setPickerSlot(index)}>
              {slot?.employee ? displayEmployeeName(slot.employee) : "Не выбрано"}
            </button>
            {slot?.assignment ? (
              <button
                className="rounded-md p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300"
                disabled={!editable}
                title="Убрать сотрудника"
                onClick={async () => {
                  if (!await confirm({
                    title: "Убрать сотрудника?",
                    message: slot.employee ? `Убрать ${displayEmployeeName(slot.employee)} из операции?` : "Убрать сотрудника из операции?",
                    confirmLabel: "Убрать",
                    cancelLabel: "Отменить",
                    tone: "warning"
                  })) return;
                  await mutate(`/assignments/${slot.assignment.id}`, "DELETE", undefined, "Сотрудник убран");
                }}
              >
                <Trash2 size={18} />
              </button>
            ) : (
              <button className="btn-primary h-9 px-3 disabled:bg-slate-300" disabled={!editable} onClick={() => setPickerSlot(index)}>Выбрать</button>
            )}
          </div>
        ))}
      </div>

      {!editable && (
        <div className="rounded-md bg-slate-100 p-3 text-sm font-normal text-slate-600">
          {canEditOut ? `План сейчас: ${internalPlanStatusLabel(plan)}. Распределение доступно только когда план у аутсорсера.` : "Нет права на распределение аутсорсинга."}
        </div>
      )}
      <button className="btn-primary ml-auto flex" onClick={back}>Сохранить</button>
      {pickerSlot !== null && (
        <PersonnelPicker
          data={data}
          assignedIds={data.assignments.filter((assignment) => assignment.plan_id === planId).map((assignment) => assignment.employee_id)}
          period={{ from: plan.start_date, to: plan.end_date }}
          close={() => setPickerSlot(null)}
          select={async (employee) => {
            if (!editable) return;
            await mutate("/assignments", "POST", { plan_id: planId, operation_id: operationId, employee_id: employee.id, status: "Назначен" }, "Сотрудник назначен");
            setPickerSlot(null);
          }}
        />
      )}
    </div>
  );
}

function PersonnelPicker({ data, assignedIds, period, select, close }: { data: BootstrapData; assignedIds: string[]; period: { from: string; to: string }; select: (employee: Employee) => Promise<void>; close: () => void }) {
  const [query, setQuery] = useState("");
  const candidates = data.employees.map((employee) => ({
    employee,
    busy: (data.employeeBusy || []).find((busy) => busy.employee_id === employee.id && busyOverlapsPeriod(busy, period))
  })).filter(({ employee }) => {
    if (assignedIds.includes(employee.id)) return false;
    return `${displayEmployeeName(employee)} ${employee.full_name}`.toLowerCase().includes(query.toLowerCase());
  }).sort((left, right) => Number(Boolean(left.busy)) - Number(Boolean(right.busy)) || displayEmployeeName(left.employee).localeCompare(displayEmployeeName(right.employee), "ru"));
  return (
    <Modal title="Доступный персонал" close={close}>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input className="field pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск..." />
        </div>
      </div>
      <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">
        {candidates.map(({ employee, busy }) => (
          <button key={employee.id} className={`w-full rounded-md p-3 text-left ${busy ? "cursor-not-allowed bg-slate-100 opacity-70" : "bg-slate-100 hover:bg-emerald-50"}`} disabled={Boolean(busy)} onClick={() => select(employee)}>
            <p className="text-sm font-normal">{displayEmployeeName(employee)}</p>
            <p className="text-xs font-normal text-slate-500">{displayEmployeeMeta(employee)}</p>
            <p className={`mt-1 text-xs font-normal ${busy ? "text-orange-600" : statusTone(employee.status)}`}>{busy ? `Занят до ${busy.end_at}` : employee.status}</p>
          </button>
        ))}
        {!candidates.length && <Empty text="Нет сотрудников для выбранного периода. Добавьте людей в базе персонала." />}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-normal text-white" onClick={close}>Отменить</button>
      </div>
    </Modal>
  );
}

function PlanEditor({ kind, editAccess, sections = [], operationCatalog = [], drafts, setDrafts, planId, onAddOperation, onRemoveOperation }: { kind: PlanKind; editAccess?: PlanEditAccess; sections?: Section[]; operationCatalog?: BootstrapData["operationCatalog"]; drafts: Operation[]; setDrafts: (rows: Operation[]) => void; planId?: string; onAddOperation?: () => void; onRemoveOperation?: (row: Operation) => void }) {
  const update = (id: string, patch: Partial<Operation>) => setDrafts(drafts.map((row) => row.id === id ? { ...row, ...patch } : row));
  const addOperation = () => {
    if (onAddOperation) {
      onAddOperation();
      return;
    }
    setDrafts([...drafts, createDraftOperation(drafts.length + 1, planId || NEW_PLAN_ID)]);
  };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-100 p-2 shadow-sm">
        <div className="space-y-2">
          {drafts.map((row) => <PlanOperationCard key={row.id} kind={kind} editAccess={editAccess} row={row} sections={sections} operationCatalog={operationCatalog} edit onChange={(patch) => update(row.id, patch)} onRemove={(editAccess?.factory ?? kind === "factory") ? () => onRemoveOperation?.(row) : undefined} />)}
          {!drafts.length && <Empty text="Добавьте первую строку плана." />}
        </div>
      </div>
      {(editAccess?.factory ?? kind === "factory") && (
        <button className="rounded-full bg-orange-500 px-4 py-2 text-sm font-normal text-white" onClick={addOperation}>
          <Plus size={16} className="inline" /> Операция
        </button>
      )}
    </div>
  );
}
