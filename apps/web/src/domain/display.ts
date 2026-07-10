import type { Employee, Operation, Plan, Reservation } from "../api/client";
import type { PlanKind } from "./types";

export type PlanStatusCode =
  | "draft"
  | "submitted_to_hr"
  | "received_by_outsourcer"
  | "on_approval"
  | "approved"
  | "rejected";

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

export function planStatusCode(plan?: Plan): PlanStatusCode | string {
  if (!plan) return "";
  if (plan.status_code) return plan.status_code;
  return planStatusCodeFromLabel(plan.status);
}

export function planStatusCodeFromLabel(status?: string): PlanStatusCode | string {
  if (["В доработке", "У планировщика фабрики"].includes(status || "")) return "draft";
  if (["Отправлено", "У HR"].includes(status || "")) return "submitted_to_hr";
  if (["Получено", "У аутсорсера"].includes(status || "")) return "received_by_outsourcer";
  if (["На согласовании", "У согласующего"].includes(status || "")) return "on_approval";
  if (["На очереди", "Утверждено", "У мастеров"].includes(status || "")) return "approved";
  if (["Не утверждено", "У аутсорсера (доработка)"].includes(status || "")) return "rejected";
  return status || "";
}

export function internalPlanStatusLabel(plan?: Plan) {
  const code = planStatusCode(plan);
  if (code === "draft") return "У планировщика фабрики";
  if (code === "submitted_to_hr") return "У HR";
  if (code === "received_by_outsourcer") return "У аутсорсера";
  if (code === "on_approval") return "У согласующего";
  if (code === "approved") return "У мастеров";
  if (code === "rejected") return "У аутсорсера (доработка)";
  return plan?.status || "-";
}

export function displayPlanStatusForRole(plan: Plan, kind: PlanKind) {
  const code = planStatusCode(plan);
  if (kind === "factory") {
    if (code === "draft") return "Получено";
    if (["submitted_to_hr", "received_by_outsourcer", "on_approval"].includes(code)) return "Отправлено";
    if (code === "approved") return "Утверждено";
    if (code === "rejected") return "На доработке у аутсорсера";
  }
  if (kind === "hr") {
    if (code === "draft") return "Ожидает отправки";
    if (code === "submitted_to_hr") return "Получено";
    if (["received_by_outsourcer", "on_approval", "approved", "rejected"].includes(code)) return "Отправлено";
  }
  if (code === "received_by_outsourcer" || code === "rejected") return "Получено";
  if (code === "on_approval") return "Отправлено";
  if (code === "approved") return "Утверждено";
  if (code === "submitted_to_hr") return "Ожидает HR";
  return plan.status;
}

export function canEditPlan(kind: PlanKind, plan?: Plan) {
  if (!plan) return false;
  const code = planStatusCode(plan);
  if (kind === "factory") return code === "draft";
  if (kind === "hr") return code === "submitted_to_hr";
  return ["received_by_outsourcer", "rejected"].includes(code);
}

export function statusTone(status?: string) {
  if (["Отправлено", "Получено", "Утверждено", "В работе", "Работает", "У HR", "У аутсорсера", "У мастеров"].includes(status || "")) return "text-refGreen";
  if (["На согласовании", "На очереди", "У согласующего"].includes(status || "")) return "text-blue-600";
  if (["Не утверждено", "В доработке", "У планировщика фабрики", "У аутсорсера (доработка)", "На доработке у аутсорсера"].includes(status || "")) return "text-orange-500";
  if (["Завершен"].includes(status || "")) return "text-slate-500";
  return "text-orange-500";
}

export function planApprovalText(plan?: Plan) {
  if (!plan) return "";
  const code = planStatusCode(plan);
  if (code === "on_approval") return "На согласовании";
  if (code === "rejected") return "План не утвержден, доступна доработка";
  if (code === "approved") return "Утвержден, ожидает выхода на участки";
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
