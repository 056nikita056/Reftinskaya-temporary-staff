import { Check, ChevronDown, ChevronRight, Copy, FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { BootstrapData, DictionaryItem, OperationCatalogItem, RoleKey, Section } from "../../api/client";
import type { BootstrapMutate } from "../../domain/types";
import { Empty, Modal } from "../../components/common";
import { displayOperationName, displaySectionName, internalPlanStatusLabel, planPeriod } from "../../domain/display";
import { useUiFeedback } from "../../ui/feedback";

type ParentValue = "" | `section:${string}` | `operation:${string}`;
type Draft = {
  name: string;
  parent: ParentValue;
};
type TreeNode = {
  key: string;
  id: string;
  source: "section" | "operation";
  name: string;
  active: boolean;
  isFolder: boolean;
  operationCount: number;
  parentKey: string;
  sectionId?: string | null;
  raw: Section | OperationCatalogItem;
};
type TreeEntry = {
  node: TreeNode;
  depth: number;
};
type DictionaryKey =
  | "list"
  | "workStructure"
  | "operations"
  | "employeeStatuses"
  | "housingReservationStatuses"
  | "housingFactStatuses"
  | "dormitories"
  | "rooms"
  | "beds"
  | "priceList"
  | "roomPriceList";

type DictionaryCard = {
  key: Exclude<DictionaryKey, "list">;
  title: string;
  total: number;
  active: number;
  used: number;
  usedLabel?: string;
};

type GenericDictionaryRow = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  usage?: string;
  raw: DictionaryItem;
};
type GenericDraft = Record<string, string | boolean>;
type GenericFieldDefinition = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "checkbox" | "select";
  options?: Array<[string, string]>;
};

