import { createContext, useContext } from "react";
import type { ConfirmOptions, ToastTone } from "../domain/types";

export const UiFeedbackContext = createContext<{
  notify: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
} | null>(null);

export function useUiFeedback() {
  const context = useContext(UiFeedbackContext);
  if (!context) throw new Error("UiFeedbackContext is not available");
  return context;
}
