import type { AccessModule, RoleKey } from "../api/client";
import type { useBootstrap } from "../api/useBootstrap";

export type ModuleKey = AccessModule;
export type PlanKind = "factory" | "hr" | "out";
export type ViewState =
  | { type: "list" }
  | { type: "plan"; kind: PlanKind; planId: string; edit?: boolean }
  | { type: "assignment"; planId: string; operationId: string }
  | { type: "employee"; employeeId?: string; edit?: boolean }
  | { type: "facts"; planId?: string; operationId?: string; edit?: boolean };
export type ToastTone = "success" | "error" | "warning";
export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ToastTone;
};
export type ActionDialogState = Required<Omit<ConfirmOptions, "tone">> & {
  tone: ToastTone;
  resolve: (confirmed: boolean) => void;
};
export type RoleOption = {
  key: RoleKey;
  label: string;
  description: string;
  modules: readonly ModuleKey[];
  start: ModuleKey;
};
export type BootstrapMutate = ReturnType<typeof useBootstrap>["mutate"];
export type BootstrapLoadMore = ReturnType<typeof useBootstrap>["loadMore"];
