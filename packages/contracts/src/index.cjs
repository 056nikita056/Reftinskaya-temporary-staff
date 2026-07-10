const USER_ROLES = Object.freeze([
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
]);

const BASE_MODULES = Object.freeze(["notifications", "profile"]);

const ACCESS_POLICY = Object.freeze({
  factoryPlanner: Object.freeze({
    modules: Object.freeze(["dashboard", "plans", "dictionaries", ...BASE_MODULES]),
    actions: Object.freeze([
      "dashboard.requestFactAnalytics.view",
      "notifications.view",
      "profile.view",
      "demandRequests.edit",
      "deviationReasons.edit",
      "plans.view",
      "plans.edit",
      "plans.factory.edit"
    ])
  }),
  hr: Object.freeze({
    modules: Object.freeze(["dashboard", "plans", ...BASE_MODULES]),
    actions: Object.freeze([
      "dashboard.requestFactAnalytics.view",
      "notifications.view",
      "profile.view",
      "demandRequests.edit",
      "deviationReasons.edit",
      "plans.view",
      "plans.edit",
      "plans.hr.edit"
    ])
  }),
  directorOutsourcing: Object.freeze({
    modules: Object.freeze(["dashboard", "plans", ...BASE_MODULES]),
    actions: Object.freeze(["dashboard.requestFactAnalytics.view", "notifications.view", "profile.view", "plans.view"])
  }),
  outsourcer: Object.freeze({
    modules: Object.freeze(["plans", ...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view", "plans.view", "plans.edit", "plans.out.edit"])
  }),
  outsourcerBrigadier: Object.freeze({
    modules: Object.freeze(["plans", ...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view", "plans.view", "plans.out.approve"])
  }),
  hrOutsourcer: Object.freeze({
    modules: Object.freeze(["personnel", ...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view", "personnel.view", "personnel.edit"])
  }),
  warden: Object.freeze({
    modules: Object.freeze(["housing", ...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view", "housing.view", "housing.edit"])
  }),
  factoryMaster: Object.freeze({
    modules: Object.freeze(["dashboard", "facts", ...BASE_MODULES]),
    actions: Object.freeze(["dashboard.requestFactAnalytics.view", "notifications.view", "profile.view", "facts.view", "facts.edit", "facts.factory.edit"])
  }),
  outMaster: Object.freeze({
    modules: Object.freeze(["facts", ...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view", "facts.view", "facts.edit", "facts.out.edit"])
  }),
  tempEmployee: Object.freeze({
    modules: Object.freeze([...BASE_MODULES]),
    actions: Object.freeze(["notifications.view", "profile.view"])
  }),
  admin: Object.freeze({
    modules: Object.freeze(["dashboard", "plans", "dictionaries", "personnel", "housing", "facts", "notifications", "profile", "adminUsers"]),
    actions: Object.freeze([
      "dashboard.requestFactAnalytics.view",
      "notifications.view",
      "profile.view",
      "admin.users.manage",
      "demandRequests.edit",
      "deviationReasons.edit",
      "sections.manage",
      "plans.view",
      "plans.edit",
      "plans.factory.edit",
      "plans.hr.edit",
      "plans.out.edit",
      "plans.out.approve",
      "personnel.view",
      "personnel.edit",
      "housing.view",
      "housing.edit",
      "facts.view",
      "facts.edit",
      "facts.factory.edit",
      "facts.out.edit"
    ])
  })
});

function accessForRole(role) {
  return ACCESS_POLICY[role] || { modules: BASE_MODULES, actions: Object.freeze([]) };
}

function roleHasModule(role, module) {
  return accessForRole(role).modules.includes(module);
}

function roleHasAction(role, action) {
  return accessForRole(role).actions.includes(action);
}

module.exports = {
  ACCESS_POLICY,
  USER_ROLES,
  accessForRole,
  roleHasAction,
  roleHasModule
};
