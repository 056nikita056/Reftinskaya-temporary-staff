import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Operation, OperationCatalogItem, Section } from "../../api/client";
import type { PlanKind } from "../../domain/types";
import { calculateOutsource, displayOperationName, displaySectionName, numberValue } from "../../domain/display";
import { Modal } from "../../components/common";

export type PlanEditAccess = {
  factory: boolean;
  hr: boolean;
  out: boolean;
};

export function PlanOperationCard({ kind, row, sections = [], operationCatalog = [], assigned = [], edit, editAccess, onChange, onOpen, onRemove }: { kind: PlanKind; row: Operation; sections?: Section[]; operationCatalog?: OperationCatalogItem[]; assigned?: string[]; edit?: boolean; editAccess?: PlanEditAccess; onChange?: (patch: Partial<Operation>) => void; onOpen?: () => void; onRemove?: () => void }) {
  const [picker, setPicker] = useState<"section" | "operation" | null>(null);
  const required = numberValue(row.required_staff);
  const staff = numberValue(row.staff_count);
  const outsource = calculateOutsource(required, staff);
  const canEditFactory = Boolean(edit && (editAccess?.factory ?? kind === "factory"));
  const canEditHr = Boolean(edit && (editAccess?.hr ?? kind === "hr"));
  const canEditOut = Boolean(edit && (editAccess?.out ?? kind === "out"));
  const canOpen = (kind === "out" || Boolean(editAccess?.out)) && !edit && Boolean(onOpen);
  const assignedText = assigned.length ? assigned.join(", ") : "";
  const update = (patch: Partial<Operation>) => onChange?.(patch);
  const sectionTree = buildSectionTree(sections);
  const operationTree = buildOperationTree(operationCatalog);
  const selectSection = (sectionId: string) => {
    const section = sections.find((item) => item.id === sectionId);
    update({
      section_id: section?.id || undefined,
      section_name: section?.name || "",
      section_order: section?.order ?? row.section_order
    });
    setPicker(null);
  };
  const selectOperation = (nodeKey: string) => {
    const node = operationTree.find((item) => item.key === nodeKey);
    if (!node) return;
    const operation = node.source === "operation" ? operationCatalog.find((item) => item.id === node.id) : undefined;
    update({
      operation_id: operation?.id,
      name: node.name
    });
    setPicker(null);
  };
  const open = () => {
    if (canOpen) onOpen?.();
  };

  if (edit) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid min-w-0 gap-2 xl:grid-cols-[minmax(11rem,1fr)_minmax(14rem,1.4fr)_6.5rem_6.5rem_6.5rem_7rem_2.5rem] xl:items-end">
          <PlanRowField label="Структура">
            {canEditFactory ? (
              <button className="h-9 w-full min-w-0 truncate rounded border border-slate-300 bg-white px-2 text-left text-sm font-black text-refDark outline-none transition hover:bg-emerald-50 focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" type="button" onClick={() => setPicker("section")}>
                {row.section_id ? displaySectionName(row.section_name) : "Выбрать"}
              </button>
            ) : (
              <ReadonlyCell>{displaySectionName(row.section_name)}</ReadonlyCell>
            )}
          </PlanRowField>
          <PlanRowField label="Операция">
            {canEditFactory ? (
              <button className="h-9 w-full min-w-0 truncate rounded border border-slate-300 bg-white px-2 text-left text-sm font-black text-refDark outline-none transition hover:bg-emerald-50 focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" type="button" onClick={() => setPicker("operation")}>
                {row.name ? displayOperationName(row.name) : "Выбрать"}
              </button>
            ) : (
              <ReadonlyCell>{displayOperationName(row.name)}</ReadonlyCell>
            )}
          </PlanRowField>
          <PlanRowField label="Персонал">
            {canEditFactory ? (
              <input className="h-9 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.required_staff} onChange={(event) => update({ required_staff: numberValue(event.target.value), outsource_count: calculateOutsource(event.target.value, row.staff_count) })} />
            ) : (
              <ReadonlyCell align="center">{required}</ReadonlyCell>
            )}
          </PlanRowField>
          <PlanRowField label="Штат">
            {canEditHr ? (
              <input className="h-9 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.staff_count} onChange={(event) => update({ staff_count: numberValue(event.target.value), outsource_count: calculateOutsource(required, event.target.value) })} />
            ) : (
              <ReadonlyCell align="center">{staff}</ReadonlyCell>
            )}
          </PlanRowField>
          <PlanRowField label="Аутсорсинг">
            <ReadonlyCell align="center" accent>{outsource}</ReadonlyCell>
          </PlanRowField>
          <PlanRowField label="Ставка">
            {canEditOut ? (
              <input className="h-9 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.rate_per_hour} onChange={(event) => update({ rate_per_hour: numberValue(event.target.value) })} />
            ) : (
              <ReadonlyCell align="center">{row.rate_per_hour}</ReadonlyCell>
            )}
          </PlanRowField>
          <div className="flex items-end justify-end">
            {onRemove ? (
              <button className="flex h-9 w-9 items-center justify-center rounded bg-red-50 text-red-600 transition hover:bg-red-100" type="button" title="Удалить операцию" onClick={onRemove}>
                <Trash2 size={16} />
              </button>
            ) : (
              <span className="hidden h-9 w-9 xl:block" />
            )}
          </div>
        </div>
        {picker === "section" && (
          <CatalogPicker
            title="Выбор участка"
            emptyText="Нет элементов структуры."
            entries={sectionTree}
            selectedId={row.section_id ? `section:${row.section_id}` : ""}
            selectable={() => true}
            onSelect={(entry) => selectSection(entry.id)}
            close={() => setPicker(null)}
          />
        )}
        {picker === "operation" && (
          <CatalogPicker
            title="Выбор операции"
            emptyText="Нет операций."
            entries={operationTree}
            selectedId={row.operation_id ? `operation:${row.operation_id}` : ""}
            selectable={() => true}
            onSelect={(entry) => selectOperation(entry.key)}
            close={() => setPicker(null)}
          />
        )}
      </div>
    );
  }

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
        {canEditFactory ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
              <button className="h-8 min-w-0 truncate rounded bg-slate-100 px-2 text-left text-[11px] font-black text-slate-700 outline-none ring-1 ring-slate-200 transition hover:bg-emerald-50 focus:bg-white focus:ring-2 focus:ring-refGreen/30" type="button" onClick={() => setPicker("section")}>
                {row.section_id ? displaySectionName(row.section_name) : "Участок"}
              </button>
              <button className="h-8 min-w-0 truncate rounded bg-slate-100 px-2 text-left text-sm font-black text-refDark outline-none ring-1 ring-slate-200 transition hover:bg-emerald-50 focus:bg-white focus:ring-2 focus:ring-refGreen/30" type="button" onClick={() => setPicker("operation")}>
                {row.name ? displayOperationName(row.name) : "Операция"}
              </button>
            </div>
            {onRemove && (
              <button className="flex h-8 w-8 items-center justify-center rounded bg-red-50 text-red-600 transition hover:bg-red-100" type="button" title="Удалить операцию" onClick={onRemove}>
                <Trash2 size={16} />
              </button>
            )}
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
          {canEditFactory ? (
            <input className="mx-auto mt-1 h-7 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.required_staff} onChange={(event) => update({ required_staff: numberValue(event.target.value), outsource_count: calculateOutsource(event.target.value, row.staff_count) })} />
          ) : null}
        </PlanMetric>
        <PlanMetric label="Штат" value={staff}>
          {canEditHr ? (
            <input className="mx-auto mt-1 h-7 w-full rounded border border-slate-300 px-2 text-center text-sm font-black outline-none focus:border-refGreen focus:ring-2 focus:ring-refGreen/20" inputMode="numeric" value={row.staff_count} onChange={(event) => update({ staff_count: numberValue(event.target.value), outsource_count: calculateOutsource(required, event.target.value) })} />
          ) : null}
        </PlanMetric>
        <PlanMetric label="Аутсорсинг" value={outsource} accent />
      </div>

      {(kind === "out" || canEditOut || assigned.length > 0) && (
        <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs font-bold text-slate-600">
          {(kind === "out" || canEditOut) && (
            <div className="grid gap-2">
              {canEditOut ? (
                <label className="text-[11px] font-black text-slate-500">Ставка/час<input className="field mt-1 h-8" value={row.rate_per_hour} onChange={(event) => update({ rate_per_hour: numberValue(event.target.value) })} /></label>
              ) : (
                <p>{row.rate_per_hour} руб./ч</p>
              )}
            </div>
          )}
          {(kind === "out" || canEditOut) && !edit && <p className="mt-2 text-refGreen">Назначено: {assigned.length}/{Math.max(outsource, assigned.length, 1)}</p>}
          {assignedText && <p className="mt-2 text-refGreen">{assignedText}</p>}
          {canOpen && <p className="mt-2 text-right text-[11px] font-black text-refGreen">Открыть распределение</p>}
        </div>
      )}
      {picker === "section" && (
        <CatalogPicker
          title="Выбор участка"
          emptyText="Нет элементов структуры."
          entries={sectionTree}
          selectedId={row.section_id ? `section:${row.section_id}` : ""}
          selectable={() => true}
          onSelect={(entry) => selectSection(entry.id)}
          close={() => setPicker(null)}
        />
      )}
      {picker === "operation" && (
        <CatalogPicker
          title="Выбор операции"
          emptyText="Нет операций."
          entries={operationTree}
          selectedId={row.operation_id ? `operation:${row.operation_id}` : ""}
          selectable={() => true}
          onSelect={(entry) => selectOperation(entry.key)}
          close={() => setPicker(null)}
        />
      )}
    </div>
  );
}

