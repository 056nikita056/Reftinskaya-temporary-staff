import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { Operation, Section } from "../../api/client";
import type { PlanKind } from "../../domain/types";
import { calculateOutsource, displayOperationName, displaySectionName, numberValue } from "../../domain/display";

export function PlanOperationCard({ kind, row, sections = [], assigned = [], edit, onChange, onCreateSection, onOpen }: { kind: PlanKind; row: Operation; sections?: Section[]; assigned?: string[]; edit?: boolean; onChange?: (patch: Partial<Operation>) => void; onCreateSection?: (name: string, rowId: string) => Promise<void>; onOpen?: () => void }) {
  const [sectionQuery, setSectionQuery] = useState("");
  const required = numberValue(row.required_staff);
  const staff = numberValue(row.staff_count);
  const outsource = calculateOutsource(required, staff);
  const canOpen = kind === "out" && !edit && Boolean(onOpen);
  const assignedText = assigned.length ? assigned.join(", ") : "";
  const update = (patch: Partial<Operation>) => onChange?.(patch);
  const normalizedSectionQuery = sectionQuery.trim();
  const selectableSections = sections.filter((section) => section.active || section.id === row.section_id);
  const visibleSections = selectableSections.filter((section) => section.name.toLowerCase().includes(normalizedSectionQuery.toLowerCase()));
  const canCreateSection = Boolean(onCreateSection && normalizedSectionQuery && !sections.some((section) => section.name.toLowerCase() === normalizedSectionQuery.toLowerCase()));
  const selectSection = (sectionId: string) => {
    const section = sections.find((item) => item.id === sectionId);
    update({
      section_id: section?.id || undefined,
      section_name: section?.name || "",
      section_order: section?.order ?? row.section_order
    });
  };
  const createSection = async () => {
    if (!canCreateSection || !onCreateSection) return;
    await onCreateSection(normalizedSectionQuery, row.id);
    setSectionQuery("");
  };
  const open = () => {
    if (canOpen) onOpen?.();
  };

  return (
    <div
      className={`rounded-md border border-slate-200 bg-white p-2.5 text-left shadow-sm ${canOpen ? "cursor-pointer transition hover:border-refGreen hover:bg-emerald-50/40" : ""}`}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (canOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="mb-2">
        {edit && kind === "factory" ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
            <div className="grid min-w-0 gap-1">
              <div className="grid grid-cols-[1fr_2rem] gap-1">
                <input
                  className="h-8 min-w-0 rounded bg-slate-100 px-2 text-[11px] font-black text-slate-700 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-refGreen/30"
                  value={sectionQuery}
                  placeholder="Поиск участка"
                  onChange={(event) => setSectionQuery(event.target.value)}
                />
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded bg-orange-500 text-white disabled:bg-slate-300"
                  disabled={!canCreateSection}
                  onClick={createSection}
                  title="Добавить участок"
                  type="button"
                >
                  <Plus size={14} />
                </button>
              </div>
              <select
                className="h-8 min-w-0 rounded bg-slate-100 px-2 text-[11px] font-black text-slate-700 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-refGreen/30"
                value={row.section_id || ""}
                onChange={(event) => selectSection(event.target.value)}
              >
                <option value="">Участок</option>
                {visibleSections.map((section) => (
                  <option key={section.id} value={section.id}>{section.name}</option>
                ))}
              </select>
            </div>
            <input
              className="h-8 min-w-0 rounded bg-slate-100 px-2 text-sm font-black text-refDark outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-refGreen/30"
              value={row.name}
              placeholder="Операция без названия"
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{displaySectionName(row.section_name)}</span>
            <p className="min-w-0 truncate text-sm font-black">{displayOperationName(row.name)}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-300 bg-white text-center text-xs sm:text-sm">
        <PlanMetric label="Персонал" value={required}>
          {edit && kind === "factory" ? (
            <input className="mx-auto mt-1 h-7 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.required_staff} onChange={(event) => update({ required_staff: numberValue(event.target.value), outsource_count: calculateOutsource(event.target.value, row.staff_count) })} />
          ) : null}
        </PlanMetric>
        <PlanMetric label="Штат" value={staff}>
          {edit && kind === "hr" ? (
            <input className="mx-auto mt-1 h-7 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.staff_count} onChange={(event) => update({ staff_count: numberValue(event.target.value), outsource_count: calculateOutsource(required, event.target.value) })} />
          ) : null}
        </PlanMetric>
        <PlanMetric label="Аутсорсинг" value={outsource} accent />
      </div>

      {(kind === "out" || assigned.length > 0) && (
        <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs font-bold text-slate-600">
          {kind === "out" && (
            <div className="grid grid-cols-2 gap-2">
              {edit ? (
                <>
                  <label className="text-[11px] font-black text-slate-500">Часов в день<input className="field mt-1 h-8" value={row.hours_per_day} onChange={(event) => update({ hours_per_day: numberValue(event.target.value) })} /></label>
                  <label className="text-[11px] font-black text-slate-500">Ставка/час<input className="field mt-1 h-8" value={row.rate_per_hour} onChange={(event) => update({ rate_per_hour: numberValue(event.target.value) })} /></label>
                </>
              ) : (
                <>
                  <p>{row.hours_per_day} ч/день</p>
                  <p>{row.rate_per_hour} руб./ч</p>
                </>
              )}
            </div>
          )}
          {kind === "out" && !edit && <p className="mt-2 text-refGreen">Назначено: {assigned.length}/{Math.max(outsource, assigned.length, 1)}</p>}
          {assignedText && <p className="mt-2 text-refGreen">{assignedText}</p>}
          {canOpen && <p className="mt-2 text-right text-[11px] font-black text-refGreen">Открыть распределение</p>}
        </div>
      )}
    </div>
  );
}

function PlanMetric({ label, value, accent, children }: { label: string; value: unknown; accent?: boolean; children?: ReactNode }) {
  return (
    <div className="border-r border-slate-300 px-2 py-1.5 last:border-r-0">
      <p className="text-[11px] font-bold text-slate-600">{label}</p>
      {children || <p className={`mt-0.5 text-sm font-black ${accent ? "text-refGreen" : ""}`}>{String(value ?? "")}</p>}
    </div>
  );
}
