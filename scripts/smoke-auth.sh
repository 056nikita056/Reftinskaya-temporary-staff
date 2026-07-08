#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8096/api/v1}"
DATABASE_URL="${DATABASE_URL:-postgresql://reftinskaya:reftinskaya@localhost:55432/reftinskaya_staff?schema=public}"
ADMIN_LOGIN="${ADMIN_LOGIN:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin12345}"

API_BASE_URL="$API_BASE_URL" \
DATABASE_URL="$DATABASE_URL" \
ADMIN_LOGIN="$ADMIN_LOGIN" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
node --input-type=module <<'NODE'
import { PrismaClient } from "@prisma/client";

const base = process.env.API_BASE_URL;
const login = process.env.ADMIN_LOGIN;
const password = process.env.ADMIN_PASSWORD;
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function resetAdminLockState() {
  await prisma.user.updateMany({
    where: { login },
    data: {
      failedAttempts: 0,
      lockedUntil: null
    }
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function loginAdmin() {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login, password })
  });
}

try {
  await resetAdminLockState();

  const factories = await request("/factories");
  assert(factories.status === 200, `GET /factories expected 200, got ${factories.status}: ${JSON.stringify(factories.body)}`);
  assert(Array.isArray(factories.body), "GET /factories expected an array");
  const factory = factories.body.find((item) => item.name === "Рефтинская");
  assert(factory?.id, "GET /factories did not include factory «Рефтинская»");

  const firstLogin = await loginAdmin();
  assert(firstLogin.status === 200, `login expected 200, got ${firstLogin.status}: ${JSON.stringify(firstLogin.body)}`);
  assert(firstLogin.body?.ok === true, "login response ok is not true");
  assert(firstLogin.body.role === "admin", `login response role expected admin, got ${firstLogin.body?.role}`);
  assert(firstLogin.body.user?.role === "admin", `login response user.role expected admin, got ${firstLogin.body?.user?.role}`);
  assert(firstLogin.body.accessToken, "login response has no accessToken");
  assert(firstLogin.body.refreshToken, "login response has no refreshToken");
  assert(firstLogin.body.permissions?.modules?.length, "login response permissions are empty");
  assert(firstLogin.body.user?.access?.modules?.length, "login response user.access is empty");
  assert(firstLogin.body.roles?.includes("admin"), "login response roles does not include admin");

  const guardedBusiness401 = await request("/auth/change-password", {
    method: "POST",
    headers: {
      authorization: `Bearer ${firstLogin.body.accessToken}`
    },
    body: JSON.stringify({
      oldPassword: "definitely-wrong-password",
      newPassword: "newPassword12345"
    })
  });
  assert(
    guardedBusiness401.status === 401 && guardedBusiness401.body?.code === "INVALID_CREDENTIALS",
    `Bearer token did not reach business logic; expected 401 INVALID_CREDENTIALS, got ${guardedBusiness401.status}: ${JSON.stringify(guardedBusiness401.body)}`
  );

  const refreshed = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: firstLogin.body.refreshToken })
  });
  assert(refreshed.status === 200, `refresh expected 200, got ${refreshed.status}: ${JSON.stringify(refreshed.body)}`);
  assert(refreshed.body.accessToken, "refresh response has no accessToken");
  assert(refreshed.body.refreshToken, "refresh response has no refreshToken");
  assert(refreshed.body.refreshToken !== firstLogin.body.refreshToken, "refreshToken was not rotated");

  const refreshReuse = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: firstLogin.body.refreshToken })
  });
  assert(refreshReuse.status === 401, `old refresh token reuse expected 401, got ${refreshReuse.status}: ${JSON.stringify(refreshReuse.body)}`);

  const logoutLogin = await loginAdmin();
  assert(logoutLogin.status === 200, `login before logout expected 200, got ${logoutLogin.status}: ${JSON.stringify(logoutLogin.body)}`);
  const logout = await request("/auth/logout", {
    method: "POST",
    headers: {
      authorization: `Bearer ${logoutLogin.body.accessToken}`
    }
  });
  assert(logout.status === 200 && logout.body?.ok === true, `logout expected 200 ok:true, got ${logout.status}: ${JSON.stringify(logout.body)}`);
  const refreshAfterLogout = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: logoutLogin.body.refreshToken })
  });
  assert(refreshAfterLogout.status === 401, `refresh after logout expected 401, got ${refreshAfterLogout.status}: ${JSON.stringify(refreshAfterLogout.body)}`);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const badLogin = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password: `wrong-${attempt}` })
    });
    assert(badLogin.status === 401, `bad login #${attempt} expected 401, got ${badLogin.status}: ${JSON.stringify(badLogin.body)}`);
  }

  const lockedLogin = await loginAdmin();
  assert(
    lockedLogin.status === 401 && lockedLogin.body?.code === "ACCOUNT_LOCKED",
    `locked login expected 401 ACCOUNT_LOCKED, got ${lockedLogin.status}: ${JSON.stringify(lockedLogin.body)}`
  );

  await resetAdminLockState();
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: base,
        factoryId: factory.id,
        checked: [
          "factories",
          "login",
          "bearer-guard",
          "refresh-rotation",
          "refresh-reuse-detection",
          "logout-revokes-refresh",
          "lockout-and-reset"
        ]
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(`smoke-auth failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
NODE