type PickerEntry = {
  id: string;
  key: string;
  source: "section" | "operation";
  parentId: string;
  name: string;
  active: boolean;
  depth: number;
  childCount: number;
};

function CatalogPicker({ title, emptyText, entries, selectedId, selectable, onSelect, close }: { title: string; emptyText: string; entries: PickerEntry[]; selectedId: string; selectable: (entry: PickerEntry) => boolean; onSelect: (entry: PickerEntry) => void; close: () => void }) {
  const visibleEntries = entries.filter((entry) => entry.active);
  return (
    <Modal title={title} close={close}>
      <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200">
        {visibleEntries.map((entry) => {
          const canSelect = selectable(entry);
          return (
            <button
              key={entry.key}
              className={`flex min-h-10 w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 ${selectedId === entry.key ? "bg-emerald-50 text-refGreen" : canSelect ? "bg-white hover:bg-slate-50" : "cursor-not-allowed bg-slate-50 text-slate-400"}`}
              disabled={!canSelect}
              type="button"
              onClick={() => onSelect(entry)}
            >
              <span className="min-w-0 truncate font-black" style={{ paddingLeft: `${entry.depth * 18}px` }}>{entry.name}</span>
              {entry.childCount > 0 && <span className="shrink-0 text-[11px] font-bold text-slate-400">+{entry.childCount}</span>}
            </button>
          );
        })}
        {!visibleEntries.length && <p className="p-4 text-sm font-bold text-slate-500">{emptyText}</p>}
      </div>
    </Modal>
  );
}

function PlanRowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0 text-[11px] font-black uppercase text-slate-500">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ReadonlyCell({ children, align = "left", accent }: { children: ReactNode; align?: "left" | "center"; accent?: boolean }) {
  return (
    <div className={`flex h-9 min-w-0 items-center rounded border border-slate-200 bg-slate-50 px-2 text-sm font-black ${align === "center" ? "justify-center text-center" : ""} ${accent ? "text-refGreen" : "text-refDark"}`}>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function buildSectionTree(sections: Section[]): PickerEntry[] {
  const childCounts = new Map<string, number>();
  for (const section of sections) {
    if (section.parent_id) childCounts.set(section.parent_id, (childCounts.get(section.parent_id) || 0) + 1);
  }
  return buildTreeEntries(
    sections.map((section) => ({
      id: section.id,
      key: `section:${section.id}`,
      source: "section" as const,
      parentId: section.parent_id ? `section:${section.parent_id}` : "",
      name: section.name,
      active: section.active,
      childCount: childCounts.get(section.id) || 0
    }))
  );
}

function buildOperationTree(operations: OperationCatalogItem[]): PickerEntry[] {
  const allowedIds = new Set(operations.map((operation) => operation.id));
  const childCounts = new Map<string, number>();
  for (const operation of operations) {
    const parentKey = operation.parent_id && allowedIds.has(operation.parent_id) ? `operation:${operation.parent_id}` : "";
    if (parentKey) childCounts.set(parentKey, (childCounts.get(parentKey) || 0) + 1);
  }
  return buildTreeEntries(
    operations.map((operation) => ({
      id: operation.id,
      key: `operation:${operation.id}`,
      source: "operation" as const,
      parentId: operation.parent_id && allowedIds.has(operation.parent_id) ? `operation:${operation.parent_id}` : "",
      name: operation.name,
      active: operation.active,
      childCount: childCounts.get(`operation:${operation.id}`) || 0
    }))
  );
}

function buildTreeEntries(nodes: Array<Omit<PickerEntry, "depth">>): PickerEntry[] {
  const byParent = new Map<string, Array<Omit<PickerEntry, "depth">>>();
  for (const node of nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) || []), node]);
  }
  for (const [parentId, children] of byParent.entries()) {
    byParent.set(parentId, children.sort((left, right) => left.name.localeCompare(right.name, "ru")));
  }
  const result: PickerEntry[] = [];
  const walk = (parentId: string, depth: number, visited: Set<string>) => {
    for (const node of byParent.get(parentId) || []) {
      if (visited.has(node.key)) continue;
      result.push({ ...node, depth });
      walk(node.key, depth + 1, new Set([...visited, node.key]));
    }
  };
  walk("", 0, new Set());
  return result;
}

function PlanMetric({ label, value, accent, children }: { label: string; value: unknown; accent?: boolean; children?: ReactNode }) {
  return (
    <div className="border-r border-slate-300 px-2 py-1.5 last:border-r-0">
      <p className="text-[11px] font-bold text-slate-600">{label}</p>
      {children || <p className={`mt-0.5 text-sm font-black ${accent ? "text-refGreen" : ""}`}>{String(value ?? "")}</p>}
    </div>
  );
}
