import { KeyRound, LogOut } from "lucide-react";
import type { CurrentUserProfile, RoleKey } from "../../api/client";
import { Empty } from "../../components/common";
import { roleOptions } from "../../domain/roles";
import { useUiFeedback } from "../../ui/feedback";

function initials(name?: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "П") + (parts[1]?.[0] || "");
}

function roleLabel(role?: RoleKey) {
  return roleOptions.find((item) => item.key === role)?.label || role || "Роль";
}

export function UserProfile({ profile, loading, error, onLogout }: { profile: CurrentUserProfile | null; loading: boolean; error: string; onLogout: () => void }) {
  const { notify } = useUiFeedback();

  if (loading && !profile) {
    return <div className="h-96 animate-pulse rounded-lg bg-slate-100" />;
  }
  if (error && !profile) {
    return <Empty title="Профиль недоступен" text={error} />;
  }
  if (!profile) {
    return <Empty title="Профиль загружается" text="Получаем данные текущего пользователя." />;
  }
  const roleLabels = (profile.roles?.length ? profile.roles : [profile.role]).map((role) => roleLabel(role)).join(", ");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-refDark md:text-3xl">Профиль пользователя</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">Профиль относится к пользовательской системе, не к карточке сотрудника.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-refGreen bg-emerald-50 text-xl font-black text-refGreen">
            {initials(profile.fullName)}
          </div>
          <div className="min-w-0">
            <p className="text-xl font-black text-refDark">{profile.fullName}</p>
            <p className="text-sm font-bold text-slate-500">{roleLabels} · {profile.factoryName}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <ProfileRow label="ФИО" value={profile.fullName} />
          <ProfileRow label="Роли" value={roleLabels} />
          <ProfileRow label="Логин / email" value={profile.email || profile.login} />
          <ProfileRow label="Выбранная фабрика" value={profile.factoryName} />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50" onClick={() => notify("Смена пароля будет доступна в следующей итерации.", "warning")} type="button">
            <KeyRound size={17} />
            Сменить пароль
          </button>
          <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-black text-white transition hover:bg-red-700" onClick={onLogout} type="button">
            <LogOut size={17} />
            Выйти из аккаунта
          </button>
        </div>
        <p className="mt-3 text-xs font-semibold text-slate-500">Смена пароля подготовлена в интерфейсе. Backend endpoint для этого действия будет подключен отдельно.</p>
      </section>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-refDark">{value}</p>
    </div>
  );
}
