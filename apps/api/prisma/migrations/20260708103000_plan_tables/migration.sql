-- Plan domain tables.

CREATE TABLE "plan_statuses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plan_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "territories_tree" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "is_folder" BOOLEAN,

    CONSTRAINT "territories_tree_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "created_at" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_by_user_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_operations" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "territories_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "required_count" INTEGER NOT NULL,
    "staff_count" INTEGER,
    "outsourcing_count" INTEGER,
    "hourly_pay" DECIMAL(12,2),

    CONSTRAINT "plan_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_list" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "date_applyed" DATE,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

INSERT INTO "plan_statuses" ("id", "code", "title", "active") VALUES
    ('00000000-0000-0000-0000-000000000001', 'draft', 'В доработке', true),
    ('00000000-0000-0000-0000-000000000002', 'submitted_to_hr', 'Отправлено', true),
    ('00000000-0000-0000-0000-000000000003', 'received_by_outsourcer', 'Получено', true),
    ('00000000-0000-0000-0000-000000000004', 'on_approval', 'На согласовании', true),
    ('00000000-0000-0000-0000-000000000005', 'approved', 'На очереди', true),
    ('00000000-0000-0000-0000-000000000006', 'rejected', 'Не утверждено', true)
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "plan_statuses_code_key" ON "plan_statuses"("code");
CREATE INDEX "territories_tree_parent_id_idx" ON "territories_tree"("parent_id");
CREATE INDEX "plans_factory_id_start_date_end_date_idx" ON "plans"("factory_id", "start_date", "end_date");
CREATE INDEX "plans_created_by_user_id_idx" ON "plans"("created_by_user_id");
CREATE INDEX "plans_status_id_idx" ON "plans"("status_id");
CREATE UNIQUE INDEX "plan_operations_plan_id_territories_id_operation_id_key" ON "plan_operations"("plan_id", "territories_id", "operation_id");
CREATE INDEX "plan_operations_territories_id_idx" ON "plan_operations"("territories_id");
CREATE INDEX "plan_operations_operation_id_idx" ON "plan_operations"("operation_id");
CREATE INDEX "price_list_operation_id_idx" ON "price_list"("operation_id");
CREATE INDEX "price_list_section_id_idx" ON "price_list"("section_id");
CREATE INDEX "price_list_date_applyed_idx" ON "price_list"("date_applyed");

ALTER TABLE "territories_tree" ADD CONSTRAINT "territories_tree_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "territories_tree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "plan_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_operations" ADD CONSTRAINT "plan_operations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_operations" ADD CONSTRAINT "plan_operations_territories_id_fkey" FOREIGN KEY ("territories_id") REFERENCES "territories_tree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_operations" ADD CONSTRAINT "plan_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "territories_tree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
