UPDATE "plan_statuses" SET "title" = 'У планировщика фабрики' WHERE "code" = 'draft';
UPDATE "plan_statuses" SET "title" = 'У HR' WHERE "code" = 'submitted_to_hr';
UPDATE "plan_statuses" SET "title" = 'У аутсорсера' WHERE "code" = 'received_by_outsourcer';
UPDATE "plan_statuses" SET "title" = 'У согласующего' WHERE "code" = 'on_approval';
UPDATE "plan_statuses" SET "title" = 'У мастеров' WHERE "code" = 'approved';
UPDATE "plan_statuses" SET "title" = 'У аутсорсера (доработка)' WHERE "code" = 'rejected';
