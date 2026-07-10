ALTER TABLE "operations" ADD COLUMN "section_id" UUID;
CREATE INDEX "operations_section_id_idx" ON "operations"("section_id");
ALTER TABLE "operations" ADD CONSTRAINT "operations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "territories_tree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
