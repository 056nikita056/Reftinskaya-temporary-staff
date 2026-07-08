-- Replace user_factories/user_factory_roles with direct join tables:
-- users_factories and users_roles.
CREATE TABLE "users_factories" (
    "user_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "outsourcer_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_factories_pkey" PRIMARY KEY ("user_id", "factory_id")
);

CREATE TABLE "users_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "users_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

INSERT INTO "users_factories" ("user_id", "factory_id", "outsourcer_id", "active")
SELECT "user_id", "factory_id", "outsourcer_id", "active"
FROM "user_factories"
ON CONFLICT ("user_id", "factory_id") DO UPDATE SET
    "outsourcer_id" = EXCLUDED."outsourcer_id",
    "active" = EXCLUDED."active";

INSERT INTO "users_roles" ("user_id", "role_id")
SELECT DISTINCT uf."user_id", ufr."role_id"
FROM "user_factory_roles" AS ufr
JOIN "user_factories" AS uf ON uf."id" = ufr."user_factory_id"
ON CONFLICT ("user_id", "role_id") DO NOTHING;

CREATE INDEX "users_factories_factory_id_idx" ON "users_factories"("factory_id");
CREATE INDEX "users_factories_outsourcer_id_idx" ON "users_factories"("outsourcer_id");
CREATE INDEX "users_roles_role_id_idx" ON "users_roles"("role_id");

ALTER TABLE "users_factories" ADD CONSTRAINT "users_factories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users_factories" ADD CONSTRAINT "users_factories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users_factories" ADD CONSTRAINT "users_factories_outsourcer_id_fkey" FOREIGN KEY ("outsourcer_id") REFERENCES "outsourcers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "user_factory_roles";
DROP TABLE "user_factories";
