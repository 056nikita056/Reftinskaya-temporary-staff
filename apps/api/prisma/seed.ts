import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const roles = [
  ["factoryPlanner", "Планировщик фабрики"],
  ["hr", "HR фабрики"],
  ["directorOutsourcing", "Директор аутсорсинга"],
  ["outsourcer", "Менеджер аутсорсера"],
  ["outsourcerBrigadier", "Бригадир аутсорсера"],
  ["hrOutsourcer", "HR аутсорсера"],
  ["warden", "Комендант"],
  ["factoryMaster", "Мастер фабрики"],
  ["outMaster", "Мастер аутсорсера"],
  ["tempEmployee", "Временный сотрудник"],
  ["admin", "Администратор"]
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
      passwordHash
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

  await prisma.userFactoryRole.upsert({
    where: {
      userId_factoryId_roleId: {
        userId: adminUser.id,
        factoryId: factory.id,
        roleId: adminRole.id
      }
    },
    update: {
      outsourcerId: null
    },
    create: {
      userId: adminUser.id,
      factoryId: factory.id,
      roleId: adminRole.id,
      outsourcerId: null
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
