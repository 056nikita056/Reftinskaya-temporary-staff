import { Fragment, type ReactNode } from "react";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Menu, Paperclip, Pencil, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import type { BootstrapData, Employee } from "../../api/client";
import type { BootstrapLoadMore, BootstrapMutate, ViewState } from "../../domain/types";
import { cleanDisplayValue, displayEmployeeAge, displayEmployeeMeta, displayEmployeeName, employeeCountryFilterValue, employeeMissingFields, emptyCountries, numberValue, statusTone } from "../../domain/display";
import { Empty } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

export function PersonnelV2({ view, setView, data, mutate, loadMore }: { view: ViewState; setView: (view: ViewState) => void; data: BootstrapData; mutate: BootstrapMutate; loadMore: BootstrapLoadMore }) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("Все");
  const [countryFilter, setCountryFilter] = useState("Все");
  const [housingFilter, setHousingFilter] = useState("Все");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const { confirm } = useUiFeedback();
  if (view.type === "employee") {
    return <EmployeeProfileV2 employeeId={view.employeeId} edit={view.edit} data={data} mutate={mutate} back={() => setView({ type: "list" })} openEdit={() => setView({ type: "employee", employeeId: view.employeeId, edit: true })} closeEdit={(employeeId) => setView({ type: "employee", employeeId })} />;
  }
  const statusOptions = ["Все", ...Array.from(new Set(data.employees.map((employee) => employee.status || "Статус не указан")))];
  const countryOptions = ["Все", ...Array.from(new Set(data.employees.map(employeeCountryFilterValue)))];
  const activeFilters = [statusFilter !== "Все", countryFilter !== "Все", housingFilter !== "Все"].filter(Boolean).length;
  const employees = data.employees.filter((employee) => {
    const haystack = `${employee.full_name} ${displayEmployeeName(employee)} ${employee.country} ${displayEmployeeMeta(employee)} ${employee.status}`.toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const matchesStatus = statusFilter === "Все" || (employee.status || "Статус не указан") === statusFilter;
    const matchesCountry = countryFilter === "Все" || employeeCountryFilterValue(employee) === countryFilter;
    const matchesHousing = housingFilter === "Все" || (housingFilter === "Нуждается в жилье" ? Boolean(employee.needs_housing) : !employee.needs_housing);
    return matchesQuery && matchesStatus && matchesCountry && matchesHousing;
  });
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) || data.employees.find((employee) => employee.id === selectedEmployeeId);
  const createEmployee = async () => {
    const isRussian = await confirm({
      title: "Новый сотрудник",
      message: "Выберите тип профиля сотрудника.",
      confirmLabel: "Гражданин РФ",
      cancelLabel: "Иностранец"
    });
    const next = await mutate("/employees", "POST", { country: isRussian ? "Россия" : "Таджикистан", status: "В резерве", needs_housing: isRussian ? 0 : 1, needs_registration: isRussian ? 0 : 1 }, "Сотрудник добавлен");
    if (next?.createdEmployeeId) setSelectedEmployeeId(next.createdEmployeeId);
    return next?.createdEmployeeId;
  };
  const deleteSelected = async () => {
    if (!selectedEmployee) return;
    const ok = await confirm({
      title: "Удаление сотрудника",
      message: `Удалить "${displayEmployeeName(selectedEmployee)}"?`,
      confirmLabel: "Удалить",
      tone: "error"
    });
    if (!ok) return;
    await mutate(`/employees/${selectedEmployee.id}`, "DELETE", undefined, "Сотрудник удален");
    setSelectedEmployeeId("");
  };

  return (
    <div className="space-y-3 pb-2" onClick={() => setSelectedEmployeeId("")}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input className="field h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск..." />
        </div>
        <button
          className={`relative flex h-10 w-10 items-center justify-center rounded-md border text-slate-600 ${filtersOpen || activeFilters ? "border-refGreen bg-emerald-50 text-refGreen" : "border-slate-300 bg-white"}`}
          title="Фильтр"
          onClick={() => setFiltersOpen((current) => !current)}
        >
          <Menu size={18} />
          {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-refGreen px-1 text-[10px] font-normal text-white">{activeFilters}</span>}
        </button>
      </div>
      {filtersOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <SelectFilter label="Статус" value={statusFilter} options={statusOptions} onChange={setStatusFilter} />
            <SelectFilter label="Страна" value={countryFilter} options={countryOptions} onChange={setCountryFilter} />
            <SelectFilter label="Жилье" value={housingFilter} options={["Все", "Нуждается в жилье", "Жилье не требуется"]} onChange={setHousingFilter} />
          </div>
          {activeFilters > 0 && (
            <button className="mt-3 text-xs font-normal text-refGreen underline" onClick={() => { setStatusFilter("Все"); setCountryFilter("Все"); setHousingFilter("Все"); }}>
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
      {employees.length ? (
        <PersonnelTable
          employees={employees}
          selectedEmployee={selectedEmployee}
          selectedEmployeeId={selectedEmployeeId}
          selectEmployee={setSelectedEmployeeId}
          openEmployee={(employeeId, edit) => setView({ type: "employee", employeeId, edit })}
          createEmployee={createEmployee}
          deleteSelected={deleteSelected}
          mutate={mutate}
        />
      ) : (
        <Empty text="Сотрудники не найдены" />
      )}
      {data.pagination?.employees.nextCursor && (
        <button className="mx-auto flex rounded-md bg-slate-100 px-4 py-2 text-sm font-normal text-refGreen hover:bg-emerald-50" onClick={() => loadMore("employees")}>
          Загрузить еще
        </button>
      )}
    </div>
  );
}

function PersonnelTable({ employees, selectedEmployee, selectedEmployeeId, selectEmployee, openEmployee, createEmployee, deleteSelected, mutate }: { employees: Employee[]; selectedEmployee?: Employee; selectedEmployeeId: string; selectEmployee: (employeeId: string) => void; openEmployee: (employeeId: string, edit?: boolean) => void; createEmployee: () => Promise<string | undefined>; deleteSelected: () => void; mutate: BootstrapMutate }) {
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Set<string>>(() => new Set());
  const [editingEmployeeId, setEditingEmployeeId] = useState("");
  const [draft, setDraft] = useState<Employee | null>(null);
  const [pendingEditEmployeeId, setPendingEditEmployeeId] = useState("");
  const housingCount = employees.filter((employee) => employee.needs_housing).length;
  const registrationCount = employees.filter((employee) => employee.needs_registration).length;
  const toggleExpanded = (employeeId: string) => {
    setExpandedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };
  const startEdit = (employee: Employee) => {
    selectEmployee(employee.id);
    setExpandedEmployeeIds((current) => new Set(current).add(employee.id));
    setEditingEmployeeId(employee.id);
    setDraft({ ...employee });
  };
  useEffect(() => {
    if (!pendingEditEmployeeId) return;
    const employee = employees.find((item) => item.id === pendingEditEmployeeId);
    if (!employee) return;
    startEdit(employee);
    setPendingEditEmployeeId("");
  }, [employees, pendingEditEmployeeId]);
  const createAndEdit = async () => {
    const employeeId = await createEmployee();
    if (employeeId) setPendingEditEmployeeId(employeeId);
  };
  const cancelEdit = () => {
    setEditingEmployeeId("");
    setDraft(null);
  };
  const saveEdit = async () => {
    if (!draft || !editingEmployeeId) return;
    await mutate(`/employees/${editingEmployeeId}`, "PUT", {
      full_name: draft.full_name,
      country: draft.country,
      age: draft.age,
      status: draft.status,
      phone: draft.phone,
      email: draft.email,
      birth_date: draft.birth_date,
      passport_no: draft.passport_no,
      passport_issued: draft.passport_issued,
      registration: draft.registration,
      needs_housing: draft.needs_housing ? 1 : 0,
      needs_registration: draft.needs_registration ? 1 : 0,
      driver_categories: draft.driver_categories
    }, "Сотрудник сохранен");
    cancelEdit();
  };
  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-[57px] z-20 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur lg:top-0">
        <div className="min-w-0">
          <p className="text-xs font-normal uppercase text-slate-500">Выбранный сотрудник</p>
          <p className="truncate text-sm font-normal text-refDark">{selectedEmployee ? displayEmployeeName(selectedEmployee) : "Не выбран"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PersonnelAction title="Добавить сотрудника" primary onClick={createAndEdit}>
            <Plus size={16} /> Добавить
          </PersonnelAction>
          <PersonnelAction title="Открыть карточку" disabled={!selectedEmployee} onClick={() => selectedEmployee && openEmployee(selectedEmployee.id)}>
            <UserRound size={16} /> Открыть
          </PersonnelAction>
          <PersonnelAction title="Редактировать в таблице" disabled={!selectedEmployee} onClick={() => selectedEmployee && startEdit(selectedEmployee)}>
            <Pencil size={16} /> Редактировать
          </PersonnelAction>
          <PersonnelAction title="Удалить" danger disabled={!selectedEmployee} onClick={deleteSelected}>
            <Trash2 size={16} /> Удалить
          </PersonnelAction>
        </div>
      </div>
      <div className="overflow-hidden rounded-b-lg">
        <table className="w-full table-fixed border-collapse text-[11px] sm:text-xs xl:text-sm">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[19%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-white text-xs font-normal uppercase text-slate-500 shadow-sm">
            <tr>
              <PersonnelTh>ФИО</PersonnelTh>
              <PersonnelTh short="Стат.">Статус</PersonnelTh>
              <PersonnelTh>Страна</PersonnelTh>
              <PersonnelTh numeric>Возраст</PersonnelTh>
              <PersonnelTh short="Жилье">Жилье</PersonnelTh>
              <PersonnelTh short="Рег.">Регистрация</PersonnelTh>
              <PersonnelTh short="Проф.">Профиль</PersonnelTh>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => {
              const selected = employee.id === selectedEmployeeId;
              const expanded = expandedEmployeeIds.has(employee.id);
              const missing = employeeMissingFields(employee);
              const editing = editingEmployeeId === employee.id;
              return (
                <Fragment key={employee.id}>
                  <tr
                    className={`border-t border-slate-100 bg-white hover:bg-emerald-50/30 ${selected ? "border-l-4 border-l-refGreen bg-emerald-100 shadow-[inset_0_0_0_2px_rgba(0,122,83,0.24)]" : "border-l-4 border-l-transparent"}`}
                    onClick={() => selectEmployee(employee.id)}
                    onDoubleClick={() => toggleExpanded(employee.id)}
                  >
                    <PersonnelTd className="text-left">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-refGreen"
                          type="button"
                          title={expanded ? "Свернуть" : "Раскрыть"}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectEmployee(employee.id);
                            toggleExpanded(employee.id);
                          }}
                        >
                          {expanded ? <ChevronDown size={15} /> : <ChevronUp className="rotate-90" size={15} />}
                        </button>
                        <span className="min-w-0">
                          <span className="block truncate font-normal text-refDark">{displayEmployeeName(employee)}</span>
                          <span className="block truncate text-[10px] text-slate-500 xl:text-xs">{displayEmployeeMeta(employee)}</span>
                        </span>
                      </div>
                    </PersonnelTd>
                    <PersonnelTd className="text-left"><span className={`inline-flex max-w-full rounded-full bg-white px-1.5 py-1 text-[10px] leading-none ring-1 ring-slate-200 xl:px-2 ${statusTone(employee.status)}`}><span className="truncate">{employee.status || "Статус"}</span></span></PersonnelTd>
                    <PersonnelTd>{cleanDisplayValue(employee.country, emptyCountries) || "-"}</PersonnelTd>
                    <PersonnelTd numeric>{employee.age || "-"}</PersonnelTd>
                    <PersonnelTd>{employee.needs_housing ? "Да" : "Нет"}</PersonnelTd>
                    <PersonnelTd>{employee.needs_registration ? "Да" : "Нет"}</PersonnelTd>
                    <PersonnelTd>
                      <span className={`inline-flex max-w-full rounded-full px-1 py-1 text-[9px] leading-none ring-1 xl:px-2 xl:text-[10px] ${missing.length ? "bg-orange-50 text-orange-700 ring-orange-200" : "bg-emerald-50 text-refGreen ring-emerald-200"}`}>
                        <span className="whitespace-nowrap">{missing.length ? `${missing.length} поля` : "Готов"}</span>
                      </span>
                    </PersonnelTd>
                  </tr>
                  {expanded && (
                    <tr className={`border-t border-slate-100 bg-slate-50 ${selected ? "border-l-4 border-l-refGreen" : "border-l-4 border-l-transparent"}`}>
                      <td colSpan={7} className="border-r border-slate-200 p-2 last:border-r-0">
                        {editing && draft ? (
                          <EmployeeInlineEditor draft={draft} setDraft={setDraft} save={saveEdit} cancel={cancelEdit} />
                        ) : (
                          <EmployeeExpandedInfo employee={employee} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-100 font-normal text-refDark">
            <tr className="border-t-2 border-slate-300">
              <PersonnelTd>Итого: {employees.length}</PersonnelTd>
              <PersonnelTd>{""}</PersonnelTd>
              <PersonnelTd>{""}</PersonnelTd>
              <PersonnelTd>{""}</PersonnelTd>
              <PersonnelTd>{housingCount}</PersonnelTd>
              <PersonnelTd>{registrationCount}</PersonnelTd>
              <PersonnelTd>{""}</PersonnelTd>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function EmployeeExpandedInfo({ employee }: { employee: Employee }) {
  const missing = employeeMissingFields(employee);
  const fields: Array<[string, string]> = [
    ["ФИО", displayEmployeeName(employee)],
    ["Статус", employee.status || "Статус не указан"],
    ["Страна", cleanDisplayValue(employee.country, emptyCountries) || "Страна не указана"],
    ["Возраст", displayEmployeeAge(employee)],
    ["Дата рождения", employee.birth_date || "-"],
    ["Телефон", employee.phone || "-"],
    ["Email", employee.email || "-"],
    ["Паспорт", employee.passport_no || "-"],
    ["Кем и когда выдан", employee.passport_issued || "-"],
    ["Прописка", employee.registration || "-"],
    ["Нуждается в жилье", employee.needs_housing ? "Да" : "Нет"],
    ["Нуждается в регистрации", employee.needs_registration ? "Да" : "Нет"],
    ["Водительские права", employee.driver_categories || "-"],
    ["Заполненность", missing.length ? `Не заполнено: ${missing.join(", ")}` : "Профиль заполнен"]
  ];
  return (
    <div className="grid gap-2 text-left sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <p className="text-[10px] font-normal uppercase text-slate-500">{label}</p>
          <p className="mt-0.5 break-words text-xs font-normal text-refDark xl:text-sm">{value}</p>
        </div>
      ))}
    </div>
  );
}

function EmployeeInlineEditor({ draft, setDraft, save, cancel }: { draft: Employee; setDraft: (draft: Employee) => void; save: () => void; cancel: () => void }) {
  const update = (patch: Partial<Employee>) => setDraft({ ...draft, ...patch });
  return (
    <div className="space-y-3 text-left">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <InlineEmployeeField label="ФИО" value={draft.full_name || ""} onChange={(value) => update({ full_name: value })} />
        <InlineEmployeeField label="Статус" value={draft.status || ""} onChange={(value) => update({ status: value })} />
        <InlineEmployeeField label="Страна" value={draft.country || ""} onChange={(value) => update({ country: value })} />
        <InlineEmployeeField label="Возраст" value={draft.age || ""} inputMode="numeric" onChange={(value) => update({ age: numberValue(value) })} />
        <InlineEmployeeField label="Дата рождения" value={draft.birth_date || ""} onChange={(value) => update({ birth_date: value })} />
        <InlineEmployeeField label="Телефон" value={draft.phone || ""} onChange={(value) => update({ phone: value })} />
        <InlineEmployeeField label="Email" value={draft.email || ""} onChange={(value) => update({ email: value })} />
        <InlineEmployeeField label="Паспорт" value={draft.passport_no || ""} onChange={(value) => update({ passport_no: value })} />
        <InlineEmployeeField label="Кем и когда выдан" value={draft.passport_issued || ""} onChange={(value) => update({ passport_issued: value })} />
        <InlineEmployeeField label="Прописка" value={draft.registration || ""} onChange={(value) => update({ registration: value })} />
        <InlineEmployeeField label="Водительские права" value={draft.driver_categories || ""} onChange={(value) => update({ driver_categories: value })} />
        <div className="grid gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
          <InlineEmployeeCheck label="Нуждается в жилье" checked={Boolean(draft.needs_housing)} onChange={() => update({ needs_housing: draft.needs_housing ? 0 : 1 })} />
          <InlineEmployeeCheck label="Нуждается в регистрации" checked={Boolean(draft.needs_registration)} onChange={() => update({ needs_registration: draft.needs_registration ? 0 : 1 })} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 transition hover:bg-slate-200" type="button" onClick={cancel}>
          <X size={16} /> Отмена
        </button>
        <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-refGreen px-3 text-sm font-normal text-white transition hover:bg-emerald-800" type="button" onClick={save}>
          <Check size={16} /> Сохранить
        </button>
      </div>
    </div>
  );
}

function InlineEmployeeField({ label, value, inputMode, onChange }: { label: string; value: string | number; inputMode?: "numeric"; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <span className="text-[10px] font-normal uppercase text-slate-500">{label}</span>
      <input className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm font-normal outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function InlineEmployeeCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button className="flex min-h-8 items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 text-left text-sm font-normal text-refDark" type="button" onClick={onChange}>
      <span>{label}</span>
      <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-refGreen bg-refGreen text-white" : "border-slate-300 bg-white text-transparent"}`}>
        <Check size={13} />
      </span>
    </button>
  );
}

function PersonnelAction({ children, title, primary, danger, disabled, onClick }: { children: ReactNode; title: string; primary?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void }) {
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

function PersonnelTh({ children, numeric, short }: { children: string; numeric?: boolean; short?: string }) {
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

function PersonnelTd({ children, numeric, className = "" }: { children: ReactNode; numeric?: boolean; className?: string }) {
  return <td className={`max-w-0 overflow-hidden border-r border-slate-200 px-1.5 py-2 align-middle font-normal last:border-r-0 xl:px-2 ${numeric ? "text-right tabular-nums" : "text-center"} ${className}`}>{children}</td>;
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-normal text-slate-500">
      {label}
      <select className="field mt-1 h-9 bg-white" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function EmployeeCardV2({ employee, onClick }: { employee: Employee; onClick: () => void }) {
  const missing = employeeMissingFields(employee);
  return (
    <button className="w-full rounded-xl bg-slate-100 p-4 text-left shadow-sm transition hover:bg-slate-200" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-normal">{displayEmployeeName(employee)}</p>
          <p className="text-xs font-normal text-slate-600">{displayEmployeeMeta(employee)}</p>
          <p className={`mt-3 text-xs font-normal ${missing.length ? "text-orange-600" : "text-refGreen"}`}>
            {missing.length ? `Профиль требует заполнения: ${missing.join(", ")}` : "Профиль заполнен"}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-normal ${statusTone(employee.status)}`}>{employee.status || "Статус"}</span>
      </div>
    </button>
  );
}

function EmployeeProfileV2({ employeeId, edit, data, mutate, back, openEdit, closeEdit }: { employeeId?: string; edit?: boolean; data: BootstrapData; mutate: BootstrapMutate; back: () => void; openEdit: () => void; closeEdit: (employeeId?: string) => void }) {
  const employee = data.employees.find((item) => item.id === employeeId) || data.employees[0];
  const [draft, setDraft] = useState<Employee>(() => ({ ...(employee || { id: "", full_name: "", country: "Россия", age: 25, status: "В резерве" }) }));
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ housing: true });
  useEffect(() => setDraft({ ...(employee || draft) }), [employee?.id]);
  if (!employee) return <Empty text="Сотрудник не найден" />;

  const isForeign = (draft.country || employee.country || "").toLowerCase() !== "россия";
  const isEdit = Boolean(edit);
  const toggleSection = (key: string) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  const save = async () => {
    await mutate(`/employees/${employee.id}`, "PUT", {
      full_name: draft.full_name,
      country: draft.country,
      age: draft.age,
      status: draft.status,
      phone: draft.phone,
      email: draft.email,
      birth_date: draft.birth_date,
      passport_no: draft.passport_no,
      passport_issued: draft.passport_issued,
      registration: draft.registration,
      needs_housing: draft.needs_housing ? 1 : 0,
      needs_registration: draft.needs_registration ? 1 : 0,
      driver_categories: draft.driver_categories
    }, "Сотрудник сохранен");
    closeEdit(employee.id);
  };

  return (
    <div className="relative space-y-3 pb-2">
      <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal" onClick={back}>Назад</button>
      <EmployeeHeroV2 employee={draft} />

      {isEdit ? (
        <div className="space-y-3">
          <EmployeeSectionTitleV2 title="Паспортные данные" />
          <EmployeeFieldV2 label="ФИО" value={draft.full_name || ""} onChange={(value) => setDraft({ ...draft, full_name: value })} />
          <EmployeeFieldV2 label="Возраст" value={draft.age || ""} onChange={(value) => setDraft({ ...draft, age: numberValue(value) })} />
          <EmployeeFieldV2 label="Страна" value={draft.country || ""} onChange={(value) => setDraft({ ...draft, country: value })} />
          <EmployeeFieldV2 label="Статус" value={draft.status || ""} onChange={(value) => setDraft({ ...draft, status: value })} />
          <EmployeeFieldV2 label="Дата рождения" value={draft.birth_date || ""} onChange={(value) => setDraft({ ...draft, birth_date: value })} />
          {isForeign ? (
            <EmployeeFileFieldV2 label="Фото паспорта" value="Прикрепить файлы" />
          ) : (
            <>
              <EmployeeFieldV2 label="Номер и серия" value={draft.passport_no || ""} onChange={(value) => setDraft({ ...draft, passport_no: value })} />
              <EmployeeFieldV2 label="Кем и когда выдан" value={draft.passport_issued || ""} onChange={(value) => setDraft({ ...draft, passport_issued: value })} />
              <EmployeeFieldV2 label="Прописка" value={draft.registration || ""} onChange={(value) => setDraft({ ...draft, registration: value })} />
              <EmployeeFileFieldV2 label="Фото паспорта" value="Прикрепить файлы" />
            </>
          )}

          {isForeign ? (
            <>
              <EmployeeSectionTitleV2 title="Миграционные документы" />
              <EmployeeCheckFieldV2 label="Патент" checked value="Оплачен до 01.05.2025" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeCheckFieldV2 label="Временная регистрация на территории РФ" checked={Boolean(draft.needs_registration)} value="" onToggle={() => setDraft({ ...draft, needs_registration: draft.needs_registration ? 0 : 1 })} onChange={() => undefined} badWhenFalse />
              <EmployeeFileCheckFieldV2 label="Нотариально заверенный перевод паспорта" checked value="Прикрепить файлы" />
              <EmployeeCheckFieldV2 label="Медицинское освидетельствование" checked value="Срок до 01.06.2025" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeCheckFieldV2 label="Полис ДМС" checked value="Срок до 01.06.2025" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeFileCheckFieldV2 label="Уведомление о заключении трудового договора" checked value="Прикрепить файлы" />
              <EmployeeCheckFieldV2 label="СНИЛС" checked value="123-456-789 12" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeCheckFieldV2 label="ИНН" checked value="123123456456" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeSectionTitleV2 title="Проживание" />
              <EmployeeCheckFieldV2 label="Нуждается в жилье" checked={Boolean(draft.needs_housing)} value="" onToggle={() => setDraft({ ...draft, needs_housing: draft.needs_housing ? 0 : 1 })} onChange={() => undefined} />
              <EmployeeCheckFieldV2 label="Нуждается в прописке" checked={Boolean(draft.needs_registration)} value="" onToggle={() => setDraft({ ...draft, needs_registration: draft.needs_registration ? 0 : 1 })} onChange={() => undefined} />
              <EmployeeSectionTitleV2 title="Прочее" />
              <EmployeeCheckFieldV2 label="Водительские права" checked={Boolean(draft.driver_categories)} value={draft.driver_categories || ""} onToggle={() => setDraft({ ...draft, driver_categories: draft.driver_categories ? "" : "Категории B, C, C1" })} onChange={(value) => setDraft({ ...draft, driver_categories: value })} />
            </>
          ) : (
            <>
              <EmployeeSectionTitleV2 title="Документы" />
              <EmployeeCheckFieldV2 label="Медкнижка" checked value="Срок до 01.01.2026" onToggle={() => undefined} onChange={() => undefined} />
              <EmployeeCheckFieldV2 label="Водительские права" checked={Boolean(draft.driver_categories)} value={draft.driver_categories || ""} onToggle={() => setDraft({ ...draft, driver_categories: draft.driver_categories ? "" : "Категории B, C" })} onChange={(value) => setDraft({ ...draft, driver_categories: value })} />
              <EmployeeSectionTitleV2 title="Проживание" />
              <EmployeeCheckFieldV2 label="Нуждается в жилье" checked={Boolean(draft.needs_housing)} value="" badWhenFalse onToggle={() => setDraft({ ...draft, needs_housing: draft.needs_housing ? 0 : 1 })} onChange={() => undefined} />
            </>
          )}

          <EmployeeSectionTitleV2 title="Контактная информация" />
          <EmployeeFieldV2 label="Номер телефона" value={draft.phone || ""} onChange={(value) => setDraft({ ...draft, phone: value })} />
          <EmployeeFieldV2 label="Почта" value={draft.email || ""} onChange={(value) => setDraft({ ...draft, email: value })} />
          <button className="fixed bottom-20 right-5 z-20 rounded-full bg-refGreen px-5 py-3 text-sm font-normal text-white shadow-panel" onClick={save}>
            Сохранить
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <EmployeeAccordionV2 title="Паспортные данные" open={Boolean(openSections.passport)} onToggle={() => toggleSection("passport")}>
            <EmployeeReadonlyLineV2 label="Дата рождения" value={employee.birth_date || "-"} />
            <EmployeeReadonlyLineV2 label="Номер и серия" value={employee.passport_no || "-"} />
            <EmployeeReadonlyLineV2 label="Прописка" value={employee.registration || "-"} />
          </EmployeeAccordionV2>
          <EmployeeAccordionV2 title={isForeign ? "Миграционные документы" : "Документы"} open={Boolean(openSections.documents)} onToggle={() => toggleSection("documents")}>
            <EmployeeReadonlyLineV2 label="Водительские права" value={employee.driver_categories || "-"} />
            {isForeign && <EmployeeReadonlyLineV2 label="Нуждается в прописке" value={employee.needs_registration ? "Да" : "Нет"} />}
          </EmployeeAccordionV2>
          <EmployeeAccordionV2 title="Проживание" open={Boolean(openSections.housing)} onToggle={() => toggleSection("housing")}>
            <EmployeeReadonlyCheckLineV2 label="Нуждается в жилье" checked={Boolean(employee.needs_housing)} />
            {isForeign && <EmployeeReadonlyCheckLineV2 label="Нуждается в прописке" checked={Boolean(employee.needs_registration)} />}
          </EmployeeAccordionV2>
          {isForeign && (
            <EmployeeAccordionV2 title="Прочее" open={Boolean(openSections.other)} onToggle={() => toggleSection("other")}>
              <EmployeeReadonlyCheckLineV2 label="Водительские права" checked={Boolean(employee.driver_categories)} value={employee.driver_categories || ""} />
            </EmployeeAccordionV2>
          )}
          <EmployeeAccordionV2 title="Контактная информация" open={Boolean(openSections.contacts)} onToggle={() => toggleSection("contacts")}>
            <EmployeeReadonlyLineV2 label="Номер телефона" value={employee.phone || "-"} />
            <EmployeeReadonlyLineV2 label="Почта" value={employee.email || "-"} />
          </EmployeeAccordionV2>
          <p className="mx-auto max-w-xs pt-5 text-center text-sm font-normal text-slate-500">История работ появится после фиксации смен</p>
          <button className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-refGreen text-white shadow-panel" onClick={openEdit} title="Редактировать">
            <Pencil size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

function EmployeeHeroV2({ employee }: { employee: Employee }) {
  return (
    <div className="pt-8">
      <div className="relative rounded-xl bg-refGreen px-4 pb-4 pt-10 text-center text-white shadow-sm">
        <div className="absolute left-1/2 top-0 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-orange-100 text-orange-500">
          <UserRound size={34} />
        </div>
        <h2 className="text-lg font-normal">{displayEmployeeName(employee)}</h2>
        <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs font-normal">
          <span className="rounded-full border border-white/70 px-3 py-1">{displayEmployeeAge(employee)}</span>
          <span className="rounded-full border border-white/70 px-3 py-1">{cleanDisplayValue(employee.country, emptyCountries) || "Страна не указана"}</span>
          <span className="rounded-full border border-white/70 px-3 py-1">{employee.status || "Статус"}</span>
        </div>
      </div>
    </div>
  );
}

function EmployeeSectionTitleV2({ title }: { title: string }) {
  return <div className="rounded-md bg-slate-200 px-3 py-2 text-center text-sm font-normal">{title}</div>;
}

function EmployeeFieldV2({ label, value, onChange }: { label: string; value: string | number; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[7.25rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right leading-tight">{label}</span>
      <input className="h-8 rounded-md border border-slate-400 px-3 text-sm font-normal" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EmployeeFileFieldV2({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.25rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right leading-tight">{label}</span>
      <div className="flex h-8 items-center justify-between rounded-md border border-slate-400 px-3 text-sm font-normal text-slate-500">
        <span>{value}</span>
        <Paperclip size={16} />
      </div>
    </div>
  );
}

function EmployeeCheckFieldV2({ label, checked, value, badWhenFalse, onToggle, onChange }: { label: string; checked?: boolean; value: string; badWhenFalse?: boolean; onToggle: () => void; onChange: (value: string) => void }) {
  const isBad = !checked && badWhenFalse;
  return (
    <div className="grid grid-cols-[7.25rem_1.75rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right text-xs leading-tight">{label}</span>
      <button className={`flex h-7 w-7 items-center justify-center rounded-md text-white ${checked ? "bg-refGreen" : isBad ? "bg-red-600" : "bg-slate-300"}`} onClick={onToggle}>
        {checked ? <Check size={17} /> : isBad ? <X size={17} /> : null}
      </button>
      <input className="h-8 rounded-md border border-slate-400 px-3 text-sm font-normal" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function EmployeeFileCheckFieldV2({ label, checked, value }: { label: string; checked?: boolean; value: string }) {
  return (
    <div className="grid grid-cols-[7.25rem_1.75rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right text-xs leading-tight">{label}</span>
      <span className={`flex h-7 w-7 items-center justify-center rounded-md text-white ${checked ? "bg-refGreen" : "bg-red-600"}`}>{checked ? <Check size={17} /> : <X size={17} />}</span>
      <div className="flex h-8 items-center justify-between rounded-md border border-slate-400 px-3 text-sm font-normal text-slate-500">
        <span>{value}</span>
        <Paperclip size={16} />
      </div>
    </div>
  );
}

function EmployeeAccordionV2({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <button className="flex w-full items-center justify-between rounded-md bg-slate-200 px-3 py-2 text-sm font-normal" onClick={onToggle}>
        <span className="flex-1 text-center">{title}</span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-slate-700">
          {open ? <ChevronUp size={16} strokeWidth={3} /> : <ChevronDown size={16} strokeWidth={3} />}
        </span>
      </button>
      {open && <div className="space-y-2 px-1">{children}</div>}
    </section>
  );
}

function EmployeeReadonlyLineV2({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.25rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right leading-tight">{label}</span>
      <div className="min-h-8 rounded-md border border-slate-400 px-3 py-1 text-sm font-normal">{value}</div>
    </div>
  );
}

function EmployeeReadonlyCheckLineV2({ label, checked, value = "" }: { label: string; checked: boolean; value?: string }) {
  return (
    <div className="grid grid-cols-[7.25rem_1.75rem_1fr] items-center gap-2 text-sm font-normal">
      <span className="text-right leading-tight">{label}</span>
      <span className={`flex h-7 w-7 items-center justify-center rounded-md text-white ${checked ? "bg-refGreen" : "bg-red-600"}`}>{checked ? <Check size={17} /> : <X size={17} />}</span>
      <div className="min-h-8 rounded-md border border-slate-400 px-3 py-1 text-sm font-normal">{value}</div>
    </div>
  );
}
