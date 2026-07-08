import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, RefreshCcw } from "lucide-react";
import type { CurrentUserProfile, RequestFactAnalyticsData, RequestFactAnalyticsRow } from "../../api/client";
import { api } from "../../api/client";
import { Empty } from "../../components/common";

type DashboardAnalyticsProps = {
  profile: CurrentUserProfile | null;
  factoryId?: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function deviationClass(value: number) {
  if (value < 0) return "text-red-700";
  if (value > 0) return "text-refGreen";
  return "text-slate-700";
}

function rowLabel(row: RequestFactAnalyticsRow) {
  if (row.rowType === "workshop" || row.rowType === "total") return row.sectionName;
  return row.sectionName;
}

export function DashboardAnalytics({ profile, factoryId }: DashboardAnalyticsProps) {
  const [date, setDate] = useState(todayIso());
  const [workshopId, setWorkshopId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [analytics, setAnalytics] = useState<RequestFactAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.requestFactAnalytics({
        factoryId: factoryId || profile?.factoryId,
        date,
        workshopId: workshopId || undefined,
        sectionId: sectionId || undefined
      });
      setAnalytics(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить аналитику");
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [date, workshopId, sectionId, factoryId, profile?.factoryId]);

  const workshops = useMemo(() => {
    const names = new Set(
      (analytics?.rows || [])
        .filter((row) => row.rowType === "workshop")
        .map((row) => row.workshopName)
        .filter(Boolean)
    );
    return Array.from(names);
  }, [analytics?.rows]);

  const sections = useMemo(() => {
    return (analytics?.rows || []).filter((row) => row.rowType === "section" && (!workshopId || row.workshopName === workshopId));
  }, [analytics?.rows, workshopId]);

  const report = () => {
    setNotice("Отчет будет отправлен после подключения почтового backend.");
    window.setTimeout(() => setNotice(""), 2400);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-refDark md:text-3xl">Дашборд Блока 1</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">Ежедневный контроль выполнения заявки по факту выхода персонала</p>
        </div>
        <button className="btn-primary h-10 gap-2 self-start" onClick={report}>
          <Download size={17} />
          Отчёт
        </button>
      </div>

      {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">{notice}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[220px_1fr_1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Период</span>
            <div className="relative">
              <input className="field h-10 pr-10" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              <CalendarDays className="pointer-events-none absolute right-3 top-2.5 text-slate-400" size={17} />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Цех</span>
            <select className="field h-10" value={workshopId} onChange={(event) => { setWorkshopId(event.target.value); setSectionId(""); }}>
              <option value="">Все цеха</option>
              {workshops.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Участок</span>
            <select className="field h-10" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
              <option value="">Все участки</option>
              {sections.map((row) => <option key={row.sectionId} value={row.sectionId}>{row.sectionName}</option>)}
            </select>
          </label>
          <button className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50" onClick={load}>
            <RefreshCcw size={16} />
            Обновить
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-500">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-refGreen">Фабрика: {profile?.factory?.name || profile?.factoryName || "выбрана"}</span>
        </div>
      </section>

      {error ? (
        <Empty
          title="Ошибка загрузки аналитики"
          text={error}
          steps={["Проверьте роль пользователя", "Убедитесь, что backend доступен", "Повторите запрос кнопкой обновления"]}
        />
      ) : loading && !analytics ? (
        <DashboardSkeleton />
      ) : analytics ? (
        <AnalyticsContent analytics={analytics} loading={loading} />
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}

function AnalyticsContent({ analytics, loading }: { analytics: RequestFactAnalyticsData; loading: boolean }) {
  const rows = analytics.rows;
  const total = rows.find((row) => row.rowType === "total");
  return (
    <div className={loading ? "opacity-60" : ""}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Заявка месяц" value={formatNumber(total?.demandMonth ?? analytics.summary.demandMonth)} caption="строка ИТОГО" tone="default" />
        <KpiCard title="Заявка неделя" value={formatNumber(total?.demandWeek ?? analytics.summary.demandWeek)} caption="строка ИТОГО" tone="default" />
        <KpiCard title="Заявка день" value={formatNumber(total?.demandDay ?? analytics.summary.demandDay)} caption="строка ИТОГО" tone="default" />
        <KpiCard title="Факт выхода" value={formatNumber(total?.factTotal ?? analytics.summary.factTotal)} caption="по факту дня" tone="success" />
        <KpiCard title="Отклонение" value={formatNumber(total?.deviationDay ?? analytics.summary.deviationDay)} caption={(total?.deviationDay ?? analytics.summary.deviationDay) < 0 ? "недобор" : "без недобора"} tone={(total?.deviationDay ?? analytics.summary.deviationDay) < 0 ? "danger" : "default"} />
        <KpiCard title="% день" value={formatPercent(total?.completionPercentDay ?? analytics.summary.completionPercentDay)} caption={`недобор: ${formatNumber(analytics.summary.underfilledSectionsCount)}`} tone="warning" />
      </div>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-black text-refDark">Заявка / факт</h2>
            <p className="text-xs font-semibold text-slate-500">Сводка по оперативной заявке, факту выхода и причинам отклонений</p>
          </div>
          {analytics.gaps.length ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">MVP: {analytics.gaps.length} gap</span> : null}
        </div>
        {rows.length ? <AnalyticsTable rows={rows} /> : (
          <Empty title="Пустые данные" text="Нет заявок и факта для выбранного периода, цеха или участка." />
        )}
      </section>
    </div>
  );
}

function KpiCard({ title, value, caption, tone }: { title: string; value: string; caption: string; tone: "default" | "success" | "warning" | "danger" }) {
  const toneClass = {
    default: "bg-white",
    success: "bg-emerald-50",
    warning: "bg-amber-50",
    danger: "bg-red-50"
  }[tone];
  const valueClass = {
    default: "text-refDark",
    success: "text-refGreen",
    warning: "text-amber-700",
    danger: "text-red-700"
  }[tone];
  return (
    <div className={`rounded-lg border border-slate-200 p-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-black text-slate-500">{title}</p>
      <p className={`mt-2 text-2xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-1 text-[11px] font-bold text-slate-500">{caption}</p>
    </div>
  );
}

function AnalyticsTable({ rows }: { rows: RequestFactAnalyticsRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-xs xl:text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[7%]" />
          <col className="w-[11%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[19%]" />
        </colgroup>
        <thead className="bg-slate-50 text-xs font-black text-slate-500">
          <tr>
            <Th>Участок / цех</Th>
            <Th>Заявка на месяц</Th>
            <Th>Оперативная заявка на неделю</Th>
            <Th>Опер заявка на день</Th>
            <Th>Факт выхода</Th>
            <Th>Отклонения от дня</Th>
            <Th>% от дня</Th>
            <Th>% от недели</Th>
            <Th>% от месяца</Th>
            <Th>Причины отклонения</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const problem = row.deviationDay < 0;
            const isGroup = row.rowType === "workshop";
            const isTotal = row.rowType === "total";
            const rowClass = isTotal
              ? "bg-refGreen text-white"
              : isGroup
                ? "bg-slate-100 text-refDark"
                : problem
                  ? "bg-red-50/70"
                  : row.deviationDay > 0
                    ? "bg-emerald-50/50"
                    : "bg-white";
            return (
              <tr key={row.sectionId} className={rowClass}>
                <Td strong={isGroup || isTotal} className={isTotal ? "border-white/20" : ""}>
                  <span className={isGroup || isTotal ? "block uppercase" : "block pl-4"}>{rowLabel(row)}</span>
                  {row.rowType === "section" ? <span className="mt-0.5 block pl-4 text-xs font-bold text-slate-500">{row.parentName}</span> : null}
                </Td>
                <Td numeric className={isTotal ? "border-white/20" : ""}>{formatNumber(row.demandMonth)}</Td>
                <Td numeric className={isTotal ? "border-white/20" : ""}>{formatNumber(row.demandWeek)}</Td>
                <Td numeric className={isTotal ? "border-white/20" : ""}>{formatNumber(row.demandDay)}</Td>
                <Td numeric className={isTotal ? "border-white/20 font-black" : "font-black"}>{formatNumber(row.factTotal)}</Td>
                <Td numeric className={`${isTotal ? "border-white/20 text-white" : deviationClass(row.deviationDay)} font-black`}>{formatNumber(row.deviationDay)}</Td>
                <Td numeric className={`${problem && !isTotal ? "text-red-700" : ""} ${isTotal ? "border-white/20" : ""} font-black`}>{formatPercent(row.completionPercentDay)}</Td>
                <Td numeric className={isTotal ? "border-white/20 font-black" : "font-semibold"}>{formatPercent(row.completionPercentWeek)}</Td>
                <Td numeric className={isTotal ? "border-white/20 font-black" : "font-semibold"}>{formatPercent(row.completionPercentMonth)}</Td>
                <Td className={isTotal ? "border-white/20" : ""}>{row.deviationReason || (problem && row.rowType === "section" ? "Требуется пояснение" : "—")}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: string }) {
  return <th className="border-b border-r border-slate-200 px-2 py-3 last:border-r-0">{children}</th>;
}

function Td({ children, strong, numeric, className = "" }: { children: ReactNode; strong?: boolean; numeric?: boolean; className?: string }) {
  return <td className={`break-words border-b border-r border-slate-200 px-2 py-3 align-top last:border-r-0 ${numeric ? "text-right tabular-nums" : ""} ${strong ? "font-black" : "font-semibold"} ${className}`}>{children}</td>;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-slate-100" />)}
      </div>
      <div className="h-80 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}
