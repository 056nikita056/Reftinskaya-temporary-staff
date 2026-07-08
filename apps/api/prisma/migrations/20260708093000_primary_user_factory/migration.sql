ALTER TABLE "users_factories" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

WITH ranked AS (
  SELECT
    uf."user_id",
    uf."factory_id",
    row_number() OVER (
      PARTITION BY uf."user_id"
      ORDER BY uf."active" DESC, f."name" ASC, uf."factory_id" ASC
    ) AS row_number
  FROM "users_factories" AS uf
  JOIN "factories" AS f ON f."id" = uf."factory_id"
)
UPDATE "users_factories" AS uf
SET "is_primary" = true
FROM ranked
WHERE ranked."user_id" = uf."user_id"
  AND ranked."factory_id" = uf."factory_id"
  AND ranked.row_number = 1;

CREATE UNIQUE INDEX "users_factories_one_primary_per_user_idx"
ON "users_factories"("user_id")
WHERE "is_primary" = true;
