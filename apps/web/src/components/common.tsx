import type { InputHTMLAttributes, ReactNode } from "react";
import { Menu, X } from "lucide-react";

export function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center gap-2 font-normal">{icon}{title}</div>
      {children}
    </section>
  );
}

export function SectionTitle({ title, count }: { title: string; count?: number }) {
  return <div className="my-3 rounded bg-slate-200 px-3 py-2 text-center text-sm font-normal">{title} {count !== undefined && <span className="rounded-full bg-refGreen px-2 py-0.5 text-xs text-white">{count}</span>}</div>;
}

export function Readonly({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-md border border-slate-200 bg-white p-2"><p className="text-[11px] font-normal text-slate-500">{label}</p><p className="text-sm font-normal">{String(value ?? "")}</p></div>;
}

export function Input({ label, value, onChange, ...inputProps }: { label: string; value: string | number; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <label className="text-sm font-normal">{label}<input {...inputProps} className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={close}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-4 shadow-panel" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-normal">{title}</h3>
          <button onClick={close}><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, text, steps }: { title?: string; text: string; steps?: string[] }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-refGreen shadow-sm">
          <Menu size={20} />
        </div>
        <div>
          <p className="font-normal text-refDark">{title || text}</p>
          {title && <p className="mt-1 font-normal leading-relaxed text-slate-600">{text}</p>}
        </div>
      </div>
      {steps?.length ? (
        <div className="space-y-2 rounded-md bg-white p-3">
          {steps.map((step, index) => (
            <div key={step} className="flex gap-2 font-normal">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-refGreen text-[11px] text-white">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
