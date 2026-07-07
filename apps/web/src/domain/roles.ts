import { accessForRole } from "../api/client";
import type { RoleKey } from "../api/client";
import type { ModuleKey, RoleOption } from "./types";

const roleMeta: Record<RoleKey, Pick<RoleOption, "label" | "description">> = {
  factoryPlanner: { label: "Планировщик фабрики", description: "Планирует заявки и видит аналитику" },
  hr: { label: "HR", description: "Ведет штатную часть и видит аналитику" },
  directorOutsourcing: { label: "Директор аутсорсинга", description: "Смотрит управленческую аналитику" },
  outsourcer: { label: "Аутсорсер", description: "Распределяет людей и жилье" },
  outsourcerBrigadier: { label: "Бригадир аутсорсера", description: "Фиксирует факт со стороны аутсорсера" },
  hrOutsourcer: { label: "HR аутсорсера", description: "Ведет персонал аутсорсера" },
  warden: { label: "Комендант", description: "Ведет проживание" },
  factoryMaster: { label: "Мастер фабрики", description: "Фиксирует факт работ фабрики" },
  outMaster: { label: "Мастер аутсорсера", description: "Фиксирует факт работ аутсорсера" },
  tempEmployee: { label: "Временный сотрудник", description: "Получает уведомления и профиль" },
  admin: { label: "Администратор", description: "Управляет пользователями и доступами" }
};

const roleOrder: RoleKey[] = [
  "factoryPlanner",
  "hr",
  "directorOutsourcing",
  "outsourcer",
  "outsourcerBrigadier",
  "hrOutsourcer",
  "warden",
  "factoryMaster",
  "outMaster",
  "tempEmployee",
  "admin"
];

export const roleOptions: RoleOption[] = roleOrder.map((key) => {
  const access = accessForRole(key);
  return {
    key,
    ...roleMeta[key],
    modules: access.modules,
    start: access.modules[0] || "profile"
  };
});

const moduleLabels: Record<ModuleKey, string> = {
  dashboard: "Дашборд",
  plans: "Планы",
  dictionaries: "Справочники",
  personnel: "База персонала",
  housing: "Проживание",
  facts: "Фиксация работ",
  notifications: "Уведомления",
  profile: "Профиль",
  adminUsers: "Пользователи и роли"
};

export function moduleLabelForRole(key: ModuleKey, role: RoleKey) {
  if (key === "plans") {
    if (role === "hr") return "HR.План";
    if (role === "outsourcer") return "Аутсорсинг.План";
    return "Фабрика.План";
  }
  if (key === "facts") return role === "outMaster" ? "Аутсорсинг.Факт" : "Фабрика.Факт";
  return moduleLabels[key];
}
