ALTER TABLE "operations" ADD COLUMN "parent_id" UUID;
ALTER TABLE "operations" ADD COLUMN "is_folder" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "operations_parent_id_idx" ON "operations"("parent_id");
ALTER TABLE "operations" ADD CONSTRAINT "operations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
