ALTER TABLE "plan_operations" ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

CREATE INDEX "plan_operations_plan_id_created_at_idx" ON "plan_operations"("plan_id", "created_at");
