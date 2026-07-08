-- Scope territories to factories and support archiving.

ALTER TABLE "territories_tree" ADD COLUMN "factory_id" UUID;
ALTER TABLE "territories_tree" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "territories_tree"
SET "factory_id" = (
    SELECT "id"
    FROM "factories"
    WHERE "active" = true
    ORDER BY "name", "id"
    LIMIT 1
)
WHERE "factory_id" IS NULL;

ALTER TABLE "territories_tree" ALTER COLUMN "factory_id" SET NOT NULL;

CREATE INDEX "territories_tree_factory_id_idx" ON "territories_tree"("factory_id");
CREATE INDEX "territories_tree_factory_id_parent_id_idx" ON "territories_tree"("factory_id", "parent_id");

ALTER TABLE "territories_tree" ADD CONSTRAINT "territories_tree_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
