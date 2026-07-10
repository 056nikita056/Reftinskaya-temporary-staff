import { Check, ChevronDown, ChevronRight, Copy, FileText, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { BootstrapData, OperationCatalogItem, Section } from "../../api/client";
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
type DictionaryKey = "list" | "workStructure" | "operations";

export function Dictionaries({ data, mutate, openPlan }: { data: BootstrapData; mutate: BootstrapMutate; openPlan?: (planId: string) => void }) {
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
  const selectedNode = dictionaryNodes.find((node) => node.key === selectedKey);
  const selectedCount = selectedKeys.size;
  const actionNode = selectedCount === 1 ? selectedNode : undefined;
  const usageNode = dictionaryNodes.find((node) => node.key === usageNodeKey);
  const visibleTree = visibleTreeEntries(tree, collapsedKeys);
  const dictionaryTitle = activeDictionary === "operations" ? "Справочник операций" : "Справочник структуры работ";
  const dictionaryStats = activeDictionary === "operations"
    ? `Операции: ${activeOperations} активных из ${operations.length}`
    : `Элементы: ${activeSections} активных из ${sections.length}`;

  if (activeDictionary === "list") {
    return (
      <DictionariesLanding
        cards={[
          {
            key: "workStructure",
            title: "Структура работ",
            total: sections.length,
            active: activeSections,
            used: nodes.filter((node) => node.source === "section" && node.operationCount > 0).length
          },
          {
            key: "operations",
            title: "Операции",
            total: operations.length,
            active: activeOperations,
            used: nodes.filter((node) => node.source === "operation" && node.operationCount > 0).length
          }
        ]}
        onOpen={(key) => {
          setSelectedKey("");
          setSelectedKeys(new Set());
          setDraft({ name: "", parent: "" });
          setEditKey("");
          setEditDraft({ name: "", parent: "" });
          setUsageNodeKey("");
          setCollapsedKeys(new Set());
          setActiveDictionary(key);
        }}
      />
    );
  }

  const createNode = async () => {
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
    const name = `Копия ${node.name}`;
    const parent = parentValueForNode(node);
    const next = node.source === "section"
      ? await mutate("/sections", "POST", sectionPayload({ name, parent }, name), "Элемент скопирован")
      : await mutate("/operation-catalog", "POST", operationPayload({ name, parent }, name, operations), "Элемент скопирован");
    if (next) setDraft((current) => ({ ...current, name: "" }));
  };

  const moveNode = async (node: TreeNode, target: TreeNode) => {
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
          <h2 className="text-xl font-black">{dictionaryTitle}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">{dictionaryStats}</p>
        </div>
        <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-200" onClick={() => setActiveDictionary("list")}>
          Назад
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 xl:grid-cols-[1fr_320px_auto]">
          <label className="text-sm font-black text-slate-600">
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
          <label className="text-sm font-black text-slate-600">
            Материнский элемент
            <ParentSelect className="field mt-1" value={draft.parent} nodes={dictionaryNodes} onChange={(parent) => setDraft({ ...draft, parent })} />
          </label>
          <button className="btn-primary h-11 self-end gap-2 disabled:bg-slate-300" disabled={saving} onClick={createNode}>
            <Plus size={17} /> Создать
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-2">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-slate-500">Выбранный элемент</p>
            <p className="min-w-0 truncate text-sm font-black text-refDark">{selectedCount > 1 ? `Выбрано: ${selectedCount}` : selectedNode ? selectedNode.name : "Не выбран"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editKey ? (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-refGreen px-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!actionNode || savingKey === actionNode.key} onClick={() => actionNode && saveNode(actionNode)}>
                  <Check size={17} /> Сохранить
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-slate-700 hover:bg-slate-200" onClick={cancelEdit}>
                  <X size={17} /> Отмена
                </button>
              </>
            ) : (
              <>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode || actionNode.operationCount <= 0} onClick={() => actionNode && setUsageNodeKey(actionNode.key)}>
                  Использование
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && copyNode(actionNode)}>
                  <Copy size={17} /> Копировать
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-black text-refGreen hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && startEdit(actionNode)}>
                  <Pencil size={17} /> Изменить
                </button>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-50 px-3 text-sm font-black text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!actionNode} onClick={() => actionNode && removeNode(actionNode)}>
                  <Trash2 size={17} /> Удалить
                </button>
              </>
            )}
          </div>
        </div>
        <div
          className={`min-h-[calc(100vh-23rem)] p-2 ${draggedKey ? "transition-colors hover:bg-slate-50" : ""}`}
          onClick={clearSelection}
          onDragOver={(event) => {
            if (!draggedKey) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!draggedKey) return;
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
            onSelect={(range) => selectNode(entry.node, range)}
            onToggle={() => toggleCollapsed(entry.node)}
            onOpenUsage={() => setUsageNodeKey(entry.node.key)}
            onDragStart={() => {
              setDraggedKey(entry.node.key);
              setSelectedKey(entry.node.key);
              setSelectedKeys(new Set([entry.node.key]));
            }}
            onDragOver={() => draggedKey && draggedKey !== entry.node.key && setDropKey(entry.node.key)}
            onDragLeave={() => dropKey === entry.node.key && setDropKey("")}
            onDrop={() => finishDrop(entry.node)}
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

function DictionariesLanding({ cards, onOpen }: { cards: Array<{ key: Exclude<DictionaryKey, "list">; title: string; total: number; active: number; used: number }>; onOpen: (key: Exclude<DictionaryKey, "list">) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-black">Справочники</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <button key={card.key} className="group rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50" onClick={() => onOpen(card.key)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-refGreen text-white">
                <FileText size={20} />
              </div>
              <span className="text-xs font-black uppercase text-slate-400 group-hover:text-refGreen">Открыть</span>
            </div>
            <h3 className="mt-4 text-base font-black text-refDark">{card.title}</h3>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-black text-refDark">{card.total}</p>
                <p className="text-[10px] font-black uppercase text-slate-500">Всего</p>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-black text-refDark">{card.active}</p>
                <p className="text-[10px] font-black uppercase text-slate-500">Активно</p>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <p className="text-lg font-black text-refDark">{card.used}</p>
                <p className="text-[10px] font-black uppercase text-slate-500">В планах</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TreeRow({ entry, nodes, childCount, collapsed, dragging, dropTarget, selected, editing, draft, setDraft, onSelect, onToggle, onOpenUsage, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: {
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
  return (
    <div
      className={`cursor-default border-b border-slate-100 px-2 py-2 last:border-b-0 ${dropTarget ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : selected ? "bg-emerald-50 ring-1 ring-inset ring-refGreen/30" : node.active ? "hover:bg-slate-50" : "bg-slate-50 text-slate-500"} ${dragging ? "opacity-50" : ""}`}
      role="button"
      tabIndex={0}
      draggable={!editing}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        onDragLeave();
      }}
      onDrop={(event) => {
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
      <div className="min-w-0" style={{ paddingLeft: `${entry.depth * 20}px` }}>
        {editing ? (
          <div className="grid gap-2 md:grid-cols-[1fr_260px]">
            <label className="text-xs font-black text-slate-500">
              Название
              <input className="field mt-1 h-10" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="text-xs font-black text-slate-500">
              Материнский элемент
              <ParentSelect className="field mt-1 h-10" value={draft.parent} nodes={nodes.filter((item) => item.key !== node.key && !isDescendant(nodes, item.key, node.key))} onChange={(parent) => setDraft({ ...draft, parent })} />
            </label>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <GripVertical size={15} className="shrink-0 text-slate-300" />
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
                <span className="h-6 w-6 shrink-0" />
              )}
              {iconForNode(node)}
              <p className="min-w-0 truncate text-sm font-black text-refDark">{node.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${node.active ? "bg-emerald-50 text-refGreen" : "bg-slate-200 text-slate-600"}`}>{node.active ? "активен" : "архив"}</span>
            </div>
            <div className="mt-1">
              <span className={`text-xs font-bold ${node.operationCount > 0 ? "text-refGreen" : "text-slate-500"}`}>{node.operationCount > 0 ? "Используется" : "Не используется"}</span>
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
              <p className="text-sm font-black text-refDark">{plan ? `План ${planPeriod(plan)}` : "План не найден"}</p>
              <p className="mt-1 text-xs font-bold text-slate-600">{displaySectionName(operation.section_name)} · {displayOperationName(operation.name)}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">У кого: {planOwnerLabel(plan?.status)}</p>
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

function iconForNode(node: TreeNode) {
  return <FileText size={17} className={`shrink-0 ${node.source === "section" ? "text-blue-600" : "text-refGreen"}`} />;
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
