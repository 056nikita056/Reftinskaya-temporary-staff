export declare const USER_ROLES: readonly [
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

export type UserRole = (typeof USER_ROLES)[number];
export type RoleKey = UserRole;

export type AccessModule = "dashboard" | "plans" | "dictionaries" | "personnel" | "housing" | "facts" | "notifications" | "profile" | "adminUsers";
export type AccessAction =
  | "dashboard.requestFactAnalytics.view"
  | "notifications.view"
  | "profile.view"
  | "admin.users.manage"
  | "demandRequests.edit"
  | "deviationReasons.edit"
  | "sections.manage"
  | "plans.view"
  | "plans.edit"
  | "plans.factory.edit"
  | "plans.hr.edit"
  | "plans.out.edit"
  | "personnel.view"
  | "personnel.edit"
  | "housing.view"
  | "housing.edit"
  | "facts.view"
  | "facts.edit"
  | "facts.factory.edit"
  | "facts.out.edit";

export type RoleAccess = {
  modules: readonly AccessModule[];
  actions: readonly AccessAction[];
};

export declare const ACCESS_POLICY: Readonly<Record<UserRole, RoleAccess>>;
export declare function accessForRole(role: UserRole | string | undefined): RoleAccess;
export declare function roleHasModule(role: UserRole | string | undefined, module: AccessModule): boolean;
export declare function roleHasAction(role: UserRole | string | undefined, action: AccessAction): boolean;

export type Factory = {
  id: string;
  name: string;
  timezone: string;
  theme?: unknown;
  settings?: unknown;
  active: boolean;
};

export type AppSettings = {
  defaultReservationCost?: number;
};

export type CurrentUser = {
  id: string;
  factoryId: string;
  login: string;
  role: UserRole;
  roles?: readonly UserRole[];
  fullName: string;
  factory?: Factory;
  factories?: readonly Factory[];
  access?: RoleAccess;
};

export type CurrentUserProfile = CurrentUser & {
  email?: string | null;
  factoryName: string;
  modules: readonly AccessModule[];
  actions: readonly AccessAction[];
};

export type AdminUserRow = {
  id: string;
  fullName: string;
  login: string;
  email?: string | null;
  role: UserRole;
  factoryId: string;
  factoryName: string;
  status: "active" | "inactive";
  lastActivityAt?: string | Date | null;
};

export type Block1NotificationType =
  | "planSubmitted"
  | "planApproved"
  | "explanationAdded"
  | "statusChanged"
  | "requestFactDeviation";

export type NotificationItem = {
  id: string;
  type: Block1NotificationType;
  title: string;
  message: string;
  createdAt: string | Date;
  readAt?: string | Date | null;
  isRead: boolean;
  targetType: string | null;
  targetId: string | null;
  factoryId: string;
};

export type Plan = {
  id: string;
  owner_role: string;
  start_date: string;
  end_date: string;
  status: string;
  title?: string;
  required_staff?: number;
  staff_count?: number;
  outsource_count?: number;
};

export type Operation = {
  id: string;
  plan_id: string;
  section_id?: string | null;
  section_name: string;
  section_order: number;
  name: string;
  required_staff: number;
  staff_count: number;
  outsource_count: number;
  demand_month?: number | null;
  demand_week?: number | null;
  demand_day?: number | null;
  deviation_reason?: string | null;
  hours_per_day: number;
  rate_per_hour: number;
  assigned_count?: number;
};

export type Section = {
  id: string;
  factory_id: string;
  name: string;
  order: number;
  active: boolean;
  operation_count?: number;
};

export type Employee = {
  id: string;
  full_name: string;
  country?: string;
  age?: number;
  status: string;
  phone?: string;
  email?: string;
  birth_date?: string;
  passport_no?: string;
  passport_issued?: string;
  registration?: string;
  needs_housing?: number;
  needs_registration?: number;
  driver_categories?: string;
};

export type EmployeeBusy = {
  id: string;
  employee_id: string;
  start_at: string;
  end_at: string;
  source: string;
  ref_id?: string | null;
};

export type Assignment = {
  id: string;
  plan_id: string;
  operation_id: string;
  employee_id: string;
  status: string;
};

export type Dormitory = {
  id: string;
  name: string;
  room_count: number;
  beds_per_room: number;
  rooms?: Room[];
  sort_order?: number;
};

export type Room = {
  id: string;
  dormitory_id: string;
  block: string;
  number: string;
  beds: number;
  order: number;
};

export type HousingPlace = {
  dorm_id: string;
  room_id?: string | null;
  bed_number?: number | null;
  dorm: string;
  block: string;
  room: string;
  bed: string;
  label: string;
  reservation?: {
    room_id?: string | null;
    bed_number?: number | null;
    dorm: string;
    room: string;
    bed: string;
    status: string;
  };
};

export type Reservation = {
  id: string;
  employee_id: string;
  employee_name?: string;
  room_id?: string | null;
  bed_number?: number | null;
  dorm: string;
  room: string;
  bed: string;
  check_in: string;
  check_out: string;
  cost: number;
  comment: string;
  status: string;
};

export type FactEntry = {
  id: string;
  plan_id: string;
  operation_id: string;
  employee_id: string;
  side: string;
  work_date: string;
  operation_done: number;
  start_done: number;
  end_done: number;
  penalty: number;
  started_at: string;
  ended_at: string;
};

export type Explanation = {
  id: string;
  fact_entry_id: string;
  author_name: string;
  author_role: string;
  text: string;
  created_at: string;
};

export type BootstrapPageName = "employees" | "facts" | "reservations";

export type BootstrapQuery = {
  from?: string;
  to?: string;
  planId?: string;
  take?: number;
  employees_cursor?: string;
  facts_cursor?: string;
  reservations_cursor?: string;
};

export type BootstrapData = {
  plans: Plan[];
  sections: Section[];
  operations: Operation[];
  employees: Employee[];
  employeeBusy: EmployeeBusy[];
  assignments: Assignment[];
  reservations: Reservation[];
  housingDorms: Dormitory[];
  housingPlaces: HousingPlace[];
  facts: FactEntry[];
  explanations: Explanation[];
  settings?: AppSettings;
  currentUser?: CurrentUser;
  factory?: Factory;
  permissions?: RoleAccess;
  summary: {
    totalBeds: number;
    occupiedBeds: number;
    freeBeds: number;
    personnelToSettle: number;
  };
  createdEmployeeId?: string;
  createdPlanId?: string;
  selectedDormId?: string;
  pendingMutations?: number;
  scope?: {
    from: string;
    to: string;
    planId?: string;
  };
  pagination?: Record<BootstrapPageName, { nextCursor?: string; take: number }>;
};

export type MutationAction = "created" | "updated" | "deleted" | "upserted";
export type MutationResource = "plans" | "sections" | "operations" | "employees" | "assignments" | "housingDorms" | "reservations" | "facts" | "explanations" | "settings";

export type MutationDelta = {
  ok: true;
  action: MutationAction;
  resource: MutationResource;
  id?: string;
  data?: unknown;
  related?: Record<string, unknown>;
  createdPlanId?: string;
  createdEmployeeId?: string;
  selectedDormId?: string;
};

export type LoginResponse = {
  ok: boolean;
  role: UserRole;
  roles?: readonly UserRole[];
  accessToken?: string;
  refreshToken?: string;
  user?: CurrentUser;
  factory?: Factory;
  factories?: readonly Factory[];
  permissions?: RoleAccess;
  mustChangePassword?: boolean;
};

export type RequestFactAnalyticsQuery = {
  factoryId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  workshopId?: string;
  sectionId?: string;
  role?: UserRole | string;
  userScope?: string;
  search?: string;
};

export type RequestFactAnalyticsRow = {
  sectionId: string;
  sectionName: string;
  workshopName: string;
  parentName: string | null;
  rowType: "workshop" | "section" | "total";
  demandMonth: number;
  demandWeek: number;
  demandDay: number;
  factTotal: number;
  deviationDay: number;
  completionPercentDay: number | null;
  completionPercentWeek: number | null;
  completionPercentMonth: number | null;
  deviationReason: string | null;
};

export type RequestFactAnalyticsSummary = {
  demandMonth: number;
  demandWeek: number;
  demandDay: number;
  factTotal: number;
  factDay: number;
  deviationDay: number;
  completionPercentDay: number | null;
  completionPercentWeek: number | null;
  completionPercentMonth: number | null;
  underfilledSectionsCount: number;
};

export type RequestFactAnalyticsData = {
  factoryId: string;
  filter: RequestFactAnalyticsQuery & { date: string };
  summary: RequestFactAnalyticsSummary;
  rows: RequestFactAnalyticsRow[];
  gaps: string[];
};