export function Dictionaries({ role, data, mutate, canEdit, openPlan }: { role: RoleKey; data: BootstrapData; mutate: BootstrapMutate; canEdit: boolean; openPlan?: (planId: string) => void }) {
  const [activeDictionary, setActiveDictionary] = useState<DictionaryKey>("list");
  const sections = [...(data.sections || [])].sort(sortSections);
  const operations = [...(data.operationCatalog || [])].sort(sortOperations);
  const nodes = buildUnifiedNodes(sections, operations);
  const dictionaryNodes = nodesForDictionary(nodes, activeDictionary);
  const tree = buildTree(dictionaryNodes);
  const childCounts = childCountByKey(dictionaryNodes);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft>({ name: "", parent: "" });
  const [editKey, setEditKey] = useState("");
  const [editDraft, setEditDraft] = useState<Draft>({ name: "", parent: "" });
  const [usageNodeKey, setUsageNodeKey] = useState("");
  const [draggedKey, setDraggedKey] = useState("");
  const [dropKey, setDropKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const { confirm, notify } = useUiFeedback();
  const activeSections = sections.filter((item) => item.active).length;
  const activeOperations = operations.filter((item) => item.active).length;
  const allowedDictionaries = allowedDictionaryKeys(role);
  const cards = dictionaryCards(data, sections, operations, nodes).filter((card) => allowedDictionaries.has(card.key));
  const selectedNode = dictionaryNodes.find((node) => node.key === selectedKey);
  const selectedCount = selectedKeys.size;
  const actionNode = selectedCount === 1 ? selectedNode : undefined;
  const usageNode = dictionaryNodes.find((node) => node.key === usageNodeKey);
  const visibleTree = visibleTreeEntries(tree, collapsedKeys);
  const dictionaryTitle = activeDictionary === "operations" ? "Справочник операций" : "Справочник территорий предприятия";
  const dictionaryStats = activeDictionary === "operations"
    ? `Операции: ${activeOperations} активных из ${operations.length}`
    : `Элементы: ${activeSections} активных из ${sections.length}`;

  if (activeDictionary === "list") {
    return (
      <DictionariesLanding
        cards={cards}
        onOpen={(key) => {
          setSelectedKey("");
          setSelectedKeys(new Set());
          setDraft({ name: "", parent: "" });
          setEditKey("");
          setEditDraft({ name: "", parent: "" });
          setUsageNodeKey("");
          if (!allowedDictionaries.has(key)) return;
          setCollapsedKeys(defaultCollapsedKeys(nodesForDictionary(nodes, key)));
          setActiveDictionary(key);
        }}
      />
    );
  }

  if (!allowedDictionaries.has(activeDictionary)) {
    return <Empty title="Нет доступа" text="Этот справочник недоступен для текущей роли." />;
  }

  if (activeDictionary !== "workStructure" && activeDictionary !== "operations") {
    return <GenericDictionaryView dictionaryKey={activeDictionary} data={data} mutate={mutate} canEdit={canEdit} back={() => setActiveDictionary("list")} />;
  }

  const createNode = async () => {
    if (!canEdit) return;
    const name = draft.name.trim();
    if (!name) {
      notify("Введите название элемента справочника.", "warning");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const next = activeDictionary === "workStructure"
        ? await mutate("/sections", "POST", sectionPayload(draft, name), "Элемент структуры добавлен")
        : await mutate("/operation-catalog", "POST", operationPayload(draft, name, operations), "Операция добавлена");
      if (next) setDraft({ ...draft, name: "" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (node: TreeNode) => {
    if (!canEdit) return;
    setSelectedKey(node.key);
    setSelectedKeys(new Set([node.key]));
    setEditKey(node.key);
    setEditDraft({
      name: node.name,
      parent: parentValueForNode(node)
    });
  };

  const cancelEdit = () => {
    setEditKey("");
    setEditDraft({ name: "", parent: "" });
  };

  const saveNode = async (node: TreeNode) => {
    if (!canEdit) return;
    const name = editDraft.name.trim();
    if (!name) {
      notify("Введите название элемента справочника.", "warning");
      return;
    }
    if (savingKey) return;
    setSavingKey(node.key);
    try {
      const next = node.source === "section"
        ? await mutate(`/sections/${node.id}`, "PUT", sectionPayload(editDraft, name), "Элемент структуры сохранен")
        : await mutate(`/operation-catalog/${node.id}`, "PUT", operationPayload(editDraft, name, operations), "Операция сохранена");
      if (next) cancelEdit();
    } finally {
      setSavingKey("");
    }
  };

  const removeNode = async (node: TreeNode) => {
    if (!canEdit) return;
    const childCount = dictionaryNodes.filter((item) => item.parentKey === node.key).length;
    if (childCount > 0) {
      notify("Сначала удалите или перенесите дочерние элементы.", "warning");
      return;
    }
    if (node.operationCount > 0) {
      if (!node.active) {
        notify(`Элемент уже в архиве и используется в ${node.operationCount} строках плана.`, "warning");
        return;
      }
      const archive = await confirm({
        title: "Элемент используется",
        message: `Элемент используется в ${node.operationCount} строках плана. Перевести в архив?`,
        confirmLabel: "В архив",
        cancelLabel: "Оставить",
        tone: "warning"
      });
      if (archive) {
        const path = node.source === "section" ? `/sections/${node.id}` : `/operation-catalog/${node.id}`;
        await mutate(path, "PUT", { active: false }, "Элемент переведен в архив");
      }
      return;
    }
    const remove = await confirm({
      title: "Удалить элемент?",
      message: `Удалить "${node.name}"?`,
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      tone: "error"
    });
    if (!remove) return;
    const path = node.source === "section" ? `/sections/${node.id}` : `/operation-catalog/${node.id}`;
    await mutate(path, "DELETE", undefined, "Элемент удален");
    if (selectedKey === node.key) setSelectedKey("");
    setSelectedKeys((current) => {
      const next = new Set(current);
      next.delete(node.key);
      return next;
    });
  };

  const copyNode = async (node: TreeNode) => {
    if (!canEdit) return;
    const name = `Копия ${node.name}`;
    const parent = parentValueForNode(node);
    const next = node.source === "section"
      ? await mutate("/sections", "POST", sectionPayload({ name, parent }, name), "Элемент скопирован")
      : await mutate("/operation-catalog", "POST", operationPayload({ name, parent }, name, operations), "Элемент скопирован");
    if (next) setDraft((current) => ({ ...current, name: "" }));
  };

  const moveNode = async (node: TreeNode, target: TreeNode) => {
    if (!canEdit) return;
    if (node.key === target.key || isDescendant(dictionaryNodes, target.key, node.key)) {
      notify("Нельзя перенести элемент внутрь самого себя или своего потомка.", "warning");
      return;
    }
    if (!target.active) {
      notify("Нельзя перенести элемент в архивный родитель.", "warning");
      return;
    }
    if (node.source === "section") {
      await mutate(`/sections/${node.id}`, "PUT", { parent_id: target.id }, "Элемент перенесен");
      return;
    }
    await mutate(`/operation-catalog/${node.id}`, "PUT", target.source === "section"
      ? { parent_id: null, section_id: target.id }
      : { parent_id: target.id, section_id: target.sectionId ?? null }, "Элемент перенесен");
  };

  const moveNodeToRoot = async (node: TreeNode) => {
    if (!canEdit) return;
    if (!node.parentKey) return;
    if (node.source === "section") {
      await mutate(`/sections/${node.id}`, "PUT", { parent_id: null }, "Элемент перенесен");
      return;
    }
    await mutate(`/operation-catalog/${node.id}`, "PUT", { parent_id: null, section_id: null }, "Элемент перенесен");
  };

  const selectNode = (node: TreeNode, range = false) => {
    if (range && selectedKey) {
      const from = visibleTree.findIndex((entry) => entry.node.key === selectedKey);
      const to = visibleTree.findIndex((entry) => entry.node.key === node.key);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelectedKeys(new Set(visibleTree.slice(start, end + 1).map((entry) => entry.node.key)));
      } else {
        setSelectedKeys(new Set([node.key]));
      }
    } else {
      setSelectedKeys(new Set([node.key]));
    }
    setSelectedKey(node.key);
    setDraft((current) => ({
      ...current,
      parent: node.key as ParentValue
    }));
  };

  const clearSelection = () => {
    setSelectedKey("");
    setSelectedKeys(new Set());
    cancelEdit();
    setDraft((current) => ({ ...current, parent: "" }));
  };

  const toggleCollapsed = (node: TreeNode) => {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  };

  const finishDrop = async (target: TreeNode) => {
    const draggedNode = dictionaryNodes.find((node) => node.key === draggedKey);
    setDraggedKey("");
    setDropKey("");
    if (!draggedNode) return;
    await moveNode(draggedNode, target);
  };

  const finishRootDrop = async () => {
    const draggedNode = dictionaryNodes.find((node) => node.key === draggedKey);
    setDraggedKey("");
    setDropKey("");
    if (!draggedNode) return;
    await moveNodeToRoot(draggedNode);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-normal">{dictionaryTitle}</h2>
          <p className="mt-1 text-sm font-normal text-slate-500">{dictionaryStats}</p>
        </div>
        <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal text-slate-700 hover:bg-slate-200" onClick={() => setActiveDictionary("list")}>
          Назад
        </button>
      </div>

      {canEdit && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2 xl:grid-cols-[1fr_320px_auto]">
            <label className="text-sm font-normal text-slate-600">
              Название
              <input
                className="field mt-1"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Название"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createNode();
                }}
              />
            </label>
            <label className="text-sm font-normal text-slate-600">
              Материнский элемент
              <ParentSelect className="field mt-1" value={draft.parent} nodes={dictionaryNodes} onChange={(parent) => setDraft({ ...draft, parent })} />
            </label>
            <button className="btn-primary h-11 self-end gap-2 disabled:bg-slate-300" disabled={saving} onClick={createNode}>
              <Plus size={17} /> Создать
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-2">
          <div className="min-w-0">
            <p className="text-xs font-normal uppercase text-slate-500">Выбранный элемент</p>
            <p className="min-w-0 truncate text-sm font-normal text-refDark">{selectedCount > 1 ? `Выбрано: ${selectedCount}` : selectedNode ? selectedNode.name : "Не выбран"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && editKey ? (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-refGreen px-3 text-sm font-normal text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!actionNode || savingKey === actionNode.key} onClick={() => actionNode && saveNode(actionNode)}>
                  <Check size={17} /> Сохранить
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200" onClick={cancelEdit}>
                  <X size={17} /> Отмена
                </button>
              </>
            ) : (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode || actionNode.operationCount <= 0} onClick={() => actionNode && setUsageNodeKey(actionNode.key)}>
                  Использование
                </button>
                {canEdit && (
                  <>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && copyNode(actionNode)}>
                      <Copy size={17} /> Копировать
                    </button>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-refGreen hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && startEdit(actionNode)}>
                      <Pencil size={17} /> Изменить
                    </button>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-50 px-3 text-sm font-normal text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && removeNode(actionNode)}>
                      <Trash2 size={17} /> Удалить
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div
          className={`min-h-[calc(100vh-23rem)] p-2 ${draggedKey ? "transition-colors hover:bg-slate-50" : ""}`}
          onClick={clearSelection}
          onDragOver={(event) => {
            if (!canEdit || !draggedKey) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!canEdit || !draggedKey) return;
            event.preventDefault();
            void finishRootDrop();
          }}
        >
        {visibleTree.map((entry) => (
          <TreeRow
            key={entry.node.key}
            entry={entry}
            nodes={dictionaryNodes}
            childCount={childCounts.get(entry.node.key) || 0}
            collapsed={collapsedKeys.has(entry.node.key)}
            dragging={draggedKey === entry.node.key}
            dropTarget={dropKey === entry.node.key}
            selected={selectedKeys.has(entry.node.key)}
            editing={editKey === entry.node.key}
            draft={editDraft}
            setDraft={setEditDraft}
            canEdit={canEdit}
            onSelect={(range) => selectNode(entry.node, range)}
            onToggle={() => toggleCollapsed(entry.node)}
            onOpenUsage={() => setUsageNodeKey(entry.node.key)}
            onDragStart={() => {
              if (!canEdit) return;
              setDraggedKey(entry.node.key);
              setSelectedKey(entry.node.key);
              setSelectedKeys(new Set([entry.node.key]));
            }}
            onDragOver={() => canEdit && draggedKey && draggedKey !== entry.node.key && setDropKey(entry.node.key)}
            onDragLeave={() => canEdit && dropKey === entry.node.key && setDropKey("")}
            onDrop={() => canEdit && finishDrop(entry.node)}
            onDragEnd={() => {
              setDraggedKey("");
              setDropKey("");
            }}
          />
        ))}
        {!tree.length && <Empty title="Справочник пуст" text={activeDictionary === "operations" ? "Создайте первую операцию." : "Создайте первый элемент структуры."} />}
        </div>
      </section>
      {usageNode && <UsageModal node={usageNode} data={data} close={() => setUsageNodeKey("")} openPlan={openPlan} />}
    </div>
  );
}

function DictionariesLanding({ cards, onOpen }: { cards: DictionaryCard[]; onOpen: (key: Exclude<DictionaryKey, "list">) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-normal">Справочники</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <button key={card.key} className="group rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50" onClick={() => onOpen(card.key)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-refGreen text-white">
                <FileText size={20} />
              </div>
              <span className="text-xs font-normal uppercase text-slate-400 group-hover:text-refGreen">Открыть</span>
            </div>
            <h3 className="mt-4 text-base font-normal text-refDark">{card.title}</h3>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-normal text-refDark">{card.total}</p>
                <p className="text-[10px] font-normal uppercase text-slate-500">Всего</p>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-normal text-refDark">{card.active}</p>
                <p className="text-[10px] font-normal uppercase text-slate-500">Активно</p>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-normal text-refDark">{card.used}</p>
                <p className="text-[10px] font-normal uppercase text-slate-500">{card.usedLabel || "В планах"}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function GenericDictionaryView({ dictionaryKey, data, mutate, canEdit, back }: { dictionaryKey: Exclude<DictionaryKey, "list" | "workStructure" | "operations">; data: BootstrapData; mutate: BootstrapMutate; canEdit: boolean; back: () => void }) {
  const meta = genericDictionaryMeta(dictionaryKey);
  const rows = genericDictionaryRows(dictionaryKey, data);
  const fields = genericDictionaryFields(dictionaryKey, data);
  const emptyDraft = genericEmptyDraft(fields);
  const [draft, setDraft] = useState<GenericDraft>(emptyDraft);
  const [selectedId, setSelectedId] = useState("");
  const [editId, setEditId] = useState("");
  const [editDraft, setEditDraft] = useState<GenericDraft>(emptyDraft);
  const [usageId, setUsageId] = useState("");
  const { confirm, notify } = useUiFeedback();
  const selected = rows.find((row) => row.id === selectedId);
  const usageRow = rows.find((row) => row.id === usageId);
  const endpoint = genericDictionaryEndpoint(dictionaryKey);
  const selectedCount = selected ? 1 : 0;

  const createItem = async () => {
    const payload = genericPayload(fields, draft);
    const firstValue = payload[fields[0]?.key || "title"];
    if (!String(firstValue || payload.title || payload.name || payload.room_number || payload.bed_number || "").trim()) {
      notify("Введите название элемента справочника.", "warning");
      return;
    }
    const next = await mutate(endpoint, "POST", payload, "Элемент справочника добавлен");
    if (next) setDraft(emptyDraft);
  };

  const startEdit = (row: GenericDictionaryRow) => {
    setSelectedId(row.id);
    setEditId(row.id);
    setEditDraft(genericDraftFromRow(fields, row));
  };

  const saveItem = async () => {
    if (!selected) return;
    const payload = genericPayload(fields, editDraft);
    const next = await mutate(`${endpoint}/${selected.id}`, "PUT", payload, "Элемент справочника сохранен");
    if (next) setEditId("");
  };

  const copyItem = async () => {
    if (!selected) return;
    const copyDraft = genericDraftFromRow(fields, selected);
    const firstKey = fields[0]?.key || "title";
    const payload = genericPayload(fields, { ...copyDraft, [firstKey]: `Копия ${selected.title}` });
    await mutate(endpoint, "POST", payload, "Элемент справочника скопирован");
  };

  const removeItem = async () => {
    if (!selected) return;
    const used = Number(selected.raw.usageCount || 0);
    const message = used > 0 ? `Элемент используется (${used}). Перевести в архив или удалить, если это возможно?` : `Удалить "${selected.title}"?`;
    const remove = await confirm({ title: used > 0 ? "Элемент используется" : "Удалить элемент?", message, confirmLabel: used > 0 ? "Продолжить" : "Удалить", cancelLabel: "Отмена", tone: used > 0 ? "warning" : "error" });
    if (!remove) return;
    const next = await mutate(`${endpoint}/${selected.id}`, "DELETE", undefined, used > 0 ? "Элемент переведен в архив" : "Элемент удален");
    if (next) setSelectedId("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-normal">{meta.title}</h2>
          <p className="mt-1 text-sm font-normal text-slate-500">{meta.description}</p>
        </div>
        <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-normal text-slate-700 hover:bg-slate-200" onClick={back}>
          Назад
        </button>
      </div>
      {canEdit && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            {fields.map((field) => (
              <GenericField key={field.key} field={field} value={draft[field.key]} onChange={(value) => setDraft({ ...draft, [field.key]: value })} />
            ))}
            <button className="btn-primary h-11 self-end gap-2" onClick={createItem}>
              <Plus size={17} /> Создать
            </button>
          </div>
        </section>
      )}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-2">
          <div className="min-w-0">
            <p className="text-xs font-normal uppercase text-slate-500">Выбранный элемент</p>
            <p className="min-w-0 truncate text-sm font-normal text-refDark">{selectedCount > 1 ? `Выбрано: ${selectedCount}` : selected ? selected.title : "Не выбран"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && editId ? (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-refGreen px-3 text-sm font-normal text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!selected} onClick={saveItem}>
                  <Check size={17} /> Сохранить
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200" onClick={() => setEditId("")}>
                  <X size={17} /> Отмена
                </button>
              </>
            ) : (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!selected || Number(selected.raw.usageCount || 0) <= 0} onClick={() => selected && setUsageId(selected.id)}>
                  Использование
                </button>
                {canEdit && (
                  <>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!selected} onClick={copyItem}>
                      <Copy size={17} /> Копировать
                    </button>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-normal text-refGreen hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!selected} onClick={() => selected && startEdit(selected)}>
                      <Pencil size={17} /> Изменить
                    </button>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-50 px-3 text-sm font-normal text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!selected} onClick={removeItem}>
                      <Trash2 size={17} /> Удалить
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="min-h-[calc(100vh-23rem)] p-2" onClick={() => {
          setSelectedId("");
          setEditId("");
        }}>
          {rows.map((row) => (
            <GenericTreeRow
              key={row.id}
              row={row}
              fields={fields}
              selected={selectedId === row.id}
              editing={editId === row.id}
              draft={editDraft}
              setDraft={setEditDraft}
              onSelect={() => setSelectedId(row.id)}
              onOpenUsage={() => Number(row.raw.usageCount || 0) > 0 && setUsageId(row.id)}
            />
          ))}
          {!rows.length && <Empty title="Справочник пуст" text="Создайте первый элемент справочника." />}
        </div>
      </section>
      {usageRow && <GenericUsageModal row={usageRow} close={() => setUsageId("")} />}
    </div>
  );
}

function GenericTreeRow({ row, fields, selected, editing, draft, setDraft, onSelect, onOpenUsage }: {
  row: GenericDictionaryRow;
  fields: GenericFieldDefinition[];
  selected: boolean;
  editing: boolean;
  draft: GenericDraft;
  setDraft: (draft: GenericDraft) => void;
  onSelect: () => void;
  onOpenUsage: () => void;
}) {
  const active = row.raw.active;
  const usageCount = Number(row.raw.usageCount || 0);
  return (
    <div
      className={`cursor-default border-b border-slate-100 px-2 py-2 last:border-b-0 ${selected ? "bg-emerald-50 ring-1 ring-inset ring-refGreen/30" : active ? "hover:bg-slate-50" : "bg-slate-50 text-slate-500"}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onSelect();
        onOpenUsage();
      }}
      onKeyDown={(event) => {
        if (isEditableControl(event.target)) return;
        if (event.key === "Enter") onSelect();
        if (event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="min-w-0">
        {editing ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {fields.map((field) => (
              <GenericField key={field.key} compact field={field} value={draft[field.key]} onChange={(value) => setDraft({ ...draft, [field.key]: value })} />
            ))}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 shrink-0" />
              <p className="min-w-0 truncate text-sm font-normal text-refDark">{row.title}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-normal ${active ? "bg-emerald-50 text-refGreen" : "bg-slate-200 text-slate-600"}`}>{active ? "активен" : "архив"}</span>
            </div>
            <div className="ml-8 mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`text-xs font-normal ${usageCount > 0 ? "text-refGreen" : "text-slate-500"}`}>{usageCount > 0 ? "Используется" : "Не используется"}</span>
              {row.subtitle && <span className="min-w-0 truncate text-xs font-normal text-slate-500">{row.subtitle}</span>}
              {row.usage && row.usage !== "-" && <span className="text-xs font-normal text-slate-500">{row.usage}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GenericUsageModal({ row, close }: { row: GenericDictionaryRow; close: () => void }) {
  return (
    <Modal title={`Где используется: ${row.title}`} close={close}>
      <div className="space-y-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-normal text-refDark">{row.usage || "Используется в связанных записях"}</p>
          <p className="mt-1 text-xs font-normal text-slate-600">{row.subtitle || "Подробные связи считаются на стороне справочника."}</p>
        </div>
      </div>
    </Modal>
  );
}

function TreeRow({ entry, nodes, childCount, collapsed, dragging, dropTarget, selected, editing, draft, setDraft, canEdit, onSelect, onToggle, onOpenUsage, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: {
  entry: TreeEntry;
  nodes: TreeNode[];
  childCount: number;
  collapsed: boolean;
  dragging: boolean;
  dropTarget: boolean;
  selected: boolean;
  editing: boolean;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  canEdit: boolean;
  onSelect: (range?: boolean) => void;
  onToggle: () => void;
  onOpenUsage: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const node = entry.node;
  const indentPx = entry.depth * (node.source === "operation" ? 12 : 20);
  const spacerClassName = node.source === "operation" ? "flex h-6 w-3 shrink-0" : "flex h-6 w-6 shrink-0";
  const usageOffsetClassName = node.source === "operation" ? "ml-3" : "ml-8";
  return (
    <div
      className={`cursor-default border-b border-slate-100 px-2 py-2 last:border-b-0 ${dropTarget ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : selected ? "bg-emerald-50 ring-1 ring-inset ring-refGreen/30" : node.active ? "hover:bg-slate-50" : "bg-slate-50 text-slate-500"} ${dragging ? "opacity-50" : ""}`}
      role="button"
      tabIndex={0}
      draggable={canEdit && !editing}
      onDragStart={(event) => {
        if (!canEdit) return;
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDragLeave={(event) => {
        if (!canEdit) return;
        event.stopPropagation();
        onDragLeave();
      }}
      onDrop={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
        if (node.operationCount > 0) onOpenUsage();
      }}
      onKeyDown={(event) => {
        if (isEditableControl(event.target)) return;
        if (event.key === "Enter") onSelect(event.shiftKey);
        if (event.key === " ") {
          event.preventDefault();
          onSelect(event.shiftKey);
        }
      }}
    >
      <div className="min-w-0" style={{ paddingLeft: `${indentPx}px` }}>
        {editing ? (
          <div className="grid gap-2 md:grid-cols-[1fr_260px]">
            <label className="text-xs font-normal text-slate-500">
              Название
              <input className="field mt-1 h-10" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="text-xs font-normal text-slate-500">
              Материнский элемент
              <ParentSelect className="field mt-1 h-10" value={draft.parent} nodes={nodes.filter((item) => item.key !== node.key && !isDescendant(nodes, item.key, node.key))} onChange={(parent) => setDraft({ ...draft, parent })} />
            </label>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {childCount > 0 ? (
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-refGreen"
                  type="button"
                  title={collapsed ? "Развернуть" : "Свернуть"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle();
                  }}
                >
                  {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </button>
              ) : (
                <span className={spacerClassName} />
              )}
              <p className="min-w-0 truncate text-sm font-normal text-refDark">{node.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-normal ${node.active ? "bg-emerald-50 text-refGreen" : "bg-slate-200 text-slate-600"}`}>{node.active ? "активен" : "архив"}</span>
            </div>
            <div className={`${usageOffsetClassName} mt-1`}>
              <span className={`text-xs font-normal ${node.operationCount > 0 ? "text-refGreen" : "text-slate-500"}`}>{node.operationCount > 0 ? "Используется" : "Не используется"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function isEditableControl(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function UsageModal({ node, data, close, openPlan }: { node: TreeNode; data: BootstrapData; close: () => void; openPlan?: (planId: string) => void }) {
  const rows = data.operations.filter((operation) => node.source === "section" ? operation.section_id === node.id : operation.operation_id === node.id);
  return (
    <Modal title={`Где используется: ${node.name}`} close={close}>
      <div className="space-y-2">
        {rows.map((operation) => {
          const plan = data.plans.find((item) => item.id === operation.plan_id);
          const open = () => {
            if (!plan || !openPlan) return;
            close();
            openPlan(plan.id);
          };
          return (
            <div
              key={operation.id}
              className={`rounded-md border border-slate-200 bg-slate-50 p-3 ${plan && openPlan ? "cursor-pointer hover:border-emerald-200 hover:bg-emerald-50" : ""}`}
              role={plan && openPlan ? "button" : undefined}
              tabIndex={plan && openPlan ? 0 : undefined}
              onDoubleClick={open}
              onKeyDown={(event) => {
                if (event.key === "Enter") open();
              }}
            >
              <p className="text-sm font-normal text-refDark">{plan ? `План ${planPeriod(plan)}` : "План не найден"}</p>
              <p className="mt-1 text-xs font-normal text-slate-600">{displaySectionName(operation.section_name)} · {displayOperationName(operation.name)}</p>
              <p className="mt-1 text-xs font-normal text-slate-500">У кого: {planOwnerLabel(plan?.status)}</p>
            </div>
          );
        })}
        {!rows.length && <Empty text="Использований не найдено." />}
      </div>
    </Modal>
  );
}

function planOwnerLabel(status?: string) {
  return internalPlanStatusLabel(status ? { id: "", owner_role: "factory", start_date: "", end_date: "", status } : undefined);
}

function ParentSelect({ value, nodes, className, onChange }: { value: ParentValue; nodes: TreeNode[]; className?: string; onChange: (value: ParentValue) => void }) {
  const options = nodes.filter((node) => node.active);
  return (
    <select className={className} value={value} onChange={(event) => onChange(event.target.value as ParentValue)}>
      <option value="">Верхний уровень</option>
      {options.map((node) => (
        <option key={node.key} value={node.key}>{node.name}</option>
      ))}
    </select>
  );
}

function nodesForDictionary(nodes: TreeNode[], dictionary: DictionaryKey) {
  const source = dictionary === "operations" ? "operation" : "section";
  const filtered = nodes.filter((node) => node.source === source);
  const keys = new Set(filtered.map((node) => node.key));
  return filtered.map((node) => ({
    ...node,
    parentKey: keys.has(node.parentKey) ? node.parentKey : "",
    sectionId: dictionary === "operations" ? null : node.sectionId
  }));
}

function dictionaryCards(data: BootstrapData, sections: Section[], operations: OperationCatalogItem[], nodes: TreeNode[]): DictionaryCard[] {
  const dictionaries = data.dictionaries;
  const employeeStatuses = dictionaries?.employeeStatuses || [];
  const reservationStatuses = dictionaries?.housingReservationStatuses || [];
  const factStatuses = dictionaries?.housingFactStatuses || [];
  const dictionaryDormitories = dictionaries?.dormitories || [];
  const dictionaryRooms = dictionaries?.rooms || [];
  const dictionaryBeds = dictionaries?.beds || [];
  const rooms = data.housingDorms.flatMap((dorm) => dorm.rooms || []);
  const beds = data.housingPlaces;
  return [
    {
      key: "workStructure",
      title: "Территории предприятия",
      total: sections.length,
      active: sections.filter((item) => item.active).length,
      used: nodes.filter((node) => node.source === "section" && node.operationCount > 0).length
    },
    {
      key: "operations",
      title: "Операции",
      total: operations.length,
      active: operations.filter((item) => item.active).length,
      used: nodes.filter((node) => node.source === "operation" && node.operationCount > 0).length
    },
    { key: "employeeStatuses", title: "Статусы сотрудников", total: employeeStatuses.length, active: employeeStatuses.filter((item) => item.active).length, used: sumUsage(employeeStatuses), usedLabel: "Сотрудн." },
    { key: "housingReservationStatuses", title: "Статусы бронирований", total: reservationStatuses.length, active: reservationStatuses.filter((item) => item.active).length, used: sumUsage(reservationStatuses), usedLabel: "Броней" },
    { key: "housingFactStatuses", title: "Статусы факта проживания", total: factStatuses.length, active: factStatuses.filter((item) => item.active).length, used: sumUsage(factStatuses), usedLabel: "Фактов" },
    { key: "dormitories", title: "Общежития", total: dictionaryDormitories.length || data.housingDorms.length, active: dictionaryDormitories.filter((item) => item.active).length || data.housingDorms.length, used: sumUsage(dictionaryDormitories) || data.reservations.length, usedLabel: "Связей" },
    { key: "rooms", title: "Комнаты", total: dictionaryRooms.length || rooms.length, active: dictionaryRooms.filter((item) => item.active).length || rooms.length, used: sumUsage(dictionaryRooms) || data.reservations.filter((item) => item.room_id).length, usedLabel: "Связей" },
    { key: "beds", title: "Койко-места", total: dictionaryBeds.length || beds.length, active: dictionaryBeds.filter((item) => item.active).length || beds.length, used: sumUsage(dictionaryBeds) || beds.filter((item) => item.reservation).length, usedLabel: "Связей" },
    { key: "priceList", title: "Прайс-лист операций", total: dictionaries?.priceList.length || 0, active: dictionaries?.priceList.length || 0, used: data.operations.filter((item) => item.rate_per_hour > 0).length, usedLabel: "В планах" },
    { key: "roomPriceList", title: "Прайс-лист комнат", total: dictionaries?.roomPriceList.length || 0, active: dictionaries?.roomPriceList.length || 0, used: data.reservations.filter((item) => item.cost > 0).length, usedLabel: "В бронях" }
  ];
}

function allowedDictionaryKeys(role: RoleKey): Set<Exclude<DictionaryKey, "list">> {
  if (role === "factoryPlanner") return new Set(["workStructure", "operations"]);
  return new Set([
    "workStructure",
    "operations",
    "employeeStatuses",
    "housingReservationStatuses",
    "housingFactStatuses",
    "dormitories",
    "rooms",
    "beds",
    "priceList",
    "roomPriceList"
  ]);
}

function genericDictionaryMeta(dictionaryKey: Exclude<DictionaryKey, "list" | "workStructure" | "operations">) {
  const meta: Record<typeof dictionaryKey, { title: string; description: string }> = {
    employeeStatuses: { title: "Статусы сотрудников", description: "Справочник статусов временного персонала." },
    housingReservationStatuses: { title: "Статусы бронирований", description: "Справочник статусов бронирования проживания." },
    housingFactStatuses: { title: "Статусы факта проживания", description: "Справочник статусов фактического проживания." },
    dormitories: { title: "Общежития", description: "Справочник объектов проживания." },
    rooms: { title: "Комнаты", description: "Комнаты внутри общежитий." },
    beds: { title: "Койко-места", description: "Койко-места внутри комнат." },
    priceList: { title: "Прайс-лист операций", description: "Стоимость операций по участкам. Физическая таблица подготовлена в базе." },
    roomPriceList: { title: "Прайс-лист комнат", description: "Стоимость проживания по комнатам. Физическая таблица подготовлена в базе." }
  };
  return meta[dictionaryKey];
}

function genericDictionaryRows(dictionaryKey: Exclude<DictionaryKey, "list" | "workStructure" | "operations">, data: BootstrapData): GenericDictionaryRow[] {
  const dictionaryRows = data.dictionaries?.[dictionaryKey as keyof NonNullable<BootstrapData["dictionaries"]>];
  if (dictionaryRows?.length) {
    return dictionaryRows.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      status: item.active ? "Активен" : "Архив",
      usage: item.usageCount ? `${item.usageCount} связей` : "-",
      raw: item
    })).sort((left, right) => left.title.localeCompare(right.title, "ru"));
  }
  if (dictionaryKey === "employeeStatuses") {
    return uniqueRows(data.employees.map((employee) => ({
      id: employee.status || "empty",
      title: employee.status || "Статус не указан",
      status: "Активен",
      usage: `${data.employees.filter((item) => (item.status || "empty") === (employee.status || "empty")).length} сотрудников`,
      raw: { id: employee.status || "empty", title: employee.status || "Статус не указан", active: true }
    })));
  }
  if (dictionaryKey === "housingReservationStatuses") {
    return uniqueRows(data.reservations.map((reservation) => ({
      id: reservation.status || "empty",
      title: reservation.status || "Статус не указан",
      status: "Активен",
      usage: `${data.reservations.filter((item) => (item.status || "empty") === (reservation.status || "empty")).length} броней`,
      raw: { id: reservation.status || "empty", title: reservation.status || "Статус не указан", active: true }
    })));
  }
  if (dictionaryKey === "housingFactStatuses") {
    return uniqueRows(data.facts.map((fact) => ({
      id: fact.side || "empty",
      title: fact.side === "out" ? "Аутсорсер" : "Фабрика",
      subtitle: fact.side,
      status: "Активен",
      usage: `${data.facts.filter((item) => item.side === fact.side).length} фактов`,
      raw: { id: fact.side || "empty", title: fact.side === "out" ? "Аутсорсер" : "Фабрика", active: true }
    })));
  }
  if (dictionaryKey === "dormitories") {
    return data.housingDorms.map((dorm) => ({
      id: dorm.id,
      title: dorm.name,
      subtitle: `${dorm.rooms?.length || dorm.room_count} комнат · ${dorm.beds_per_room} мест/комн.`,
      status: "Активен",
      usage: `${data.reservations.filter((reservation) => reservation.dorm === dorm.name).length} броней`,
      raw: { id: dorm.id, title: dorm.name, active: true }
    }));
  }
  if (dictionaryKey === "rooms") {
    return data.housingDorms.flatMap((dorm) => (dorm.rooms || []).map((room) => ({
      id: room.id,
      title: room.number,
      subtitle: `${dorm.name} · ${room.block}`,
      status: "Активна",
      usage: `${data.reservations.filter((reservation) => reservation.room_id === room.id || (reservation.dorm === dorm.name && reservation.room === room.number)).length} броней`,
      raw: { id: room.id, title: room.number, subtitle: dorm.name, active: true, fields: { dormitory_id: dorm.id, room_number: room.number } }
    })));
  }
  if (dictionaryKey === "beds") {
    return data.housingPlaces.map((place) => ({
      id: `${place.dorm_id}-${place.room_id || place.room}-${place.bed_number || place.bed}`,
      title: place.bed,
      subtitle: `${place.dorm} · ${place.room}`,
      status: place.reservation ? "Занято" : "Свободно",
      usage: place.reservation?.status || "-",
      raw: { id: `${place.dorm_id}-${place.room_id || place.room}-${place.bed_number || place.bed}`, title: place.bed, subtitle: place.room, active: true, fields: { room_id: place.room_id || "", bed_number: place.bed_number || 1 } }
    }));
  }
  if (dictionaryKey === "priceList") {
    return uniqueRows(data.operations.filter((operation) => operation.rate_per_hour > 0).map((operation) => ({
      id: `${operation.operation_id || operation.id}-${operation.section_id || ""}-${operation.rate_per_hour}`,
      title: displayOperationName(operation.name),
      subtitle: displaySectionName(operation.section_name),
      status: "Из планов",
      usage: `${operation.rate_per_hour} руб./ч`,
      raw: { id: `${operation.operation_id || operation.id}-${operation.section_id || ""}-${operation.rate_per_hour}`, title: displayOperationName(operation.name), active: true, fields: { operation_id: operation.operation_id || "", section_id: operation.section_id || "", cost: operation.rate_per_hour } }
    })));
  }
  if (dictionaryKey === "roomPriceList") {
    return uniqueRows(data.reservations.filter((reservation) => reservation.cost > 0).map((reservation) => ({
      id: `${reservation.room_id || reservation.room}-${reservation.cost}`,
      title: reservation.room,
      subtitle: reservation.dorm,
      status: "Из бронирований",
      usage: `${reservation.cost} руб.`,
      raw: { id: `${reservation.room_id || reservation.room}-${reservation.cost}`, title: reservation.room, active: true, fields: { room_id: reservation.room_id || "", cost: reservation.cost } }
    })));
  }
  return [];
}

function uniqueRows(rows: GenericDictionaryRow[]): GenericDictionaryRow[] {
  const seen = new Set<string>();
  const result: GenericDictionaryRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result.sort((left, right) => left.title.localeCompare(right.title, "ru"));
}

function sumUsage(rows: DictionaryItem[]) {
  return rows.reduce((sum, row) => sum + Number(row.usageCount || 0), 0);
}

function genericDictionaryEndpoint(dictionaryKey: Exclude<DictionaryKey, "list" | "workStructure" | "operations">) {
  const endpoints: Record<typeof dictionaryKey, string> = {
    employeeStatuses: "/employee-statuses",
    housingReservationStatuses: "/housing-reservation-statuses",
    housingFactStatuses: "/housing-fact-statuses",
    dormitories: "/dormitories",
    rooms: "/rooms",
    beds: "/beds",
    priceList: "/price-list",
    roomPriceList: "/room-price-list"
  };
  return endpoints[dictionaryKey];
}

function genericDictionaryFields(dictionaryKey: Exclude<DictionaryKey, "list" | "workStructure" | "operations">, data: BootstrapData): GenericFieldDefinition[] {
  if (dictionaryKey === "dormitories") return [{ key: "title", label: "Название" }, { key: "address", label: "Адрес" }, activeField()];
  if (dictionaryKey === "rooms") return [{ key: "room_number", label: "Комната" }, { key: "dormitory_id", label: "Общежитие", type: "select", options: optionsFromDictionaries(data.dictionaries?.dormitories) }, activeField()];
  if (dictionaryKey === "beds") return [{ key: "bed_number", label: "Номер места", type: "number" }, { key: "room_id", label: "Комната", type: "select", options: optionsFromDictionaries(data.dictionaries?.rooms) }, activeField()];
  if (dictionaryKey === "priceList") return [
    { key: "operation_id", label: "Операция", type: "select", options: (data.operationCatalog || []).map((item) => [item.id, item.name]) },
    { key: "section_id", label: "Территория", type: "select", options: (data.sections || []).map((item) => [item.id, displaySectionName(item.name)]) },
    { key: "cost", label: "Стоимость", type: "number" },
    { key: "date_applyed", label: "Дата", type: "date" }
  ];
  if (dictionaryKey === "roomPriceList") return [{ key: "room_id", label: "Комната", type: "select", options: optionsFromDictionaries(data.dictionaries?.rooms) }, { key: "cost", label: "Стоимость", type: "number" }, { key: "date_applyed", label: "Дата", type: "date" }];
  if (dictionaryKey === "housingReservationStatuses" || dictionaryKey === "housingFactStatuses") return [{ key: "title", label: "Название" }, { key: "is_final", label: "Финальный", type: "checkbox" }, activeField()];
  return [{ key: "title", label: "Название" }, activeField()];
}

function activeField(): GenericFieldDefinition {
  return { key: "active", label: "Активен", type: "checkbox" };
}

function optionsFromDictionaries(rows?: DictionaryItem[]): Array<[string, string]> {
  return (rows || []).filter((item) => item.active).map((item) => [item.id, item.title]);
}

function genericEmptyDraft(fields: GenericFieldDefinition[]): GenericDraft {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "checkbox" ? field.key === "active" : ""])) as GenericDraft;
}

function genericDraftFromRow(fields: GenericFieldDefinition[], row: GenericDictionaryRow): GenericDraft {
  return Object.fromEntries(fields.map((field) => {
    if (field.key === "title") return [field.key, row.title];
    if (field.key === "active") return [field.key, row.raw.active];
    const value = row.raw.fields?.[field.key];
    return [field.key, typeof value === "boolean" ? value : value == null ? "" : String(value)];
  })) as GenericDraft;
}

function genericPayload(fields: GenericFieldDefinition[], draft: GenericDraft) {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = draft[field.key];
    if (field.type === "checkbox") payload[field.key] = Boolean(value);
    else if (field.type === "number") payload[field.key] = value === "" ? 0 : Number(value);
    else payload[field.key] = value;
  }
  if (!("title" in payload) && "room_number" in payload) payload.title = payload.room_number;
  return payload;
}

function GenericField({ field, value, compact, onChange }: { field: GenericFieldDefinition; value: string | boolean | undefined; compact?: boolean; onChange: (value: string | boolean) => void }) {
  const className = compact ? "field mb-1 h-9" : "field mt-1";
  return (
    <label className={`${compact ? "block text-xs text-slate-500" : "text-sm text-slate-600"} font-normal`}>
      {field.label}
      {field.type === "select" ? (
        <select className={className} value={String(value || "")} onChange={(event) => onChange(event.target.value)}>
          <option value="">Не выбрано</option>
          {(field.options || []).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      ) : field.type === "checkbox" ? (
        <span className={`flex items-center gap-2 ${compact ? "" : "mt-3 h-9"}`}>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        </span>
      ) : (
        <input className={className} type={field.type || "text"} value={String(value || "")} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function buildUnifiedNodes(sections: Section[], operations: OperationCatalogItem[]): TreeNode[] {
  const result: TreeNode[] = sections.map((section) => ({
    key: `section:${section.id}`,
    id: section.id,
    source: "section",
    name: section.name,
    active: section.active,
    isFolder: false,
    operationCount: section.operation_count || 0,
    parentKey: section.parent_id ? `section:${section.parent_id}` : "",
    sectionId: section.id,
    raw: section
  }));
  for (const operation of operations) {
    result.push({
      key: `operation:${operation.id}`,
      id: operation.id,
      source: "operation",
      name: operation.name,
      active: operation.active,
      isFolder: false,
      operationCount: operation.operation_count || 0,
      parentKey: operation.parent_id ? `operation:${operation.parent_id}` : operation.section_id ? `section:${operation.section_id}` : "",
      sectionId: operation.section_id,
      raw: operation
    });
  }
  return result;
}

function buildTree(nodes: TreeNode[]) {
  const byParent = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    byParent.set(node.parentKey, [...(byParent.get(node.parentKey) || []), node]);
  }
  for (const [parent, children] of byParent.entries()) byParent.set(parent, children.sort(sortTreeNodes));
  const result: TreeEntry[] = [];
  const walk = (parentKey: string, depth: number, visited: Set<string>) => {
    for (const node of byParent.get(parentKey) || []) {
      if (visited.has(node.key)) continue;
      result.push({ node, depth });
      walk(node.key, depth + 1, new Set([...visited, node.key]));
    }
  };
  walk("", 0, new Set());
  return result;
}

function childCountByKey(nodes: TreeNode[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (!node.parentKey) continue;
    counts.set(node.parentKey, (counts.get(node.parentKey) || 0) + 1);
  }
  return counts;
}

function defaultCollapsedKeys(nodes: TreeNode[]) {
  return new Set(childCountByKey(nodes).keys());
}

function visibleTreeEntries(tree: TreeEntry[], collapsedKeys: Set<string>) {
  const hiddenParents = new Set<string>();
  const visible: TreeEntry[] = [];
  for (const entry of tree) {
    if (hiddenParents.has(entry.node.parentKey)) {
      hiddenParents.add(entry.node.key);
      continue;
    }
    visible.push(entry);
    if (collapsedKeys.has(entry.node.key)) hiddenParents.add(entry.node.key);
  }
  return visible;
}

function sectionPayload(draft: Draft, name: string) {
  return {
    name,
    parent_id: draft.parent.startsWith("section:") ? draft.parent.slice("section:".length) : null,
    is_folder: false,
    active: true
  };
}

function operationPayload(draft: Draft, name: string, operations: OperationCatalogItem[]) {
  const operationParentId = draft.parent.startsWith("operation:") ? draft.parent.slice("operation:".length) : null;
  const parentOperation = operationParentId ? operations.find((operation) => operation.id === operationParentId) : undefined;
  return {
    name,
    parent_id: operationParentId,
    section_id: draft.parent.startsWith("section:") ? draft.parent.slice("section:".length) : parentOperation?.section_id ?? null,
    is_folder: false,
    active: true
  };
}

function parentValueForNode(node: TreeNode): ParentValue {
  return node.parentKey as ParentValue;
}

function isDescendant(nodes: TreeNode[], candidateKey: string, parentKey: string) {
  let cursor = nodes.find((node) => node.key === candidateKey)?.parentKey || "";
  for (let depth = 0; cursor && depth < 256; depth += 1) {
    if (cursor === parentKey) return true;
    cursor = nodes.find((node) => node.key === cursor)?.parentKey || "";
  }
  return false;
}

function sortTreeNodes(left: TreeNode, right: TreeNode) {
  if (left.active !== right.active) return left.active ? -1 : 1;
  if (left.source !== right.source) return left.source === "section" ? -1 : 1;
  return left.name.localeCompare(right.name, "ru");
}

function sortSections(left: Section, right: Section) {
  if (left.active !== right.active) return left.active ? -1 : 1;
  return left.name.localeCompare(right.name, "ru");
}

function sortOperations(left: OperationCatalogItem, right: OperationCatalogItem) {
  if (left.active !== right.active) return left.active ? -1 : 1;
  return left.name.localeCompare(right.name, "ru");
}
