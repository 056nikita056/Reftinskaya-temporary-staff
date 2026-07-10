import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const roles = [
  ["factoryPlanner", "Директор по производству"],
  ["hr", "HR-специалист фабрики"],
  ["directorOutsourcing", "Директор по аутсорсингу"],
  ["outsourcer", "Менеджер аутсорсера"],
  ["outsourcerBrigadier", "Бригадир аутсорсера"],
  ["hrOutsourcer", "HR-специалист аутсорсера"],
  ["warden", "Комендант"],
  ["factoryMaster", "Мастер фабрики"],
  ["outMaster", "Мастер аутсорсера"],
  ["tempEmployee", "Временный сотрудник"],
  ["admin", "Администратор"]
] as const;

const planStatuses = [
  ["00000000-0000-0000-0000-000000000001", "draft", "У планировщика фабрики"],
  ["00000000-0000-0000-0000-000000000002", "submitted_to_hr", "У HR"],
  ["00000000-0000-0000-0000-000000000003", "received_by_outsourcer", "У аутсорсера"],
  ["00000000-0000-0000-0000-000000000004", "on_approval", "У согласующего"],
  ["00000000-0000-0000-0000-000000000005", "approved", "У мастеров"],
  ["00000000-0000-0000-0000-000000000006", "rejected", "У аутсорсера (доработка)"]
] as const;

async function upsertDemoFactory() {
  const existingFactory = await prisma.factory.findFirst({
    where: { name: "Рефтинская" }
  });

  if (existingFactory) {
    return prisma.factory.update({
      where: { id: existingFactory.id },
      data: {
        active: true,
        timezone: "Asia/Yekaterinburg"
      }
    });
  }

  return prisma.factory.create({
    data: {
      name: "Рефтинская",
      timezone: "Asia/Yekaterinburg",
      active: true
    }
  });
}

async function main(): Promise<void> {
  await Promise.all(
    planStatuses.map(([id, code, title]) =>
      prisma.planStatus.upsert({
        where: { code },
        update: {
          title,
          active: true
        },
        create: {
          id,
          code,
          title,
          active: true
        }
      })
    )
  );

  const roleRecords = await Promise.all(
    roles.map(([code, name]) =>
      prisma.role.upsert({
        where: { code },
        update: {
          name,
          active: true
        },
        create: {
          code,
          name,
          active: true
        }
      })
    )
  );
  const adminRole = roleRecords.find((role) => role.code === "admin");
  if (!adminRole) {
    throw new Error("Admin role was not seeded");
  }

  const factory = await upsertDemoFactory();
  const password = process.env.SEED_ADMIN_PASSWORD || "admin12345";
  const passwordHash = await bcrypt.hash(password, 12);
  const adminUser = await prisma.user.upsert({
    where: { login: "admin" },
    update: {
      active: true,
      mustChangePassword: true,
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null
    },
    create: {
      login: "admin",
      passwordHash,
      mustChangePassword: true,
      active: true
    }
  });

  await prisma.userProfile.upsert({
    where: { userId: adminUser.id },
    update: {
      fullName: "Администратор"
    },
    create: {
      userId: adminUser.id,
      fullName: "Администратор"
    }
  });

  await prisma.usersFactory.upsert({
    where: {
      userId_factoryId: {
        userId: adminUser.id,
        factoryId: factory.id
      }
    },
    update: {
      active: true,
      isPrimary: true,
      outsourcerId: null
    },
    create: {
      userId: adminUser.id,
      factoryId: factory.id,
      active: true,
      isPrimary: true,
      outsourcerId: null
    }
  });

  await prisma.usersRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id
      }
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
