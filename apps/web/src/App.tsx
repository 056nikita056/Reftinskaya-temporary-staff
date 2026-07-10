import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  ClipboardList,
  Factory as FactoryIcon,
  LogOut,
  ShieldCheck,
  UserCircle,
  Users
} from "lucide-react";
import { accessForRole, api, BootstrapData, clearAuthTokens, CurrentUserProfile, Factory, hasAuthTokens, LoginResponse, RoleAccess, type AccessAction, type AccessModule, RoleKey } from "./api/client";
import { useBootstrap } from "./api/useBootstrap";
import { Empty } from "./components/common";
import { AdminUsers } from "./features/block1/AdminUsers";
import { DashboardAnalytics } from "./features/block1/DashboardAnalytics";
import { NotificationsCenter } from "./features/block1/NotificationsCenter";
import { UserProfile } from "./features/block1/UserProfile";
import { Dictionaries } from "./features/dictionaries/Dictionaries";
import { FactsV2 } from "./features/facts/Facts";
import { Housing } from "./features/housing/Housing";
import { PersonnelV2 } from "./features/personnel/Personnel";
import { Plans } from "./features/plans/Plans";
import type { ActionDialogState, BootstrapLoadMore, BootstrapMutate, ConfirmOptions, ModuleKey, ToastTone, ViewState } from "./domain/types";
import { UiFeedbackContext } from "./ui/feedback";

const authKey = "reft-web-auth-v1";
const savedLoginKey = "reft-web-login-v1";
const selectedFactoryKey = "reft-web-selected-factory-v1";

const legacyModules = new Set<ModuleKey>(["plans", "dictionaries", "personnel", "housing", "facts"]);
const moduleOrder: ModuleKey[] = ["dashboard", "plans", "dictionaries", "personnel", "housing", "facts", "notifications", "profile", "adminUsers"];

type AuthState = {
  loggedIn: boolean;
  role: RoleKey;
  roles: RoleKey[];
  factoryId?: string;
  access: RoleAccess;
};

