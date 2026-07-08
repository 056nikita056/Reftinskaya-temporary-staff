#!/usr/bin/env node

const path = require("node:path");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), "apps/api/.env"), quiet: true });

const prisma = new PrismaClient();

const knownRoles = [
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

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function printHelp() {
  console.log(`
Создание пользователя:
  npm run create:user -- --login ivan --password pass12345 --name "Иван Петров" --roles hr,factoryMaster

Параметры:
  --login       логин пользователя, обязательно
  --password    пароль, минимум 8 символов, обязательно
  --name        ФИО, обязательно
  --roles       роли через запятую, обязательно
  --factory     название фабрики, по умолчанию "Рефтинская"
  --primary-factory true|false, сделать фабрику основной; по умолчанию true, если основной фабрики еще нет
  --email       email, необязательно
  --phone       телефон, необязательно
  --position    должность, необязательно

Доступные роли:
  ${knownRoles.join(", ")}
`);
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const login = args.login?.trim();
  const password = args.password;
  const fullName = args.name?.trim();
  const factoryName = args.factory?.trim() || "Рефтинская";
  const roleCodes = (args.roles || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  if (!login || !password || !fullName || !roleCodes.length) {
    printHelp();
    throw new Error("Нужно указать --login, --password, --name и --roles");
  }
  if (password.length < 8) {
    throw new Error("Пароль должен быть минимум 8 символов");
  }

  const invalidRoles = roleCodes.filter((role) => !knownRoles.includes(role));
  if (invalidRoles.length) {
    throw new Error(`Неизвестные роли: ${invalidRoles.join(", ")}`);
  }

  const factory = await prisma.factory.findFirst({
    where: { name: factoryName, active: true }
  });
  if (!factory) {
    throw new Error(`Активная фабрика "${factoryName}" не найдена`);
  }

  const roles = await prisma.role.findMany({
    where: { code: { in: roleCodes }, active: true }
  });
  const foundRoleCodes = new Set(roles.map((role) => role.code));
  const missingRoles = roleCodes.filter((role) => !foundRoleCodes.has(role));
  if (missingRoles.length) {
    throw new Error(`Роли не найдены в базе: ${missingRoles.join(", ")}`);
  }

  if (args["primary-factory"] && !["true", "false"].includes(args["primary-factory"])) {
    throw new Error("--primary-factory принимает только true или false");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { login },
    update: {
      passwordHash,
      active: true,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null
    },
    create: {
      login,
      passwordHash,
      active: true,
      mustChangePassword: false
    }
  });

  const existingPrimaryFactory = await prisma.usersFactory.findFirst({
    where: {
      userId: user.id,
      isPrimary: true
    }
  });
  const isPrimaryFactory = args["primary-factory"]
    ? args["primary-factory"] === "true"
    : !existingPrimaryFactory || existingPrimaryFactory.factoryId === factory.id;
  if (isPrimaryFactory) {
    await prisma.usersFactory.updateMany({
      where: {
        userId: user.id,
        isPrimary: true,
        NOT: {
          factoryId: factory.id
        }
      },
      data: {
        isPrimary: false
      }
    });
  }

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      fullName,
      email: args.email || null,
      phone: args.phone || null,
      position: args.position || null
    },
    create: {
      userId: user.id,
      fullName,
      email: args.email || null,
      phone: args.phone || null,
      position: args.position || null
    }
  });

  await prisma.usersFactory.upsert({
    where: {
      userId_factoryId: {
        userId: user.id,
        factoryId: factory.id
      }
    },
    update: {
      active: true,
      isPrimary: isPrimaryFactory,
      outsourcerId: null
    },
    create: {
      userId: user.id,
      factoryId: factory.id,
      active: true,
      isPrimary: isPrimaryFactory,
      outsourcerId: null
    }
  });

  for (const role of roles) {
    await prisma.usersRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: role.id
        }
      },
      update: {},
      create: {
        userId: user.id,
        roleId: role.id
      }
    });
  }

  console.log(`Пользователь "${login}" создан/обновлен.`);
  console.log(`Фабрика: ${factory.name}`);
  console.log(`Основная фабрика: ${isPrimaryFactory ? "да" : "нет"}`);
  console.log(`Роли: ${roleCodes.join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
