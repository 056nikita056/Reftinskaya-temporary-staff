import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Menu, Paperclip, Pencil, Plus, Search, UserRound, X } from "lucide-react";
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

  return (
    <div className="space-y-3 pb-2">
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
      <div className="space-y-3">
        {employees.map((employee) => <EmployeeCardV2 key={employee.id} employee={employee} onClick={() => setView({ type: "employee", employeeId: employee.id })} />)}
      </div>
      {!employees.length && <Empty text="Сотрудники не найдены" />}
      {data.pagination?.employees.nextCursor && (
        <button className="mx-auto flex rounded-md bg-slate-100 px-4 py-2 text-sm font-normal text-refGreen hover:bg-emerald-50" onClick={() => loadMore("employees")}>
          Загрузить еще
        </button>
      )}
      <button
        className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-refGreen text-white shadow-panel"
        title="Добавить сотрудника"
        onClick={async () => {
          const isRussian = await confirm({
            title: "Новый сотрудник",
            message: "Выберите тип профиля сотрудника.",
            confirmLabel: "Гражданин РФ",
            cancelLabel: "Иностранец"
          });
          const next = await mutate("/employees", "POST", { country: isRussian ? "Россия" : "Таджикистан", status: "В резерве", needs_housing: isRussian ? 0 : 1, needs_registration: isRussian ? 0 : 1 }, "Сотрудник добавлен");
          setView({ type: "employee", employeeId: next?.createdEmployeeId, edit: true });
        }}
      >
        <Plus size={28} />
      </button>
    </div>
  );
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
