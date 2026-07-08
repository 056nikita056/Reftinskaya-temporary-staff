import { Archive, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { BootstrapData, OperationCatalogItem, Section } from "../../api/client";
import type { BootstrapMutate } from "../../domain/types";
import { Empty } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

type SectionDraft = {
  name: string;
  order: string;
};

export function Dictionaries({ data, mutate }: { data: BootstrapData; mutate: BootstrapMutate }) {
  const [name, setName] = useState("");
  const [operationName, setOperationName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingOperation, setSavingOperation] = useState(false);
  const [savingSectionId, setSavingSectionId] = useState("");
  const [editingSectionId, setEditingSectionId] = useState("");
  const [sectionDraft, setSectionDraft] = useState<SectionDraft>({ name: "", order: "0" });
  const { confirm, notify } = useUiFeedback();
  const sections = [...(data.sections || [])].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    if (left.order !== right.order) return left.order - right.order;
    return left.name.localeCompare(right.name, "ru");
  });
  const activeCount = sections.filter((section) => section.active).length;
  const operationCatalog = [...(data.operationCatalog || [])].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name, "ru");
  });
  const activeOperationCount = operationCatalog.filter((operation) => operation.active).length;

  const createSection = async () => {
    const normalized = name.trim();
    if (!normalized) {
      notify("Введите название участка.", "warning");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const nextOrder = sections.reduce((max, section) => Math.max(max, section.order || 0), 0) + 1;
      const next = await mutate("/sections", "POST", { name: normalized, order: nextOrder, active: true }, "Участок добавлен");
      if (next) setName("");
    } finally {
      setSaving(false);
    }
  };

  const createOperation = async () => {
    const normalized = operationName.trim();
    if (!normalized) {
      notify("Введите название операции.", "warning");
      return;
    }
    if (savingOperation) return;
    setSavingOperation(true);
    try {
      const next = await mutate("/operation-catalog", "POST", { name: normalized, active: true }, "Операция добавлена");
      if (next) setOperationName("");
    } finally {
      setSavingOperation(false);
    }
  };

  const removeOperation = async (operation: OperationCatalogItem) => {
    const used = operation.operation_count || 0;
    if (used > 0) {
      if (!operation.active) {
        notify(`Операция уже в архиве и используется в ${used} строках плана.`, "warning");
        return;
      }
      const archive = await confirm({
        title: "Операция используется",
        message: `Операция используется в ${used} строках плана. Перевести в архив?`,
        confirmLabel: "В архив",
        cancelLabel: "Оставить",
        tone: "warning"
      });
      if (archive) await mutate(`/operation-catalog/${operation.id}`, "PUT", { active: false }, "Операция переведена в архив");
      return;
    }

    const remove = await confirm({
      title: "Удалить операцию?",
      message: `Удалить операцию "${operation.name}"?`,
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      tone: "error"
    });
    if (remove) await mutate(`/operation-catalog/${operation.id}`, "DELETE", undefined, "Операция удалена");
  };

  const removeSection = async (section: Section) => {
    const used = section.operation_count || 0;
    if (used > 0) {
      if (!section.active) {
        notify(`Участок уже в архиве и используется в ${used} операциях.`, "warning");
        return;
      }
      const archive = await confirm({
        title: "Участок используется",
        message: `Участок используется в ${used} операциях. Перевести в архив?`,
        confirmLabel: "В архив",
        cancelLabel: "Оставить",
        tone: "warning"
      });
      if (archive) await mutate(`/sections/${section.id}`, "PUT", { active: false }, "Участок переведен в архив");
      return;
    }

    const remove = await confirm({
      title: "Удалить участок?",
      message: `Удалить участок "${section.name}"?`,
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      tone: "error"
    });
    if (remove) await mutate(`/sections/${section.id}`, "DELETE", undefined, "Участок удален");
  };

  const startEdit = (section: Section) => {
    setEditingSectionId(section.id);
    setSectionDraft({ name: section.name, order: String(section.order ?? 0) });
  };

  const cancelEdit = () => {
    setEditingSectionId("");
    setSectionDraft({ name: "", order: "0" });
  };

  const saveSection = async (section: Section) => {
    const normalized = sectionDraft.name.trim();
    const order = Number(sectionDraft.order);
    if (!normalized) {
      notify("Введите название участка.", "warning");
      return;
    }
    if (!Number.isFinite(order) || order < 0) {
      notify("Порядок должен быть числом не ниже нуля.", "warning");
      return;
    }
    if (savingSectionId) return;
    setSavingSectionId(section.id);
    try {
      const next = await mutate(`/sections/${section.id}`, "PUT", {
        name: normalized,
        order: Math.trunc(order)
      }, "Участок сохранен");
      if (next) cancelEdit();
    } finally {
      setSavingSectionId("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Справочники</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">Участки: {activeCount} активных из {sections.length} · Операции: {activeOperationCount} активных из {operationCatalog.length}</p>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="text-sm font-black text-slate-600">
            Новый участок
            <input
              className="field mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Название участка"
              onKeyDown={(event) => {
                if (event.key === "Enter") void createSection();
              }}
            />
          </label>
          <button className="btn-primary h-11 self-end gap-2 disabled:bg-slate-300" disabled={saving} onClick={createSection}>
            <Plus size={17} /> Добавить
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="text-sm font-black text-slate-600">
            Новая операция
            <input
              className="field mt-1"
              value={operationName}
              onChange={(event) => setOperationName(event.target.value)}
              placeholder="Название операции"
              onKeyDown={(event) => {
                if (event.key === "Enter") void createOperation();
              }}
            />
          </label>
          <button className="btn-primary h-11 self-end gap-2 disabled:bg-slate-300" disabled={savingOperation} onClick={createOperation}>
            <Plus size={17} /> Добавить
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-black">Операции</h3>
        {operationCatalog.map((operation) => {
          const used = operation.operation_count || 0;
          return (
            <div key={operation.id} className={`grid gap-3 rounded-md border p-3 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center ${operation.active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-black text-refDark">{operation.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${operation.active ? "bg-emerald-50 text-refGreen" : "bg-slate-200 text-slate-600"}`}>
                    {operation.active ? "активна" : "архив"}
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">Строк плана: {used}</p>
              </div>
              <button
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-black ${used > 0 && operation.active ? "bg-orange-500 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                onClick={() => removeOperation(operation)}
                title={used > 0 && operation.active ? "Перевести в архив" : "Удалить операцию"}
              >
                {used > 0 && operation.active ? <Archive size={17} /> : <Trash2 size={17} />}
                {used > 0 && operation.active ? "В архив" : "Удалить"}
              </button>
            </div>
          );
        })}
        {!operationCatalog.length && <Empty title="Операций пока нет" text="Добавьте операции, чтобы выбирать их при создании плана." />}
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-black">Участки</h3>
        {sections.map((section) => {
          const used = section.operation_count || 0;
          const editing = editingSectionId === section.id;
          const savingCurrent = savingSectionId === section.id;
          return (
            <div key={section.id} className={`grid gap-3 rounded-md border p-3 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center ${section.active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
              <div className="min-w-0">
                {editing ? (
                  <div className="grid gap-2 md:grid-cols-[1fr_120px]">
                    <label className="text-xs font-black text-slate-500">
                      Название
                      <input
                        className="field mt-1 h-10"
                        value={sectionDraft.name}
                        onChange={(event) => setSectionDraft({ ...sectionDraft, name: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveSection(section);
                          if (event.key === "Escape") cancelEdit();
                        }}
                      />
                    </label>
                    <label className="text-xs font-black text-slate-500">
                      Порядок
                      <input
                        className="field mt-1 h-10"
                        min={0}
                        type="number"
                        value={sectionDraft.order}
                        onChange={(event) => setSectionDraft({ ...sectionDraft, order: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveSection(section);
                          if (event.key === "Escape") cancelEdit();
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-black text-refDark">{section.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${section.active ? "bg-emerald-50 text-refGreen" : "bg-slate-200 text-slate-600"}`}>
                        {section.active ? "активен" : "архив"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-500">Операций: {used} · Порядок: {section.order}</p>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {editing ? (
                  <>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-refGreen px-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      disabled={savingCurrent}
                      onClick={() => saveSection(section)}
                    >
                      <Check size={17} /> Сохранить
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-slate-700 hover:bg-slate-200"
                      onClick={cancelEdit}
                    >
                      <X size={17} /> Отмена
                    </button>
                  </>
                ) : (
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-refGreen hover:bg-emerald-50"
                    onClick={() => startEdit(section)}
                    title="Переименовать участок"
                  >
                    <Pencil size={17} /> Изменить
                  </button>
                )}
                <button
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-black ${used > 0 && section.active ? "bg-orange-500 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                  onClick={() => removeSection(section)}
                  title={used > 0 && section.active ? "Перевести в архив" : "Удалить участок"}
                >
                  {used > 0 && section.active ? <Archive size={17} /> : <Trash2 size={17} />}
                  {used > 0 && section.active ? "В архив" : "Удалить"}
                </button>
              </div>
            </div>
          );
        })}
        {!sections.length && <Empty title="Участков пока нет" text="Добавьте первый участок фабрики. В следующих правках операции будут выбирать участок из этого справочника." />}
      </section>
    </div>
  );
}
