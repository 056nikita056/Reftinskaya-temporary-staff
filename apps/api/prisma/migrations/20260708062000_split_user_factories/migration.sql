-- Split user/factory membership from role assignments.
CREATE TABLE "user_factories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "outsourcer_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_factories_pkey" PRIMARY KEY ("id")
);

INSERT INTO "user_factories" ("user_id", "factory_id", "outsourcer_id")
SELECT
    "user_id",
    "factory_id",
    (array_agg("outsourcer_id") FILTER (WHERE "outsourcer_id" IS NOT NULL))[1]
FROM "user_factory_roles"
GROUP BY "user_id", "factory_id";

ALTER TABLE "user_factory_roles" ADD COLUMN "user_factory_id" UUID;

UPDATE "user_factory_roles" AS ufr
SET "user_factory_id" = uf."id"
FROM "user_factories" AS uf
WHERE uf."user_id" = ufr."user_id"
  AND uf."factory_id" = ufr."factory_id";

ALTER TABLE "user_factory_roles" ALTER COLUMN "user_factory_id" SET NOT NULL;

ALTER TABLE "user_factory_roles" DROP CONSTRAINT "user_factory_roles_user_id_fkey";
ALTER TABLE "user_factory_roles" DROP CONSTRAINT "user_factory_roles_factory_id_fkey";
ALTER TABLE "user_factory_roles" DROP CONSTRAINT "user_factory_roles_outsourcer_id_fkey";
ALTER TABLE "user_factory_roles" DROP CONSTRAINT "user_factory_roles_pkey";

DROP INDEX "user_factory_roles_user_id_idx";
DROP INDEX "user_factory_roles_factory_id_role_id_idx";
DROP INDEX "user_factory_roles_outsourcer_id_idx";

ALTER TABLE "user_factory_roles" DROP COLUMN "user_id";
ALTER TABLE "user_factory_roles" DROP COLUMN "factory_id";
ALTER TABLE "user_factory_roles" DROP COLUMN "outsourcer_id";

ALTER TABLE "user_factory_roles" ADD CONSTRAINT "user_factory_roles_pkey" PRIMARY KEY ("user_factory_id", "role_id");

CREATE UNIQUE INDEX "user_factories_user_id_factory_id_key" ON "user_factories"("user_id", "factory_id");
CREATE INDEX "user_factories_factory_id_idx" ON "user_factories"("factory_id");
CREATE INDEX "user_factories_outsourcer_id_idx" ON "user_factories"("outsourcer_id");
CREATE INDEX "user_factory_roles_role_id_idx" ON "user_factory_roles"("role_id");

ALTER TABLE "user_factories" ADD CONSTRAINT "user_factories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_factories" ADD CONSTRAINT "user_factories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_factories" ADD CONSTRAINT "user_factories_outsourcer_id_fkey" FOREIGN KEY ("outsourcer_id") REFERENCES "outsourcers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_factory_roles" ADD CONSTRAINT "user_factory_roles_user_factory_id_fkey" FOREIGN KEY ("user_factory_id") REFERENCES "user_factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