const emptyAccess: RoleAccess = {
  modules: ["profile"],
  actions: ["profile.view"]
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function accessForRoles(roles: RoleKey[]): RoleAccess {
  const modules = new Set<AccessModule>();
  const actions = new Set<AccessAction>();
  const effectiveRoles = roles.length ? roles : ["factoryPlanner"];
  for (const currentRole of effectiveRoles) {
    const access = accessForRole(currentRole);
    access.modules.forEach((module) => modules.add(module));
    access.actions.forEach((action) => actions.add(action));
  }
  return {
    modules: [...modules],
    actions: [...actions]
  };
}

function modulesForAccess(access: RoleAccess) {
  const allowed = new Set(access.modules);
  return moduleOrder.filter((module) => allowed.has(module));
}

function labelForModule(module: ModuleKey) {
  const labels: Record<ModuleKey, string> = {
    dashboard: "Дашборд",
    plans: "Планы",
    dictionaries: "Справочники",
    personnel: "База персонала",
    housing: "Проживание",
    facts: "Факты",
    notifications: "Уведомления",
    profile: "Профиль",
    adminUsers: "Администрирование"
  };
  return labels[module];
}

function sameRoles(left: RoleKey[], right: RoleKey[]) {
  if (left.length !== right.length) return false;
  return left.every((role, index) => role === right[index]);
}

function sameAccess(left: RoleAccess, right: RoleAccess) {
  return sameSet(left.modules, right.modules) && sameSet(left.actions, right.actions);
}

function sameSet<T extends string>(left: readonly T[], right: readonly T[]) {
  if (left.length !== right.length) return false;
  const available = new Set(left);
  return right.every((item) => available.has(item));
}

function hasModule(access: RoleAccess, module: ModuleKey) {
  return access.modules.includes(module);
}

function hasAction(access: RoleAccess, action: AccessAction) {
  return access.actions.includes(action);
}

export function App() {
  const [{ loggedIn, role, roles, factoryId, access }, setAuth] = useState<AuthState>(() => {
    const stored = readJson<AuthState | null>(authKey, null);
    if (!stored || !stored.loggedIn || !hasAuthTokens()) {
      return { loggedIn: false, role: "factoryPlanner", roles: ["factoryPlanner"], access: emptyAccess };
    }
    const storedRoles = stored.roles?.length ? stored.roles : [stored.role];
    return { ...stored, roles: storedRoles, access: stored.access || accessForRoles(storedRoles) };
  });
  const [selectedFactory, setSelectedFactory] = useState<Factory | null>(() => readJson<Factory | null>(selectedFactoryKey, null));
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [view, setView] = useState<ViewState>({ type: "list" });
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const [dialog, setDialog] = useState<ActionDialogState | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [profile, setProfile] = useState<CurrentUserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  const navModules = useMemo(() => modulesForAccess(access), [access]);
  const legacyEnabled = loggedIn && legacyModules.has(active);
  const { data, error: legacyError, notice: apiNotice, mutate, loadMore } = useBootstrap(legacyEnabled);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), tone === "error" ? 2800 : 1800);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setDialog({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel || "Подтвердить",
      cancelLabel: options.cancelLabel || "Отмена",
      tone: options.tone || "success",
      resolve
    });
  }), []);

  const feedback = useMemo(() => ({ notify, confirm }), [notify, confirm]);
  const notice = apiNotice || toast?.message || "";
  const noticeTone = apiNotice ? "success" : toast?.tone || "success";

  useEffect(() => {
    if (loggedIn) localStorage.setItem(authKey, JSON.stringify({ loggedIn, role, roles, factoryId: factoryId || selectedFactory?.id, access }));
    else localStorage.removeItem(authKey);
  }, [loggedIn, role, roles, factoryId, selectedFactory?.id, access]);

  useEffect(() => {
    if (selectedFactory) localStorage.setItem(selectedFactoryKey, JSON.stringify(selectedFactory));
    else localStorage.removeItem(selectedFactoryKey);
  }, [selectedFactory]);

  useEffect(() => {
    if (!navModules.includes(active)) setActive(navModules[0] || "profile");
    setView({ type: "list" });
  }, [navModules]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!loggedIn) {
      setProfile(null);
      setProfileError("");
      return undefined;
    }
    let alive = true;
    setProfileLoading(true);
    setProfileError("");
    api.currentUser()
      .then((current) => {
        if (!alive) return;
        setProfile(current);
        if (current.factory) setSelectedFactory(current.factory);
        const nextRoles = current.roles?.length ? [...current.roles] : [current.role];
        const nextAccess = current.access || { modules: [...current.modules], actions: [...current.actions] };
        setAuth((prev) =>
          prev.role === current.role && prev.factoryId === current.factoryId && sameRoles(prev.roles, nextRoles) && sameAccess(prev.access, nextAccess)
            ? prev
            : { ...prev, role: current.role, roles: nextRoles, factoryId: current.factoryId, access: nextAccess }
        );
      })
      .catch((err) => {
        if (!alive) return;
        setProfileError(err instanceof Error ? err.message : "Не удалось загрузить профиль");
      })
      .finally(() => {
        if (alive) setProfileLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loggedIn]);

  useEffect(() => {
    const current = data?.currentUser;
    if (!loggedIn || !current) return;
    if (current.factory) setSelectedFactory(current.factory);
    const nextRoles = current.roles?.length ? [...current.roles] : [current.role];
    const nextAccess = current.access || accessForRoles(nextRoles);
    setAuth((prev) =>
      prev.role === current.role && prev.factoryId === current.factoryId && sameRoles(prev.roles, nextRoles) && sameAccess(prev.access, nextAccess)
        ? prev
        : { ...prev, role: current.role, roles: nextRoles, factoryId: current.factoryId, access: nextAccess }
    );
  }, [loggedIn, data?.currentUser]);

  const openModule = (key: ModuleKey) => {
    setActive(key);
    setView({ type: "list" });
  };

  const openPlan = (planId: string) => {
    setActive("plans");
    setView({ type: "plan", kind: planKindForRole(role), planId });
  };

  const logout = () => {
    api.logout().catch(() => clearAuthTokens()).finally(() => {
      setProfile(null);
      setAuth({ loggedIn: false, role: "factoryPlanner", roles: ["factoryPlanner"], access: emptyAccess });
    });
  };

  const closeDialog = (confirmed: boolean) => {
    dialog?.resolve(confirmed);
    setDialog(null);
  };

  if (!loggedIn) {
    return (
      <Login
        onLogin={(nextRole, nextRoles, nextAccess, nextFactoryId, nextFactory) => {
          setSelectedFactory(nextFactory || null);
          setAuth({ loggedIn: true, role: nextRole, roles: nextRoles.length ? nextRoles : [nextRole], factoryId: nextFactoryId, access: nextAccess });
          setActive(modulesForAccess(nextAccess)[0] || "profile");
        }}
      />
    );
  }

  return (
    <UiFeedbackContext.Provider value={feedback}>
      <main className="min-h-[100dvh] bg-[#eef2f1] text-refDark">
        <MobileHeader
          active={active}
          selectedFactory={selectedFactory}
          openModule={openModule}
          logout={logout}
        />

        {legacyError && legacyEnabled && <div className="mx-auto mt-3 max-w-[1400px] rounded-md bg-red-50 px-4 py-2 text-sm font-bold text-red-700">{legacyError}</div>}
        {!online && <OfflineNotice hasData={Boolean(data)} />}
        {notice && <div className={`fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm font-black text-white shadow-panel ${noticeTone === "error" ? "bg-red-600" : noticeTone === "warning" ? "bg-orange-500" : "bg-refGreen"}`}>{notice}</div>}

        <div className="grid min-h-[100dvh] w-full lg:grid-cols-[260px_1fr]">
          <Sidebar
            role={role}
            profile={profile}
            selectedFactory={selectedFactory}
            modules={navModules}
            active={active}
            setActive={openModule}
          />
          <section className="min-w-0 px-2 pb-24 pt-3 md:px-3 lg:px-4 lg:py-4">
            <Workspace
              role={role}
              access={access}
              active={active}
              view={view}
              setView={setView}
              data={data}
              mutate={mutate}
              loadMore={loadMore}
              profile={profile}
              profileLoading={profileLoading}
              profileError={profileError}
              selectedFactory={selectedFactory}
              openModule={openModule}
              openPlan={openPlan}
              logout={logout}
              legacyEnabled={legacyEnabled}
            />
          </section>
        </div>

        <MobileNav modules={navModules} active={active} setActive={openModule} />
        {dialog && <ActionDialog dialog={dialog} close={closeDialog} />}
      </main>
    </UiFeedbackContext.Provider>
  );
}

