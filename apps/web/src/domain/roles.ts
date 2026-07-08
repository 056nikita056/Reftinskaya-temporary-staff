import { accessForRole } from "../api/client";
import type { RoleKey } from "../api/client";
import type { ModuleKey, RoleOption } from "./types";

const roleMeta: Record<RoleKey, Pick<RoleOption, "label" | "description">> = {
  factoryPlanner: { label: "Директор по производству", description: "Создает планы численности на свои участки и отправляет HR" },
  hr: { label: "HR-специалист фабрики", description: "Проставляет штат, считает аутсорсинг и отправляет аутсорсеру" },
  directorOutsourcing: { label: "Директор по аутсорсингу", description: "Контролирует планы в режиме просмотра" },
  outsourcer: { label: "Менеджер аутсорсера", description: "Распределяет персонал по операциям и отправляет на согласование" },
  outsourcerBrigadier: { label: "Бригадир аутсорсера", description: "Согласует план аутсорсера" },
  hrOutsourcer: { label: "HR-специалист аутсорсера", description: "Ведет базу персонала, документы и архив" },
  warden: { label: "Комендант", description: "Ведет проживание, шахматку и бронирование" },
  factoryMaster: { label: "Мастер фабрики", description: "Фиксирует факт на своих участках" },
  outMaster: { label: "Мастер аутсорсера", description: "Фиксирует факт в ограниченном режиме" },
  tempEmployee: { label: "Временный сотрудник", description: "Видит свой профиль" },
  admin: { label: "Администратор", description: "Управляет учетками, ролями, справочниками и настройками" }
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

export function moduleLabel(key: ModuleKey) {
  return moduleLabels[key];
}

export function moduleLabelForRole(key: ModuleKey, role: RoleKey) {
  if (key === "plans") {
    if (role === "hr") return "HR.План";
    if (role === "outsourcer") return "Аутсорсинг.План";
    return "Фабрика.План";
  }
  if (key === "facts") return role === "outMaster" ? "Аутсорсинг.Факт" : "Фабрика.Факт";
  return moduleLabels[key];
}
