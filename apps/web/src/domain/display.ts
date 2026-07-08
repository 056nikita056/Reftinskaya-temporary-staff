import type { Employee, Operation, Plan, Reservation } from "../api/client";
import type { PlanKind } from "./types";

export function todayRu() {
  return new Date().toLocaleDateString("ru-RU");
}

export function defaultEndRu() {
  const next = new Date();
  next.setDate(next.getDate() + 30);
  return next.toLocaleDateString("ru-RU");
}

export function parseRuDate(value?: string) {
  if (!value) return new Date();
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year, month - 1, day);
}

export function formatRuDate(date: Date) {
  return date.toLocaleDateString("ru-RU");
}

export function dateRange(start?: string, end?: string) {
  const result: string[] = [];
  const cursor = parseRuDate(start);
  const limit = parseRuDate(end);
  for (let i = 0; i < 45 && cursor <= limit; i += 1) {
    result.push(formatRuDate(new Date(cursor)));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result.length ? result : [todayRu()];
}

export function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateOutsource(required: unknown, staff: unknown) {
  return Math.max(0, numberValue(required) - numberValue(staff));
}

export function planPeriod(plan?: Plan) {
  if (!plan) return "";
  return `с ${plan.start_date} по ${plan.end_date}`;
}

export function canEditPlan(kind: PlanKind, plan?: Plan) {
  if (!plan) return false;
  if (kind === "factory") return plan.status !== "Завершен";
  if (kind === "hr") return plan.status === "Отправлено";
  return ["Получено", "Не утверждено"].includes(plan.status);
}

export function statusTone(status?: string) {
  if (["Отправлено", "Получено", "Утверждено", "В работе", "Работает"].includes(status || "")) return "text-refGreen";
  if (["На согласовании", "На очереди"].includes(status || "")) return "text-blue-600";
  if (["Не утверждено", "В доработке"].includes(status || "")) return "text-orange-500";
  if (["Завершен"].includes(status || "")) return "text-slate-500";
  return "text-orange-500";
}

export function planApprovalText(plan?: Plan) {
  if (!plan) return "";
  if (plan.status === "На согласовании") return "На согласовании";
  if (plan.status === "Не утверждено") return "План не утвержден, доступна доработка";
  if (plan.status === "На очереди") return "Утвержден, ожидает выхода на участки";
  return "";
}

export const emptyEmployeeNames = ["", "ФИО", "Новый сотрудник"];
export const emptyCountries = ["", "Страна"];
export const emptyOperations = ["", "Операция", "Название операции", "Новая операция"];
export const emptySections = ["", "Участок", "Новый участок"];

export function cleanDisplayValue(value: unknown, placeholders: string[]) {
  const text = String(value ?? "").trim();
  return placeholders.includes(text) ? "" : text;
}

export function displayEmployeeName(employee?: Pick<Employee, "full_name">) {
  return cleanDisplayValue(employee?.full_name, emptyEmployeeNames) || "ФИО не заполнено";
}

export function displayReservationEmployeeName(reservation?: Pick<Reservation, "employee_name">) {
  return cleanDisplayValue(reservation?.employee_name, emptyEmployeeNames) || "Сотрудник не заполнен";
}

export function displayEmployeeMeta(employee: Pick<Employee, "full_name" | "country" | "age">) {
  const country = cleanDisplayValue(employee.country, emptyCountries) || "Страна не указана";
  return `${country} · ${displayEmployeeAge(employee)}`;
}

export function displayEmployeeAge(employee: Pick<Employee, "full_name" | "age">) {
  const age = numberValue(employee.age);
  const ageLooksDefault = age === 25 && !cleanDisplayValue(employee.full_name, emptyEmployeeNames);
  return age > 0 && !ageLooksDefault ? `${age} лет` : "Возраст не указан";
}

export function employeeMissingFields(employee: Pick<Employee, "full_name" | "country" | "age">) {
  const missing: string[] = [];
  if (!cleanDisplayValue(employee.full_name, emptyEmployeeNames)) missing.push("ФИО");
  if (!cleanDisplayValue(employee.country, emptyCountries)) missing.push("страна");
  if (displayEmployeeAge(employee) === "Возраст не указан") missing.push("возраст");
  return missing;
}

export function employeeCountryFilterValue(employee: Pick<Employee, "country">) {
  return cleanDisplayValue(employee.country, emptyCountries) || "Не указана";
}

export function displayOperationName(value: unknown) {
  return cleanDisplayValue(value, emptyOperations) || "Операция без названия";
}

export function displaySectionName(value: unknown) {
  return cleanDisplayValue(value, emptySections) || "Участок без названия";
}

export function operationGroups(operations: Operation[]) {
  const map = new Map<string, Operation[]>();
  for (const operation of operations) {
    const key = operation.section_name || "";
    map.set(key, [...(map.get(key) || []), operation]);
  }
  return Array.from(map.entries()).map(([section, rows]) => ({ section, rows: rows.sort((a, b) => a.section_order - b.section_order || a.id.localeCompare(b.id)) }));
}