function Login({ onLogin }: { onLogin: (role: RoleKey, roles: RoleKey[], access: RoleAccess, factoryId?: string, factory?: Factory) => void }) {
  const saved = useMemo(() => readJson<{ login?: string }>(savedLoginKey, {}), []);
  const [login, setLogin] = useState(saved.login || "admin");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordChange, setPasswordChange] = useState<{ oldPassword: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [pending, setPending] = useState<{
    response: LoginResponse;
    role: RoleKey;
    roles: RoleKey[];
    access: RoleAccess;
    factories: Factory[];
  } | null>(null);

  const startSession = (result: LoginResponse) => {
    const nextRole = result.user?.role || result.role;
    const nextRoles = result.user?.roles?.length ? [...result.user.roles] : result.roles?.length ? [...result.roles] : [nextRole];
    const nextAccess = result.user?.access || result.permissions || accessForRoles(nextRoles);
    const factories = (result.user?.factories?.length ? [...result.user.factories] : result.factories?.length ? [...result.factories] : [])
      .filter((factory) => factory.active);
    if (factories.length > 1) {
      setPending({ response: result, role: nextRole, roles: nextRoles, access: nextAccess, factories });
      return;
    }
    localStorage.setItem(savedLoginKey, JSON.stringify({ login }));
    onLogin(nextRole, nextRoles, nextAccess, result.user?.factoryId || result.factory?.id, result.user?.factory || result.factory);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.login(login);
      startSession(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  };

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordChange || submitting) return;
    setError("");
    if (newPassword.length < 8) {
      setError("Новый пароль должен быть минимум 8 символов");
      return;
    }
    if (newPassword !== repeatPassword) {
      setError("Пароли не совпадают");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(passwordChange.oldPassword, newPassword);
      const result = await api.login(login, newPassword);
      setPasswordChange(null);
      setNewPassword("");
      setRepeatPassword("");
      startSession(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setSubmitting(false);
    }
  };

  const selectFactory = async (factory: Factory) => {
    if (!pending || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const currentFactoryId = pending.response.user?.factoryId || pending.response.factory?.id;
      const result = factory.id === currentFactoryId ? pending.response : await api.selectFactory(factory.id);
      const nextRole = result.user?.role || result.role || pending.role;
      const nextRoles = result.user?.roles?.length ? [...result.user.roles] : result.roles?.length ? [...result.roles] : pending.roles;
      const nextAccess = result.user?.access || result.permissions || pending.access;
      localStorage.setItem(savedLoginKey, JSON.stringify({ login }));
      onLogin(nextRole, nextRoles, nextAccess, result.user?.factoryId || result.factory?.id || factory.id, result.user?.factory || result.factory || factory);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выбрать фабрику");
    } finally {
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    setSubmitting(true);
    api.logout().catch(() => undefined).finally(() => {
      clearAuthTokens();
      setPending(null);
      setPasswordChange(null);
      setNewPassword("");
      setRepeatPassword("");
      setError("");
      setSubmitting(false);
    });
  };

  if (passwordChange) {
    return (
      <PasswordChange
        login={login}
        newPassword={newPassword}
        repeatPassword={repeatPassword}
        submitting={submitting}
        error={error}
        setNewPassword={setNewPassword}
        setRepeatPassword={setRepeatPassword}
        onSubmit={submitPasswordChange}
        onBack={backToLogin}
      />
    );
  }

  if (pending) {
    return (
      <FactoryChoice
        factories={pending.factories}
        selectedFactoryId={pending.response.user?.factoryId || pending.response.factory?.id}
        submitting={submitting}
        error={error}
        onSelect={selectFactory}
        onBack={backToLogin}
      />
    );
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#eef2f1] px-4 py-6">
      <section className="w-full max-w-[390px] rounded-2xl bg-white p-6 shadow-panel">
        <div className="mb-4 text-center">
          <h1 className="text-2xl font-black leading-tight text-refDark">Вход в систему</h1>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Логин</span>
            <input className="field" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="admin" />
          </label>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-bold text-red-700">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={submitting}>{submitting ? "Входим..." : "Войти"}</button>
        </form>
      </section>
    </main>
  );
}

function FactoryChoice({ factories, selectedFactoryId, submitting, error, onSelect, onBack }: { factories: Factory[]; selectedFactoryId?: string; submitting: boolean; error: string; onSelect: (factory: Factory) => void; onBack: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#eef2f1] px-4 py-6">
      <section className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-panel">
        <div className="mb-5">
          <h1 className="text-2xl font-black leading-tight text-refDark">Выберите фабрику</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">Доступно несколько рабочих областей</p>
        </div>
        <div className="grid gap-2">
          {factories.map((factory) => (
            <button
              key={factory.id}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${factory.id === selectedFactoryId ? "border-refGreen bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-refGreen hover:bg-emerald-50/60"}`}
              disabled={submitting}
              onClick={() => onSelect(factory)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-refGreen shadow-sm">
                  <FactoryIcon size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-refDark">{factory.name}</span>
                  <span className="block truncate text-xs font-bold text-slate-500">{factory.timezone?.replace("Asia/", "UTC+5 · ") || "UTC+5"}</span>
                </span>
              </span>
              <span className="shrink-0 text-xs font-black text-refGreen">{factory.id === selectedFactoryId ? "Основная" : ""}</span>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-bold text-red-700">{error}</p>}
        <button className="mt-4 rounded-md bg-slate-200 px-4 py-2 text-sm font-black text-slate-700" disabled={submitting} onClick={onBack}>
          Назад
        </button>
      </section>
    </main>
  );
}

function PasswordChange({
  login,
  newPassword,
  repeatPassword,
  submitting,
  error,
  setNewPassword,
  setRepeatPassword,
  onSubmit,
  onBack
}: {
  login: string;
  newPassword: string;
  repeatPassword: string;
  submitting: boolean;
  error: string;
  setNewPassword: (value: string) => void;
  setRepeatPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#eef2f1] px-4 py-6">
      <section className="w-full max-w-[390px] rounded-2xl bg-white p-6 shadow-panel">
        <div className="mb-4 text-center">
          <h1 className="text-2xl font-black leading-tight text-refDark">Смена пароля</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">{login}</p>
        </div>
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Новый пароль</span>
            <input className={`field ${error ? "border-red-400 focus:border-red-500 focus:ring-red-200" : ""}`} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-500">Повторите пароль</span>
            <input className={`field ${error ? "border-red-400 focus:border-red-500 focus:ring-red-200" : ""}`} value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-bold text-red-700">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={submitting}>{submitting ? "Сохраняем..." : "Сменить пароль"}</button>
        </form>
        <button className="mt-3 w-full rounded-md bg-slate-200 px-4 py-2 text-sm font-black text-slate-700" disabled={submitting} onClick={onBack}>
          Назад
        </button>
      </section>
    </main>
  );
}

function Sidebar({ role, profile, selectedFactory, modules, active, setActive }: { role: RoleKey; profile: CurrentUserProfile | null; selectedFactory: Factory | null; modules: ModuleKey[]; active: ModuleKey; setActive: (key: ModuleKey) => void }) {
  return (
    <aside className="hidden border-r border-slate-200 bg-white px-3 py-6 lg:block">
      <img src="/ref-logo.png" alt="REF" className="h-14 w-24 object-contain" />
      <div className="mt-5">
        <p className="text-sm font-black text-refDark">{profile?.factoryName || selectedFactory?.name || "Рефтинская птицефабрика"}</p>
        <p className="mt-1 text-xs font-bold text-slate-500">{selectedFactory?.timezone?.replace("Asia/", "UTC+5 · ") || profile?.factory?.timezone?.replace("Asia/", "UTC+5 · ") || "UTC+5"}</p>
      </div>
      <nav className="mt-10 space-y-2">
        {modules.map((key) => {
          const Icon = moduleIcon(key);
          return (
            <button key={key} className={`nav-item ${active === key ? "nav-item-active" : ""}`} onClick={() => setActive(key)}>
              <Icon size={18} />
              {labelForModule(key)}
            </button>
          );
        })}
      </nav>
      <div className="mt-[min(38vh,360px)] border-t border-slate-200 pt-6">
        <p className="text-sm font-black text-refDark">{profile?.fullName || "Пользователь"}</p>
        <p className="mt-1 text-xs font-bold text-slate-500">{profile?.role || role}</p>
      </div>
    </aside>
  );
}

function MobileHeader({ active, selectedFactory, openModule, logout }: { active: ModuleKey; selectedFactory: Factory | null; openModule: (key: ModuleKey) => void; logout: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/ref-logo.png" alt="REF" className="h-10 w-14 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-black">{labelForModule(active)}</p>
            <p className="truncate text-xs font-bold text-slate-500">{selectedFactory?.name || "Рабочая область"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-button" onClick={() => openModule("notifications")} title="Уведомления">
            <Bell size={18} />
          </button>
          <button className="icon-button" title="Выйти" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function MobileNav({ modules, active, setActive }: { modules: ModuleKey[]; active: ModuleKey; setActive: (key: ModuleKey) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white lg:hidden">
      {modules.map((key) => {
        const Icon = moduleIcon(key);
        return (
          <button key={key} className={`flex min-w-[96px] flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px] font-black ${active === key ? "text-refGreen" : "text-slate-600"}`} onClick={() => setActive(key)}>
            <Icon size={18} />
            {labelForModule(key)}
          </button>
        );
      })}
    </nav>
  );
}

function Workspace({
  role,
  access,
  active,
  view,
  setView,
  data,
  mutate,
  loadMore,
  profile,
  profileLoading,
  profileError,
  selectedFactory,
  openModule,
  openPlan,
  logout,
  legacyEnabled
}: {
  role: RoleKey;
  access: RoleAccess;
  active: ModuleKey;
  view: ViewState;
  setView: (view: ViewState) => void;
  data: BootstrapData | null;
  mutate: BootstrapMutate;
  loadMore: BootstrapLoadMore;
  profile: CurrentUserProfile | null;
  profileLoading: boolean;
  profileError: string;
  selectedFactory: Factory | null;
  openModule: (key: ModuleKey) => void;
  openPlan: (planId: string) => void;
  logout: () => void;
  legacyEnabled: boolean;
}) {
  if (!hasModule(access, active)) {
    return <Empty title="Нет доступа" text="Этот раздел не входит в права текущего пользователя." />;
  }
  if (active === "dashboard") {
    return hasAction(access, "dashboard.requestFactAnalytics.view")
      ? <DashboardAnalytics profile={profile} factoryId={profile?.factoryId || selectedFactory?.id} />
      : <Empty title="Нет доступа" text="Просмотр дашборда недоступен для текущего набора прав." />;
  }
  if (active === "notifications") {
    return hasAction(access, "notifications.view")
      ? <NotificationsCenter onNavigate={openModule} />
      : <Empty title="Нет доступа" text="Уведомления недоступны для текущего набора прав." />;
  }
  if (active === "profile") {
    return hasAction(access, "profile.view")
      ? <UserProfile profile={profile} loading={profileLoading} error={profileError} onLogout={logout} />
      : <Empty title="Нет доступа" text="Профиль недоступен для текущего набора прав." />;
  }
  if (active === "adminUsers") {
    return hasAction(access, "admin.users.manage") ? <AdminUsers profile={profile} /> : <Empty title="Нет доступа" text="Нет права на управление пользователями." />;
  }

  if (!legacyEnabled || !data) {
    return <Empty title="Загружаем раздел" text="Получаем данные выбранного рабочего раздела." />;
  }
  if (active === "plans") {
    return hasAction(access, "plans.view")
      ? <Plans role={role} access={access} view={view} setView={setView} data={data} mutate={mutate} />
      : <Empty title="Нет доступа" text="Просмотр планов недоступен для текущего набора прав." />;
  }
  if (active === "dictionaries") {
    return hasAction(access, "admin.users.manage")
      ? <Dictionaries data={data} mutate={mutate} openPlan={openPlan} />
      : <Empty title="Нет доступа" text="Справочники доступны только администратору." />;
  }
  if (active === "personnel") {
    return hasAction(access, "personnel.view")
      ? <PersonnelV2 view={view} setView={setView} data={data} mutate={mutate} loadMore={loadMore} />
      : <Empty title="Нет доступа" text="Просмотр персонала недоступен для текущего набора прав." />;
  }
  if (active === "housing") {
    return hasAction(access, "housing.view")
      ? <Housing data={data} mutate={mutate} loadMore={loadMore} />
      : <Empty title="Нет доступа" text="Просмотр проживания недоступен для текущего набора прав." />;
  }
  if (active === "facts") {
    return hasAction(access, "facts.view")
      ? <FactsV2 role={role} access={access} view={view} setView={setView} data={data} mutate={mutate} loadMore={loadMore} />
      : <Empty title="Нет доступа" text="Фиксация работ недоступна для текущего набора прав." />;
  }
  return <Empty title="Раздел готовится" text="Раздел подключен к ролевой карте и готов для следующего этапа UI." />;
}

function OfflineNotice({ hasData }: { hasData: boolean }) {
  return (
    <div className="mx-auto mt-3 max-w-[1400px] rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-800">
      {hasData ? "Нет сети, данные могут быть неактуальны." : "Нет сети. Данные могут быть неактуальны, часть действий временно недоступна."}
    </div>
  );
}

function ActionDialog({ dialog, close }: { dialog: ActionDialogState; close: (confirmed: boolean) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <section className="w-full max-w-sm rounded-xl bg-white p-4 shadow-panel">
        <h2 className="text-lg font-black text-refDark">{dialog.title}</h2>
        <p className="mt-2 text-sm font-semibold leading-5 text-slate-600">{dialog.message}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="h-11 rounded-md bg-slate-200 px-3 text-sm font-black text-slate-700" onClick={() => close(false)}>
            {dialog.cancelLabel}
          </button>
          <button className={`h-11 rounded-md px-3 text-sm font-black text-white ${dialog.tone === "error" ? "bg-red-600" : dialog.tone === "warning" ? "bg-orange-500" : "bg-refGreen"}`} onClick={() => close(true)}>
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function moduleIcon(module: ModuleKey) {
  return {
    dashboard: BarChart3,
    plans: ClipboardList,
    dictionaries: BookOpen,
    personnel: Users,
    housing: BedDouble,
    facts: FactoryIcon,
    notifications: Bell,
    profile: UserCircle,
    adminUsers: ShieldCheck
  }[module];
}

function planKindForRole(role: RoleKey) {
  if (role === "hr") return "hr";
  if (role === "outsourcer" || role === "outsourcerBrigadier") return "out";
  return "factory";
}
